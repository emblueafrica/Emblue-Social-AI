// src/routes/campaigns.ts
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import prisma from '../db/prisma';
import { mapEngageCampaign, toInputJson } from '../db/mappers';
import { engageEngager, fetchXPostEngagers, runPostUrlCampaign, extractPostId, fillVariables } from '../stream/engageEngagers';
import { publishReply, uploadXMediaFromUrl } from '../stream/publisher';
import { getValidToken } from '../auth/platformAuth';
import { getConnectedAccountRecord } from '../db/queries';
import { syncXRepliesForPost, trackPublishedXPost } from '../campaigns/xReplySync';
import { retryCampaignEngagement, syncTrackedCampaignEngagements } from '../campaigns/engagementSync';
import { syncKeywordCampaigns } from '../campaigns/keywordCampaignSync';
import { resolveCampaignCapability } from '../campaigns/capabilities';
import { fetchPostUrlCampaignPreview, runPostUrlCampaignPreview } from '../campaigns/postUrlCampaign';
import { prepareCampaignDelivery } from '../campaigns/deliveryWorker';
import { enqueueCampaignDelivery, isBullEnabled } from '../queue/jobs';
import { withSchedulerLease } from '../automation/schedulerLease';
import { CampaignConfig, PostUrlItem, Credentials, Intent, Platform } from '../types';
import {
  CAMPAIGN_PLATFORMS,
  CampaignEventSettings,
  CampaignMediaInput,
  CampaignPlatform,
  CampaignSourceMode,
  DEFAULT_EVENT_SETTINGS,
  validateActivationRequest,
  validateMediaSet,
  validateKeywordCampaignInput,
} from '../campaigns/lifecycle';
import { uploadCampaignMediaBuffer } from '../utils/cloudinary';
import { canAccessBrandId, requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import {
  getRequiredBrandId,
  isHttpUrl,
  isPlatform,
  requireNonEmptyArray,
  sendServerError,
  sendValidationError,
  validateAllocationTotal,
} from '../utils/validation';

const router = Router();

const SOCIAL_RESPONSE_DAYS = 30;
const campaignUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 100 * 1024 * 1024 },
});

type UploadedCampaignMedia = CampaignMediaInput & {
  url: string;
  public_id: string;
  media_type: 'image' | 'video';
};

const UNIFIED_MODES = ['live', 'post_url', 'keyword'] as const;
type UnifiedMode = typeof UNIFIED_MODES[number];

function isUnifiedMode(value: unknown): value is UnifiedMode {
  return typeof value === 'string' && UNIFIED_MODES.includes(value as UnifiedMode);
}

function cleanPlatforms(value: unknown): CampaignPlatform[] {
  return Array.isArray(value)
    ? Array.from(new Set(value)).filter((platform): platform is CampaignPlatform => CAMPAIGN_PLATFORMS.includes(platform as CampaignPlatform))
    : [];
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function cleanModeConfig(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Record<string, Prisma.InputJsonValue> = {};
  const campaignTypes = ['brand_mention', 'competitor_complaint', 'category_intent'];
  if (typeof input['campaign_type'] === 'string' && campaignTypes.includes(input['campaign_type'])) output['campaign_type'] = input['campaign_type'];
  const audienceTypes = ['regular', 'influencer', 'brand'];
  if (Array.isArray(input['audience_types'])) output['audience_types'] = input['audience_types'].filter(item => typeof item === 'string' && audienceTypes.includes(item));
  for (const key of ['skip_verified', 'skip_reposts', 'include_tracked_link']) {
    if (typeof input[key] === 'boolean') output[key] = input[key];
  }
  for (const [key, max] of [['min_followers', 10_000_000], ['skip_accounts_newer_than_days', 3650]] as const) {
    const parsed = boundedInteger(input[key], 0, 0, max);
    if (parsed !== null) output[key] = parsed;
  }
  return output as Prisma.InputJsonObject;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

function keywordAllocation(platforms: CampaignPlatform[]): Record<CampaignPlatform, number> {
  const allocation = { instagram: 0, facebook: 0, tiktok: 0, x: 0 };
  const share = Math.floor(100 / platforms.length);
  platforms.forEach((platform, index) => { allocation[platform] = share + (index === 0 ? 100 - share * platforms.length : 0); });
  return allocation;
}

async function campaignCapabilities(brandId: number, platforms: CampaignPlatform[]) {
  const accounts = await Promise.all(platforms.map(platform => getConnectedAccountRecord(brandId, platform)));
  return platforms.map((platform, index) => resolveCampaignCapability({
    platform,
    connected: Boolean(accounts[index]),
    scopes: accounts[index]?.scope,
    discoveryConfigured: Boolean(process.env.APIFY_API_TOKEN),
  }));
}

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

function hasScope(scope: string | null | undefined, required: string): boolean {
  return String(scope ?? '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .includes(required);
}

function extractXStatusId(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  return extractPostId('x', url.trim());
}

async function deleteCampaignPlatformPost(brandId: number, platform: CampaignPlatform, postId: string): Promise<{ deleted: boolean; status: string }> {
  const token = await getValidToken(brandId, platform);
  if (!token) return { deleted: false, status: 'manual_required:no_active_token' };
  try {
    if (platform === 'x') {
      const response = await fetch(`https://api.x.com/2/tweets/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      return response.ok ? { deleted: true, status: 'deleted' } : { deleted: false, status: `manual_required:x_delete_${response.status}` };
    }
    if (platform === 'facebook') {
      const response = await fetch(`https://graph.facebook.com/v19.0/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      return response.ok ? { deleted: true, status: 'deleted' } : { deleted: false, status: `manual_required:facebook_delete_${response.status}` };
    }
    return { deleted: false, status: 'manual_required:platform_delete_not_supported' };
  } catch {
    return { deleted: false, status: 'manual_required:delete_request_failed' };
  }
}

router.post('/media/upload', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), campaignUpload.array('files', 10), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) { sendValidationError(res, 'Select at least one campaign media file'); return; }

  const mediaValidation = validateMediaSet(files.map(file => ({ mime_type: file.mimetype, size_bytes: file.size })));
  if (!mediaValidation.ok) { sendValidationError(res, mediaValidation.message ?? 'Invalid campaign media'); return; }

  try {
    const media: UploadedCampaignMedia[] = [];
    for (const file of files) {
      const uploaded = await uploadCampaignMediaBuffer(file.buffer, file.originalname, file.mimetype, `social-emblue-ai/campaigns/${brandId}`);
      if (uploaded.error || !uploaded.secure_url || !uploaded.public_id || !uploaded.media_type || !uploaded.mime_type || !uploaded.size_bytes) {
        res.status(422).json({ error: 'Campaign media upload failed', message: uploaded.error ?? 'Cloudinary did not return complete media metadata' });
        return;
      }
      media.push({
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        media_type: uploaded.media_type,
        mime_type: uploaded.mime_type,
        size_bytes: uploaded.size_bytes,
      });
    }
    res.status(201).json({ ok: true, media });
  } catch (err) {
    sendServerError(res, 'Campaign media upload failed', err);
  }
});

router.get('/capabilities', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  const requested = typeof req.query['platforms'] === 'string' ? req.query['platforms'].split(',') : CAMPAIGN_PLATFORMS;
  const platforms = cleanPlatforms(requested);
  if (!brandId || !platforms.length) { sendValidationError(res, 'brand_id and at least one supported platform are required'); return; }
  try { res.json({ capabilities: await campaignCapabilities(brandId, platforms), queue_available: isBullEnabled() }); }
  catch (err) { sendServerError(res, 'Campaign capability lookup failed', err); }
});

