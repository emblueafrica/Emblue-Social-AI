import { Prisma } from '@prisma/client';
import { CampaignConfig, Platform, PlatformAllocation } from '../types';

type EngageCampaignRow = Prisma.EngageCampaignGetPayload<Record<string, never>>;

export type CampaignRecord = CampaignConfig & {
  campaign_id: number;
  brand_id: number;
  post_ids: string[];
  total_sent: number;
  created_at: Date;
  updated_at: Date;
};

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function mapPlatformAllocation(value: Prisma.JsonValue): PlatformAllocation {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as PlatformAllocation;
  }
  return { instagram: 34, facebook: 33, tiktok: 33 };
}

export function mapEngageCampaign(row: EngageCampaignRow): CampaignRecord {
  return {
    id: Number(row.campaignId),
    campaign_id: Number(row.campaignId),
    brand_id: row.brandId,
    name: row.name,
    mode: row.mode,
    platform: row.platform ? row.platform as Platform : undefined,
    platforms: row.platforms as Platform[],
    priority: row.priority,
    scope_type: row.scopeType,
    reply_mode: row.replyMode,
    post_ids: row.postIds ?? [],
    keywords: row.keywords ?? [],
    engage_all: row.engageAll ?? true,
    engage_negative: row.engageNegative ?? false,
    tone: row.tone ?? undefined,
    reply_template: row.replyTemplate ?? undefined,
    fallback_template: row.fallbackTemplate ?? undefined,
    cta_link: row.ctaLink ?? undefined,
    image_url: row.imageUrl ?? undefined,
    tracked_link_code: row.trackedLinkCode ?? undefined,
    auto_fire_threshold: row.autoFireThreshold ?? 85,
    max_per_hour: row.maxPerHour ?? 50,
    max_per_day: row.maxPerDay,
    max_dm_per_day: row.maxDmPerDay,
    spacing_minutes: row.spacingMinutes,
    intent_filter: row.intentFilter as CampaignConfig['intent_filter'],
    urgency_threshold: row.urgencyThreshold,
    reply_template_id: row.replyTemplateId ? Number(row.replyTemplateId) : null,
    public_reply_enabled: row.publicReplyEnabled,
    direct_message_enabled: row.directMessageEnabled,
    is_active: row.isActive ?? true,
    total_sent: row.totalSent ?? 0,
    platform_allocation: mapPlatformAllocation(row.platformAllocation),
    include_likers: row.includeLikers ?? true,
    include_commenters: row.includeCommenters ?? true,
    source_mode: row.sourceMode === 'publish_new' || row.sourceMode === 'keyword' ? row.sourceMode : 'existing',
    post_caption: row.postCaption ?? undefined,
    public_reply_template: row.publicReplyTemplate ?? undefined,
    private_followup_template: row.privateFollowupTemplate ?? undefined,
    event_settings: row.eventSettings as CampaignConfig['event_settings'],
    mode_config: row.modeConfig as CampaignConfig['mode_config'],
    preview_fetched_at: row.previewFetchedAt,
    preview_expires_at: row.previewExpiresAt,
    activation_status: row.activationStatus,
    last_activated_at: row.lastActivatedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
