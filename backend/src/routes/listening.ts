import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { getBrandById } from '../db/queries';
import { runAgent4 } from '../agents/agent4_reply_assistant';
import { canAccessBrandId, requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import {
  getRequiredBrandId,
  isPlatform,
  requireNonEmptyArray,
  sendServerError,
  sendValidationError,
} from '../utils/validation';
import { Platform } from '../types';
import {
  normalizeSearchMode,
  runListeningSearch,
  startListeningSearch,
} from '../listening/searchService';

const router = Router();

function toBigIntId(value: unknown): bigint | null {
  const parsed = getRequiredBrandId(value);
  return parsed ? BigInt(parsed) : null;
}

function cleanKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 20);
}

function cleanPlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value)).filter(isPlatform) as Platform[];
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnly(value: Date | null): Date | null {
  if (!value) return null;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function validateHistoricalRange(dateFrom: Date | null, dateTo: Date | null): string | null {
  if (!dateFrom || !dateTo) return 'date_from and date_to are required for historical search';
  if (dateFrom > dateTo) return 'date_from must be before date_to';
  const today = dateOnly(new Date())!;
  if (dateFrom > today || dateTo > today) return 'date range cannot include future dates';
  const months = (dateTo.getUTCFullYear() - dateFrom.getUTCFullYear()) * 12 + (dateTo.getUTCMonth() - dateFrom.getUTCMonth());
  if (months > 24 || (months === 24 && dateTo.getUTCDate() > dateFrom.getUTCDate())) {
    return 'historical date range cannot exceed 24 months';
  }
  return null;
}

function canAccessBrand(req: Request, brandId: number): boolean {
  return canAccessBrandId(req.user, brandId);
}

async function isCampaignGroup(groupId: bigint | null): Promise<boolean> {
  if (!groupId) return false;
  const group = await prisma.keywordGroup.findUnique({ where: { groupId }, select: { source: true } });
  return group?.source === 'campaign';
}

function keywordGroupJson(row: Awaited<ReturnType<typeof prisma.keywordGroup.findFirst>>) {
  if (!row) return null;
  return {
    group_id: Number(row.groupId),
    brand_id: row.brandId,
    name: row.name,
    keywords: row.keywords,
    platforms: row.platforms,
    mode: row.mode,
    date_from: row.dateFrom,
    date_to: row.dateTo,
    alert_urgency_threshold: row.alertUrgencyThreshold,
    alert_intents: row.alertIntents,
    is_active: row.isActive,
    created_at: row.createdAt,
    last_run_at: row.lastRunAt,
  };
}

function searchRunJson(row: Awaited<ReturnType<typeof prisma.searchRun.findFirst>>) {
  if (!row) return null;
  return {
    run_id: Number(row.runId),
    brand_id: row.brandId,
    group_id: row.groupId ? Number(row.groupId) : null,
    keywords: row.keywords,
    platforms: row.platforms,
    date_from: row.dateFrom,
    date_to: row.dateTo,
    mode: row.mode,
    status: row.status,
    total_results: row.totalResults,
    positive_count: row.positiveCount,
    negative_count: row.negativeCount,
    neutral_count: row.neutralCount,
    peak_date: row.peakDate,
    peak_count: row.peakCount,
    insights_summary: row.insightsSummary,
    created_at: row.createdAt,
    completed_at: row.completedAt,
    error_msg: row.errorMsg,
  };
}

function searchResultJson(row: Awaited<ReturnType<typeof prisma.searchResult.findFirst>>) {
  if (!row) return null;
  return {
    result_id: Number(row.resultId),
    run_id: Number(row.runId),
    brand_id: row.brandId,
    group_id: row.groupId ? Number(row.groupId) : null,
    matched_keyword: row.matchedKeyword,
    platform: row.platform,
    text: row.text,
    author_handle: row.authorHandle,
    author_id_ext: row.authorIdExt,
    url: row.url,
    posted_at: row.postedAt,
    sentiment: row.sentiment,
    intent: row.intent,
    urgency_score: row.urgencyScore,
    topics: row.topics,
    likes: row.likes,
    replies_count: row.repliesCount,
    shares: row.shares,
    views: row.views,
    engaged: row.engaged,
    created_at: row.createdAt,
  };
}

function searchVolumeJson(row: Awaited<ReturnType<typeof prisma.searchVolume.findFirst>>) {
  if (!row) return null;
  return {
    volume_id: Number(row.volumeId),
    run_id: Number(row.runId),
    period_start: row.periodStart,
    period_end: row.periodEnd,
    period_type: row.periodType,
    mention_count: row.mentionCount,
    positive_count: row.positiveCount,
    negative_count: row.negativeCount,
    neutral_count: row.neutralCount,
  };
}

router.post('/keyword-groups', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (typeof body.name !== 'string' || !body.name.trim()) { sendValidationError(res, 'name is required'); return; }

  const keywords = cleanKeywords(body.keywords);
  const platforms = cleanPlatforms(body.platforms);
  if (!keywords.length) { sendValidationError(res, 'at least one keyword is required'); return; }
  if (!platforms.length) { sendValidationError(res, 'at least one valid platform is required'); return; }

  const mode = typeof body.mode === 'string' && ['realtime', 'historical', 'both'].includes(body.mode) ? body.mode : 'realtime';
  const dateFrom = dateOnly(parseDate(body.date_from));
  const dateTo = dateOnly(parseDate(body.date_to));
  const threshold = Number(body.alert_urgency_threshold ?? 4);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 5) {
    sendValidationError(res, 'alert_urgency_threshold must be 1-5');
    return;
  }

  try {
    const groupId = toBigIntId(body.group_id);
    if (groupId) {
      const existing = await prisma.keywordGroup.findUnique({ where: { groupId } });
      if (!existing) { res.status(404).json({ error: 'Keyword group not found' }); return; }
      if (existing.source === 'campaign') { res.status(404).json({ error: 'Keyword group not found' }); return; }
      if (!canAccessBrand(req, existing.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }

      const row = await prisma.keywordGroup.update({
        where: { groupId },
        data: {
          brandId,
          name: body.name.trim(),
          keywords,
          platforms,
          mode,
          dateFrom,
          dateTo,
          alertUrgencyThreshold: threshold,
          alertIntents: cleanKeywords(body.alert_intents),
          isActive: body.is_active === undefined ? existing.isActive : Boolean(body.is_active),
        },
      });
      res.json({ ok: true, keyword_group: keywordGroupJson(row) });
      return;
    }

    const row = await prisma.keywordGroup.create({
      data: {
        brandId,
        name: body.name.trim(),
        keywords,
        platforms,
        mode,
        dateFrom,
        dateTo,
        alertUrgencyThreshold: threshold,
        alertIntents: cleanKeywords(body.alert_intents),
        isActive: body.is_active === undefined ? true : Boolean(body.is_active),
      },
    });
    res.json({ ok: true, keyword_group: keywordGroupJson(row) });
  } catch (err) {
    sendServerError(res, 'Keyword group save failed', err);
  }
});