router.get('/activity', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  const campaignId = getRequiredBrandId(req.query['campaign_id']);
  const mode = isUnifiedMode(req.query['mode']) ? req.query['mode'] : null;
  const platform = isPlatform(req.query['platform']) ? req.query['platform'] : null;
  const status = typeof req.query['status'] === 'string' && req.query['status'].length <= 40 ? req.query['status'] : null;
  const deliveryStatusFilter = status && ['sent', 'queued', 'processing', 'failed', 'rate_limited', 'manual_action_required', 'manual_copy'].includes(status) ? status : null;
  const cursor = getRequiredBrandId(req.query['cursor']);
  const limit = boundedInteger(req.query['limit'], 25, 1, 100);
  if (!brandId || limit === null) { sendValidationError(res, 'brand_id and a limit between 1 and 100 are required'); return; }
  try {
    const campaigns = await prisma.engageCampaign.findMany({
      where: { brandId, ...(mode ? { mode } : {}), ...(campaignId ? { campaignId: BigInt(campaignId) } : {}) },
      select: { campaignId: true, name: true, mode: true },
    });
    const campaignById = new Map(campaigns.map(item => [String(item.campaignId), item]));
    const rows = await prisma.campaignPostEngager.findMany({
      where: {
        brandId,
        campaignId: { in: Array.from(campaignById.keys()) },
        ...(platform ? { platform } : {}),
        ...(status && !deliveryStatusFilter ? { status } : {}),
        ...(cursor ? { engagerId: { lt: BigInt(cursor) } } : {}),
      },
      orderBy: { engagerId: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const deliveries = page.length ? await prisma.campaignDeliveryAttempt.findMany({ where: { engagerId: { in: page.map(item => item.engagerId) } } }) : [];
    const deliveriesByEngager = new Map<string, typeof deliveries>();
    for (const delivery of deliveries) {
      const key = String(delivery.engagerId);
      deliveriesByEngager.set(key, [...(deliveriesByEngager.get(key) ?? []), delivery]);
    }
    const items = page.map(item => {
      const campaign = campaignById.get(String(item.campaignId));
      const itemDeliveries = deliveriesByEngager.get(String(item.engagerId)) ?? [];
      return {
      id: Number(item.engagerId), campaign_id: Number(item.campaignId), campaign_name: campaign?.name ?? 'Campaign',
      mode: campaign?.mode ?? 'post_url', platform: item.platform, action: item.action,
      author_handle: item.authorHandle, original_text: item.originalText, reply_text: item.replyText, status: item.status,
      confidence: item.replyConfidence, error: item.deliveryError, created_at: item.createdAt,
      deliveries: itemDeliveries.map(delivery => ({ channel: delivery.channel, status: delivery.status, error: delivery.error, delivered_at: delivery.deliveredAt })),
    };
    }).filter(item => !deliveryStatusFilter || item.deliveries.some(delivery => delivery.status === deliveryStatusFilter));
    if (req.query['format'] === 'csv') {
      const header = ['id', 'campaign', 'mode', 'platform', 'action', 'author', 'status', 'reply', 'error', 'created_at'];
      const csv = [header.map(csvCell).join(','), ...items.map(item => [item.id, item.campaign_name, item.mode, item.platform, item.action, item.author_handle, item.status, item.reply_text, item.error, item.created_at.toISOString()].map(csvCell).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="campaign-activity-${brandId}.csv"`);
      res.send(csv);
      return;
    }
    res.json({ items, next_cursor: rows.length > limit ? Number(page.at(-1)?.engagerId) : null });
  } catch (err) { sendServerError(res, 'Campaign activity lookup failed', err); }
});

async function queueActivityAction(req: Request, res: Response): Promise<void> {
  const engagerId = getRequiredBrandId(req.params['engager_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  const channel = req.body?.channel === 'direct_message' ? 'direct_message' : 'public_reply';
  if (!engagerId || !brandId) { sendValidationError(res, 'brand_id and engager_id must be positive integers'); return; }
  if (!isBullEnabled()) { res.status(503).json({ error: 'Campaign delivery queue unavailable', message: 'Configure REDIS_URL before sending campaign activity.' }); return; }
  try {
    const engager = await prisma.campaignPostEngager.findFirst({ where: { engagerId: BigInt(engagerId), brandId } });
    if (!engager || !/^\d+$/.test(engager.campaignId)) { res.status(404).json({ error: 'Campaign activity not found' }); return; }
    const campaignId = Number(engager.campaignId);
    const replyText = typeof req.body?.reply_text === 'string' ? req.body.reply_text.trim().slice(0, 2000) : '';
    if (replyText) await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { replyText, deliveryError: null, updatedAt: new Date() } });
    const data = { brand_id: brandId, campaign_id: campaignId, engager_id: engagerId, channel } as const;
    await prepareCampaignDelivery(data, new Date());
    await enqueueCampaignDelivery(data, 0);
    await prisma.campaignPostEngager.update({ where: { engagerId: engager.engagerId }, data: { status: 'queued', updatedAt: new Date() } });
    res.json({ ok: true, id: engagerId, status: 'queued' });
  } catch (err) { sendServerError(res, 'Campaign activity queue failed', err); }
}

router.post('/activity/:engager_id/approve', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), (req, res) => void queueActivityAction(req, res));
router.post('/activity/:engager_id/edit-and-send', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), (req, res) => void queueActivityAction(req, res));
router.post('/activity/:engager_id/retry', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), (req, res) => void queueActivityAction(req, res));
router.post('/activity/:engager_id/dismiss', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const engagerId = getRequiredBrandId(req.params['engager_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!engagerId || !brandId) { sendValidationError(res, 'brand_id and engager_id must be positive integers'); return; }
  try {
    const result = await prisma.campaignPostEngager.updateMany({ where: { engagerId: BigInt(engagerId), brandId }, data: { status: 'dismissed', processedAt: new Date(), updatedAt: new Date() } });
    if (!result.count) { res.status(404).json({ error: 'Campaign activity not found' }); return; }
    res.json({ ok: true, id: engagerId, status: 'dismissed' });
  } catch (err) { sendServerError(res, 'Campaign activity dismissal failed', err); }
});

// ── LIST CAMPAIGNS ────────────────────────────────────────────────────────────
// ── CREATE / UPDATE CAMPAIGN ──────────────────────────────────────────────────
router.post('/keyword/preflight', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.body?.brand_id);
  const platforms = Array.isArray(req.body?.platforms)
    ? Array.from(new Set(req.body.platforms)).filter((value): value is CampaignPlatform => CAMPAIGN_PLATFORMS.includes(value as CampaignPlatform))
    : [];
  if (!brandId || !platforms.length) { sendValidationError(res, 'brand_id and at least one supported platform are required'); return; }
  try { res.json({ ok: true, capabilities: await campaignCapabilities(brandId, platforms) }); }
  catch (err) { sendServerError(res, 'Keyword campaign preflight failed', err); }
});

router.post('/keyword', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id?: number; campaign_id?: number; name?: string; keywords?: unknown; platforms?: unknown;
    intent_filter?: unknown; confidence_threshold?: number; urgency_threshold?: number; reply_template_id?: number | null;
    max_per_day?: number; public_reply_enabled?: boolean; direct_message_enabled?: boolean; status?: 'draft' | 'active';
    max_dm_per_day?: number; spacing_minutes?: number; priority?: number; reply_mode?: 'public' | 'dm_with_public_fallback' | 'dm_only';
    tone?: string; public_reply_template?: string; private_followup_template?: string; cta_link?: string; image_url?: string;
  };
  const brandId = getRequiredBrandId(body.brand_id);
  const campaignId = body.campaign_id === undefined ? null : getRequiredBrandId(body.campaign_id);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const keywords = Array.isArray(body.keywords) ? Array.from(new Set(body.keywords.map(value => String(value).trim()).filter(Boolean))) : [];
  const platforms = Array.isArray(body.platforms)
    ? Array.from(new Set(body.platforms)).filter((value): value is CampaignPlatform => CAMPAIGN_PLATFORMS.includes(value as CampaignPlatform))
    : [];
  const intents = Array.isArray(body.intent_filter) ? Array.from(new Set(body.intent_filter)) as Intent[] : [];
  const confidenceThreshold = Number(body.confidence_threshold ?? 75);
  const urgencyThreshold = Number(body.urgency_threshold ?? 3);
  const maxPerDay = Number(body.max_per_day ?? 50);
  const maxDmPerDay = boundedInteger(body.max_dm_per_day, maxPerDay, 0, 5000);
  const spacingMinutes = boundedInteger(body.spacing_minutes, 10, 0, 1440);
  const priority = boundedInteger(body.priority, 0, 0, 1000);
  const publicReplyEnabled = body.public_reply_enabled !== false;
  const directMessageEnabled = body.direct_message_enabled !== false;
  const status = body.status === 'active' ? 'active' : 'draft';
  const tone = typeof body.tone === 'string' ? body.tone.trim().slice(0, 80) : 'professional';
  const publicReplyTemplate = typeof body.public_reply_template === 'string' ? body.public_reply_template.trim().slice(0, 2000) : '';
  const privateFollowupTemplate = typeof body.private_followup_template === 'string' ? body.private_followup_template.trim().slice(0, 2000) : '';
  const ctaLink = typeof body.cta_link === 'string' ? body.cta_link.trim().slice(0, 2048) : '';
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim().slice(0, 2048) : '';
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (maxDmPerDay === null || spacingMinutes === null || priority === null) { sendValidationError(res, 'Keyword campaign limits are outside the supported range'); return; }
  if (body.campaign_id !== undefined && !campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }
  if (!name || name.length > 120) { sendValidationError(res, 'name is required and must be 120 characters or fewer'); return; }
  const validation = validateKeywordCampaignInput({ keywords, platforms, intent_filter: intents, confidence_threshold: confidenceThreshold, urgency_threshold: urgencyThreshold, max_per_day: maxPerDay, public_reply_enabled: publicReplyEnabled, direct_message_enabled: directMessageEnabled });
  if (!validation.ok) { sendValidationError(res, validation.message ?? 'Invalid keyword campaign'); return; }
  const replyTemplateId = body.reply_template_id === null || body.reply_template_id === undefined ? null : getRequiredBrandId(body.reply_template_id);
  if (body.reply_template_id !== null && body.reply_template_id !== undefined && !replyTemplateId) { sendValidationError(res, 'reply_template_id must be a positive integer'); return; }

  try {
    const replyTemplate = replyTemplateId ? await prisma.replyTemplate.findFirst({ where: { templateId: BigInt(replyTemplateId), brandId, isActive: true } }) : null;
    if (replyTemplateId && !replyTemplate) { res.status(404).json({ error: 'Reply template not found' }); return; }
    if (campaignId) {
      const existing = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
      if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }
      if (existing.sourceMode !== 'keyword') { res.status(409).json({ error: 'Only keyword campaigns can be updated through this endpoint.' }); return; }
    }
    const campaign = await prisma.$transaction(async tx => {
      const data = {
        brandId,
        name,
        mode: 'keyword' as const,
        platform: platforms[0] as never,
        platforms: platforms as never,
        scopeType: 'all_owned_posts' as const,
        replyMode: body.reply_mode ?? (directMessageEnabled ? 'dm_with_public_fallback' as const : 'public' as const),
        priority,
        keywords,
        tone,
        replyTemplate: replyTemplate?.templateText ?? (publicReplyTemplate || null),
        publicReplyTemplate: publicReplyTemplate || replyTemplate?.templateText || null,
        privateFollowupTemplate: privateFollowupTemplate || publicReplyTemplate || replyTemplate?.templateText || null,
        ctaLink: ctaLink || null,
        imageUrl: imageUrl || null,
        autoFireThreshold: confidenceThreshold,
        maxPerDay,
        maxDmPerDay,
        spacingMinutes,
        intentFilter: intents,
        urgencyThreshold,
        replyTemplateId: replyTemplateId ? BigInt(replyTemplateId) : null,
        publicReplyEnabled,
        directMessageEnabled,
        platformAllocation: toInputJson(keywordAllocation(platforms)),
        sourceMode: 'keyword',
        eventSettings: toInputJson({ ...DEFAULT_EVENT_SETTINGS, comments: publicReplyEnabled, dms: directMessageEnabled }),
        modeConfig: toInputJson(cleanModeConfig(req.body?.mode_config)),
        activationStatus: status,
        isActive: status === 'active',
        lastActivatedAt: status === 'active' ? new Date() : null,
        updatedAt: new Date(),
      };
      const saved = campaignId ? await tx.engageCampaign.update({ where: { campaignId: BigInt(campaignId) }, data }) : await tx.engageCampaign.create({ data });
      await tx.keywordGroup.upsert({
        where: { campaignId: saved.campaignId },
        create: { brandId, campaignId: saved.campaignId, source: 'campaign', name, keywords, platforms, mode: 'realtime', alertUrgencyThreshold: urgencyThreshold, alertIntents: intents, isActive: status === 'active' },
        update: { name, keywords, platforms, alertUrgencyThreshold: urgencyThreshold, alertIntents: intents, isActive: status === 'active', lastRunAt: null },
      });
      return saved;
    });
    res.status(campaignId ? 200 : 201).json({ ok: true, campaign: mapEngageCampaign(campaign), capabilities: await campaignCapabilities(brandId, platforms) });
  } catch (err) { sendServerError(res, 'Keyword campaign save failed', err); }
});

router.get('/', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.query['brand_id']);
  const mode = isUnifiedMode(req.query['mode']) ? req.query['mode'] : null;
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  try {
    const rows = await prisma.engageCampaign.findMany({
      where: {
        brandId,
        ...(mode ? { mode } : {}),
        ...(status === 'active' ? { isActive: true } : status === 'paused' ? { isActive: false, activationStatus: 'paused' } : status === 'draft' ? { activationStatus: 'draft' } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ campaigns: rows.map(mapEngageCampaign) });
  } catch (err) { sendServerError(res, 'Campaign lookup failed', err); }
});

router.post('/', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as CampaignConfig & {
    campaign_id?: number;
    brand_id:     number;
    name:         string;
    platform:     Platform;
    source_mode?: CampaignSourceMode;
    post_caption?: string;
    public_reply_template?: string;
    private_followup_template?: string;
    event_settings?: CampaignEventSettings;
    activation_status?: string;
    selected_posts?: PostUrlItem[];
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!body.name?.trim()) { sendValidationError(res, 'name is required'); return; }
  const platforms = cleanPlatforms(body.platforms?.length ? body.platforms : [body.platform]);
  if (!platforms.length) { sendValidationError(res, 'Select at least one supported platform'); return; }
  const mode = isUnifiedMode(body.mode) ? body.mode : body.source_mode === 'keyword' ? 'keyword' : 'post_url';
  const priority = boundedInteger(body.priority, 0, 0, 1000);
  const maxPerHour = boundedInteger(body.max_per_hour, 50, 1, 1000);
  const maxPerDay = boundedInteger(body.max_per_day, 50, 1, 5000);
  const maxDmPerDay = boundedInteger(body.max_dm_per_day, 50, 0, 5000);
  const spacingMinutes = boundedInteger(body.spacing_minutes, 10, 0, 1440);
  if ([priority, maxPerHour, maxPerDay, maxDmPerDay, spacingMinutes].some(value => value === null)) {
    sendValidationError(res, 'Campaign priority or delivery limits are outside the supported range'); return;
  }
  const scopeType = body.scope_type === 'all_owned_posts' ? 'all_owned_posts' : 'selected_posts';
  const replyMode = body.reply_mode === 'dm_only' || body.reply_mode === 'dm_with_public_fallback' ? body.reply_mode : 'public';
  const selectedPosts = Array.isArray(body.selected_posts)
    ? body.selected_posts.filter(post => isPlatform(post?.platform) && isHttpUrl(post?.url)).slice(0, 10)
    : null;
  if (Array.isArray(body.selected_posts) && selectedPosts?.length !== body.selected_posts.length) {
    sendValidationError(res, 'selected_posts must contain no more than 10 valid supported-platform URLs'); return;
  }
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
          mode,
          platform: platforms[0] as never,
          platforms: platforms as never,
          priority: priority!,
          scopeType,
          replyMode,
          keywords: body.keywords ?? [],
          engageAll: body.engage_all ?? true,
          engageNegative: body.engage_negative ?? false,
          tone: body.tone ?? 'professional',
          replyTemplate: body.reply_template ?? null,
          fallbackTemplate: body.fallback_template ?? null,
          ctaLink: body.cta_link ?? null,
          imageUrl: body.image_url ?? null,
          autoFireThreshold: body.auto_fire_threshold ?? 85,
          maxPerHour: maxPerHour!,
          maxPerDay: maxPerDay!,
          maxDmPerDay: maxDmPerDay!,
          spacingMinutes: spacingMinutes!,
          isActive: body.is_active ?? false,
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 }),
          sourceMode: mode === 'keyword' ? 'keyword' : 'existing',
          postCaption: body.post_caption ?? null,
          publicReplyTemplate: body.public_reply_template ?? body.reply_template ?? null,
          privateFollowupTemplate: body.private_followup_template ?? body.reply_template ?? null,
          eventSettings: toInputJson(body.event_settings ?? DEFAULT_EVENT_SETTINGS),
          modeConfig: toInputJson(cleanModeConfig(body.mode_config)),
          activationStatus: body.activation_status ?? 'draft',
          updatedAt: new Date(),
        },
      });
      result = mapEngageCampaign(row);
    } else {
      const row = await prisma.engageCampaign.create({
        data: {
          brandId,
          name: body.name,
          mode,
          platform: platforms[0] as never,
          platforms: platforms as never,
          priority: priority!,
          scopeType,
          replyMode,
          keywords: body.keywords ?? [],
          engageAll: body.engage_all ?? true,
          engageNegative: body.engage_negative ?? false,
          tone: body.tone ?? 'professional',
          replyTemplate: body.reply_template ?? null,
          fallbackTemplate: body.fallback_template ?? null,
          ctaLink: body.cta_link ?? null,
          imageUrl: body.image_url ?? null,
          autoFireThreshold: body.auto_fire_threshold ?? 85,
          maxPerHour: maxPerHour!,
          maxPerDay: maxPerDay!,
          maxDmPerDay: maxDmPerDay!,
          spacingMinutes: spacingMinutes!,
          isActive: body.is_active ?? false,
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 }),
          sourceMode: mode === 'keyword' ? 'keyword' : 'existing',
          postCaption: body.post_caption ?? null,
          publicReplyTemplate: body.public_reply_template ?? body.reply_template ?? null,
          privateFollowupTemplate: body.private_followup_template ?? body.reply_template ?? null,
          eventSettings: toInputJson(body.event_settings ?? DEFAULT_EVENT_SETTINGS),
          modeConfig: toInputJson(cleanModeConfig(body.mode_config)),
          activationStatus: body.activation_status ?? 'draft',
        },
      });
      result = mapEngageCampaign(row);
    }
    if (selectedPosts) {
      const savedCampaignId = BigInt(result.campaign_id);
      await prisma.$transaction([
        prisma.campaignPostUrl.deleteMany({ where: { brandId, campaignId: savedCampaignId } }),
        prisma.campaignPostUrl.createMany({
          data: selectedPosts.map(post => ({
            brandId,
            campaignId: savedCampaignId,
            platform: post.platform as never,
            postUrl: post.url,
            postIdExt: extractPostId(post.platform, post.url),
            includeCommenters: true,
            includeLikers: true,
            status: 'ready',
            bindingStatus: 'active',
            sourceMode: mode,
          })),
        }),
      ]);
    }
    res.json({ ok: true, campaign: result });
  } catch (err) {
    sendServerError(res, 'Campaign lookup failed', err);
  }
});

router.patch('/:campaign_id', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  try {
    const existing = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }
    const platforms = req.body?.platforms === undefined ? existing.platforms : cleanPlatforms(req.body.platforms);
    if (!platforms.length) { sendValidationError(res, 'Select at least one supported platform'); return; }
    const priority = boundedInteger(req.body?.priority, existing.priority, 0, 1000);
    const maxPerHour = boundedInteger(req.body?.max_per_hour, existing.maxPerHour ?? 50, 1, 1000);
    const maxPerDay = boundedInteger(req.body?.max_per_day, existing.maxPerDay, 1, 5000);
    const maxDmPerDay = boundedInteger(req.body?.max_dm_per_day, existing.maxDmPerDay, 0, 5000);
    const spacingMinutes = boundedInteger(req.body?.spacing_minutes, existing.spacingMinutes, 0, 1440);
    if ([priority, maxPerHour, maxPerDay, maxDmPerDay, spacingMinutes].some(value => value === null)) { sendValidationError(res, 'Campaign limits are outside the supported range'); return; }
    if (req.body?.platform_allocation) {
      const allocation = validateAllocationTotal(req.body.platform_allocation as Record<string, number | undefined>);
      if (!allocation.ok) { sendValidationError(res, allocation.message); return; }
    }
    const selectedPosts = Array.isArray(req.body?.selected_posts)
      ? req.body.selected_posts.filter((post: PostUrlItem) => isPlatform(post?.platform) && isHttpUrl(post?.url)).slice(0, 10)
      : null;
    if (Array.isArray(req.body?.selected_posts) && selectedPosts?.length !== req.body.selected_posts.length) {
      sendValidationError(res, 'selected_posts must contain no more than 10 valid supported-platform URLs'); return;
    }
    const row = await prisma.engageCampaign.update({
      where: { campaignId: existing.campaignId },
      data: {
        name: typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : existing.name,
        mode: isUnifiedMode(req.body?.mode) ? req.body.mode : existing.mode,
        platform: platforms[0] as never,
        platforms: platforms as never,
        priority: priority!,
        scopeType: req.body?.scope_type === 'all_owned_posts' ? 'all_owned_posts' : req.body?.scope_type === 'selected_posts' ? 'selected_posts' : existing.scopeType,
        replyMode: ['public', 'dm_with_public_fallback', 'dm_only'].includes(req.body?.reply_mode) ? req.body.reply_mode : existing.replyMode,
        keywords: Array.isArray(req.body?.keywords) ? req.body.keywords.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 20) : existing.keywords,
        intentFilter: Array.isArray(req.body?.intent_filter) ? req.body.intent_filter.map(String).slice(0, 6) : existing.intentFilter,
        tone: typeof req.body?.tone === 'string' ? req.body.tone.trim().slice(0, 80) : existing.tone,
        publicReplyTemplate: typeof req.body?.public_reply_template === 'string' ? req.body.public_reply_template.trim().slice(0, 2000) : existing.publicReplyTemplate,
        privateFollowupTemplate: typeof req.body?.private_followup_template === 'string' ? req.body.private_followup_template.trim().slice(0, 2000) : existing.privateFollowupTemplate,
        ctaLink: typeof req.body?.cta_link === 'string' ? req.body.cta_link.trim().slice(0, 2048) : existing.ctaLink,
        autoFireThreshold: boundedInteger(req.body?.auto_fire_threshold, existing.autoFireThreshold ?? 85, 0, 100) ?? existing.autoFireThreshold,
        maxPerHour: maxPerHour!, maxPerDay: maxPerDay!, maxDmPerDay: maxDmPerDay!, spacingMinutes: spacingMinutes!,
        platformAllocation: toInputJson(req.body?.platform_allocation ?? existing.platformAllocation),
        eventSettings: toInputJson(req.body?.event_settings ?? existing.eventSettings),
        modeConfig: toInputJson(req.body?.mode_config ? cleanModeConfig(req.body.mode_config) : existing.modeConfig),
        updatedAt: new Date(),
      },
    });
    if (selectedPosts) {
      await prisma.$transaction([
        prisma.campaignPostUrl.deleteMany({ where: { brandId, campaignId: existing.campaignId } }),
        prisma.campaignPostUrl.createMany({ data: selectedPosts.map((post: PostUrlItem) => ({ brandId, campaignId: existing.campaignId, platform: post.platform as never, postUrl: post.url, postIdExt: extractPostId(post.platform, post.url), includeCommenters: true, includeLikers: true, status: 'ready', bindingStatus: 'active', sourceMode: row.mode })) }),
      ]);
    }
    res.json({ ok: true, campaign: mapEngageCampaign(row) });
  } catch (err) { sendServerError(res, 'Campaign update failed', err); }
});

router.post('/:campaign_id/pause', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']); const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  try {
    const result = await prisma.engageCampaign.updateMany({ where: { campaignId: BigInt(campaignId), brandId }, data: { isActive: false, activationStatus: 'paused', updatedAt: new Date() } });
    if (!result.count) { res.status(404).json({ error: 'Campaign not found' }); return; }
    await prisma.keywordGroup.updateMany({ where: { campaignId: BigInt(campaignId), brandId }, data: { isActive: false } });
    res.json({ ok: true, status: 'paused' });
  } catch (err) { sendServerError(res, 'Campaign pause failed', err); }
});

router.post('/:campaign_id/resume', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']); const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  if (process.env.NODE_ENV === 'production' && !isBullEnabled()) { res.status(503).json({ error: 'Campaign delivery queue unavailable', message: 'Configure REDIS_URL before activating campaigns.' }); return; }
  try {
    const result = await prisma.engageCampaign.updateMany({ where: { campaignId: BigInt(campaignId), brandId }, data: { isActive: true, activationStatus: 'active', lastActivatedAt: new Date(), updatedAt: new Date() } });
    if (!result.count) { res.status(404).json({ error: 'Campaign not found' }); return; }
    await prisma.keywordGroup.updateMany({ where: { campaignId: BigInt(campaignId), brandId }, data: { isActive: true } });
    res.json({ ok: true, status: 'active' });
  } catch (err) { sendServerError(res, 'Campaign resume failed', err); }
});

router.post('/:campaign_id/post-urls/fetch', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']); const brandId = getRequiredBrandId(req.body?.brand_id);
  const posts = Array.isArray(req.body?.post_urls) ? req.body.post_urls.filter((post: PostUrlItem) => isPlatform(post?.platform) && isHttpUrl(post?.url)).slice(0, 10) : [];
  if (!campaignId || !brandId || !posts.length) { sendValidationError(res, 'campaign_id, brand_id and 1-10 valid post_urls are required'); return; }
  try { res.json(await fetchPostUrlCampaignPreview(brandId, campaignId, posts)); }
  catch (err) { sendServerError(res, 'Post URL preview failed', err); }
});

router.post('/:campaign_id/post-urls/run', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']); const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  try { res.json({ ok: true, campaign_id: campaignId, ...(await runPostUrlCampaignPreview(brandId, campaignId)) }); }
  catch (err) {
    const message = (err as Error).message;
    if (message.includes('queue is unavailable')) res.status(503).json({ error: 'Campaign delivery queue unavailable', message });
    else if (message.includes('expired')) res.status(409).json({ error: 'Campaign preview expired', message });
    else sendServerError(res, 'Post URL campaign run failed', err);
  }
});

router.get('/:campaign_id/progress', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']); const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  try {
    const rows = await prisma.campaignPostEngager.groupBy({ by: ['status'], where: { brandId, campaignId: String(campaignId) }, _count: { _all: true } });
    const counts = Object.fromEntries(rows.map(row => [row.status ?? 'unknown', row._count._all]));
    res.json({ campaign_id: campaignId, counts });
  } catch (err) { sendServerError(res, 'Campaign progress lookup failed', err); }
});

router.post('/:campaign_id/preflight', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }

  const body = req.body as {
    brand_id: number;
    source_mode: CampaignSourceMode;
    platforms: CampaignPlatform[];
    existing_posts?: { platform: CampaignPlatform; url: string }[];
    allocation: Partial<Record<CampaignPlatform, number>>;
    media?: UploadedCampaignMedia[];
  };
  const validation = validateActivationRequest(body);
  if (!validation.ok) { sendValidationError(res, validation.message ?? 'Invalid campaign activation request'); return; }

  try {
    const campaign = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

    const results = await Promise.all(body.platforms.map(async platform => {
      const account = await getConnectedAccountRecord(brandId, platform);
      const issues: string[] = [];
      if (!account) issues.push(`${platform} is not connected.`);
      if (body.source_mode === 'publish_new') {
        const requiredScope = platform === 'x' ? 'tweet.write' : platform === 'facebook' ? 'pages_manage_posts' : platform === 'instagram' ? 'instagram_content_publish' : 'video.publish';
        if (account && !hasScope(account.scope, requiredScope)) issues.push(`Missing ${requiredScope} permission.`);
        if (platform === 'x' && body.media?.length && account && !hasScope(account.scope, 'media.write')) issues.push('Missing media.write permission. Reconnect X to approve media publishing.');
        if (platform === 'x' && (body.media?.filter(media => media.media_type === 'image').length ?? 0) > 4) issues.push('X supports at most four images in one post.');
      } else {
        const url = body.existing_posts?.find(post => post.platform === platform)?.url ?? '';
        if (!extractPostId(platform, url)) issues.push(`The ${platform} post URL could not be resolved.`);
      }
      return { platform, ready: issues.length === 0, issues };
    }));

    res.json({ ok: results.some(result => result.ready), platforms: results });
  } catch (err) {
    sendServerError(res, 'Campaign preflight failed', err);
  }
});

router.post('/:campaign_id/activate', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  if (process.env.NODE_ENV === 'production' && !isBullEnabled()) { res.status(503).json({ error: 'Campaign delivery queue unavailable', message: 'Configure REDIS_URL before activating campaigns.' }); return; }

  try {
    const unifiedCampaign = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
    if (!unifiedCampaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (unifiedCampaign.mode === 'live' || unifiedCampaign.mode === 'keyword') {
      await prisma.$transaction([
        prisma.engageCampaign.update({ where: { campaignId: unifiedCampaign.campaignId }, data: { isActive: true, activationStatus: 'active', lastActivatedAt: new Date(), updatedAt: new Date() } }),
        prisma.keywordGroup.updateMany({ where: { campaignId: unifiedCampaign.campaignId, brandId }, data: { isActive: unifiedCampaign.mode === 'keyword' } }),
      ]);
      res.json({ ok: true, campaign_id: campaignId, activation_status: 'active' });
      return;
    }
  } catch (err) { sendServerError(res, 'Campaign activation failed', err); return; }

  const body = req.body as {
    brand_id: number;
    source_mode: CampaignSourceMode;
    platforms: CampaignPlatform[];
    existing_posts?: { platform: CampaignPlatform; url: string }[];
    allocation: Partial<Record<CampaignPlatform, number>>;
    media?: UploadedCampaignMedia[];
    post_caption?: string;
  };
  const validation = validateActivationRequest(body);
  if (!validation.ok) { sendValidationError(res, validation.message ?? 'Invalid campaign activation request'); return; }

  try {
    const campaign = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

    const now = new Date();
    await prisma.campaignAsset.updateMany({
      where: { brandId, campaignId: String(campaignId), isActive: true },
      data: { isActive: false },
    });
    if (body.media?.length) {
      await prisma.campaignAsset.createMany({
        data: body.media.map((media, index) => ({
          brandId,
          campaignId: String(campaignId),
          imageUrl: media.url,
          publicId: media.public_id,
          mediaType: media.media_type,
          mimeType: media.mime_type,
          sizeBytes: media.size_bytes,
          sortOrder: index,
          isActive: true,
        })),
      });
    }

    const results: { platform: CampaignPlatform; success: boolean; post_url?: string; post_id?: string; warning?: string; error?: string }[] = [];
    for (const platform of body.platforms) {
      try {
        let postId: string | null = null;
        let postUrl = '';
        if (body.source_mode === 'existing') {
          postUrl = body.existing_posts?.find(post => post.platform === platform)?.url.trim() ?? '';
          postId = extractPostId(platform, postUrl);
          if (!postId) throw new Error(`The ${platform} post URL could not be resolved.`);
        } else if (platform === 'x') {
          const xMediaIds: string[] = [];
          for (const [index, media] of (body.media ?? []).entries()) {
            const upload = await uploadXMediaFromUrl(brandId, media, index);
            if (!upload.success || !upload.media_id) throw new Error(upload.error ?? 'X media upload failed.');
            xMediaIds.push(upload.media_id);
          }
          const publish = await publishReply({
            brand_id: brandId,
            platform: 'x',
            reply_text: body.post_caption?.trim() || campaign.postCaption?.trim() || campaign.name,
            media_ids: xMediaIds,
          });
          if (!publish.success || !publish.message_id) throw new Error(publish.error ?? 'X did not return a post ID.');
          postId = publish.message_id;
          postUrl = `https://x.com/i/web/status/${postId}`;
        } else {
          const account = await getConnectedAccountRecord(brandId, platform);
          const requiredScope = platform === 'facebook' ? 'pages_manage_posts' : platform === 'instagram' ? 'instagram_content_publish' : 'video.publish';
          if (!account || !hasScope(account.scope, requiredScope)) throw new Error(`${platform} publishing requires an active connection with ${requiredScope}.`);
          throw new Error(`${platform} publishing is capability-gated and is not enabled in this deployment yet. Attach an existing post instead.`);
        }

        const oldBindings = await prisma.campaignPostUrl.findMany({
          where: { brandId, campaignId: campaign.campaignId, platform, bindingStatus: 'active' },
          select: { urlId: true, postIdExt: true, sourceMode: true },
        });
        let deletionWarning: string | undefined;
        for (const oldBinding of oldBindings) {
          let deleteStatus = 'not_requested';
          if (oldBinding.sourceMode === 'publish_new' && oldBinding.postIdExt) {
            const deletion = await deleteCampaignPlatformPost(brandId, platform, oldBinding.postIdExt);
            deleteStatus = deletion.status;
            if (!deletion.deleted) deletionWarning = `The previous ${platform} post could not be deleted automatically. Monitoring stopped; delete it manually or retry later.`;
          }
          await prisma.campaignPostUrl.update({
            where: { urlId: oldBinding.urlId },
            data: { bindingStatus: 'superseded', supersededAt: now, deleteStatus },
          });
        }

        await prisma.campaignPostUrl.create({
          data: {
            brandId,
            campaignId: campaign.campaignId,
            platform,
            postUrl,
            postIdExt: postId,
            includeCommenters: true,
            includeLikers: true,
            status: 'complete',
            sourceMode: body.source_mode,
            bindingStatus: 'active',
            completedAt: now,
          },
        });
        results.push({ platform, success: true, post_url: postUrl, post_id: postId, warning: deletionWarning });
      } catch (err) {
        results.push({ platform, success: false, error: (err as Error).message });
      }
    }

    const succeeded = results.filter(result => result.success).length;
    const activationStatus = succeeded === results.length ? 'active' : succeeded > 0 ? 'partial' : 'failed';
    await prisma.engageCampaign.update({
      where: { campaignId: campaign.campaignId },
      data: {
        sourceMode: body.source_mode,
        postCaption: body.post_caption ?? campaign.postCaption,
        activationStatus,
        isActive: succeeded > 0,
        lastActivatedAt: succeeded > 0 ? now : campaign.lastActivatedAt,
        platformAllocation: toInputJson(body.allocation),
        updatedAt: now,
      },
    });

    res.status(succeeded > 0 ? 200 : 409).json({
      ok: succeeded > 0,
      campaign_id: campaignId,
      activation_status: activationStatus,
      platforms: results,
      ...(succeeded === 0 ? { error: 'Campaign activation failed', message: results.map(result => `${result.platform}: ${result.error ?? 'activation failed'}`).join(' ') } : {}),
    });
  } catch (err) {
    sendServerError(res, 'Campaign activation failed', err);
  }
});

router.delete('/:campaign_id', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id ?? req.query['brand_id']);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  try {
    const existing = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }
    await prisma.$transaction([
      prisma.keywordGroup.deleteMany({ where: { campaignId: existing.campaignId, brandId } }),
      prisma.campaignPostUrl.deleteMany({ where: { campaignId: existing.campaignId, brandId } }),
      prisma.campaignDeliveryAttempt.deleteMany({ where: { campaignId: existing.campaignId, brandId } }),
      prisma.campaignPostEngager.deleteMany({ where: { campaignId: String(campaignId), brandId } }),
      prisma.engageCampaign.delete({ where: { campaignId: existing.campaignId } }),
    ]);
    res.json({ ok: true, campaign_id: campaignId });
  } catch (err) { sendServerError(res, 'Campaign deletion failed', err); }
});

