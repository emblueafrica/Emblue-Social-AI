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
import { getMissingToolIds } from '../tools/access';
import { isToolId, TOOL_REGISTRY } from '../tools/registry';
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
  sendServerError,
  sendValidationError,
} from '../utils/validation';

const router = Router();

router.get('/tools/:tool_id/summary', requireBrandAccess, async (req: Request, res: Response) => {
  const toolId = req.params['tool_id'];
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!isToolId(toolId)) { sendValidationError(res, 'tool_id is invalid'); return; }

  try {
    const missingToolIds =
      req.user?.platform_role === 'super_admin' || req.user?.platform_role === 'platform_admin'
        ? []
        : await getMissingToolIds(brandId, toolId);
    if (missingToolIds.length) {
      res.status(403).json({
        error: 'Tool not enabled',
        message: `Your current plan does not include ${TOOL_REGISTRY[toolId].name}.`,
        tool_id: toolId,
        missing_tool_ids: missingToolIds,
        upgrade_url: '/settings/upgrade',
      });
      return;
    }

    if (toolId === 'tool_1') {
      const [keywordGroups, searchRuns] = await Promise.all([
        prisma.keywordGroup.count({ where: { brandId, isActive: true } }),
        prisma.searchRun.count({ where: { brandId } }),
      ]);
      res.json({ keyword_groups: keywordGroups, search_runs: searchRuns });
      return;
    }

    if (toolId === 'tool_2') {
      const [clusters, recommendations] = await Promise.all([
        prisma.cluster.count({ where: { brandId } }),
        prisma.contentRecommendation.count({ where: { brandId } }),
      ]);
      res.json({ clusters, recommendations });
      return;
    }

    if (toolId === 'tool_3') {
      const [pendingQueue, suggestions] = await Promise.all([
        prisma.approvalQueue.count({ where: { brandId, status: 'pending' } }),
        prisma.replySuggestion.count({ where: { brandId } }),
      ]);
      res.json({ pending_queue: pendingQueue, suggestions });
      return;
    }

    if (toolId === 'tool_4') {
      const [funnels, active] = await Promise.all([
        prisma.funnel.count({ where: { brandId } }),
        prisma.funnel.count({ where: { brandId, isActive: true } }),
      ]);
      res.json({ funnels, active });
      return;
    }

    if (toolId === 'tool_6') {
      const [totalLinks, totals] = await Promise.all([
        prisma.trackedLink.count({ where: { brandId } }),
        prisma.trackedLink.aggregate({
          where: { brandId },
          _sum: { clicks: true, conversions: true },
        }),
      ]);
      res.json({
        total_links: totalLinks,
        clicks: totals._sum.clicks ?? 0,
        conversions: totals._sum.conversions ?? 0,
      });
      return;
    }

    if (toolId === 'tool_7') {
      const [totalScores, avgStats, latest] = await Promise.all([
        prisma.creativeScore.count({ where: { brandId } }),
        prisma.creativeScore.aggregate({
          where: { brandId },
          _avg: { score: true },
        }),
        prisma.creativeScore.findFirst({
          where: { brandId },
          orderBy: { createdAt: 'desc' },
          select: { grade: true, score: true, createdAt: true },
        }),
      ]);
      res.json({
        total_scores: totalScores,
        avg_score: avgStats._avg.score ?? null,
        latest_grade: latest?.grade ?? null,
        latest_score: latest?.score ?? null,
        latest_created_at: latest?.createdAt ?? null,
      });
      return;
    }

    if (toolId === 'tool_8') {
      const latest = await prisma.insightRun.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        select: {
          messagesProcessed: true,
          faqsFound: true,
          painPoints: true,
          summary: true,
          createdAt: true,
        },
      });
      res.json({
        messages_processed: latest?.messagesProcessed ?? 0,
        faqs_found: latest?.faqsFound ?? 0,
        pain_points: latest?.painPoints ?? 0,
        summary: latest?.summary ?? null,
        latest_created_at: latest?.createdAt ?? null,
      });
      return;
    }

    if (toolId === 'tool_9') {
      const latest = await prisma.warRoom.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        select: { health: true, summary: true, alerts: true, createdAt: true },
      });
      res.json({
        health: latest?.health ?? null,
        summary: latest?.summary ?? null,
        alerts_count: Array.isArray(latest?.alerts) ? latest.alerts.length : 0,
        latest_created_at: latest?.createdAt ?? null,
      });
      return;
    }

    if (toolId === 'tool_10') {
      const [campaigns, active, totals] = await Promise.all([
        prisma.engageCampaign.count({ where: { brandId } }),
        prisma.engageCampaign.count({ where: { brandId, isActive: true } }),
        prisma.engageCampaign.aggregate({
          where: { brandId },
          _sum: { totalSent: true },
        }),
      ]);
      res.json({
        campaigns,
        active,
        total_sent: totals._sum.totalSent ?? 0,
      });
      return;
    }

    sendValidationError(res, 'tool_id is invalid');
  } catch (err) {
    sendServerError(res, 'Tool summary failed', err);
  }
});

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
    sendServerError(res, 'Ingest failed', err);
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
    sendServerError(res, 'Clustering failed', err);
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
    sendServerError(res, 'Strategy generation failed', err);
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
    sendServerError(res, 'Reply generation failed', err);
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
    sendServerError(res, 'KPI generation failed', err);
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
    sendServerError(res, 'Creative scoring failed', err);
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
    sendServerError(res, 'Comment insights failed', err);
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
    sendServerError(res, 'War room snapshot failed', err);
  }
});

// ── ATTRIBUTION LINKS ─────────────────────────────────────────────────────────
router.get('/attribution/links/:brand_id', requireBrandAccess, requireToolAccess('tool_6'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.trackedLink.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const baseUrl = (process.env.LINK_BASE_URL ?? process.env.FRONTEND_URL ?? '').replace(/\/+$/, '');
    res.json({
      links: rows.map(row => ({
        link_id: Number(row.linkId),
        brand_id: row.brandId,
        short_code: row.shortCode,
        tracked_url: baseUrl ? `${baseUrl}/r/${row.shortCode}` : `/r/${row.shortCode}`,
        dest_url: row.destUrl,
        campaign: row.campaign,
        platform: row.platform,
        content_type: row.contentType,
        clicks: row.clicks,
        conversions: row.conversions,
        created_at: row.createdAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Attribution link lookup failed', err);
  }
});

router.post('/attribution/links', requireBrandAccess, requireToolAccess('tool_6'), async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!isHttpUrl(body.dest_url)) { sendValidationError(res, 'dest_url must be a valid http(s) URL'); return; }

  try {
    const result = await createTrackedLink(req.body);
    res.json(result);
  } catch (err) {
    sendServerError(res, 'Attribution link creation failed', err);
  }
});

export default router;
