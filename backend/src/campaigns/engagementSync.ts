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
import { CampaignConfig, Credentials, Engager, EngageResult, Platform } from '../types';
import { syncXRepliesForPost } from './xReplySync';
import { eligibleForCampaign } from './lifecycle';
import { runAgent1 } from '../agents/agent1_listening';
import { Intent } from '../types';
import { prepareCampaignDelivery } from './deliveryWorker';
import { enqueueCampaignDelivery, isBullEnabled } from '../queue/jobs';

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
  ignored: number;
  failed: number;
  skipped: number;
  errors: string[];
  posts: { platform: Platform; post_url: string; fetched: number; captured: number; sent: number; ignored: number; failed: number; error?: string; synced_at: string }[];
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

  return row ? mapEngageCampaign(row) : null;
}

export async function getCampaignCredentials(brandId: number): Promise<Credentials> {
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

async function createCampaignEngagerIfNew(brandId: number, campaignId: string, post: TrackedPost, engager: Engager, status = 'pending', classification?: { intent: Intent; urgency: number }): Promise<bigint | null> {
  try {
    const row = await prisma.campaignPostEngager.create({
      data: {
        brandId,
        campaignId,
        platform: engager.platform as never,
        action: engager.action,
        authorId: engagerKey(engager),
        platformAuthorId: engager.author_id,
        externalEventId: engagerKey(engager),
        commentId: engager.raw_comment_id ?? engager.raw_tweet_id ?? null,
        postId: engager.raw_video_id ?? post.postIdExt,
        authorHandle: engager.author_handle,
        originalText: engager.text,
        intent: classification?.intent,
        urgencyScore: classification?.urgency,
        status,
      },
    });
    return row.engagerId;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null;
    }
    throw err;
  }
}

export async function persistCampaignDeliveryOutcomes(
  engagerId: bigint,
  brandId: number,
  campaignId: number,
  platform: Platform,
  result: EngageResult,
): Promise<void> {
  for (const delivery of result.deliveries ?? []) {
    await prisma.campaignDeliveryAttempt.upsert({
      where: { engagerId_channel: { engagerId, channel: delivery.channel } },
      create: {
        engagerId,
        brandId,
        campaignId: BigInt(campaignId),
        platform: platform as never,
        channel: delivery.channel,
        status: delivery.status,
        externalMessageId: delivery.external_message_id ?? null,
        error: delivery.error ?? null,
        deliveredAt: delivery.status === 'sent' ? new Date() : null,
      },
      update: {
        status: delivery.status,
        externalMessageId: delivery.external_message_id ?? null,
        error: delivery.error ?? null,
        attemptCount: { increment: 1 },
        deliveredAt: delivery.status === 'sent' ? new Date() : undefined,
        updatedAt: new Date(),
      },
    });
  }

  if ((result.deliveries ?? []).some(delivery => delivery.status === 'sent')) {
    const firstDelivery = await prisma.campaignPostEngager.updateMany({
      where: { engagerId, brandId, campaignId: String(campaignId), firstDeliveredAt: null },
      data: { firstDeliveredAt: new Date(), updatedAt: new Date() },
    });
    if (firstDelivery.count) {
      await prisma.engageCampaign.updateMany({
        where: { brandId, campaignId: BigInt(campaignId) },
        data: { totalSent: { increment: 1 }, updatedAt: new Date() },
      });
    }
  }
}