router.get('/:campaign_id/status', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!campaignId || !brandId) { sendValidationError(res, 'campaign_id and brand_id must be positive integers'); return; }
  try {
    const campaign = await prisma.engageCampaign.findFirst({ where: { campaignId: BigInt(campaignId), brandId } });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
    const [bindings, media] = await Promise.all([
      prisma.campaignPostUrl.findMany({ where: { brandId, campaignId: campaign.campaignId }, orderBy: { submittedAt: 'desc' } }),
      prisma.campaignAsset.findMany({ where: { brandId, campaignId: String(campaignId), isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    res.json({ campaign: mapEngageCampaign(campaign), bindings: bindings.map(binding => ({ platform: binding.platform, post_url: binding.postUrl, post_id: binding.postIdExt, status: binding.bindingStatus, source_mode: binding.sourceMode, error: binding.errorMsg, delete_status: binding.deleteStatus })), media: media.map(asset => ({ url: asset.imageUrl, public_id: asset.publicId, media_type: asset.mediaType, mime_type: asset.mimeType, size_bytes: asset.sizeBytes })) });
  } catch (err) {
    sendServerError(res, 'Campaign status lookup failed', err);
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

    const nextActive = !(existing.isActive ?? false);
    const row = await prisma.$transaction(async tx => {
      const updated = await tx.engageCampaign.update({
        where: { campaignId: existing.campaignId },
        data: { isActive: nextActive, activationStatus: nextActive ? 'active' : 'paused', updatedAt: new Date() },
        select: { campaignId: true, isActive: true },
      });
      await tx.keywordGroup.updateMany({ where: { campaignId: existing.campaignId, source: 'campaign' }, data: { isActive: nextActive } });
      return updated;
    });
    res.json({ ok: true, campaign_id: Number(row.campaignId), is_active: row.isActive });
  } catch (err) {
    sendServerError(res, 'Campaign save failed', err);
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
      config.reply_template ?? `Hey {{handle}}! Thank you for engaging. Check this out: {{link}}`,
      { handle: sample_handle.startsWith('@') ? sample_handle : `@${sample_handle}`, link: config.cta_link ?? '', brand: '' }
    );
    res.json({ preview: text, image_url: config.image_url, cta_link: config.cta_link });
  } catch (err) {
    sendServerError(res, 'Campaign toggle failed', err);
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
    const [facebookAccount, metaToken] =
      body.platform === 'instagram' || body.platform === 'facebook'
        ? await Promise.all([
            getConnectedAccountRecord(brandId, 'facebook'),
            getValidToken(brandId, body.platform),
          ])
        : [null, null] as const;

    const config: CampaignConfig = {
      brand_id: brandId,
      name: 'manual',
      platform: body.platform,
      engage_all: true,
      max_per_hour: 100,
      auto_fire_threshold: 0,
    };

    const credentials: Credentials = {
      META_PAGE_ACCESS_TOKEN: metaToken,
      META_PAGE_ID: facebookAccount?.accountIdExt ?? null,
      X_OAUTH_TOKEN: body.platform === 'x' ? await getValidToken(brandId, 'x') : null,
      TIKTOK_ACCESS_TOKEN: body.platform === 'tiktok' ? await getValidToken(brandId, 'tiktok') : null,
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
    sendServerError(res, 'Campaign preview failed', err);
  }
});

// ── POST URL CAMPAIGN ─────────────────────────────────────────────────────────
router.post('/x/preflight', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as { brand_id: number; tweet_url?: string };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const [account, token] = await Promise.all([
      getConnectedAccountRecord(brandId, 'x'),
      getValidToken(brandId, 'x'),
    ]);
    const diagnostics: string[] = [];
    const scopes = account?.scope ?? '';
    if (!account || !token) diagnostics.push('X is not connected for this brand.');
    if (account && !account.refreshToken) diagnostics.push('X token is not refreshable. Reconnect X with offline.access.');
    for (const scope of ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']) {
      if (account && !hasScope(scopes, scope)) diagnostics.push(`Missing X scope: ${scope}`);
    }

    const tweetId = extractXStatusId(body.tweet_url);
    let recentSearch: { checked: boolean; ok: boolean; engager_count?: number; error?: string } = { checked: false, ok: false };
    if (tweetId && token) {
      try {
        const engagers = await fetchXPostEngagers(tweetId, token);
        recentSearch = { checked: true, ok: true, engager_count: engagers.length };
      } catch (err) {
        recentSearch = { checked: true, ok: false, error: (err as Error).message };
        diagnostics.push((err as Error).message);
      }
    }

    res.json({
      ok: diagnostics.length === 0,
      connected: Boolean(account && token),
      account_handle: account?.accountHandle ?? null,
      refreshable: Boolean(account?.refreshToken),
      scopes: {
        tweet_read: hasScope(scopes, 'tweet.read'),
        tweet_write: hasScope(scopes, 'tweet.write'),
        users_read: hasScope(scopes, 'users.read'),
        media_write: hasScope(scopes, 'media.write'),
        offline_access: hasScope(scopes, 'offline.access'),
      },
      recent_search: recentSearch,
      diagnostics,
    });
  } catch (err) {
    sendServerError(res, 'X campaign preflight failed', err);
  }
});

router.post('/x/post', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as { brand_id: number; text?: string; reply_to_url?: string };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) { sendValidationError(res, 'text is required'); return; }
  if (text.length > 280) { sendValidationError(res, 'text must be 280 characters or fewer for X'); return; }

  const replyTweetId = extractXStatusId(body.reply_to_url);
  if (body.reply_to_url && !replyTweetId) {
    sendValidationError(res, 'reply_to_url must be a valid X/Twitter status URL');
    return;
  }

  try {
    const account = await getConnectedAccountRecord(brandId, 'x');
    if (!account) {
      res.status(409).json({
        error: 'X is not connected',
        message: 'Connect X for this brand before publishing X campaign posts.',
      });
      return;
    }
    if (!hasScope(account.scope, 'tweet.write')) {
      res.status(409).json({
        error: 'Missing X permission',
        message: 'The connected X token is missing tweet.write. Reconnect X with write access enabled.',
      });
      return;
    }

    const result = await publishReply({
      brand_id: brandId,
      platform: 'x',
      reply_text: text,
      tweet_id: replyTweetId ?? undefined,
    });
    if (!result.success) {
      res.status(502).json({
        error: 'X publish failed',
        message: result.error ?? 'X rejected the publish request.',
      });
      return;
    }

    res.json({
      ok: true,
      platform: 'x',
      message_id: result.message_id,
      reply_to_tweet_id: replyTweetId,
    });
    if (result.message_id && !replyTweetId) {
      void trackPublishedXPost(brandId, result.message_id);
    }
  } catch (err) {
    sendServerError(res, 'X publish failed', err);
  }
});

