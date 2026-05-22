// src/routes/realtime.ts
import { Router, Request, Response } from 'express';
import { addSseClient, broadcastToClients, getApprovalQueue, removeFromQueue } from '../stream/eventQueue';
import prisma from '../db/prisma';
import { requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import { publishReply } from '../stream/publisher';
import { getRequiredBrandId, requireNonEmptyString, sendValidationError } from '../utils/validation';

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
router.get('/queue/:brand_id', requireBrandAccess, requireToolAccess('tool_5'), (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  res.json({ queue: getApprovalQueue(brandId) });
});

router.get('/reply-queue/:brand_id', requireBrandAccess, requireToolAccess('tool_3'), (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  res.json({ queue: getApprovalQueue(brandId) });
});

router.post('/queue/approve', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const { brand_id, index, reply_text } = req.body as { brand_id: number; index: number; reply_text?: string };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!Number.isInteger(index) || index < 0) { sendValidationError(res, 'index must be a non-negative integer'); return; }

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
});

router.post('/queue/skip', requireBrandAccess, requireToolAccess('tool_3'), (req: Request, res: Response) => {
  const { brand_id, index } = req.body as { brand_id: number; index: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!Number.isInteger(index) || index < 0) { sendValidationError(res, 'index must be a non-negative integer'); return; }

  const item = removeFromQueue(brandId, index);
  if (!item) { res.status(404).json({ error: 'Queue item not found' }); return; }

  broadcastToClients(brandId, 'reply_skipped', { index, item });
  res.json({ ok: true, item });
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
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
