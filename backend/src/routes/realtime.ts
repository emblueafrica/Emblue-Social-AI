import { Router, Request, Response } from 'express';
import { addSseClient, broadcastToClients } from '../stream/eventQueue';
import prisma from '../db/prisma';
import { requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { publishReply } from '../stream/publisher';
import { getRequiredBrandId, requireNonEmptyString, sendServerError, sendValidationError } from '../utils/validation';
import { ApprovalQueueItem, Platform } from '../types';

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

router.post('/webhook/meta', (req: Request, res: Response) => {
  const body = req.body as { entry?: { id: string; changes?: { value: { comments?: unknown[] } }[] }[] };
  (body.entry ?? []).forEach(entry => (entry.changes ?? []).forEach(change => {
    if (change.value.comments) broadcastToClients(0, 'new_comment', change.value.comments);
  }));
  res.json({ ok: true });
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
    queue_id: Number(row.queueId),
    brand_id: brandId,
    campaign_id: row.campaignId ? Number(row.campaignId) : null,
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

router.get('/queue/:brand_id', requireBrandAccess, requireToolAccess('tool_5'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try { res.json({ queue: (await fetchPendingApprovalRows(brandId)).map(row => mapApprovalRow(row, brandId)) }); }
  catch (err) { sendServerError(res, 'Failed to load approval queue', err); }
});

router.get('/reply-queue/:brand_id', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try { res.json({ queue: (await fetchPendingApprovalRows(brandId)).map(row => mapApprovalRow(row, brandId)) }); }
  catch (err) { sendServerError(res, 'Failed to load reply queue', err); }
});

router.post('/queue/:queue_id/approve', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const queueId = getRequiredBrandId(req.params['queue_id']);
  const { brand_id, reply_text } = req.body as { brand_id: number; reply_text?: string };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId || !queueId) { sendValidationError(res, 'brand_id and queue_id must be positive integers'); return; }
  try {
    const row = await prisma.approvalQueue.findFirst({ where: { queueId: BigInt(queueId), brandId, status: 'pending', campaignId: null } });
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
    res.json({ ok: true, ...(await approveQueueRow(brandId, row, reply_text)) });
  } catch (err) { sendServerError(res, 'Failed to approve queue item', err); }
});

router.post('/queue/:queue_id/skip', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const queueId = getRequiredBrandId(req.params['queue_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!brandId || !queueId) { sendValidationError(res, 'brand_id and queue_id must be positive integers'); return; }
  try {
    const row = await prisma.approvalQueue.findFirst({ where: { queueId: BigInt(queueId), brandId, status: 'pending', campaignId: null } });
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }
    const item = mapApprovalRow(row, brandId);
    await prisma.approvalQueue.update({ where: { queueId: row.queueId }, data: { status: 'rejected', updatedAt: new Date() } });
    broadcastToClients(brandId, 'reply_skipped', { queue_id: queueId, item });
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
