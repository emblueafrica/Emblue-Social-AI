import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { getValidToken } from '../auth/platformAuth';
import { getConnectedAccountRecord } from '../db/queries';
import { mapEngageCampaign } from '../db/mappers';
import {
  engageEngager,
  fetchFacebookPostEngagers,
  fetchInstagramPostEngagers,
  fetchTikTokPostEngagers,
  resolveInstagramMediaId,
} from '../stream/engageEngagers';
import { broadcastToClients } from '../stream/eventQueue';
import { CampaignConfig, Credentials, Engager, Platform } from '../types';
import { syncXRepliesForPost } from './xReplySync';
import { eligibleForCampaign } from './lifecycle';

type TrackedPost = {
  urlId: bigint;
  brandId: number;
  campaignId: bigint | null;
  platform: Platform;
  postUrl: string;
  postIdExt: string | null;
  includeCommenters: boolean | null;
  includeLikers: boolean | null;
};

export type CampaignEngagementSyncResult = {
  checked: number;
  fetched: number;
  captured: number;
  sent: number;
  queued: number;
  manual: number;
  skipped: number;
  errors: string[];
};

function campaignIdString(post: Pick<TrackedPost, 'campaignId' | 'postIdExt' | 'urlId'>): string {
  return post.campaignId ? String(post.campaignId) : `tracked-${post.postIdExt ?? String(post.urlId)}`;
}

function engagerKey(engager: Engager): string {
  if (engager.action === 'commented') {
    return engager.raw_tweet_id ?? engager.raw_comment_id ?? engager.author_id;
  }
  return engager.author_id;
}

function defaultCampaignConfig(brandId: number, post: TrackedPost): CampaignConfig {
  return {
    id: campaignIdString(post),
    brand_id: brandId,
    name: 'tracked campaign engagement',
    platform: post.platform,
    engage_all: true,
    engage_negative: true,
    tone: 'warm and professional',
    auto_fire_threshold: 85,
    max_per_hour: 50,
    include_commenters: post.includeCommenters ?? true,
    include_likers: post.includeLikers ?? true,
  };
}

async function getCampaignConfig(brandId: number, post: TrackedPost): Promise<CampaignConfig | null> {
  if (!post.campaignId) return defaultCampaignConfig(brandId, post);

  const row = await prisma.engageCampaign.findFirst({
    where: {
      brandId,
      campaignId: post.campaignId,
      isActive: true,
    },
  });

  return row ? mapEngageCampaign(row) : defaultCampaignConfig(brandId, post);
}

async function getCredentials(brandId: number): Promise<Credentials> {
  const [instagramAccount, facebookAccount, metaToken, tiktokToken, xToken] = await Promise.all([
    getConnectedAccountRecord(brandId, 'instagram'),
    getConnectedAccountRecord(brandId, 'facebook'),
    getValidToken(brandId, 'instagram').then(token => token ?? getValidToken(brandId, 'facebook')),
    getValidToken(brandId, 'tiktok'),
    getValidToken(brandId, 'x'),
  ]);

  return {
    META_PAGE_ACCESS_TOKEN: metaToken,
    META_PAGE_ID: facebookAccount?.accountIdExt ?? null,
    META_IG_USER_ID: instagramAccount?.accountIdExt ?? null,
    TIKTOK_ACCESS_TOKEN: tiktokToken,
    X_OAUTH_TOKEN: xToken,
  };
}

async function fetchPostEngagers(post: TrackedPost, credentials: Credentials): Promise<Engager[]> {
  if (!post.postIdExt) return [];

  if (post.platform === 'instagram') {
    if (!credentials.META_PAGE_ACCESS_TOKEN) throw new Error('Meta is not connected for this brand.');
    const mediaId = await resolveInstagramMediaId(post.postIdExt, credentials.META_PAGE_ACCESS_TOKEN, credentials.META_IG_USER_ID);
    return fetchInstagramPostEngagers(mediaId, credentials.META_PAGE_ACCESS_TOKEN, post.includeCommenters ?? true, post.includeLikers ?? true);
  }

  if (post.platform === 'facebook') {
    if (!credentials.META_PAGE_ACCESS_TOKEN) throw new Error('Meta is not connected for this brand.');
    return fetchFacebookPostEngagers(post.postIdExt, credentials.META_PAGE_ACCESS_TOKEN, post.includeCommenters ?? true, post.includeLikers ?? true);
  }

  if (post.platform === 'tiktok') {
    if (!credentials.TIKTOK_ACCESS_TOKEN) throw new Error('TikTok is not connected for this brand.');
    const engagers = await fetchTikTokPostEngagers(post.postIdExt, credentials.TIKTOK_ACCESS_TOKEN);
    engagers.forEach(engager => { engager.raw_video_id = engager.raw_video_id ?? post.postIdExt ?? undefined; });
    return engagers;
  }

  return [];
}

