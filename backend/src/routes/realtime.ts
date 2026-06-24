import { Router, Request, Response } from 'express';
import { addSseClient, broadcastToClients } from '../stream/eventQueue';
import prisma from '../db/prisma';
import { requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { publishReply } from '../stream/publisher';
import { getRequiredBrandId, requireNonEmptyString, sendServerError, sendValidationError } from '../utils/validation';
import { ApprovalQueueItem, Platform } from '../types';
import { CampaignDeliveryChannel, verifyMetaWebhookSignature } from '../campaigns/unified';
import { processLiveEngagementEvent, resolveBrandForPlatformAccount } from '../campaigns/liveEngagement';
import { prepareCampaignDelivery, recordCampaignDeliveryUnavailable } from '../campaigns/deliveryWorker';
import { enqueueCampaignDelivery, isBullEnabled } from '../queue/jobs';

const router = Router();

router.get('/stream/:brand_id', requireBrandAccess, (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ brand_id: brandId, ts: Date.now() })}\n\n`);
  addSseClient(brandId, res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
  req.on('close', () => clearInterval(heartbeat));
});

router.get('/webhook/meta', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

router.post('/webhook/meta', async (req: Request, res: Response) => {
  if (!verifyMetaWebhookSignature(req.rawBody ?? Buffer.alloc(0), req.header('x-hub-signature-256'), process.env.META_APP_SECRET)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }
  const body = req.body as {
    object?: string;
    entry?: Array<{
      id: string;
      changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
    }>;
  };
  const accepted: Array<Promise<unknown>> = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const eventId = String(value['id'] ?? value['comment_id'] ?? '');
      const text = String(value['text'] ?? value['message'] ?? '');
      if (!eventId || !text) continue;
      const platform = body.object === 'instagram' ? 'instagram' : 'facebook';
      const brandId = await resolveBrandForPlatformAccount(platform, entry.id);
      if (!brandId) continue;
      const from = value['from'] && typeof value['from'] === 'object' ? value['from'] as Record<string, unknown> : {};
      accepted.push(processLiveEngagementEvent(brandId, {
        platform,
        accountId: entry.id,
        eventId,
        postId: value['media_id'] ? String(value['media_id']) : value['post_id'] ? String(value['post_id']) : null,
        commentId: eventId,
        authorId: from['id'] ? String(from['id']) : value['user_id'] ? String(value['user_id']) : null,
        authorHandle: String(from['username'] ?? from['name'] ?? value['username'] ?? 'customer'),
        text,
      }));
    }
  }
  await Promise.allSettled(accepted);
  res.json({ ok: true, accepted: accepted.length });
});

async function fetchPendingApprovalRows(brandId: number) {
  return prisma.approvalQueue.findMany({
    where: { brandId, status: 'pending', campaignId: null },
    orderBy: { createdAt: 'asc' },
  });
}

type PendingApprovalRow = Awaited<ReturnType<typeof fetchPendingApprovalRows>>[number];

function mapApprovalRow(row: PendingApprovalRow, brandId: number): ApprovalQueueItem {
  return {
    queue_key: `approval:${Number(row.queueId)}`,
    queue_id: Number(row.queueId),
    brand_id: brandId,
    campaign_id: row.campaignId ? Number(row.campaignId) : null,
    source: 'approval',
    channel: null,
    status: row.status ?? 'pending',
    platform: (row.platform ?? 'x') as Platform,
    author: row.authorHandle ?? '',
    original: row.originalText ?? '',
    reply: row.replyText ?? '',
    delivery_error: row.deliveryError,
    meta: {
      author_id: row.authorId,
      comment_id: row.commentId,
      post_id: row.postId,
      tweet_id: row.tweetId,
    },
  };
}

type CampaignQueueDelivery = Awaited<ReturnType<typeof fetchCampaignQueueDeliveries>>[number];
type CampaignReviewRow = Awaited<ReturnType<typeof fetchKeywordCampaignReviewRows>>[number];

async function fetchCampaignQueueDeliveries(brandId: number) {
  return prisma.campaignDeliveryAttempt.findMany({
    where: {
      brandId,
      status: { in: ['needs_review', 'manual_action_required', 'failed', 'rate_limited'] },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
}

async function mapCampaignDeliveryRows(brandId: number, deliveries: CampaignQueueDelivery[]): Promise<ApprovalQueueItem[]> {
  if (!deliveries.length) return [];
  const [engagers, campaigns] = await Promise.all([
    prisma.campaignPostEngager.findMany({ where: { engagerId: { in: deliveries.map(item => item.engagerId) } } }),
    prisma.engageCampaign.findMany({
      where: { brandId, campaignId: { in: deliveries.map(item => item.campaignId) } },
      select: { campaignId: true, name: true, mode: true, sourceMode: true },
    }),
  ]);
  const engagerById = new Map(engagers.map(item => [String(item.engagerId), item]));
  const campaignById = new Map(campaigns.map(item => [String(item.campaignId), item]));
  return deliveries.flatMap(delivery => {
    const engager = engagerById.get(String(delivery.engagerId));
    const campaign = campaignById.get(String(delivery.campaignId));
    if (campaign?.mode === 'keyword' || campaign?.sourceMode === 'keyword' || engager?.source === 'keyword') return [];
    const manual = delivery.status === 'manual_action_required';
    return [{
      queue_key: `campaign:${Number(delivery.engagerId)}:${delivery.channel}`,
      brand_id: brandId,
      campaign_id: Number(delivery.campaignId),
      campaign_name: campaign?.name ?? 'Campaign',
      source: 'campaign',
      channel: delivery.channel as ApprovalQueueItem['channel'],
      status: delivery.status,
      platform: delivery.platform as Platform,
      author: engager?.authorHandle ?? engager?.platformAuthorId ?? '',
      original: engager?.originalText ?? '',
      reply: engager?.replyText ?? '',
      delivery_error: delivery.error ?? engager?.deliveryError ?? null,
      manual_copy_required: manual,
      manual_copy_instructions: manual
        ? `${delivery.platform === 'x' ? 'X' : delivery.platform} ${delivery.channel === 'direct_message' ? 'DM' : 'reply'} must be sent manually from the platform, then marked sent here.`
        : undefined,
      meta: {
        author_id: engager?.platformAuthorId ?? engager?.authorId ?? null,
        comment_id: engager?.commentId ?? null,
        post_id: engager?.postId ?? null,
        tweet_id: engager?.platform === 'x' ? engager?.commentId ?? null : null,
      },
    } satisfies ApprovalQueueItem];
  });
}

async function fetchKeywordCampaignReviewRows(brandId: number) {
  return prisma.campaignPostEngager.findMany({
    where: {
      brandId,
      source: 'keyword',
      status: { in: ['needs_review', 'manual_action_required', 'failed', 'rate_limited', 'setup_required'] },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
}

async function mapKeywordCampaignRows(brandId: number, rows: CampaignReviewRow[]): Promise<ApprovalQueueItem[]> {
  if (!rows.length) return [];
  const campaignIds = rows
    .map(item => item.campaignId)
    .filter((value): value is string => /^\d+$/.test(value));
  const campaigns = campaignIds.length
    ? await prisma.engageCampaign.findMany({
        where: { brandId, campaignId: { in: campaignIds.map(value => BigInt(value)) } },
        select: { campaignId: true, name: true },
      })
    : [];
  const campaignById = new Map(campaigns.map(item => [String(item.campaignId), item.name]));
  return rows
    .filter(item => /^\d+$/.test(item.campaignId))
    .map(item => ({
      queue_key: `campaign:${Number(item.engagerId)}:public_reply`,
      brand_id: brandId,
      campaign_id: Number(item.campaignId),
      campaign_name: campaignById.get(item.campaignId) ?? 'Keyword Campaign',
      source: 'campaign' as const,
      channel: 'public_reply' as const,
      status: item.status,
      platform: item.platform as Platform,
      author: item.authorHandle ?? item.platformAuthorId ?? '',
      original: item.originalText ?? '',
      reply: item.replyText ?? '',
      delivery_error: item.deliveryError,
      meta: {
        author_id: item.platformAuthorId ?? item.authorId,
        comment_id: item.commentId,
        post_id: item.postId,
        tweet_id: item.platform === 'x' ? item.commentId : null,
      },
    } satisfies ApprovalQueueItem));
}

async function fetchUnifiedApprovalItems(brandId: number): Promise<ApprovalQueueItem[]> {
  const [approvalRows, campaignDeliveries, reviewEngagers] = await Promise.all([
    fetchPendingApprovalRows(brandId),
    fetchCampaignQueueDeliveries(brandId),
    prisma.campaignPostEngager.findMany({
      where: { brandId, source: { not: 'keyword' }, status: { in: ['needs_review', 'queued_for_approval'] } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  ]);
  const deliveryEngagerIds = new Set(campaignDeliveries.map(item => String(item.engagerId)));
  const reviewWithoutDelivery = reviewEngagers.filter(item => !deliveryEngagerIds.has(String(item.engagerId)) && /^\d+$/.test(item.campaignId));
  const reviewCampaigns = reviewWithoutDelivery.length
    ? await prisma.engageCampaign.findMany({
        where: { brandId, campaignId: { in: reviewWithoutDelivery.map(item => BigInt(item.campaignId)) } },
        select: { campaignId: true, name: true },
      })
    : [];
  const campaignById = new Map(reviewCampaigns.map(item => [String(item.campaignId), item.name]));
  return [
    ...approvalRows.map(row => mapApprovalRow(row, brandId)),
    ...(await mapCampaignDeliveryRows(brandId, campaignDeliveries)),
    ...reviewWithoutDelivery.map(item => ({
      queue_key: `campaign:${Number(item.engagerId)}:public_reply`,
      brand_id: brandId,
      campaign_id: Number(item.campaignId),
      campaign_name: campaignById.get(item.campaignId) ?? 'Campaign',
      source: 'campaign' as const,
      channel: 'public_reply' as const,
      status: item.status,
      platform: item.platform as Platform,
      author: item.authorHandle ?? item.platformAuthorId ?? '',
      original: item.originalText ?? '',
      reply: item.replyText ?? '',
      delivery_error: item.deliveryError,
      meta: {
        author_id: item.platformAuthorId ?? item.authorId,
        comment_id: item.commentId,
        post_id: item.postId,
        tweet_id: item.platform === 'x' ? item.commentId : null,
      },
    } satisfies ApprovalQueueItem)),
  ];
}

async function approveQueueRow(brandId: number, row: PendingApprovalRow, replyTextInput?: string) {
  const item = mapApprovalRow(row, brandId);
  const replyText = requireNonEmptyString(replyTextInput) ? replyTextInput.trim() : item.reply;
  const publish = await publishReply({
    brand_id: brandId,
    platform: item.platform,
    reply_text: replyText,
    author_id: item.meta?.author_id ?? undefined,
    comment_id: item.meta?.comment_id ?? item.meta?.post_id ?? undefined,
    tweet_id: item.meta?.tweet_id ?? undefined,
  });
  await prisma.approvalQueue.update({
    where: { queueId: row.queueId },
    data: publish.success
      ? { status: 'approved', replyText, deliveryError: null, updatedAt: new Date() }
      : { replyText, deliveryError: publish.error ?? 'Platform publish failed', updatedAt: new Date() },
  });
  broadcastToClients(brandId, publish.success ? 'reply_approved' : 'reply_failed', {
    queue_id: Number(row.queueId),
    item,
    error: publish.error,
  });
  return { item: { ...item, reply: replyText }, publish };
}

function parseQueueKey(value: unknown): { source: 'approval'; queueId: number } | { source: 'campaign'; engagerId: number; channel: CampaignDeliveryChannel } | null {
  const key = decodeURIComponent(String(value ?? ''));
  if (/^\d+$/.test(key)) return { source: 'approval', queueId: Number(key) };
  const approval = key.match(/^approval:(\d+)$/);
  if (approval) return { source: 'approval', queueId: Number(approval[1]) };
  const campaign = key.match(/^campaign:(\d+):(public_reply|direct_message)$/);
  if (campaign) return { source: 'campaign', engagerId: Number(campaign[1]), channel: campaign[2] as CampaignDeliveryChannel };
  return null;
}

async function syncCampaignTotalSent(brandId: number, campaignId: bigint): Promise<void> {
  const sent = await prisma.campaignDeliveryAttempt.count({ where: { brandId, campaignId, status: 'sent' } });
  await prisma.engageCampaign.updateMany({ where: { brandId, campaignId }, data: { totalSent: sent, updatedAt: new Date() } });
}

async function updateCampaignEngagerFromDeliveries(brandId: number, engagerId: bigint, campaignId: bigint): Promise<void> {
  const deliveries = await prisma.campaignDeliveryAttempt.findMany({ where: { brandId, engagerId } });
  const hasSent = deliveries.some(delivery => delivery.status === 'sent');
  const hasQueued = deliveries.some(delivery => delivery.status === 'queued' || delivery.status === 'processing');
  const hasReview = deliveries.some(delivery => delivery.status === 'needs_review');
  const hasManual = deliveries.some(delivery => delivery.status === 'manual_action_required');
  const hasFailed = deliveries.some(delivery => delivery.status === 'failed' || delivery.status === 'rate_limited');
  const status = hasSent && (hasQueued || hasReview || hasManual || hasFailed) ? 'partial'
    : hasSent ? 'sent'
      : hasReview ? 'needs_review'
      : hasQueued ? 'queued'
        : hasManual ? 'manual_action_required'
          : hasFailed ? 'failed'
            : 'dismissed';
  const error = deliveries.map(delivery => delivery.error).filter(Boolean).join(' ') || null;
  await prisma.campaignPostEngager.updateMany({
    where: { brandId, engagerId },
    data: {
      status,
      deliveryError: error,
      firstDeliveredAt: hasSent ? new Date() : undefined,
      processedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await syncCampaignTotalSent(brandId, campaignId);
}

async function getCampaignQueueItem(brandId: number, engagerId: number, channel: CampaignDeliveryChannel): Promise<ApprovalQueueItem | null> {
  const delivery = await prisma.campaignDeliveryAttempt.findFirst({ where: { brandId, engagerId: BigInt(engagerId), channel } });
  if (!delivery || delivery.status === 'sent' || delivery.status === 'queued' || delivery.status === 'processing' || delivery.status === 'dismissed') return null;
  return (await mapCampaignDeliveryRows(brandId, [delivery]))[0] ?? null;
}

async function handleCampaignQueueAction(
  brandId: number,
  engagerId: number,
  channel: CampaignDeliveryChannel,
  action: 'approve' | 'edit-and-send' | 'mark-sent' | 'retry' | 'skip',
  replyTextInput?: string,
) {
  const engager = await prisma.campaignPostEngager.findFirst({ where: { brandId, engagerId: BigInt(engagerId) } });
  if (!engager || !/^\d+$/.test(engager.campaignId)) return null;
  const campaignId = BigInt(engager.campaignId);
  const replyText = requireNonEmptyString(replyTextInput) ? replyTextInput.trim() : null;
  if (replyText) {
    await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { replyText, deliveryError: null, updatedAt: new Date() } });
  }
  const existingDelivery = await prisma.campaignDeliveryAttempt.findFirst({ where: { brandId, engagerId: engager.engagerId, channel } });
  if (existingDelivery && ['sent', 'queued', 'processing'].includes(existingDelivery.status)) {
    return { item: null, publish: { success: true, platform: engager.platform, message_id: existingDelivery.externalMessageId ?? undefined } };
  }

  if (action === 'mark-sent') {
    await prisma.campaignDeliveryAttempt.upsert({
      where: { engagerId_channel: { engagerId: engager.engagerId, channel } },
      create: {
        engagerId: engager.engagerId,
        brandId,
        campaignId,
        platform: engager.platform,
        channel,
        status: 'sent',
        deliveredAt: new Date(),
        attemptCount: 1,
      },
      update: { status: 'sent', error: null, deliveredAt: new Date(), updatedAt: new Date() },
    });
    await updateCampaignEngagerFromDeliveries(brandId, engager.engagerId, campaignId);
    return { item: await getCampaignQueueItem(brandId, engagerId, channel), publish: { success: true, platform: engager.platform } };
  }

  if (action === 'skip') {
    await prisma.campaignDeliveryAttempt.updateMany({
      where: { brandId, engagerId: engager.engagerId, channel },
      data: { status: 'dismissed', error: null, updatedAt: new Date() },
    });
    await updateCampaignEngagerFromDeliveries(brandId, engager.engagerId, campaignId);
    return { item: await getCampaignQueueItem(brandId, engagerId, channel) };
  }

  const numericCampaignId = Number(campaignId);
  const data = { brand_id: brandId, campaign_id: numericCampaignId, engager_id: engagerId, channel };
  if (!isBullEnabled()) {
    await recordCampaignDeliveryUnavailable(data, 'Campaign delivery queue unavailable. Configure REDIS_URL before sending campaign activity.');
    await updateCampaignEngagerFromDeliveries(brandId, engager.engagerId, campaignId);
    throw new Error('Campaign delivery queue unavailable. Configure REDIS_URL before sending campaign activity.');
  }
  try {
    await prepareCampaignDelivery(data, new Date());
    const queued = await enqueueCampaignDelivery(data, 0);
    if (!queued) throw new Error('Campaign delivery queue did not accept the job.');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Campaign delivery queue failed.';
    await recordCampaignDeliveryUnavailable(data, message);
    await updateCampaignEngagerFromDeliveries(brandId, engager.engagerId, campaignId);
    throw new Error(`Campaign delivery queue unavailable. ${message}`);
  }
  await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { status: 'queued', deliveryError: null, updatedAt: new Date() } });
  return { item: await getCampaignQueueItem(brandId, engagerId, channel), publish: { success: true, platform: engager.platform } };
}

router.get('/queue/:brand_id', requireBrandAccess, requireToolAccess('tool_5'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try { res.json({ queue: await fetchUnifiedApprovalItems(brandId) }); }
  catch (err) { sendServerError(res, 'Failed to load approval queue', err); }
});

router.get('/reply-queue/:brand_id', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try {
    const queue = await mapKeywordCampaignRows(brandId, await fetchKeywordCampaignReviewRows(brandId));
    res.json({
      queue,
      summary: {
        queue: queue.length,
        manual_review: queue.filter(item => item.status === 'needs_review' || item.delivery_error || item.manual_copy_required).length,
        generated_drafts: queue.filter(item => Boolean(item.reply)).length,
        active_platforms: new Set(queue.map(item => item.platform)).size,
      },
    });
  }
  catch (err) { sendServerError(res, 'Failed to load reply queue', err); }
});

router.post('/queue/:queue_key/approve', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const key = parseQueueKey(req.params['queue_key']);
  const { brand_id, reply_text } = req.body as { brand_id: number; reply_text?: string };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId || !key) { sendValidationError(res, 'brand_id and queue_key are required'); return; }
  try {
    if (key.source === 'campaign') {
      const result = await handleCampaignQueueAction(brandId, key.engagerId, key.channel, 'approve', reply_text);
      if (!result) { res.status(404).json({ error: 'Queue item not found' }); return; }
      res.json({ ok: true, ...result });
      return;
    }
    const row = await prisma.approvalQueue.findFirst({ where: { queueId: BigInt(key.queueId), brandId, status: 'pending', campaignId: null } });
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
    res.json({ ok: true, ...(await approveQueueRow(brandId, row, reply_text)) });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Campaign delivery queue unavailable')) {
      res.status(503).json({ error: 'Campaign delivery queue unavailable', message: err.message });
      return;
    }
    sendServerError(res, 'Failed to approve queue item', err);
  }
});

router.post('/queue/:queue_key/edit-and-send', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const key = parseQueueKey(req.params['queue_key']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  const replyText = typeof req.body?.reply_text === 'string' ? req.body.reply_text : undefined;
  if (!brandId || !key) { sendValidationError(res, 'brand_id and queue_key are required'); return; }
  try {
    if (key.source === 'approval') {
      const row = await prisma.approvalQueue.findFirst({ where: { queueId: BigInt(key.queueId), brandId, status: 'pending', campaignId: null } });
      if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
      res.json({ ok: true, ...(await approveQueueRow(brandId, row, replyText)) });
      return;
    }
    const result = await handleCampaignQueueAction(brandId, key.engagerId, key.channel, 'edit-and-send', replyText);
    if (!result) { res.status(404).json({ error: 'Queue item not found' }); return; }
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Campaign delivery queue unavailable')) {
      res.status(503).json({ error: 'Campaign delivery queue unavailable', message: err.message });
      return;
    }
    sendServerError(res, 'Failed to approve queue item', err);
  }
});

router.post('/queue/:queue_key/mark-sent', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const key = parseQueueKey(req.params['queue_key']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!brandId || !key || key.source !== 'campaign') { sendValidationError(res, 'brand_id and a campaign queue_key are required'); return; }
  try {
    const result = await handleCampaignQueueAction(brandId, key.engagerId, key.channel, 'mark-sent');
    if (!result) { res.status(404).json({ error: 'Queue item not found' }); return; }
    res.json({ ok: true, ...result });
  } catch (err) { sendServerError(res, 'Failed to mark queue item sent', err); }
});

router.post('/queue/:queue_key/retry', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const key = parseQueueKey(req.params['queue_key']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!brandId || !key || key.source !== 'campaign') { sendValidationError(res, 'brand_id and a campaign queue_key are required'); return; }
  try {
    const result = await handleCampaignQueueAction(brandId, key.engagerId, key.channel, 'retry');
    if (!result) { res.status(404).json({ error: 'Queue item not found' }); return; }
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Campaign delivery queue unavailable')) {
      res.status(503).json({ error: 'Campaign delivery queue unavailable', message: err.message });
      return;
    }
    sendServerError(res, 'Failed to retry queue item', err);
  }
});

router.post('/queue/:queue_key/skip', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const key = parseQueueKey(req.params['queue_key']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!brandId || !key) { sendValidationError(res, 'brand_id and queue_key are required'); return; }
  try {
    if (key.source === 'campaign') {
      const result = await handleCampaignQueueAction(brandId, key.engagerId, key.channel, 'skip');
      if (!result) { res.status(404).json({ error: 'Queue item not found' }); return; }
      res.json({ ok: true, ...result });
      return;
    }
    const row = await prisma.approvalQueue.findFirst({ where: { queueId: BigInt(key.queueId), brandId, status: 'pending', campaignId: null } });
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
    const item = mapApprovalRow(row, brandId);
    await prisma.approvalQueue.update({ where: { queueId: row.queueId }, data: { status: 'rejected', updatedAt: new Date() } });
    broadcastToClients(brandId, 'reply_skipped', { queue_id: key.queueId, item });
    res.json({ ok: true, item });
  } catch (err) { sendServerError(res, 'Failed to skip queue item', err); }
});

// Compatibility routes for clients that still send the queue position.
router.post('/queue/approve', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const { brand_id, index, reply_text } = req.body as { brand_id: number; index: number; reply_text?: string };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId || !Number.isInteger(index) || index < 0) { sendValidationError(res, 'brand_id and a non-negative index are required'); return; }
  try {
    const row = (await fetchPendingApprovalRows(brandId))[index];
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
    res.json({ ok: true, ...(await approveQueueRow(brandId, row, reply_text)) });
  } catch (err) { sendServerError(res, 'Failed to approve queue item', err); }
});

router.post('/queue/skip', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const { brand_id, index } = req.body as { brand_id: number; index: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId || !Number.isInteger(index) || index < 0) { sendValidationError(res, 'brand_id and a non-negative index are required'); return; }
  try {
    const row = (await fetchPendingApprovalRows(brandId))[index];
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
    const item = mapApprovalRow(row, brandId);
    await prisma.approvalQueue.update({ where: { queueId: row.queueId }, data: { status: 'rejected', updatedAt: new Date() } });
    res.json({ ok: true, item });
  } catch (err) { sendServerError(res, 'Failed to skip queue item', err); }
});

router.post('/events/convert', async (req: Request, res: Response) => {
  const { short_code, brand_id } = req.body as { short_code: string; brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!requireNonEmptyString(short_code)) { sendValidationError(res, 'short_code is required'); return; }
  try {
    await prisma.trackedLink.updateMany({ where: { shortCode: short_code, brandId }, data: { conversions: { increment: 1 } } });
    res.json({ ok: true });
  } catch (err) { sendServerError(res, 'Conversion event failed', err); }
});

export default router;
