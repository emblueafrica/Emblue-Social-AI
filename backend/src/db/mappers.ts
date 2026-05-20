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
    platform: row.platform ? row.platform as Platform : undefined,
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
    is_active: row.isActive ?? true,
    total_sent: row.totalSent ?? 0,
    platform_allocation: mapPlatformAllocation(row.platformAllocation),
    include_likers: row.includeLikers ?? true,
    include_commenters: row.includeCommenters ?? true,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