router.post('/x/sync-replies', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as { brand_id: number; tweet_url?: string; tweet_id?: string };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const tweetId = typeof body.tweet_id === 'string' && /^\d+$/.test(body.tweet_id.trim())
    ? body.tweet_id.trim()
    : extractXStatusId(body.tweet_url);
  if (!tweetId) {
    sendValidationError(res, 'tweet_url or tweet_id must point to a valid X status');
    return;
  }

  try {
    res.json(await syncXRepliesForPost(brandId, tweetId));
  } catch (err) {
    sendServerError(res, 'X reply sync failed', err);
  }
});

router.post('/post-urls/run', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id:           number;
    campaign_id?:       string;
    post_urls:          PostUrlItem[];
    platform_allocation?: { instagram?: number; facebook?: number; tiktok?: number; x?: number };
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

  const alloc = body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 };
  const allocationResult = validateAllocationTotal(alloc);
  if (!allocationResult.ok) {
    res.status(400).json({ error: allocationResult.message });
    return;
  }

  const validated = body.post_urls.map(p => ({
    ...p,
    post_id_ext: extractPostId(p.platform, p.url),
  })).filter(p => isPlatform(p.platform) && isHttpUrl(p.url) && p.post_id_ext);

  if (!validated.length) {
    sendValidationError(res, 'No valid post URLs were provided. Check platform selection and URL format.');
    return;
  }

  let credentials: Credentials;
  try {
    const [instagramAccount, facebookAccount, metaToken, tiktokToken, xAccount, xToken] = await Promise.all([
      getConnectedAccountRecord(brandId, 'instagram'),
      getConnectedAccountRecord(brandId, 'facebook'),
      getValidToken(brandId, 'instagram').then(token => token ?? getValidToken(brandId, 'facebook')),
      getValidToken(brandId, 'tiktok'),
      getConnectedAccountRecord(brandId, 'x'),
      getValidToken(brandId, 'x'),
    ]);
    credentials = {
      META_PAGE_ACCESS_TOKEN: metaToken,
      META_PAGE_ID: facebookAccount?.accountIdExt ?? null,
      META_IG_USER_ID: instagramAccount?.accountIdExt ?? null,
      TIKTOK_ACCESS_TOKEN: tiktokToken,
      X_OAUTH_TOKEN: xToken,
    };

    const platforms = new Set(validated.map(item => item.platform));
    const diagnostics: string[] = [];
    if ((platforms.has('instagram') || platforms.has('facebook')) && !metaToken) {
      diagnostics.push('Meta is not connected for this brand. Connect a Facebook Page with a linked Instagram Business/Creator account.');
    }
    if (platforms.has('instagram') && !instagramAccount?.accountIdExt) {
      diagnostics.push('Instagram Business/Creator account ID is missing. Reconnect Meta after linking Instagram to a Facebook Page.');
    }
    if (platforms.has('tiktok') && !tiktokToken) {
      diagnostics.push('TikTok is not connected for this brand.');
    }
    if (platforms.has('x') && !xToken) {
      diagnostics.push('X is not connected for this brand.');
    }
    if (platforms.has('x') && !xAccount?.refreshToken) {
      diagnostics.push('X token is not refreshable. Reconnect X with offline.access enabled.');
    }
    if (diagnostics.length) {
      res.status(409).json({
        error: 'Campaign preflight failed',
        message: diagnostics[0],
        diagnostics,
      });
      return;
    }
  } catch (err) {
    sendServerError(res, 'Campaign preflight failed', err);
    return;
  }

  const campaignId = body.campaign_id ?? String(Date.now());

  res.json({
    ok:         true,
    message:    `Processing ${validated.length} post URLs`,
    campaign_id: campaignId,
    post_count: validated.length,
  });

  const config: CampaignConfig = {
    id:                   campaignId,
    brand_id:             brandId,
    tone:                 body.tone,
    reply_template:       body.reply_template,
    cta_link:             body.cta_link,
    image_url:            body.image_url,
    auto_fire_threshold:  body.auto_fire_threshold ?? 85,
    max_per_hour:         body.max_per_hour ?? 50,
    platform_allocation:  alloc,
  };

  void runPostUrlCampaign(brandId, config, validated, credentials);
});

