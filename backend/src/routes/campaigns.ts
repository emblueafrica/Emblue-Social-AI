// src/routes/campaigns.ts
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { mapEngageCampaign, toInputJson } from '../db/mappers';
import { engageEngager, runPostUrlCampaign, extractPostId, fillVariables } from '../stream/engageEngagers';
import { getValidToken } from '../auth/platformAuth';
import { CampaignConfig, PostUrlItem, Credentials, Platform } from '../types';
import { canAccessBrandId, requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import {
  getRequiredBrandId,
  isHttpUrl,
  isPlatform,
  requireNonEmptyArray,
  sendValidationError,
  validateAllocationTotal,
} from '../utils/validation';

const router = Router();

const SOCIAL_RESPONSE_DAYS = 30;

function dayKey(date: Date | null | undefined): string {
  return (date ?? new Date()).toISOString().slice(0, 10);
}

function recentDayKeys(days: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    keys.push(dayKey(d));
  }
  return keys;
}

function dayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function severityFor(
  score: number | null | undefined,
  sentiment: string | null | undefined
): { severity: string; tag: string } {
  if ((score ?? 0) >= 5) return { severity: 'CRITICAL', tag: 'Urgent reply' };
  if ((score ?? 0) >= 4) return { severity: 'HIGH', tag: 'Priority reply' };
  if (sentiment === 'negative') return { severity: 'HIGH', tag: 'Negative sentiment' };
  return { severity: 'MEDIUM', tag: 'Needs review' };
}

