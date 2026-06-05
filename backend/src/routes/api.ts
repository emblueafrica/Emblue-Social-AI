// src/routes/api.ts
import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { runAgent1 } from '../agents/agent1_listening';
import { runAgent2 } from '../agents/agent2_clustering';
import { runAgent3 } from '../agents/agent3_content_strategist';
import { runAgent4 } from '../agents/agent4_reply_assistant';
import { runAgent6 } from '../agents/agents567';
import { runAgent9, runAgent10, runAgent11 } from '../agents/agents9_to_14';
import { createTrackedLink } from '../agents/agent8_attribution';
import prisma from '../db/prisma';
import { generateKpiReportPdf } from '../reports/pdf';
import { canAccessBrandId, requireBrandAccess } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import {
  persistAgent1Result, persistAgent2Result, persistAgent3Result,
  insertKpiSnapshot, persistAgent10Result, insertWarRoomSnapshot,
  getRecentMessages, getTopClusters, getBrandById,
} from '../db/queries';
import { Platform } from '../types';
import {
  getRequiredBrandId,
  isHttpUrl,
  isPlatform,
  requireNonEmptyArray,
  sendValidationError,
} from '../utils/validation';

const router = Router();

// ── INGEST ────────────────────────────────────────────────────────────────────
router.post('/ingest', requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const { brand_id, platform, payload_type, source_name, items } = req.body as {
    brand_id:     number;
    platform:     Platform;
    payload_type: 'csv' | 'api_items';
    source_name:  string;
    items:        unknown[];
  };

  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!isPlatform(platform)) { sendValidationError(res, 'platform is invalid'); return; }
  if (payload_type !== 'csv' && payload_type !== 'api_items') { sendValidationError(res, 'payload_type must be csv or api_items'); return; }
  if (!requireNonEmptyArray(items)) { sendValidationError(res, 'items must be a non-empty array'); return; }

  try {
    const result = await runAgent1({ brand_id: brandId, platform, payload_type, source_name, items: items as any });
    await persistAgent1Result(brandId, result);
    res.json({ ok: true, classified: result.total_items, errors: result.errors });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── CLUSTER ───────────────────────────────────────────────────────────────────
router.post('/cluster', requireBrandAccess, requireToolAccess('tool_2'), async (req: Request, res: Response) => {
  const { brand_id, time_window_days = 7 } = req.body as { brand_id: number; time_window_days?: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const messages = await getRecentMessages(brandId, 200);
    if (messages.length < 3) {
      res.json({ ok: true, clusters: 0, message: 'Insufficient data' });
      return;
    }

    const result = await runAgent2({
      brand_id: brandId,
      items: messages.map(m => ({ text: m.text, platform: m.platform, kind: m.kind ?? 'comment', captured_at: m.captured_at })),
      time_window_days,
      min_items_per_cluster: 3,
    });

    if (!result.insufficient_data) await persistAgent2Result(brandId, result);
    res.json({ ok: true, clusters: result.clusters_created, data: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── STRATEGIZE ────────────────────────────────────────────────────────────────
router.post('/strategize', requireBrandAccess, requireToolAccess('tool_2'), async (req: Request, res: Response) => {
  const { brand_id } = req.body as { brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const clusters = await getTopClusters(brandId, 3);
    const brand    = await getBrandById(brandId);

    const result = await runAgent3({
      brand_id: brandId,
      clusters,
      platforms_target: ['instagram', 'x', 'tiktok'],
      campaign_context: { objective: brand?.campaign_objective ?? 'brand awareness' },
      ruleset:          { tone: brand?.tone ?? 'professional' },
    });

    if (!result.error) await persistAgent3Result(brandId, result);
    res.json({ ok: true, recommendations: result.recommendations?.length ?? 0, data: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── REPLY ─────────────────────────────────────────────────────────────────────
router.post('/reply', requireBrandAccess, requireToolAccess('tool_3'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId((req.body as Record<string, unknown>).brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const result = await runAgent4(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── KPI ───────────────────────────────────────────────────────────────────────
router.post('/kpi', requireBrandAccess, requireToolAccess('tool_5'), async (req: Request, res: Response) => {
  const { brand_id } = req.body as { brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const week  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const result = await runAgent6({
      brand_id: brandId,
      date_from: week,
      date_to:   today,
      platforms: ['x', 'instagram', 'facebook', 'tiktok'],
    });

    if (!result.error) await insertKpiSnapshot(brandId, result, ['x', 'instagram', 'facebook', 'tiktok']);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── CREATIVE SCORE ────────────────────────────────────────────────────────────
router.post('/creative/score', requireBrandAccess, requireToolAccess('tool_7'), async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!isPlatform(body.platform)) { sendValidationError(res, 'platform is invalid'); return; }

  try {
    const result = await runAgent9(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── COMMENT INSIGHTS ──────────────────────────────────────────────────────────
router.post('/insights/run', requireBrandAccess, requireToolAccess('tool_8'), async (req: Request, res: Response) => {
  const { brand_id } = req.body as { brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const messages = await getRecentMessages(brandId, 500);
    const brand    = await getBrandById(brandId);

    const result = await runAgent10({
      brand_id: brandId,
      comments: messages.map(m => ({
        platform: m.platform,
        author:   m.author_handle ?? '',
        text:     m.text,
      })),
      brand_context: brand?.name ?? 'Brand',
    });

    if (!result.error) await persistAgent10Result(brandId, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── WAR ROOM ──────────────────────────────────────────────────────────────────
router.post('/warroom/snapshot', requireBrandAccess, requireToolAccess('tool_9'), async (req: Request, res: Response) => {
  const { brand_id } = req.body as { brand_id: number };
  const brandId = getRequiredBrandId(brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const messages = await getRecentMessages(brandId, 50);
    const brand    = await getBrandById(brandId);

    const result = await runAgent11({
      brand_id: brandId,
      war_room_id:        1,
      live_messages:      messages,
      watchlist_keywords: brand?.watchlist_keywords ?? [],
      current_metrics:    {},
    });

    if (!result.error) await insertWarRoomSnapshot(1, brandId, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── ATTRIBUTION LINKS ─────────────────────────────────────────────────────────
router.post('/attribution/links', requireBrandAccess, requireToolAccess('tool_6'), async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!isHttpUrl(body.dest_url)) { sendValidationError(res, 'dest_url must be a valid http(s) URL'); return; }

  try {
    const result = await createTrackedLink(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
