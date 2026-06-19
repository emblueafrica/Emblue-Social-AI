// src/routes/realtime.ts
import { Router, Request, Response } from 'express';
import { addSseClient, broadcastToClients, getApprovalQueue, removeFromQueue } from '../stream/eventQueue';
import prisma from '../db/prisma';
import { requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { publishReply } from '../stream/publisher';
import { getRequiredBrandId, requireNonEmptyString, sendServerError, sendValidationError } from '../utils/validation';
import { ApprovalQueueItem, Platform } from '../types';

const router = Router();

// ── SSE STREAM ────────────────────────────────────────────────────────────────
router.get('/stream/:brand_id', requireBrandAccess, (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ brand_id: brandId, ts: Date.now() })}\n\n`);

  addSseClient(brandId, res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => clearInterval(heartbeat));
});

// ── META WEBHOOK ──────────────────────────────────────────────────────────────
router.get('/webhook/meta', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post('/webhook/meta', (req: Request, res: Response) => {
  const body = req.body as {
    entry?: {
      id: string;
      changes?: { value: { messaging?: unknown[]; comments?: unknown[] } }[];
    }[];
  };

  (body.entry ?? []).forEach(entry => {
    (entry.changes ?? []).forEach(change => {
      if (change.value.comments) {
        // New comment on a page post
        broadcastToClients(0, 'new_comment', change.value.comments);
      }
    });
  });

  res.json({ ok: true });
});

// ── APPROVAL QUEUE ────────────────────────────────────────────────────────────
// The queue has two sources: the in-memory queue (live items pushed by the
// automation) and the approval_queue table (persisted items that survive a
// restart and can be seeded). GET returns them concatenated as
// [in-memory..., db...]; the `index` used by approve/skip is a position into
// that combined list.

function fetchPendingApprovalRows(brandId: number) {
  return prisma.approvalQueue.findMany({
    where: { brandId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
}

type PendingApprovalRow = Awaited<ReturnType<typeof fetchPendingApprovalRows>>[number];

function mapApprovalRow(row: PendingApprovalRow, brandId: number): ApprovalQueueItem {
  return {
    brand_id: brandId,
    platform: (row.platform ?? 'x') as Platform,
    author: row.authorHandle ?? '',
    original: row.originalText ?? '',
    reply: row.replyText ?? '',
    meta: {
      author_id: row.authorId ?? null,
      comment_id: row.commentId ?? null,
      post_id: row.postId ?? null,
      tweet_id: row.tweetId ?? null,
    },
  };
}

async function getCombinedApprovalQueue(brandId: number): Promise<ApprovalQueueItem[]> {
  const dbRows = await fetchPendingApprovalRows(brandId);
  return [...getApprovalQueue(brandId), ...dbRows.map(row => mapApprovalRow(row, brandId))];
}

router.get('/queue/:brand_id', requireBrandAccess, requireToolAccess('tool_5'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try {
    res.json({ queue: await getCombinedApprovalQueue(brandId) });
  } catch (err) {
    sendServerError(res, 'Failed to load approval queue', err);
  }
});

router.get('/reply-queue/:brand_id', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try {
    res.json({ queue: await getCombinedApprovalQueue(brandId) });
  } catch (err) {
    sendServerError(res, 'Failed to load reply queue', err);
  }
});

router.post('/queue/approve', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const { brand_id, index, reply_text } = req.body as { brand_id: number; index: number; reply_text?: string };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!Number.isInteger(index) || index < 0) { sendValidationError(res, 'index must be a non-negative integer'); return; }

  try {
    const memoryItems = getApprovalQueue(brandId);

    // In-memory item pushed by live automation — original behaviour.
    if (index < memoryItems.length) {
      const item = removeFromQueue(brandId, index);
      if (!item) { res.status(404).json({ error: 'Queue item not found' }); return; }

      const publish = await publishReply({
        brand_id: brandId,
        platform: item.platform,
        reply_text: requireNonEmptyString(reply_text) ? reply_text.trim() : item.reply,
        author_id: item.meta?.author_id ?? undefined,
        comment_id: item.meta?.comment_id ?? item.meta?.post_id ?? undefined,
        tweet_id: item.meta?.tweet_id ?? undefined,
        image_url: item.image_url ?? undefined,
        tracked_link: item.tracked_link ?? undefined,
      });

      broadcastToClients(brandId, 'reply_approved', { index, item });
      res.json({ ok: true, item, publish });
      return;
    }

    // Persisted item from the approval_queue table.
    const dbRows = await fetchPendingApprovalRows(brandId);
    const row = dbRows[index - memoryItems.length];
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }

    const item = mapApprovalRow(row, brandId);
    const replyText = requireNonEmptyString(reply_text) ? reply_text.trim() : item.reply;
    const publish = await publishReply({
      brand_id: brandId,
      platform: item.platform,
      reply_text: replyText,
      author_id: item.meta?.author_id ?? undefined,
      comment_id: item.meta?.comment_id ?? item.meta?.post_id ?? undefined,
      tweet_id: item.meta?.tweet_id ?? undefined,
    });

    await prisma.approvalQueue.update({ where: { queueId: row.queueId }, data: { status: 'approved' } });
    broadcastToClients(brandId, 'reply_approved', { index, item });
    res.json({ ok: true, item: { ...item, reply: replyText }, publish });
  } catch (err) {
    sendServerError(res, 'Failed to approve queue item', err);
  }
});

router.post('/queue/skip', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const { brand_id, index } = req.body as { brand_id: number; index: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!Number.isInteger(index) || index < 0) { sendValidationError(res, 'index must be a non-negative integer'); return; }

  try {
    const memoryItems = getApprovalQueue(brandId);

    if (index < memoryItems.length) {
      const item = removeFromQueue(brandId, index);
      if (!item) { res.status(404).json({ error: 'Queue item not found' }); return; }
      broadcastToClients(brandId, 'reply_skipped', { index, item });
      res.json({ ok: true, item });
      return;
    }

    const dbRows = await fetchPendingApprovalRows(brandId);
    const row = dbRows[index - memoryItems.length];
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }

    const item = mapApprovalRow(row, brandId);
    await prisma.approvalQueue.update({ where: { queueId: row.queueId }, data: { status: 'rejected' } });
    broadcastToClients(brandId, 'reply_skipped', { index, item });
    res.json({ ok: true, item });
  } catch (err) {
    sendServerError(res, 'Failed to skip queue item', err);
  }
});

// ── CONVERSION TRACKING (public — no auth) ────────────────────────────────────
router.post('/events/convert', async (req: Request, res: Response) => {
  const { short_code, brand_id } = req.body as { short_code: string; brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!requireNonEmptyString(short_code)) { sendValidationError(res, 'short_code is required'); return; }

  try {
    await prisma.trackedLink.updateMany({
      where: { shortCode: short_code, brandId },
      data: { conversions: { increment: 1 } },
    });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, 'Conversion event failed', err);
  }
});

export default router;