async function createCampaignEngagerIfNew(brandId: number, campaignId: string, engager: Engager): Promise<boolean> {
  try {
    await prisma.campaignPostEngager.create({
      data: {
        brandId,
        campaignId,
        platform: engager.platform as never,
        action: engager.action,
        authorId: engagerKey(engager),
        authorHandle: engager.author_handle,
        originalText: engager.text,
        status: 'pending',
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false;
    }
    throw err;
  }
}

async function updateCampaignEngagerStatus(
  brandId: number,
  campaignId: string,
  engager: Engager,
  status: string
): Promise<void> {
  await prisma.campaignPostEngager.updateMany({
    where: {
      brandId,
      campaignId,
      platform: engager.platform as never,
      authorId: engagerKey(engager),
    },
    data: { status, processedAt: new Date() },
  }).catch(() => undefined);
}

async function persistSocialMessage(brandId: number, post: TrackedPost, engager: Engager): Promise<void> {
  const externalId = engager.raw_tweet_id ?? engager.raw_comment_id ?? `${campaignIdString(post)}:${engager.action}:${engager.author_id}`;
  await prisma.socialMessage.create({
    data: {
      brandId,
      platform: engager.platform as never,
      kind: engager.action === 'liked' ? 'reaction' : 'comment',
      externalId,
      text: engager.text,
      authorHandle: engager.author_handle,
      authorIdHash: engager.author_id,
      url: post.postUrl,
      sentiment: 'neutral',
      urgencyScore: engager.action === 'commented' ? 2 : 1,
      rawMetrics: {},
      raw: {
        source: 'campaign_engagement_sync',
        action: engager.action,
        post_url: post.postUrl,
        post_id: post.postIdExt,
        comment_id: engager.raw_comment_id,
        tweet_id: engager.raw_tweet_id,
      } as Prisma.InputJsonObject,
      capturedAt: engager.timestamp ? new Date(engager.timestamp) : new Date(),
    },
  }).catch(err => {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  });
}

async function syncTrackedPost(
  brandId: number,
  post: TrackedPost,
  credentials: Credentials
): Promise<Omit<CampaignEngagementSyncResult, 'checked' | 'errors'>> {
  const config = await getCampaignConfig(brandId, post);
  if (!config) return { fetched: 0, captured: 0, sent: 0, queued: 0, manual: 0, skipped: 0 };

  const campaignId = String(config.id ?? config.campaign_id ?? campaignIdString(post));
  const fetched = await fetchPostEngagers(post, credentials);
  const eligible = fetched.filter(engager => {
    if (engager.action === 'liked') return config.event_settings?.likes !== false;
    return config.event_settings?.comments !== false && eligibleForCampaign({ kind: 'comment', text: engager.text }, config.keywords ?? []);
  });
  const totals = { fetched: fetched.length, captured: 0, sent: 0, queued: 0, manual: 0, skipped: fetched.length - eligible.length };

  for (const engager of eligible) {
    const isNew = await createCampaignEngagerIfNew(brandId, campaignId, engager);
    if (!isNew) {
      totals.skipped += 1;
      continue;
    }

    totals.captured += 1;
    await persistSocialMessage(brandId, post, engager);

    const result = await engageEngager(
      brandId,
      {
        platform: engager.platform,
        author_handle: engager.author_handle,
        author_id: engager.author_id,
        comment_id: engager.raw_comment_id,
        post_id: engager.raw_video_id ?? post.postIdExt,
        tweet_id: engager.raw_tweet_id ?? engager.raw_comment_id,
        text: engager.text,
        action: engager.action,
      },
      config,
      credentials,
    );

    if (result.status === 'sent') totals.sent += 1;
    else if (result.status === 'queued_for_approval') totals.queued += 1;
    else if (result.status === 'manual_copy') totals.manual += 1;
    else totals.skipped += 1;

    await updateCampaignEngagerStatus(brandId, campaignId, engager, result.status);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await prisma.campaignPostUrl.update({
    where: { urlId: post.urlId },
    data: {
      status: 'complete',
      totalFetched: fetched.length,
      errorMsg: null,
      completedAt: new Date(),
    },
  }).catch(() => undefined);

  return totals;
}

export async function syncTrackedCampaignEngagements(brandId: number): Promise<CampaignEngagementSyncResult> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const trackedPosts = await prisma.campaignPostUrl.findMany({
    where: {
      brandId,
      postIdExt: { not: null },
      submittedAt: { gte: cutoff },
      bindingStatus: 'active',
    },
    orderBy: { submittedAt: 'desc' },
    take: 50,
    select: {
      urlId: true,
      brandId: true,
      campaignId: true,
      platform: true,
      postUrl: true,
      postIdExt: true,
      includeCommenters: true,
      includeLikers: true,
    },
  }) as TrackedPost[];

  const credentials = await getCredentials(brandId);
  const totals: CampaignEngagementSyncResult = {
    checked: 0,
    fetched: 0,
    captured: 0,
    sent: 0,
    queued: 0,
    manual: 0,
    skipped: 0,
    errors: [],
  };

  const seenX = new Set<string>();
  for (const post of trackedPosts) {
    if (!post.postIdExt) continue;
    totals.checked += 1;

    try {
      if (post.platform === 'x') {
        if (seenX.has(post.postIdExt)) continue;
        seenX.add(post.postIdExt);
        const config = await getCampaignConfig(brandId, post);
        const xResult = await syncXRepliesForPost(brandId, post.postIdExt, config ?? undefined);
        totals.fetched += xResult.fetched;
        totals.captured += xResult.captured;
        totals.queued += xResult.queued;
        totals.sent += xResult.sent;
        totals.skipped += xResult.skipped;
        totals.skipped += xResult.duplicates;
        continue;
      }

      const result = await syncTrackedPost(brandId, post, credentials);
      totals.fetched += result.fetched;
      totals.captured += result.captured;
      totals.sent += result.sent;
      totals.queued += result.queued;
      totals.manual += result.manual;
      totals.skipped += result.skipped;
    } catch (err) {
      const message = (err as Error).message;
      totals.errors.push(`${post.platform} ${post.postIdExt}: ${message}`);
      await prisma.campaignPostUrl.update({
        where: { urlId: post.urlId },
        data: { status: 'error', errorMsg: message, completedAt: new Date() },
      }).catch(() => undefined);
    }
  }

  if (totals.checked > 0) {
    broadcastToClients(brandId, 'campaign_engagement_sync_complete', {
      ...totals,
      errors: totals.errors.length,
    });
  }

  return totals;
}
