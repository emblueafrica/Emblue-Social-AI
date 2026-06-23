import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { getCampaignCredentials } from './engagementSync';
import {
  applyPlatformAllocation,
  extractPostId,
  fetchFacebookPostEngagers,
  fetchInstagramPostEngagers,
  fetchTikTokPostEngagers,
  fetchXPostEngagers,
  resolveInstagramMediaId,
} from '../stream/engageEngagers';
import { runAgent14 } from '../agents/agents9_to_14';
import { CampaignPlatform } from './lifecycle';
import { Engager, PostUrlItem } from '../types';
import { deliveryChannelsForReplyMode, isPreviewFresh } from './unified';
import { enqueueCampaignDelivery, isBullEnabled } from '../queue/jobs';
import { prepareCampaignDelivery } from './deliveryWorker';

type AudienceFilters = {
  audience_types?: Array<'regular' | 'influencer' | 'brand'>;
  skip_verified?: boolean;
  min_followers?: number;
  skip_accounts_newer_than_days?: number;
};

function eventId(engager: Engager): string {
  return engager.raw_tweet_id ?? engager.raw_comment_id ?? `${engager.action}:${engager.author_id}`;
}

async function fetchForPost(brandId: number, post: PostUrlItem): Promise<Engager[]> {
  const postId = post.post_id_ext ?? extractPostId(post.platform, post.url);
  if (!postId) throw new Error(`Could not extract a post ID from ${post.url}`);
  const credentials = await getCampaignCredentials(brandId);
  if (post.platform === 'instagram') {
    const mediaId = await resolveInstagramMediaId(postId, credentials.META_PAGE_ACCESS_TOKEN, credentials.META_IG_USER_ID);
    return fetchInstagramPostEngagers(mediaId, credentials.META_PAGE_ACCESS_TOKEN, post.include_commenters, post.include_likers);
  }
  if (post.platform === 'facebook') {
    return fetchFacebookPostEngagers(postId, credentials.META_PAGE_ACCESS_TOKEN, post.include_commenters, post.include_likers);
  }
  if (post.platform === 'tiktok') return fetchTikTokPostEngagers(postId, credentials.TIKTOK_ACCESS_TOKEN);
  return fetchXPostEngagers(postId, credentials.X_OAUTH_TOKEN);
}

function filterStatus(
  profile: Awaited<ReturnType<typeof runAgent14>> | null,
  filters: AudienceFilters,
): 'eligible' | 'ignored_profile' | 'needs_review' {
  if (!profile) return 'needs_review';
  if (profile.classification === 'bot' || profile.risk_level === 'high') return 'ignored_profile';
  if (filters.audience_types?.length && !filters.audience_types.includes(profile.classification as 'regular' | 'influencer' | 'brand')) return 'ignored_profile';
  if ((filters.min_followers ?? 0) > 0 && profile.follower_count === undefined) return 'needs_review';
  if ((profile.follower_count ?? 0) < (filters.min_followers ?? 0)) return 'ignored_profile';
  if (filters.skip_verified || (filters.skip_accounts_newer_than_days ?? 0) > 0) return 'needs_review';
  return 'eligible';
}