router.get('/keyword-groups/:brand_id', requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.keywordGroup.findMany({
      where: { brandId, source: 'listening' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ keyword_groups: rows.map(keywordGroupJson) });
  } catch (err) {
    sendServerError(res, 'Keyword group lookup failed', err);
  }
});

router.delete('/keyword-groups/:group_id', requireBrandRole('client_owner'), requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const groupId = toBigIntId(req.params['group_id']);
  if (!groupId) { sendValidationError(res, 'group_id must be a positive integer'); return; }

  try {
    const group = await prisma.keywordGroup.findUnique({ where: { groupId } });
    if (!group) { res.status(404).json({ error: 'Keyword group not found' }); return; }
    if (group.source === 'campaign') { res.status(404).json({ error: 'Keyword group not found' }); return; }
    if (!canAccessBrand(req, group.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }

    await prisma.keywordGroup.delete({ where: { groupId } });
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, 'Keyword group deletion failed', err);
  }
});

router.post('/keyword-groups/:group_id/toggle', requireBrandRole('client_owner'), requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const groupId = toBigIntId(req.params['group_id']);
  if (!groupId) { sendValidationError(res, 'group_id must be a positive integer'); return; }

  try {
    const group = await prisma.keywordGroup.findUnique({ where: { groupId } });
    if (!group) { res.status(404).json({ error: 'Keyword group not found' }); return; }
    if (group.source === 'campaign') { res.status(404).json({ error: 'Keyword group not found' }); return; }
    if (!canAccessBrand(req, group.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }

    const row = await prisma.keywordGroup.update({
      where: { groupId },
      data: { isActive: !(group.isActive ?? false) },
    });
    res.json({ ok: true, keyword_group: keywordGroupJson(row) });
  } catch (err) {
    sendServerError(res, 'Keyword group toggle failed', err);
  }
});

