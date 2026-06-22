// src/routes/campaigns.ts
import { Router, Request, Response } from 'express';
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

function keywordAllocation(platforms: CampaignPlatform[]): Record<CampaignPlatform, number> {
  const allocation = { instagram: 0, facebook: 0, tiktok: 0, x: 0 };
  const share = Math.floor(100 / platforms.length);
  platforms.forEach((platform, index) => { allocation[platform] = share + (index === 0 ? 100 - share * platforms.length : 0); });
  return allocation;
}

async function campaignCapabilities(brandId: number, platforms: CampaignPlatform[]) {
  const accounts = await Promise.all(platforms.map(platform => getConnectedAccountRecord(brandId, platform)));
  return platforms.map((platform, index) => {
    const connected = Boolean(accounts[index]);
    const dmSupported = platform === 'instagram' || platform === 'facebook';
    return {
      platform,
      keyword_discovery: Boolean(process.env.APIFY_API_TOKEN),
      public_reply: connected,
      direct_message: connected && dmSupported,
      issues: [
        ...(!process.env.APIFY_API_TOKEN ? ['Keyword discovery requires APIFY_API_TOKEN.'] : []),
        ...(!connected ? [`${platform} is not connected for outbound delivery.`] : []),
        ...(connected && !dmSupported ? [`${platform === 'x' ? 'X' : 'TikTok'} direct messaging is not available for campaign events through the connected API permissions.`] : []),
      ],
    };
  });
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
  const publicReplyEnabled = body.public_reply_enabled !== false;
  const directMessageEnabled = body.direct_message_enabled !== false;
  const status = body.status === 'active' ? 'active' : 'draft';
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
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
        platform: platforms[0] as never,
        keywords,
        tone: 'professional',
        replyTemplate: replyTemplate?.templateText ?? null,
        autoFireThreshold: confidenceThreshold,
        maxPerDay,
        intentFilter: intents,
        urgencyThreshold,
        replyTemplateId: replyTemplateId ? BigInt(replyTemplateId) : null,
        publicReplyEnabled,
        directMessageEnabled,
        platformAllocation: toInputJson(keywordAllocation(platforms)),
        sourceMode: 'keyword',
        eventSettings: toInputJson({ ...DEFAULT_EVENT_SETTINGS, comments: publicReplyEnabled, dms: directMessageEnabled }),
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
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 }),
          sourceMode: body.source_mode ?? 'existing',
          postCaption: body.post_caption ?? null,
          publicReplyTemplate: body.public_reply_template ?? body.reply_template ?? null,
          privateFollowupTemplate: body.private_followup_template ?? body.reply_template ?? null,
          eventSettings: toInputJson(body.event_settings ?? DEFAULT_EVENT_SETTINGS),
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
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 }),
          sourceMode: body.source_mode ?? 'existing',
          postCaption: body.post_caption ?? null,
          publicReplyTemplate: body.public_reply_template ?? body.reply_template ?? null,
          privateFollowupTemplate: body.private_followup_template ?? body.reply_template ?? null,
          eventSettings: toInputJson(body.event_settings ?? DEFAULT_EVENT_SETTINGS),
          activationStatus: body.activation_status ?? 'draft',
        },
      });
      result = mapEngageCampaign(row);
    }
    res.json({ ok: true, campaign: result });
  } catch (err) {
    sendServerError(res, 'Campaign lookup failed', err);
  }
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
    res.json({ campaigns: rows.map(mapEngageCampaign) });
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
      if (row.status === 'queued' || row.status === 'queued_for_approval') stats.queued += count;
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
      if (engagement.status === 'queued' || engagement.status === 'queued_for_approval') queuedByDay.set(key, (queuedByDay.get(key) ?? 0) + 1);
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
    sendServerError(res, 'Post URL campaign run failed', err);
  }
});

export default router;