async function updateCampaignEngagerStatus(
  brandId: number,
  campaignId: string,
  engager: Engager,
  status: string,
  replyText?: string,
  deliveryError?: string,
  replyConfidence?: number,
): Promise<void> {
  await prisma.campaignPostEngager.updateMany({
    where: {
      brandId,
      campaignId,
      platform: engager.platform as never,
      externalEventId: engagerKey(engager),
    },
    data: { status, replyText, deliveryError, replyConfidence, processedAt: new Date(), updatedAt: new Date() },
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
): Promise<{ fetched: number; captured: number; sent: number; queued: number; manual: number; ignored: number; failed: number; skipped: number }> {
  const config = await getCampaignConfig(brandId, post);
  if (!config) return { fetched: 0, captured: 0, sent: 0, queued: 0, manual: 0, ignored: 0, failed: 0, skipped: 0 };

  const campaignId = String(config.id ?? config.campaign_id ?? campaignIdString(post));
  const fetched = await fetchPostEngagers(post, credentials);
  const commentEngagers = fetched.filter(engager => engager.action === 'commented');
  const classifications = new Map<string, { intent: Intent; urgency: number }>();
  if (commentEngagers.length) {
    const classified = await runAgent1({
      brand_id: brandId,
      platform: post.platform,
      payload_type: 'api_items',
      source_name: 'campaign_post_sync',
      items: commentEngagers.map(engager => ({ platform: engager.platform, kind: 'comment', text: engager.text, author_handle: engager.author_handle, author_id: engager.author_id })),
    });
    commentEngagers.forEach((engager, index) => classifications.set(engagerKey(engager), {
      intent: classified.classified[index]?.intent ?? 'neutral',
      urgency: classified.classified[index]?.urgency_score ?? 1,
    }));
  }
  const isEligible = (engager: Engager) => {
    if (engager.action === 'liked') return config.event_settings?.likes !== false;
    return config.event_settings?.comments !== false && eligibleForCampaign({ kind: 'comment', text: engager.text }, config.keywords ?? []);
  };
  const totals = { fetched: fetched.length, captured: 0, sent: 0, queued: 0, manual: 0, ignored: 0, failed: 0, skipped: 0 };

  for (const engager of fetched) {
    const eligible = isEligible(engager);
    const engagerId = await createCampaignEngagerIfNew(brandId, campaignId, post, engager, eligible ? 'pending' : 'ignored_keyword', classifications.get(engagerKey(engager)));
    if (!engagerId) {
      totals.skipped += 1;
      continue;
    }

    totals.captured += 1;
    await persistSocialMessage(brandId, post, engager);
    if (!eligible) {
      totals.ignored += 1;
      continue;
    }

    if (!isBullEnabled()) {
      totals.manual += 1;
      await updateCampaignEngagerStatus(brandId, campaignId, engager, 'setup_required', undefined, 'Campaign delivery queue unavailable.');
      continue;
    }

    const numericCampaignId = Number(campaignId);
    const channel = config.reply_mode === 'public' ? 'public_reply' : 'direct_message';
    const delay = Math.max(0, totals.queued) * Math.max(0, config.spacing_minutes ?? 0) * 60_000;
    const data = { brand_id: brandId, campaign_id: numericCampaignId, engager_id: Number(engagerId), channel } as const;
    const scheduledAt = new Date(Date.now() + delay);
    await prepareCampaignDelivery(data, scheduledAt);
    await enqueueCampaignDelivery(data, delay);
    totals.queued += 1;
    await updateCampaignEngagerStatus(brandId, campaignId, engager, 'queued');
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

export async function syncTrackedCampaignEngagements(brandId: number, campaignId?: number): Promise<CampaignEngagementSyncResult> {
  const activeCampaigns = await prisma.engageCampaign.findMany({
    where: { brandId, isActive: true, ...(campaignId ? { campaignId: BigInt(campaignId) } : {}) },
    select: { campaignId: true },
  });
  const activeCampaignIds = activeCampaigns.map(item => item.campaignId);
  const trackedPosts = await prisma.campaignPostUrl.findMany({
    where: {
      brandId,
      campaignId: { in: activeCampaignIds },
      postIdExt: { not: null },
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

  const credentials = await getCampaignCredentials(brandId);
  const totals: CampaignEngagementSyncResult = {
    checked: 0,
    fetched: 0,
    captured: 0,
    sent: 0,
    queued: 0,
    manual: 0,
    ignored: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    posts: [],
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
        totals.failed += xResult.failed;
        totals.posts.push({ platform: post.platform, post_url: post.postUrl, fetched: xResult.fetched, captured: xResult.captured, sent: xResult.sent, ignored: xResult.skipped, failed: xResult.failed, synced_at: new Date().toISOString() });
        continue;
      }

      const result = await syncTrackedPost(brandId, post, credentials);
      totals.fetched += result.fetched;
      totals.captured += result.captured;
      totals.sent += result.sent;
      totals.queued += result.queued;
      totals.manual += result.manual;
      totals.ignored += result.ignored;
      totals.failed += result.failed;
      totals.skipped += result.skipped;
      totals.posts.push({ platform: post.platform, post_url: post.postUrl, fetched: result.fetched, captured: result.captured, sent: result.sent, ignored: result.ignored, failed: result.failed, synced_at: new Date().toISOString() });
    } catch (err) {
      const message = (err as Error).message;
      totals.errors.push(`${post.platform} ${post.postIdExt}: ${message}`);
      totals.failed += 1;
      totals.posts.push({ platform: post.platform, post_url: post.postUrl, fetched: 0, captured: 0, sent: 0, ignored: 0, failed: 1, error: message, synced_at: new Date().toISOString() });
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

export async function retryCampaignEngagement(
  brandId: number,
  campaignId: number,
  engagerId: number,
  editedReply?: string,
): Promise<{ status: string; reply?: string; error?: string }> {
  const [campaign, engager, credentials] = await Promise.all([
    prisma.engageCampaign.findFirst({ where: { brandId, campaignId: BigInt(campaignId), isActive: true } }),
    prisma.campaignPostEngager.findFirst({ where: { brandId, campaignId: String(campaignId), engagerId: BigInt(engagerId) } }),
    getCampaignCredentials(brandId),
  ]);
  if (!campaign) throw new Error('Campaign is not active. Resume it before retrying this reply.');
  if (!engager) throw new Error('Campaign engagement was not found.');

  const config = mapEngageCampaign(campaign);
  if (editedReply?.trim()) {
    config.reply_template = editedReply.trim();
    config.public_reply_template = editedReply.trim();
    config.auto_fire_threshold = 0;
  }
  const result = await engageEngager(
    brandId,
    {
      platform: engager.platform as Platform,
      author_handle: engager.authorHandle ?? engager.platformAuthorId ?? 'customer',
      author_id: engager.platformAuthorId,
      comment_id: engager.commentId,
      post_id: engager.postId,
      tweet_id: engager.platform === 'x' ? engager.commentId : null,
      text: engager.originalText ?? '',
      action: engager.action === 'liked' ? 'liked' : 'commented',
    },
    config,
    credentials,
  );
  const status = result.status === 'queued_for_approval' ? 'needs_review' : result.status;
  await persistCampaignDeliveryOutcomes(engager.engagerId, brandId, campaignId, engager.platform as Platform, result);
  await prisma.campaignPostEngager.update({
    where: { engagerId: engager.engagerId },
    data: {
      status,
      replyText: result.reply ?? editedReply ?? engager.replyText,
      deliveryError: result.error ?? null,
      processedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return { status, reply: result.reply, error: result.error };
}
