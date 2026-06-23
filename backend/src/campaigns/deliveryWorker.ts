import prisma from '../db/prisma';
import { mapEngageCampaign } from '../db/mappers';
import { engageEngager } from '../stream/engageEngagers';
import { CampaignDeliveryChannel, buildCampaignDeliveryJobId } from './unified';
import { getCampaignCredentials, persistCampaignDeliveryOutcomes } from './engagementSync';

export type CampaignDeliveryJobData = {
  brand_id: number;
  campaign_id: number;
  engager_id: number;
  channel: CampaignDeliveryChannel;
};

export type CampaignDeliveryJobResult = {
  status: string;
  fallback_to_public: boolean;
  error?: string;
};

export async function processCampaignDeliveryJob(
  data: CampaignDeliveryJobData,
): Promise<CampaignDeliveryJobResult> {
  const [campaign, engager] = await Promise.all([
    prisma.engageCampaign.findFirst({
      where: { brandId: data.brand_id, campaignId: BigInt(data.campaign_id), isActive: true },
    }),
    prisma.campaignPostEngager.findFirst({
      where: { brandId: data.brand_id, campaignId: String(data.campaign_id), engagerId: BigInt(data.engager_id) },
    }),
  ]);
  if (!campaign || !engager) return { status: 'skipped', fallback_to_public: false, error: 'Campaign or engager is no longer active.' };

  const existing = await prisma.campaignDeliveryAttempt.findUnique({
    where: { engagerId_channel: { engagerId: engager.engagerId, channel: data.channel } },
  });
  if (existing?.status === 'sent') return { status: 'sent', fallback_to_public: false };

  const now = new Date();
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const [sentThisHour, sentToday, dmsToday] = await Promise.all([
    prisma.campaignDeliveryAttempt.count({ where: { campaignId: campaign.campaignId, status: 'sent', deliveredAt: { gte: hourStart } } }),
    prisma.campaignDeliveryAttempt.count({ where: { campaignId: campaign.campaignId, status: 'sent', deliveredAt: { gte: dayStart } } }),
    prisma.campaignDeliveryAttempt.count({ where: { campaignId: campaign.campaignId, channel: 'direct_message', status: 'sent', deliveredAt: { gte: dayStart } } }),
  ]);
  const limitError = sentThisHour >= (campaign.maxPerHour ?? 50)
    ? 'Campaign hourly delivery limit reached.'
    : sentToday >= campaign.maxPerDay
      ? 'Campaign daily delivery limit reached.'
      : data.channel === 'direct_message' && dmsToday >= campaign.maxDmPerDay
        ? 'Campaign daily direct-message limit reached.'
        : null;
  if (limitError) {
    await prisma.campaignDeliveryAttempt.update({
      where: { engagerId_channel: { engagerId: engager.engagerId, channel: data.channel } },
      data: { status: 'rate_limited', error: limitError, lastAttemptAt: now, nextAttemptAt: null, updatedAt: now },
    });
    await prisma.campaignPostEngager.update({
      where: { engagerId: engager.engagerId },
      data: { status: 'rate_limited', deliveryError: limitError, processedAt: now, updatedAt: now },
    });
    return { status: 'rate_limited', fallback_to_public: false, error: limitError };
  }

  await prisma.campaignDeliveryAttempt.update({
    where: { engagerId_channel: { engagerId: engager.engagerId, channel: data.channel } },
    data: { status: 'processing', attemptCount: { increment: 1 }, lastAttemptAt: now, nextAttemptAt: null, updatedAt: now },
  });

  const config = mapEngageCampaign(campaign);
  config.public_reply_enabled = data.channel === 'public_reply';
  config.direct_message_enabled = data.channel === 'direct_message';
  const credentials = await getCampaignCredentials(data.brand_id);
  const result = await engageEngager(data.brand_id, {
    platform: engager.platform,
    author_handle: engager.authorHandle ?? engager.platformAuthorId ?? 'customer',
    author_id: engager.platformAuthorId,
    comment_id: engager.commentId,
    post_id: engager.postId,
    tweet_id: engager.platform === 'x' ? engager.commentId : null,
    text: engager.originalText ?? '',
    action: engager.action === 'liked' ? 'liked' : 'commented',
  }, config, credentials);

  await persistCampaignDeliveryOutcomes(
    engager.engagerId,
    data.brand_id,
    data.campaign_id,
    engager.platform,
    result,
  );

  const delivered = (result.deliveries ?? []).some(delivery => delivery.status === 'sent');
  const status = delivered ? 'sent'
    : result.status === 'queued_for_approval' ? 'needs_review'
      : result.status;
  await prisma.campaignPostEngager.update({
    where: { engagerId: engager.engagerId },
    data: {
      status,
      replyText: result.reply ?? engager.replyText,
      replyConfidence: result.confidence ?? engager.replyConfidence,
      deliveryError: result.error ?? null,
      processedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return {
    status,
    fallback_to_public: data.channel === 'direct_message'
      && campaign.replyMode === 'dm_with_public_fallback'
      && !delivered,
    error: result.error,
  };
}

export async function prepareCampaignDelivery(
  data: CampaignDeliveryJobData,
  scheduledAt: Date,
): Promise<string> {
  const jobId = buildCampaignDeliveryJobId(data.campaign_id, data.engager_id, data.channel);
  const engagerId = BigInt(data.engager_id);
  await prisma.campaignDeliveryAttempt.upsert({
    where: { engagerId_channel: { engagerId, channel: data.channel } },
    create: {
      engagerId,
      brandId: data.brand_id,
      campaignId: BigInt(data.campaign_id),
      platform: (await prisma.campaignPostEngager.findUniqueOrThrow({ where: { engagerId }, select: { platform: true } })).platform,
      channel: data.channel,
      status: 'queued',
      bullJobId: jobId,
      scheduledAt,
      nextAttemptAt: scheduledAt,
      attemptCount: 0,
    },
    update: {
      status: 'queued',
      bullJobId: jobId,
      scheduledAt,
      nextAttemptAt: scheduledAt,
      error: null,
      updatedAt: new Date(),
    },
  });
  return jobId;
}