// ── LIST CAMPAIGNS ────────────────────────────────────────────────────────────
// ── CREATE / UPDATE CAMPAIGN ──────────────────────────────────────────────────
router.post('/', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as CampaignConfig & {
    campaign_id?: number;
    brand_id:     number;
    name:         string;
    platform:     Platform;
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!body.name?.trim()) { sendValidationError(res, 'name is required'); return; }
  if (!isPlatform(body.platform)) { sendValidationError(res, 'platform is invalid'); return; }
  if (body.platform_allocation) {
    const allocationResult = validateAllocationTotal(body.platform_allocation as Record<string, number | undefined>);
    if (!allocationResult.ok) { sendValidationError(res, allocationResult.message); return; }
  }

  try {
    let result;
    const campaignId = getRequiredBrandId(body.campaign_id);
    if (body.campaign_id !== undefined && !campaignId) {
      sendValidationError(res, 'campaign_id must be a positive integer');
      return;
    }
    if (campaignId) {
      const existing = await prisma.engageCampaign.findFirst({
        where: { campaignId: BigInt(campaignId), brandId },
        select: { campaignId: true },
      });
      if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }

      const row = await prisma.engageCampaign.update({
        where: { campaignId: existing.campaignId },
        data: {
          name: body.name,
          platform: body.platform as never,
          keywords: body.keywords ?? [],
          engageAll: body.engage_all ?? true,
          engageNegative: body.engage_negative ?? false,
          tone: body.tone ?? 'professional',
          replyTemplate: body.reply_template ?? null,
          fallbackTemplate: body.fallback_template ?? null,
          ctaLink: body.cta_link ?? null,
          imageUrl: body.image_url ?? null,
          autoFireThreshold: body.auto_fire_threshold ?? 85,
          maxPerHour: body.max_per_hour ?? 50,
          isActive: body.is_active ?? true,
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 34, facebook: 33, tiktok: 33 }),
          updatedAt: new Date(),
        },
      });
      result = mapEngageCampaign(row);
    } else {
      const row = await prisma.engageCampaign.create({
        data: {
          brandId,
          name: body.name,
          platform: body.platform as never,
          keywords: body.keywords ?? [],
          engageAll: body.engage_all ?? true,
          engageNegative: body.engage_negative ?? false,
          tone: body.tone ?? 'professional',
          replyTemplate: body.reply_template ?? null,
          fallbackTemplate: body.fallback_template ?? null,
          ctaLink: body.cta_link ?? null,
          imageUrl: body.image_url ?? null,
          autoFireThreshold: body.auto_fire_threshold ?? 85,
          maxPerHour: body.max_per_hour ?? 50,
          isActive: body.is_active ?? true,
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 34, facebook: 33, tiktok: 33 }),
        },
      });
      result = mapEngageCampaign(row);
    }
    res.json({ ok: true, campaign: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── TOGGLE ────────────────────────────────────────────────────────────────────
router.post('/:campaign_id/toggle', requireBrandRole('client_owner'), requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }

  try {
    const existing = await prisma.engageCampaign.findUnique({
      where: { campaignId: BigInt(campaignId) },
      select: { campaignId: true, brandId: true, isActive: true },
    });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (!canAccessBrandId(req.user, existing.brandId)) {
      res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
      return;
    }

    const row = await prisma.engageCampaign.update({
      where: { campaignId: existing.campaignId },
      data: { isActive: !(existing.isActive ?? false), updatedAt: new Date() },
      select: { campaignId: true, isActive: true },
    });
    res.json({ ok: true, campaign_id: Number(row.campaignId), is_active: row.isActive });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PREVIEW ───────────────────────────────────────────────────────────────────
router.post('/:campaign_id/preview', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }

  const { sample_comment = 'Great post!', sample_handle = 'testuser' } = req.body as {
    sample_comment?: string;
    sample_handle?:  string;
  };
  try {
    const row = await prisma.engageCampaign.findUnique({
      where: { campaignId: BigInt(campaignId) },
    });
    if (!row) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (!canAccessBrandId(req.user, row.brandId)) {
      res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
      return;
    }

    const config = mapEngageCampaign(row);
    const text = fillVariables(
      config.reply_template ?? `Hey @{{handle}}! Thank you for engaging. Check this out: {{link}}`,
      { handle: sample_handle, link: config.cta_link ?? '', brand: '' }
    );
    res.json({ preview: text, image_url: config.image_url, cta_link: config.cta_link });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── ENGAGE NOW (manual trigger) ───────────────────────────────────────────────
router.post('/engage-now', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id:      number;
    campaign_id?:  number;
    platform:      Platform;
    author_handle: string;
    author_id?:    string;
    comment_id?:   string;
    tweet_id?:     string;
    post_id?:      string;
    text:          string;
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId || !isPlatform(body.platform) || !body.author_handle || !body.text) {
    res.status(400).json({ error: 'brand_id, platform, author_handle, text required' });
    return;
  }

  try {
    const config: CampaignConfig = {
      brand_id: brandId,
      name: 'manual',
      platform: body.platform,
      engage_all: true,
      max_per_hour: 100,
      auto_fire_threshold: 0,
    };

    const credentials: Credentials = {
      META_PAGE_ACCESS_TOKEN: await getValidToken(brandId, body.platform),
      X_OAUTH_TOKEN: process.env.X_OAUTH_TOKEN,
      TIKTOK_ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN,
    };

    const result = await engageEngager(brandId, {
      platform:      body.platform,
      author_handle: body.author_handle,
      author_id:     body.author_id,
      comment_id:    body.comment_id,
      tweet_id:      body.tweet_id,
      post_id:       body.post_id,
      text:          body.text,
    }, config, credentials);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST URL CAMPAIGN ─────────────────────────────────────────────────────────
router.post('/post-urls/run', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id:           number;
    campaign_id?:       string;
    post_urls:          PostUrlItem[];
    platform_allocation?: { instagram?: number; facebook?: number; tiktok?: number };
    tone?:              string;
    reply_template?:    string;
    cta_link?:          string;
    image_url?:         string;
    auto_fire_threshold?: number;
    max_per_hour?:      number;
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId || !requireNonEmptyArray<PostUrlItem>(body.post_urls)) {
    res.status(400).json({ error: 'brand_id and post_urls[] required' });
    return;
  }

  const alloc = body.platform_allocation ?? { instagram: 34, facebook: 33, tiktok: 33 };
  const allocationResult = validateAllocationTotal(alloc);
  if (!allocationResult.ok) {
    res.status(400).json({ error: allocationResult.message });
    return;
  }

  const validated = body.post_urls.map(p => ({
    ...p,
    post_id_ext: extractPostId(p.platform, p.url),
  })).filter(p => isPlatform(p.platform) && isHttpUrl(p.url) && p.post_id_ext);

  res.json({
    ok:         true,
    message:    `Processing ${validated.length} post URLs`,
    post_count: validated.length,
  });

  const config: CampaignConfig = {
    id:                   body.campaign_id ?? `post-${Date.now()}`,
    brand_id:             brandId,
    tone:                 body.tone,
    reply_template:       body.reply_template,
    cta_link:             body.cta_link,
    image_url:            body.image_url,
    auto_fire_threshold:  body.auto_fire_threshold ?? 85,
    max_per_hour:         body.max_per_hour ?? 50,
    platform_allocation:  alloc,
  };

  const credentials: Credentials = {
    META_PAGE_ACCESS_TOKEN: await getValidToken(brandId, 'instagram'),
    TIKTOK_ACCESS_TOKEN:    process.env.TIKTOK_ACCESS_TOKEN,
    X_OAUTH_TOKEN:          process.env.X_OAUTH_TOKEN,
  };

  void runPostUrlCampaign(brandId, config, validated, credentials);
});

router.get('/:brand_id', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.engageCampaign.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ campaigns: rows.map(mapEngageCampaign) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/:brand_id/stats', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const since = new Date(Date.now() - SOCIAL_RESPONSE_DAYS * 86400000);
    const trendKeys = recentDayKeys(7);
    const [
      grouped,
      engagements,
      messages,
      kpiSnapshots,
      linkTotals,
      riskMessages,
    ] = await Promise.all([
      prisma.autoEngagement.groupBy({
        by: ['platform', 'status'],
        where: { brandId, firedAt: { gt: since } },
        _count: { _all: true },
      }),
      prisma.autoEngagement.findMany({
        where: { brandId, firedAt: { gt: since } },
        select: { platform: true, status: true, firedAt: true },
      }),
      prisma.socialMessage.findMany({
        where: { brandId, capturedAt: { gt: since } },
        select: { capturedAt: true, sentiment: true, urgencyScore: true },
      }),
      prisma.kpiSnapshot.findMany({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        take: 7,
        select: {
          createdAt: true,
          listeningKpi: true,
          replyKpi: true,
          funnelKpi: true,
          riskEvents: true,
        },
      }),
      prisma.trackedLink.aggregate({
        where: { brandId },
        _sum: { clicks: true, conversions: true },
      }),
      prisma.socialMessage.findMany({
        where: {
          brandId,
          capturedAt: { gt: since },
          OR: [
            { urgencyScore: { gte: 4 } },
            { sentiment: 'negative' },
          ],
        },
        orderBy: { capturedAt: 'desc' },
        take: 10,
        select: {
          capturedAt: true,
          platform: true,
          text: true,
          sentiment: true,
          urgencyScore: true,
          topics: true,
        },
      }),
    ]);

    const byPlatform = new Map<string, { platform: string; total: number; sent: number; manual: number; queued: number }>();
    for (const row of grouped) {
      if (!row.platform) continue;
      const stats = byPlatform.get(row.platform) ?? { platform: row.platform, total: 0, sent: 0, manual: 0, queued: 0 };
      const count = row._count._all;
      stats.total += count;
      if (row.status === 'sent') stats.sent += count;
      if (row.status === 'manual_copy') stats.manual += count;
      if (row.status === 'queued') stats.queued += count;
      byPlatform.set(row.platform, stats);
    }

    const messageVolume = new Map<string, { d: string; classified: number; total: number }>();
    const sentiment = new Map<string, { d: string; pos: number; neu: number; neg: number }>();
    for (const key of trendKeys) {
      messageVolume.set(key, { d: dayLabel(key), classified: 0, total: 0 });
      sentiment.set(key, { d: dayLabel(key), pos: 0, neu: 0, neg: 0 });
    }

    for (const message of messages) {
      const key = dayKey(message.capturedAt);
      if (!messageVolume.has(key)) continue;
      const volume = messageVolume.get(key)!;
      volume.classified += 1;
      volume.total += 1;

      const sentimentBucket = sentiment.get(key)!;
      if (message.sentiment === 'positive') sentimentBucket.pos += 1;
      else if (message.sentiment === 'negative') sentimentBucket.neg += 1;
      else sentimentBucket.neu += 1;
    }

    const sentByDay = new Map<string, number>();
    const manualByDay = new Map<string, number>();
    const queuedByDay = new Map<string, number>();
    for (const engagement of engagements) {
      const key = dayKey(engagement.firedAt);
      if (!trendKeys.includes(key)) continue;
      if (engagement.status === 'sent') sentByDay.set(key, (sentByDay.get(key) ?? 0) + 1);
      if (engagement.status === 'manual_copy') manualByDay.set(key, (manualByDay.get(key) ?? 0) + 1);
      if (engagement.status === 'queued') queuedByDay.set(key, (queuedByDay.get(key) ?? 0) + 1);
    }

    const latestKpi = kpiSnapshots[0];
    const fallbackScores = {
      listening: latestKpi?.listeningKpi === null || latestKpi?.listeningKpi === undefined ? null : Number(latestKpi.listeningKpi),
      reply: latestKpi?.replyKpi === null || latestKpi?.replyKpi === undefined ? null : Number(latestKpi.replyKpi),
      funnel: latestKpi?.funnelKpi === null || latestKpi?.funnelKpi === undefined ? null : Number(latestKpi.funnelKpi),
    };
    const snapshotByDay = new Map(kpiSnapshots.map(snapshot => [dayKey(snapshot.createdAt), snapshot]));
    const score_trend = trendKeys.map(key => {
      const snapshot = snapshotByDay.get(key);
      return {
        d: dayLabel(key),
        listening: snapshot?.listeningKpi === null || snapshot?.listeningKpi === undefined ? fallbackScores.listening : Number(snapshot.listeningKpi),
        reply: snapshot?.replyKpi === null || snapshot?.replyKpi === undefined ? fallbackScores.reply : Number(snapshot.replyKpi),
        funnel: snapshot?.funnelKpi === null || snapshot?.funnelKpi === undefined ? fallbackScores.funnel : Number(snapshot.funnelKpi),
      };
    });

    const stats = Array.from(byPlatform.values());
    const totals = stats.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        sent: acc.sent + row.sent,
        manual: acc.manual + row.manual,
        queued: acc.queued + row.queued,
      }),
      { total: 0, sent: 0, manual: 0, queued: 0 },
    );

    const risk_events = riskMessages.map(message => {
      const risk = severityFor(message.urgencyScore, message.sentiment);
      return {
        time: message.capturedAt.toISOString(),
        platform: message.platform,
        tag: risk.tag,
        severity: risk.severity,
        text: message.text,
        sentiment: message.sentiment,
        urgency_score: message.urgencyScore,
        topics: message.topics,
      };
    });

    res.json({
      stats,
      summary: {
        total_messages: messages.length,
        replies_sent: totals.sent,
        manual_reviews: totals.manual,
        queued: totals.queued,
        listening_score: fallbackScores.listening,
        reply_score: fallbackScores.reply,
        funnel_score: fallbackScores.funnel,
        risk_events: risk_events.length || latestKpi?.riskEvents || 0,
        avg_response_time_minutes: null,
        revenue_attributed: null,
      },
      score_trend,
      message_volume: Array.from(messageVolume.values()),
      sentiment: Array.from(sentiment.values()),
      risk_events,
      attribution: {
        clicks: linkTotals._sum.clicks ?? 0,
        conversions: linkTotals._sum.conversions ?? 0,
        revenue: null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