router.post('/search', requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const groupId = toBigIntId(body.group_id);
    const group = groupId ? await prisma.keywordGroup.findUnique({ where: { groupId } }) : null;
    if (groupId && !group) { res.status(404).json({ error: 'Keyword group not found' }); return; }
    if (group?.source === 'campaign') { res.status(404).json({ error: 'Keyword group not found' }); return; }
    if (group && group.brandId !== brandId) { res.status(400).json({ error: 'group_id does not belong to brand_id' }); return; }

    const mode = normalizeSearchMode(body.mode) ?? (group?.mode === 'historical' ? 'historical' : 'realtime');
    const keywords = cleanKeywords(requireNonEmptyArray(body.keywords) ? body.keywords : group?.keywords ?? []);
    const platforms = cleanPlatforms(requireNonEmptyArray(body.platforms) ? body.platforms : group?.platforms ?? []);
    if (!keywords.length) { sendValidationError(res, 'at least one keyword is required'); return; }
    if (!platforms.length) { sendValidationError(res, 'at least one valid platform is required'); return; }

    const dateFrom = dateOnly(parseDate(body.date_from) ?? group?.dateFrom ?? null);
    const dateTo = dateOnly(parseDate(body.date_to) ?? group?.dateTo ?? null);
    if (mode === 'historical') {
      const rangeError = validateHistoricalRange(dateFrom, dateTo);
      if (rangeError) { sendValidationError(res, rangeError); return; }
    }

    const runId = await startListeningSearch({
      brandId,
      groupId: groupId ? Number(groupId) : null,
      keywords,
      platforms,
      mode,
      dateFrom,
      dateTo,
    });

    res.status(202).json({ ok: true, run_id: runId, status: 'pending' });
  } catch (err) {
    sendServerError(res, 'Listening search failed', err);
  }
});

router.get('/runs/:brand_id', requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const campaignGroups = await prisma.keywordGroup.findMany({ where: { brandId, source: 'campaign' }, select: { groupId: true } });
    const rows = await prisma.searchRun.findMany({
      where: { brandId, groupId: { notIn: campaignGroups.map(group => group.groupId) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ runs: rows.map(searchRunJson) });
  } catch (err) {
    sendServerError(res, 'Listening search start failed', err);
  }
});

