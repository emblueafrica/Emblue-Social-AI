import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { runAgent1 } from '../agents/agent1_listening';
import { runAgent14 } from '../agents/agents9_to_14';
import { broadcastToClients } from '../stream/eventQueue';
import { CampaignPlatform } from './lifecycle';
import { deliveryChannelsForReplyMode, selectLiveCampaign } from './unified';
import { prepareCampaignDelivery } from './deliveryWorker';
import { enqueueCampaignDelivery, isBullEnabled } from '../queue/jobs';

export type LiveInboundEvent = {
  platform: CampaignPlatform;
  accountId: string;
  eventId: string;
  postId: string | null;
  commentId: string | null;
  authorId: string | null;
  authorHandle: string;
  text: string;
};

export async function resolveBrandForPlatformAccount(
  platform: 'instagram' | 'facebook',
  accountId: string,
): Promise<number | null> {
  const account = await prisma.connectedAccount.findFirst({
    where: {
      platform,
      isActive: true,
      OR: [{ accountIdExt: accountId }, { platformUserId: accountId }],
    },
    select: { brandId: true },
  });
  return account?.brandId ?? null;
}

export async function processLiveEngagementEvent(brandId: number, event: LiveInboundEvent): Promise<{ status: string; campaign_id?: number }> {
  const classification = await runAgent1({
    brand_id: brandId,
    platform: event.platform,
    payload_type: 'api_items',
    source_name: 'live_campaign_webhook',
    items: [{ platform: event.platform, kind: 'comment', text: event.text, author_handle: event.authorHandle, author_id: event.authorId }],
  });
  const classified = classification.classified[0];
  if (!classified) return { status: 'classification_failed' };

  const campaigns = await prisma.engageCampaign.findMany({
    where: { brandId, mode: 'live', isActive: true, platforms: { has: event.platform } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
  if (!campaigns.length) return { status: 'no_matching_campaign' };
  const selectedBindings = await prisma.campaignPostUrl.findMany({
    where: { brandId, campaignId: { in: campaigns.map(campaign => campaign.campaignId) }, bindingStatus: 'active' },
    select: { campaignId: true, postIdExt: true },
  });
  const postsByCampaign = new Map<number, string[]>();
  for (const binding of selectedBindings) {
    if (!binding.campaignId || !binding.postIdExt) continue;
    const key = Number(binding.campaignId);
    postsByCampaign.set(key, [...(postsByCampaign.get(key) ?? []), binding.postIdExt]);
  }
  const selected = selectLiveCampaign(campaigns.map(campaign => ({
    campaignId: Number(campaign.campaignId),
    priority: campaign.priority,
    platforms: campaign.platforms as CampaignPlatform[],
    scopeType: campaign.scopeType,
    selectedPostIds: postsByCampaign.get(Number(campaign.campaignId)),
    keywords: campaign.keywords,
    intentFilter: campaign.intentFilter as never,
    createdAt: campaign.createdAt,
  })), {
    platform: event.platform,
    postId: event.postId,
    text: event.text,
    intent: classified.intent ?? 'neutral',
  });
  if (!selected) return { status: 'no_matching_campaign' };

  const campaign = campaigns.find(item => Number(item.campaignId) === selected.campaignId)!;
  let profile: Awaited<ReturnType<typeof runAgent14>> | null = null;
  try {
    profile = await runAgent14({ brand_id: brandId, user: { handle: event.authorHandle, id: event.authorId, platform: event.platform, text: event.text } });
  } catch { profile = null; }
  const status = !profile ? 'needs_review' : profile.classification === 'bot' || profile.risk_level === 'high' ? 'bot_blocked' : 'pending';
  let engager;
  try {
    engager = await prisma.campaignPostEngager.create({
      data: {
        brandId,
        campaignId: String(selected.campaignId),
        platform: event.platform,
        action: 'commented',
        authorId: event.authorId ?? event.authorHandle,
        platformAuthorId: event.authorId,
        authorHandle: event.authorHandle,
        externalEventId: event.eventId,
        commentId: event.commentId,
        postId: event.postId,
        originalText: event.text,
        source: 'live',
        intent: classified.intent ?? 'neutral',
        urgencyScore: classified.urgency_score,
        status,
        profileClassification: profile?.classification ?? null,
        profileFollowerCount: profile?.follower_count ?? null,
        profileStatus: profile ? 'classified' : 'unknown',
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 'duplicate', campaign_id: selected.campaignId };
    throw error;
  }
  if (status !== 'pending') return { status, campaign_id: selected.campaignId };
  if (!isBullEnabled()) {
    await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { status: 'setup_required', deliveryError: 'Campaign delivery queue unavailable.' } });
    return { status: 'setup_required', campaign_id: selected.campaignId };
  }
  for (const channel of deliveryChannelsForReplyMode(campaign.replyMode)) {
    const data = { brand_id: brandId, campaign_id: selected.campaignId, engager_id: Number(engager.engagerId), channel } as const;
    await prepareCampaignDelivery(data, new Date());
    await enqueueCampaignDelivery(data, 0);
  }
  await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { status: 'queued', updatedAt: new Date() } });
  broadcastToClients(brandId, 'campaign_activity_created', { campaign_id: selected.campaignId, engager_id: Number(engager.engagerId), platform: event.platform, status: 'queued' });
  return { status: 'queued', campaign_id: selected.campaignId };
}