export async function fetchPostUrlCampaignPreview(
  brandId: number,
  campaignId: number,
  posts: PostUrlItem[],
): Promise<Record<string, unknown>> {
  const campaign = await prisma.engageCampaign.findFirst({
    where: { brandId, campaignId: BigInt(campaignId), mode: 'post_url' },
  });
  if (!campaign) throw new Error('Post URL campaign not found.');
  if (!posts.length || posts.length > 10) throw new Error('Provide between 1 and 10 post URLs.');

  const filters = campaign.modeConfig as AudienceFilters;
  await prisma.$transaction([
    prisma.campaignPostUrl.deleteMany({ where: { brandId, campaignId: campaign.campaignId, status: { startsWith: 'preview_' } } }),
    prisma.campaignPostEngager.deleteMany({ where: { brandId, campaignId: String(campaignId), source: 'post_preview', firstDeliveredAt: null } }),
  ]);

  const engagersByPlatform: Record<string, Engager[]> = { instagram: [], facebook: [], tiktok: [], x: [] };
  const errors: string[] = [];
  for (const post of posts) {
    const postId = extractPostId(post.platform, post.url);
    const binding = await prisma.campaignPostUrl.create({
      data: {
        brandId,
        campaignId: campaign.campaignId,
        platform: post.platform as never,
        postUrl: post.url,
        postIdExt: postId,
        includeCommenters: post.include_commenters !== false,
        includeLikers: post.include_likers !== false,
        sourceMode: 'existing',
        bindingStatus: 'preview',
        status: 'preview_fetching',
      },
    });
    try {
      const fetched = await fetchForPost(brandId, { ...post, post_id_ext: postId });
      engagersByPlatform[post.platform]?.push(...fetched);
      await prisma.campaignPostUrl.update({ where: { urlId: binding.urlId }, data: { status: 'preview_complete', totalFetched: fetched.length, completedAt: new Date() } });
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`${post.platform}: ${message}`);
      await prisma.campaignPostUrl.update({ where: { urlId: binding.urlId }, data: { status: 'preview_error', errorMsg: message, completedAt: new Date() } });
    }
  }

  const selected = new Set(applyPlatformAllocation(engagersByPlatform, campaign.platformAllocation as Record<string, number>).map(eventId));
  const counts = { total: 0, commenters: 0, likers: 0, selected: 0, review: 0, ignored: 0 };
  const byPlatform: Record<string, { total: number; selected: number }> = {};
  for (const [platform, engagers] of Object.entries(engagersByPlatform)) {
    byPlatform[platform] = { total: engagers.length, selected: 0 };
    for (const engager of engagers) {
      counts.total += 1;
      if (engager.action === 'commented') counts.commenters += 1; else counts.likers += 1;
      let profile: Awaited<ReturnType<typeof runAgent14>> | null = null;
      try {
        profile = await runAgent14({ brand_id: brandId, user: { handle: engager.author_handle, id: engager.author_id, platform: engager.platform, text: engager.text } });
      } catch { profile = null; }
      const profileResult = filterStatus(profile, filters);
      let status = !selected.has(eventId(engager)) ? 'ignored_allocation'
        : profileResult === 'eligible' ? 'preview_selected'
          : profileResult;
      if (status === 'preview_selected') { counts.selected += 1; byPlatform[platform]!.selected += 1; }
      else if (status === 'needs_review') counts.review += 1;
      else counts.ignored += 1;
      await prisma.campaignPostEngager.create({
        data: {
          brandId,
          campaignId: String(campaignId),
          platform: engager.platform as never,
          action: engager.action,
          authorId: engager.author_id,
          platformAuthorId: engager.author_id,
          authorHandle: engager.author_handle,
          externalEventId: eventId(engager),
          commentId: engager.raw_comment_id ?? engager.raw_tweet_id ?? null,
          postId: engager.raw_video_id ?? null,
          originalText: engager.text,
          source: 'post_preview',
          status,
          profileClassification: profile?.classification ?? null,
          profileFollowerCount: profile?.follower_count ?? null,
          profileStatus: profile ? 'classified' : 'unknown',
        },
      }).catch(error => {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      });
    }
  }

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + 15 * 60 * 1000);
  await prisma.engageCampaign.update({ where: { campaignId: campaign.campaignId }, data: { previewFetchedAt: fetchedAt, previewExpiresAt: expiresAt, updatedAt: new Date() } });
  return { campaign_id: campaignId, counts, by_platform: byPlatform, errors, fetched_at: fetchedAt, expires_at: expiresAt };
}

export async function runPostUrlCampaignPreview(brandId: number, campaignId: number): Promise<{ queued: number; review: number }> {
  if (!isBullEnabled()) throw new Error('Campaign delivery queue is unavailable. Configure REDIS_URL before running campaigns.');
  const campaign = await prisma.engageCampaign.findFirst({ where: { brandId, campaignId: BigInt(campaignId), mode: 'post_url' } });
  if (!campaign || !campaign.previewFetchedAt || !campaign.previewExpiresAt || !isPreviewFresh(campaign.previewFetchedAt) || campaign.previewExpiresAt < new Date()) {
    throw new Error('The engager preview is missing or expired. Fetch engagers again.');
  }
  const selected = await prisma.campaignPostEngager.findMany({ where: { brandId, campaignId: String(campaignId), source: 'post_preview', status: 'preview_selected' }, orderBy: { engagerId: 'asc' } });
  const review = await prisma.campaignPostEngager.count({ where: { brandId, campaignId: String(campaignId), source: 'post_preview', status: 'needs_review' } });
  const channels = deliveryChannelsForReplyMode(campaign.replyMode);
  for (let index = 0; index < selected.length; index += 1) {
    const engager = selected[index]!;
    const delay = index * campaign.spacingMinutes * 60 * 1000;
    for (const channel of channels) {
      const data = { brand_id: brandId, campaign_id: campaignId, engager_id: Number(engager.engagerId), channel };
      const scheduledAt = new Date(Date.now() + delay);
      await prepareCampaignDelivery(data, scheduledAt);
      await enqueueCampaignDelivery(data, delay);
    }
    await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { status: 'queued', updatedAt: new Date() } });
  }
  await prisma.$transaction([
    prisma.engageCampaign.update({ where: { campaignId: campaign.campaignId }, data: { isActive: true, activationStatus: 'active', lastActivatedAt: new Date(), updatedAt: new Date() } }),
    prisma.campaignPostUrl.updateMany({ where: { brandId, campaignId: campaign.campaignId, bindingStatus: 'preview' }, data: { bindingStatus: 'active', status: 'queued' } }),
  ]);
  return { queued: selected.length, review };
}