router.get('/post-urls/status/:brand_id/:campaign_id', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  const campaignId = typeof req.params['campaign_id'] === 'string' ? req.params['campaign_id'] : '';
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!/^\d+$/.test(campaignId)) { sendValidationError(res, 'campaign_id must be the numeric ID returned by post-urls/run'); return; }

  try {
    const [urls, engagers] = await Promise.all([
      prisma.campaignPostUrl.findMany({
        where: { brandId, campaignId: BigInt(campaignId) },
        orderBy: { submittedAt: 'desc' },
        select: {
          platform: true,
          postUrl: true,
          status: true,
          totalFetched: true,
          errorMsg: true,
          submittedAt: true,
          completedAt: true,
        },
      }),
      prisma.campaignPostEngager.findMany({
        where: { brandId, campaignId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          platform: true,
          action: true,
          authorHandle: true,
          status: true,
          processedAt: true,
          createdAt: true,
        },
      }),
    ]);
    const sent = engagers.filter(item => item.status === 'sent').length;
    const manual = engagers.filter(item => item.status === 'manual_copy').length;
    const queued = engagers.filter(item => item.status === 'queued_for_approval' || item.status === 'queued').length;
    const errors = engagers.filter(item => item.status === 'error').length + urls.filter(item => item.status === 'error').length;
    const fetched = urls.reduce((sum, item) => sum + (item.totalFetched ?? 0), 0);
    res.json({
      campaign_id: campaignId,
      summary: {
        post_urls: urls.length,
        fetched,
        engagers: engagers.length,
        sent,
        manual,
        queued,
        errors,
        complete: urls.length > 0 && urls.every(item => item.status === 'complete' || item.status === 'error'),
      },
      post_urls: urls.map(item => ({
        platform: item.platform,
        url: item.postUrl,
        status: item.status,
        total_fetched: item.totalFetched ?? 0,
        error: item.errorMsg,
        submitted_at: item.submittedAt,
        completed_at: item.completedAt,
      })),
      engagers: engagers.slice(0, 25).map(item => ({
        platform: item.platform,
        action: item.action,
        author_handle: item.authorHandle,
        status: item.status,
        created_at: item.createdAt,
        processed_at: item.processedAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Post URL campaign status lookup failed', err);
  }
});

router.post('/:campaign_id/sync', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const campaign = await prisma.engageCampaign.findFirst({
      where: { campaignId: BigInt(campaignId), brandId },
      select: { campaignId: true, sourceMode: true },
    });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (campaign.sourceMode === 'keyword') {
      const leased = await withSchedulerLease(brandId, 'campaign_keyword_sync', 10 * 60 * 1000, () => syncKeywordCampaigns(brandId, campaignId));
      if (!leased.acquired || !leased.value) {
        res.setHeader('Retry-After', '30');
        res.status(409).json({ error: 'Campaign synchronization is already running.', retry_after: 30 });
        return;
      }
      res.json({ ok: true, campaign_id: campaignId, ...leased.value });
      return;
    }
    const leased = await withSchedulerLease(brandId, 'campaign_post_sync', 2 * 60 * 1000, () => syncTrackedCampaignEngagements(brandId, campaignId));
    if (!leased.acquired || !leased.value) {
      res.setHeader('Retry-After', '30');
      res.status(409).json({ error: 'Campaign synchronization is already running.', retry_after: 30 });
      return;
    }
    res.json({ ok: true, campaign_id: campaignId, ...leased.value });
  } catch (err) {
    sendServerError(res, 'Campaign engagement sync failed', err);
  }
});

router.get('/:campaign_id/engagements', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const brandId = getRequiredBrandId(req.query['brand_id']);
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const campaign = await prisma.engageCampaign.findFirst({
      where: { campaignId: BigInt(campaignId), brandId },
      select: { campaignId: true },
    });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

    const [engagers, bindings, deliveries] = await Promise.all([
      prisma.campaignPostEngager.findMany({
        where: { brandId, campaignId: String(campaignId) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          engagerId: true,
          platform: true,
          action: true,
          authorHandle: true,
          originalText: true,
          replyText: true,
          deliveryError: true,
          externalEventId: true,
          source: true,
          intent: true,
          urgencyScore: true,
          replyConfidence: true,
          status: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      prisma.campaignPostUrl.findMany({
        where: { brandId, campaignId: BigInt(campaignId), bindingStatus: 'active' },
        orderBy: { submittedAt: 'desc' },
        select: { platform: true, postUrl: true, status: true, totalFetched: true, errorMsg: true, completedAt: true },
      }),
      prisma.campaignDeliveryAttempt.findMany({
        where: { brandId, campaignId: BigInt(campaignId) },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const count = (statuses: string[]) => engagers.filter(item => statuses.includes(item.status ?? '')).length;
    res.json({
      campaign_id: campaignId,
      summary: {
        captured: engagers.length,
        comments: engagers.filter(item => item.action === 'commented').length,
        likes: engagers.filter(item => item.action === 'liked').length,
        reposts: engagers.filter(item => item.action === 'reposted').length,
        sent: count(['sent', 'partial']),
        queued: count(['queued', 'queued_for_approval', 'pending', 'needs_review']),
        manual: count(['manual_copy', 'manual_action_required']),
        failed: count(['error', 'failed', 'generation_failed', 'rate_limited']),
        ignored: count(['ignored_keyword', 'ignored']),
      },
      platform_capabilities: {
        x: 'Replies are captured and answered publicly. Likes and reposts require additional X API access; unsolicited DMs are not sent.',
        instagram: 'Comments can receive a public reply and a private reply when Meta permissions and messaging eligibility allow it.',
        facebook: 'Comments can receive a public reply and a private reply when Page messaging permissions allow it.',
        tiktok: 'Comments can be captured and replied to when the approved TikTok scopes allow it.',
      },
      bindings: bindings.map(item => ({
        platform: item.platform,
        url: item.postUrl,
        status: item.status,
        total_fetched: item.totalFetched ?? 0,
        error: item.errorMsg,
        last_synced_at: item.completedAt,
      })),
      engagers: engagers.map(item => ({
        id: String(item.engagerId),
        platform: item.platform,
        action: item.action,
        author_handle: item.authorHandle,
        original_text: item.originalText,
        reply_text: item.replyText,
        delivery_error: item.deliveryError,
        external_event_id: item.externalEventId,
        source: item.source,
        intent: item.intent,
        urgency_score: item.urgencyScore,
        reply_confidence: item.replyConfidence,
        deliveries: deliveries.filter(delivery => delivery.engagerId === item.engagerId).map(delivery => ({
          channel: delivery.channel,
          status: delivery.status,
          external_message_id: delivery.externalMessageId,
          error: delivery.error,
          attempt_count: delivery.attemptCount,
          delivered_at: delivery.deliveredAt,
        })),
        status: item.status,
        created_at: item.createdAt,
        processed_at: item.processedAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Campaign engagement lookup failed', err);
  }
});

router.post('/:campaign_id/engagements/:engager_id/retry', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const engagerId = getRequiredBrandId(req.params['engager_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !engagerId || !brandId) { sendValidationError(res, 'brand_id, campaign_id and engager_id must be positive integers'); return; }
  try {
    const result = await retryCampaignEngagement(brandId, campaignId, engagerId, typeof req.body?.reply_text === 'string' ? req.body.reply_text : undefined);
    res.json({ ok: true, campaign_id: campaignId, engager_id: engagerId, ...result });
  } catch (err) { sendServerError(res, 'Campaign reply retry failed', err); }
});

router.post('/:campaign_id/engagements/:engager_id/dismiss', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  const engagerId = getRequiredBrandId(req.params['engager_id']);
  const brandId = getRequiredBrandId(req.body?.brand_id);
  if (!campaignId || !engagerId || !brandId) { sendValidationError(res, 'brand_id, campaign_id and engager_id must be positive integers'); return; }
  try {
    const updated = await prisma.campaignPostEngager.updateMany({
      where: { engagerId: BigInt(engagerId), campaignId: String(campaignId), brandId },
      data: { status: 'dismissed', deliveryError: null, processedAt: new Date(), updatedAt: new Date() },
    });
    if (!updated.count) { res.status(404).json({ error: 'Campaign engagement not found' }); return; }
    res.json({ ok: true, campaign_id: campaignId, engager_id: engagerId, status: 'dismissed' });
  } catch (err) { sendServerError(res, 'Campaign engagement dismiss failed', err); }
});

router.get('/:brand_id', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.engageCampaign.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
    });
    const sentCounts = rows.length
      ? await prisma.campaignDeliveryAttempt.groupBy({
          by: ['campaignId'],
          where: { brandId, campaignId: { in: rows.map(row => row.campaignId) }, status: 'sent' },
          _count: { _all: true },
        })
      : [];
    const sentByCampaign = new Map(sentCounts.map(row => [String(row.campaignId), row._count._all]));
    res.json({
      campaigns: rows.map(row => ({
        ...mapEngageCampaign(row),
        total_sent: sentByCampaign.get(String(row.campaignId)) ?? row.totalSent ?? 0,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Engagement run failed', err);
  }
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.delete('/by-brand/:brand_id/:campaign_id', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }

  try {
    const existing = await prisma.engageCampaign.findFirst({
      where: { campaignId: BigInt(campaignId), brandId },
      select: { campaignId: true, brandId: true },
    });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }

    await prisma.$transaction(async tx => {
      await tx.keywordGroup.deleteMany({ where: { campaignId: existing.campaignId, source: 'campaign' } });
      await tx.engageCampaign.delete({ where: { campaignId: existing.campaignId } });
    });
    res.json({ ok: true, campaign_id: campaignId });
  } catch (err) {
    sendServerError(res, 'Campaign delete failed', err);
  }
});

router.get('/:brand_id/stats', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const since = new Date(Date.now() - SOCIAL_RESPONSE_DAYS * 86400000);
    const trendKeys = recentDayKeys(7);
    const [
      deliveries,
      recentEngagers,
      messages,
      kpiSnapshots,
      linkTotals,
      revenueTotals,
      riskMessages,
    ] = await Promise.all([
      prisma.campaignDeliveryAttempt.findMany({
        where: { brandId, createdAt: { gt: since } },
        select: {
          engagerId: true,
          platform: true,
          status: true,
          channel: true,
          createdAt: true,
          deliveredAt: true,
        },
      }),
      prisma.campaignPostEngager.findMany({
        where: {
          brandId,
          createdAt: { gt: since },
        },
        select: { engagerId: true, platform: true, status: true, createdAt: true },
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
      prisma.campaignMetric.aggregate({
        where: { brandId, metric: { in: ['revenue_attributed', 'revenue', 'attributed_revenue'] } },
        _sum: { value: true },
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
    const platformStats = (platform: string) => byPlatform.get(platform) ?? { platform, total: 0, sent: 0, manual: 0, queued: 0 };
    for (const delivery of deliveries) {
      const stats = platformStats(delivery.platform);
      stats.total += 1;
      if (delivery.status === 'sent') stats.sent += 1;
      else if (delivery.status === 'manual_action_required' || delivery.status === 'manual_copy') stats.manual += 1;
      else if (delivery.status === 'queued' || delivery.status === 'processing' || delivery.status === 'rate_limited' || delivery.status === 'failed') stats.queued += 1;
      byPlatform.set(delivery.platform, stats);
    }
    const pendingStatuses = new Set(['queued', 'needs_review', 'queued_for_approval', 'manual_action_required', 'manual_copy', 'failed', 'rate_limited']);
    for (const engager of recentEngagers) {
      if (!pendingStatuses.has(engager.status ?? '')) continue;
      const hasDelivery = deliveries.some(delivery => delivery.engagerId === engager.engagerId);
      if (hasDelivery) continue;
      const stats = platformStats(engager.platform);
      stats.total += 1;
      if (engager.status === 'manual_action_required' || engager.status === 'manual_copy') stats.manual += 1;
      else stats.queued += 1;
      byPlatform.set(engager.platform, stats);
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
    for (const delivery of deliveries) {
      const key = dayKey(delivery.deliveredAt ?? delivery.createdAt);
      if (!trendKeys.includes(key)) continue;
      if (delivery.status === 'sent') sentByDay.set(key, (sentByDay.get(key) ?? 0) + 1);
      if (delivery.status === 'manual_action_required' || delivery.status === 'manual_copy') manualByDay.set(key, (manualByDay.get(key) ?? 0) + 1);
      if (delivery.status === 'queued' || delivery.status === 'processing' || delivery.status === 'rate_limited' || delivery.status === 'failed') queuedByDay.set(key, (queuedByDay.get(key) ?? 0) + 1);
    }

    const latestKpi = kpiSnapshots[0];
    const totalMessages = messages.length;
    const sentDeliveries = deliveries.filter(delivery => delivery.status === 'sent');
    const manualDeliveries = deliveries.filter(delivery => delivery.status === 'manual_action_required' || delivery.status === 'manual_copy');
    const queuedDeliveries = deliveries.filter(delivery => delivery.status === 'queued' || delivery.status === 'processing' || delivery.status === 'rate_limited' || delivery.status === 'failed');
    const replyDenominator = sentDeliveries.length + manualDeliveries.length + queuedDeliveries.length;
    const conversions = linkTotals._sum.conversions ?? 0;
    const clicks = linkTotals._sum.clicks ?? 0;
    const fallbackScores = {
      listening: latestKpi?.listeningKpi === null || latestKpi?.listeningKpi === undefined
        ? Math.min(100, totalMessages * 5)
        : Number(latestKpi.listeningKpi),
      reply: latestKpi?.replyKpi === null || latestKpi?.replyKpi === undefined
        ? (replyDenominator ? Math.round((sentDeliveries.length / replyDenominator) * 100) : 0)
        : Number(latestKpi.replyKpi),
      funnel: latestKpi?.funnelKpi === null || latestKpi?.funnelKpi === undefined
        ? (clicks ? Math.round((conversions / Math.max(clicks, 1)) * 100) : 0)
        : Number(latestKpi.funnelKpi),
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
    const responseSamples = deliveries
      .filter(delivery => delivery.status === 'sent' && delivery.deliveredAt)
      .map(delivery => {
        const source = recentEngagers.find(engager => engager.engagerId === delivery.engagerId);
        return source ? Math.max(0, delivery.deliveredAt!.getTime() - source.createdAt.getTime()) / 60000 : null;
      })
      .filter((value): value is number => value !== null);
    const avgResponseTime = responseSamples.length
      ? Math.round(responseSamples.reduce((sum, value) => sum + value, 0) / responseSamples.length)
      : null;
    const revenue = Number(revenueTotals._sum.value ?? 0);

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
        avg_response_time_minutes: avgResponseTime,
        revenue_attributed: revenue,
      },
      score_trend,
      message_volume: Array.from(messageVolume.values()),
      sentiment: Array.from(sentiment.values()),
      risk_events,
      attribution: {
        clicks,
        conversions,
        revenue,
      },
    });
  } catch (err) {
    sendServerError(res, 'Post URL campaign run failed', err);
  }
});

export default router;
