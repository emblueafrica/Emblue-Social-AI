import prisma from '../db/prisma';
import { runAgent4 } from '../agents/agent4_reply_assistant';
import { getValidToken } from '../auth/platformAuth';
import { getConnectedAccountRecord } from '../db/queries';
import { fetchXPostEngagers } from '../stream/engageEngagers';

export type XReplySyncResult = {
  ok: true;
  tweet_id: string;
  fetched: number;
  captured: number;
  queued: number;
  duplicates: number;
  message: string;
};

function hasScope(scope: string | null | undefined, required: string): boolean {
  return String(scope ?? '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .includes(required);
}

export function xStatusUrl(tweetId: string): string {
  return `https://x.com/i/web/status/${tweetId}`;
}

async function generateXReplyDraft(brandId: number, text: string, authorHandle?: string | null): Promise<{
  text: string;
  tone: string | null;
  confidence: number;
  riskFlags: unknown[];
}> {
  const result = await runAgent4({
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
  const best = (result.replies ?? result.suggestions ?? [])
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  const handle = authorHandle
    ? authorHandle.startsWith('@') ? authorHandle : `@${authorHandle}`
    : '';
  return {
    text: best?.text ?? best?.reply_text ?? `${handle ? `${handle} ` : ''}Thanks for reaching out. We will take a look and follow up.`,
    tone: best?.tone ?? 'Professional',
    confidence: Math.round(best?.confidence ?? 80),
    riskFlags: best?.risk_flags ?? [],
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

export async function syncXRepliesForPost(brandId: number, tweetId: string): Promise<XReplySyncResult> {
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

  const campaignId = `x-sync-${tweetId}`;
  let captured = 0;
  let queued = 0;
  let duplicates = 0;

  for (const engager of fetched) {
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

    await prisma.campaignPostEngager.create({
      data: {
        brandId,
        campaignId,
        platform: 'x',
        action: 'commented',
        authorId: replyTweetId,
        authorHandle: engager.author_handle,
        originalText: engager.text,
        status: 'queued_for_approval',
        processedAt: new Date(),
      },
    }).catch(() => undefined);

    const existingQueueItem = await prisma.approvalQueue.findFirst({
      where: {
        brandId,
        platform: 'x',
        status: 'pending',
        tweetId: replyTweetId,
      },
      select: { queueId: true },
    });
    if (!existingQueueItem) {
      const draft = await generateXReplyDraft(brandId, engager.text, engager.author_handle);
      await prisma.autoEngagement.create({
        data: {
          brandId,
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
    duplicates,
    message: captured
      ? `${captured} new X replies captured. ${queued} reply drafts are waiting in the AI Reply Engine.`
      : 'No new X replies were found for this post.',
  };
}

export async function syncTrackedXPosts(brandId: number): Promise<{
  checked: number;
  fetched: number;
  captured: number;
  queued: number;
  errors: string[];
}> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const trackedPosts = await prisma.campaignPostUrl.findMany({
    where: {
      brandId,
      platform: 'x',
      postIdExt: { not: null },
      submittedAt: { gte: cutoff },
    },
    orderBy: { submittedAt: 'desc' },
    take: 25,
    select: { postIdExt: true },
  });

  const uniqueTweetIds = Array.from(new Set(trackedPosts.map(post => post.postIdExt).filter((id): id is string => Boolean(id))));
  const totals = { checked: 0, fetched: 0, captured: 0, queued: 0, errors: [] as string[] };

  for (const tweetId of uniqueTweetIds) {
    try {
      const result = await syncXRepliesForPost(brandId, tweetId);
      totals.checked += 1;
      totals.fetched += result.fetched;
      totals.captured += result.captured;
      totals.queued += result.queued;
    } catch (err) {
      totals.errors.push(`${tweetId}: ${(err as Error).message}`);
      await prisma.campaignPostUrl.updateMany({
        where: { brandId, platform: 'x', postIdExt: tweetId },
        data: { status: 'error', errorMsg: (err as Error).message, completedAt: new Date() },
      }).catch(() => undefined);
    }
  }

  return totals;
}
