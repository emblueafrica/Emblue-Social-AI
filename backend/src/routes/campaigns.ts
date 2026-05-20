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
    const since = new Date(Date.now() - 30 * 86400000);
    const grouped = await prisma.autoEngagement.groupBy({
      by: ['platform', 'status'],
      where: { brandId, firedAt: { gt: since } },
      _count: { _all: true },
    });

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

    res.json({ stats: Array.from(byPlatform.values()) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