router.get('/runs/:run_id/results', requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const runId = toBigIntId(req.params['run_id']);
  if (!runId) { sendValidationError(res, 'run_id must be a positive integer'); return; }

  try {
    const run = await prisma.searchRun.findUnique({ where: { runId } });
    if (!run) { res.status(404).json({ error: 'Search run not found' }); return; }
    if (await isCampaignGroup(run.groupId)) { res.status(404).json({ error: 'Search run not found' }); return; }
    if (!canAccessBrand(req, run.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }

    const limit = Math.min(100, getRequiredBrandId(req.query['limit']) ?? 50);
    const offset = Math.max(0, Number(req.query['offset'] ?? 0));
    const [rows, total] = await Promise.all([
      prisma.searchResult.findMany({
        where: { runId },
        orderBy: [{ urgencyScore: 'desc' }, { postedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.searchResult.count({ where: { runId } }),
    ]);
    res.json({ total, limit, offset, results: rows.map(searchResultJson) });
  } catch (err) {
    sendServerError(res, 'Search run lookup failed', err);
  }
});

router.get('/runs/:run_id/volume', requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const runId = toBigIntId(req.params['run_id']);
  if (!runId) { sendValidationError(res, 'run_id must be a positive integer'); return; }

  try {
    const run = await prisma.searchRun.findUnique({ where: { runId } });
    if (!run) { res.status(404).json({ error: 'Search run not found' }); return; }
    if (await isCampaignGroup(run.groupId)) { res.status(404).json({ error: 'Search run not found' }); return; }
    if (!canAccessBrand(req, run.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }

    const rows = await prisma.searchVolume.findMany({
      where: { runId },
      orderBy: { periodStart: 'asc' },
    });
    res.json({ volume: rows.map(searchVolumeJson) });
  } catch (err) {
    sendServerError(res, 'Search result lookup failed', err);
  }
});

router.get('/runs/:run_id/status', requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const runId = toBigIntId(req.params['run_id']);
  if (!runId) { sendValidationError(res, 'run_id must be a positive integer'); return; }

  try {
    const run = await prisma.searchRun.findUnique({ where: { runId } });
    if (!run) { res.status(404).json({ error: 'Search run not found' }); return; }
    if (await isCampaignGroup(run.groupId)) { res.status(404).json({ error: 'Search run not found' }); return; }
    if (!canAccessBrand(req, run.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }
    res.json({ run: searchRunJson(run) });
  } catch (err) {
    sendServerError(res, 'Search volume lookup failed', err);
  }
});

router.get('/feed/:brand_id', requireBrandAccess, requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const campaignGroups = await prisma.keywordGroup.findMany({ where: { brandId, source: 'campaign' }, select: { groupId: true } });
    const rows = await prisma.searchResult.findMany({
      where: { brandId, groupId: { notIn: campaignGroups.map(group => group.groupId) } },
      orderBy: [{ urgencyScore: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(100, getRequiredBrandId(req.query['limit']) ?? 50),
    });
    res.json({ feed: rows.map(searchResultJson) });
  } catch (err) {
    sendServerError(res, 'Listening feed lookup failed', err);
  }
});

router.post('/results/:result_id/engage', requireToolAccess('tool_1'), async (req: Request, res: Response) => {
  const resultId = toBigIntId(req.params['result_id']);
  if (!resultId) { sendValidationError(res, 'result_id must be a positive integer'); return; }

  try {
    const row = await prisma.searchResult.findUnique({ where: { resultId } });
    if (!row) { res.status(404).json({ error: 'Search result not found' }); return; }
    if (await isCampaignGroup(row.groupId)) { res.status(404).json({ error: 'Search result not found' }); return; }
    if (!canAccessBrand(req, row.brandId)) { res.status(403).json({ error: 'Forbidden' }); return; }

    await prisma.searchResult.update({
      where: { resultId },
      data: { engaged: true },
    });

    const brand = await getBrandById(row.brandId);
    const reply = await runAgent4({
      brand_id: row.brandId,
      message: row.text,
      platform: row.platform,
      tone: brand?.tone ?? 'professional',
      campaign_context: {
        objective: brand?.campaign_objective ?? 'join relevant public conversation',
      },
      ruleset: { tone: brand?.tone ?? 'professional' },
      author_handle: row.authorHandle ?? undefined,
      reply_channel: row.platform === 'x' ? 'thread_reply' : row.platform === 'tiktok' ? 'comment_reply' : 'dm',
    });

    res.json({ ok: true, result_id: Number(resultId), engaged: true, reply });
  } catch (err) {
    sendServerError(res, 'Listening engagement failed', err);
  }
});

export default router;
