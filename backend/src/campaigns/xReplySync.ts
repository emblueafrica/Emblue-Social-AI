import prisma from '../db/prisma';
import { contextualFallbackReply, runAgent4 } from '../agents/agent4_reply_assistant';
import { getValidToken } from '../auth/platformAuth';
import { getConnectedAccountRecord } from '../db/queries';
import { fetchXPostEngagers } from '../stream/engageEngagers';
import { fillVariables } from '../stream/engageEngagers';
import { publishReply } from '../stream/publisher';
import { eligibleForCampaign } from './lifecycle';
import { CampaignConfig } from '../types';
import { prepareCampaignDelivery, recordCampaignDeliveryUnavailable } from './deliveryWorker';
import { enqueueCampaignDelivery, isBullEnabled } from '../queue/jobs';
import { deliveryChannelsForReplyMode } from './unified';

export type XReplySyncResult = {
  ok: true;
  tweet_id: string;
  fetched: number;
  captured: number;
  queued: number;
  sent: number;
  skipped: number;
  duplicates: number;
  failed: number;
  message: string;
};

const HANDLED_QUEUE_STATUSES = ['approved', 'rejected', 'posted', 'sent', 'skipped'] as const;

function hasScope(scope: string | null | undefined, required: string): boolean {
  return String(scope ?? '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .includes(required);
}

export function xStatusUrl(tweetId: string): string {
  return `https://x.com/i/web/status/${tweetId}`;
}

async function generateXReplyDraft(brandId: number, text: string, authorHandle?: string | null, config?: CampaignConfig): Promise<{
  text: string;
  tone: string | null;
  confidence: number;
  riskFlags: unknown[];
}> {
  const template = config?.public_reply_template ?? config?.reply_template;
  if (template) {
    const handle = authorHandle ? (authorHandle.startsWith('@') ? authorHandle : `@${authorHandle}`) : '';
    return { text: fillVariables(template, { handle, link: config?.cta_link ?? '', keyword: '' }), tone: config?.tone ?? 'Professional', confidence: 100, riskFlags: [] };
  }
  const result = await runAgent4({
    brand_id: brandId,
    message: text,
    platform: 'x',
    tone: config?.tone ?? 'warm and professional',
    campaign_context: {
      objective: config?.objective ?? 'respond to inbound replies on an X campaign post',
      cta_link: config?.cta_link,
      action_type: 'thread_reply',
    },
    ruleset: {
      tone: 'warm and professional',
      do_not_say: [],
      required_words: [],
    },
    author_handle: authorHandle ?? undefined,
    reply_channel: 'thread_reply',
  });
  const best = (result.replies ?? result.suggestions ?? [])
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  const fallback = contextualFallbackReply({
    brand_id: brandId,
    message: text,
    platform: 'x',
    tone: 'warm and professional',
    campaign_context: {
      objective: 'respond to inbound replies on an X campaign post',
      action_type: 'thread_reply',
    },
    ruleset: {
      tone: 'warm and professional',
      do_not_say: [],
      required_words: [],
    },
    author_handle: authorHandle ?? undefined,
    reply_channel: 'thread_reply',
  });
  return {
    text: best?.text ?? best?.reply_text ?? fallback.text,
    tone: best?.tone ?? fallback.tone,
    confidence: Math.round(best?.confidence ?? fallback.confidence),
    riskFlags: best?.risk_flags ?? fallback.risk_flags ?? [],
  };
}

async function persistCapturedXReply(params: {
  brandId: number;
  rootTweetId: string;
  replyTweetId: string;
  authorId: string;
  authorHandle?: string | null;
  text: string;
  capturedAt?: string | null;
}): Promise<{ created: boolean; messageId: bigint | null }> {
  const existing = await prisma.socialMessage.findUnique({
    where: {
      brandId_platform_externalId: {
        brandId: params.brandId,
        platform: 'x',
        externalId: params.replyTweetId,
      },
    },
    select: { messageId: true },
  });
  if (existing) return { created: false, messageId: existing.messageId };

  const row = await prisma.socialMessage.create({
    data: {
      brandId: params.brandId,
      platform: 'x',
      kind: 'reply',
      externalId: params.replyTweetId,
      text: params.text,
      authorHandle: params.authorHandle ?? null,
      authorIdHash: params.authorId,
      url: xStatusUrl(params.replyTweetId),
      sentiment: 'neutral',
      urgencyScore: 2,
      raw: {
        source: 'x_reply_sync',
        root_tweet_id: params.rootTweetId,
        reply_tweet_id: params.replyTweetId,
      },
      rawMetrics: {},
      capturedAt: params.capturedAt ? new Date(params.capturedAt) : new Date(),
    },
    select: { messageId: true },
  });

  return { created: true, messageId: row.messageId };
}

export async function trackPublishedXPost(brandId: number, tweetId: string): Promise<void> {
  try {
    await prisma.campaignPostUrl.create({
      data: {
        brandId,
        campaignId: null,
        platform: 'x',
        postUrl: xStatusUrl(tweetId),
        postIdExt: tweetId,
        includeCommenters: true,
        includeLikers: false,
        status: 'complete',
        totalFetched: 0,
        completedAt: new Date(),
      },
    });
  } catch {
    // Tracking failure must not make a successful publish look failed.
  }
}

export async function syncXRepliesForPost(brandId: number, tweetId: string, config?: CampaignConfig): Promise<XReplySyncResult> {
  const [account, token] = await Promise.all([
    getConnectedAccountRecord(brandId, 'x'),
    getValidToken(brandId, 'x'),
  ]);
  if (!account || !token) {
    throw new Error('Connect X for this brand before syncing replies.');
  }
  if (!hasScope(account.scope, 'tweet.read') || !hasScope(account.scope, 'users.read')) {
    throw new Error('Reconnect X with tweet.read and users.read before syncing replies.');
  }

  const ownAccountIds = new Set(
    [account.accountIdExt, account.platformUserId].filter((value): value is string => Boolean(value))
  );
  const fetched = (await fetchXPostEngagers(tweetId, token))
    .filter(engager => !ownAccountIds.has(engager.author_id));

  const campaignId = String(config?.id ?? config?.campaign_id ?? `x-sync-${tweetId}`);
  const numericCampaignId = /^\d+$/.test(campaignId) ? BigInt(campaignId) : null;
  let captured = 0;
  let queued = 0;
  let sent = 0;
  let skipped = 0;
  let duplicates = 0;
  let failed = 0;

  for (const engager of fetched) {
    const eligible = config?.event_settings?.comments !== false && eligibleForCampaign({ kind: 'reply', text: engager.text }, config?.keywords ?? []);
    const replyTweetId = engager.raw_tweet_id ?? engager.raw_comment_id;
    if (!replyTweetId) {
      duplicates += 1;
      continue;
    }

    const saved = await persistCapturedXReply({
      brandId,
      rootTweetId: tweetId,
      replyTweetId,
      authorId: engager.author_id,
      authorHandle: engager.author_handle,
      text: engager.text,
      capturedAt: engager.timestamp ?? null,
    });
    if (saved.created) captured += 1;
    else duplicates += 1;

    const campaignEngager = await prisma.campaignPostEngager.create({
      data: {
        brandId,
        campaignId,
        platform: 'x',
        action: 'commented',
        authorId: replyTweetId,
        platformAuthorId: engager.author_id,
        externalEventId: replyTweetId,
        commentId: replyTweetId,
        postId: tweetId,
        authorHandle: engager.author_handle,
        originalText: engager.text,
        status: eligible ? 'pending' : 'ignored_keyword',
        processedAt: new Date(),
      },
    }).catch(() => null);
    if (!campaignEngager) {
      duplicates += 1;
      continue;
    }
    if (!eligible) {
      skipped += 1;
      continue;
    }

    if (numericCampaignId && config) {
      const draft = await generateXReplyDraft(brandId, engager.text, engager.author_handle, config);
      await prisma.campaignPostEngager.update({
        where: { engagerId: campaignEngager.engagerId },
        data: { replyText: draft.text, replyConfidence: draft.confidence, updatedAt: new Date() },
      });

      const threshold = config.auto_fire_threshold ?? 85;
      if (draft.confidence < threshold || draft.riskFlags.length > 0) {
        queued += 1;
        await prisma.campaignPostEngager.update({
          where: { engagerId: campaignEngager.engagerId },
          data: { status: 'needs_review', processedAt: new Date(), updatedAt: new Date() },
        });
        continue;
      }

      if (!isBullEnabled()) {
        const campaignIdNumber = Number(numericCampaignId);
        for (const channel of deliveryChannelsForReplyMode(config.reply_mode)) {
          await recordCampaignDeliveryUnavailable({
            brand_id: brandId,
            campaign_id: campaignIdNumber,
            engager_id: Number(campaignEngager.engagerId),
            channel,
          }, 'Campaign delivery queue unavailable.');
        }
        await prisma.campaignPostEngager.update({
          where: { engagerId: campaignEngager.engagerId },
          data: { status: 'setup_required', deliveryError: 'Campaign delivery queue unavailable.', processedAt: new Date(), updatedAt: new Date() },
        });
        skipped += 1;
        continue;
      }
      const campaignIdNumber = Number(numericCampaignId);
      const delay = queued * Math.max(0, config.spacing_minutes ?? 0) * 60_000;
      for (const channel of deliveryChannelsForReplyMode(config.reply_mode)) {
        const data = { brand_id: brandId, campaign_id: campaignIdNumber, engager_id: Number(campaignEngager.engagerId), channel } as const;
        await prepareCampaignDelivery(data, new Date(Date.now() + delay));
        await enqueueCampaignDelivery(data, delay);
      }
      await prisma.campaignPostEngager.update({ where: { engagerId: campaignEngager.engagerId }, data: { status: 'queued', processedAt: new Date(), updatedAt: new Date() } });
      queued += 1;
      continue;
    }

    const existingQueueItem = numericCampaignId ? null : await prisma.approvalQueue.findFirst({
      where: {
        brandId,
        platform: 'x',
        tweetId: replyTweetId,
      },
      orderBy: { createdAt: 'desc' },
      select: { queueId: true, status: true },
    });
    if (existingQueueItem) {
      duplicates += 1;
      if (HANDLED_QUEUE_STATUSES.includes((existingQueueItem.status ?? '') as never)) {
        await prisma.campaignPostEngager.updateMany({
          where: { brandId, campaignId, platform: 'x', authorId: replyTweetId },
          data: { status: existingQueueItem.status, processedAt: new Date() },
        }).catch(() => undefined);
      }
      continue;
    }

    const draft = await generateXReplyDraft(brandId, engager.text, engager.author_handle, config);
    await prisma.campaignPostEngager.update({
      where: { engagerId: campaignEngager.engagerId },
      data: { replyText: draft.text, updatedAt: new Date() },
    });
    await prisma.autoEngagement.create({
      data: {
        brandId,
        campaignId: numericCampaignId,
        platform: 'x',
        authorHandle: engager.author_handle,
        originalText: engager.text,
        replyText: draft.text,
        status: 'queued_for_approval',
        firedAt: new Date(),
      },
    }).catch(() => undefined);

    if (saved.messageId) {
      await prisma.replySuggestion.create({
        data: {
          brandId,
          messageId: saved.messageId,
          text: draft.text,
          tone: draft.tone,
          confidence: draft.confidence,
          riskFlags: draft.riskFlags as never,
          status: 'pending',
        },
      }).catch(() => undefined);
    }

    const threshold = config?.auto_fire_threshold ?? 85;
    const requiresApproval = draft.confidence < threshold || draft.riskFlags.length > 0;
    if (!requiresApproval) {
      const publish = await publishReply({ brand_id: brandId, platform: 'x', reply_text: draft.text, tweet_id: replyTweetId });
      if (publish.success) {
        sent += 1;
        await prisma.campaignPostEngager.updateMany({ where: { brandId, campaignId, platform: 'x', authorId: replyTweetId }, data: { status: 'sent', processedAt: new Date() } });
        if (numericCampaignId) {
          await prisma.engageCampaign.updateMany({
            where: { brandId, campaignId: numericCampaignId },
            data: { totalSent: { increment: 1 }, updatedAt: new Date() },
          });
        }
        continue;
      }
      if (numericCampaignId) {
        failed += 1;
        await prisma.campaignPostEngager.update({
          where: { engagerId: campaignEngager.engagerId },
          data: { status: 'failed', deliveryError: publish.error ?? 'X reply failed', processedAt: new Date(), updatedAt: new Date() },
        });
        continue;
      }
    }

    if (numericCampaignId) {
      queued += 1;
      await prisma.campaignPostEngager.update({
        where: { engagerId: campaignEngager.engagerId },
        data: { status: 'needs_review', processedAt: new Date(), updatedAt: new Date() },
      });
      continue;
    }

    await prisma.approvalQueue.create({
      data: {
        brandId,
        platform: 'x',
        authorId: engager.author_id,
        authorHandle: engager.author_handle,
        originalText: engager.text,
        replyText: draft.text,
        tweetId: replyTweetId,
        confidence: draft.confidence,
        status: 'pending',
      },
    });
    queued += 1;
  }

  await prisma.campaignPostUrl.updateMany({
    where: { brandId, platform: 'x', postIdExt: tweetId },
    data: {
      status: 'complete',
      totalFetched: fetched.length,
      completedAt: new Date(),
      errorMsg: null,
    },
  }).catch(() => undefined);

  return {
    ok: true,
    tweet_id: tweetId,
    fetched: fetched.length,
    captured,
    queued,
    sent,
    skipped,
    duplicates,
    failed,
    message: captured
      ? `${captured} new X replies captured. ${sent} sent automatically and ${queued} ${numericCampaignId ? 'need review in Campaign Activity' : 'waiting in the AI Reply Engine'}.`
      : 'No new X replies were found for this post.',
  };
}
