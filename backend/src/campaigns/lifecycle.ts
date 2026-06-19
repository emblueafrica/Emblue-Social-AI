import { Platform } from '../types';

export const CAMPAIGN_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'x'] as const;
export type CampaignPlatform = typeof CAMPAIGN_PLATFORMS[number];
export type CampaignSourceMode = 'publish_new' | 'existing';
export type CampaignEventKind = 'comment' | 'reply' | 'mention' | 'dm' | 'like' | 'repost';

export type CampaignMediaInput = {
  url?: string;
  public_id?: string;
  mime_type: string;
  size_bytes: number;
};

export type CampaignEventSettings = {
  comments: boolean;
  likes: boolean;
  reposts: boolean;
  mentions: boolean;
  dms: boolean;
};

export const DEFAULT_EVENT_SETTINGS: CampaignEventSettings = {
  comments: true,
  likes: true,
  reposts: true,
  mentions: true,
  dms: true,
};

export function validateMediaSet(media: CampaignMediaInput[]): {
  ok: boolean;
  media_type: 'image' | 'video' | null;
  message?: string;
} {
  if (!media.length) return { ok: true, media_type: null };
  if (media.length > 10) return { ok: false, media_type: null, message: 'A campaign can contain at most 10 media files.' };

  const types = new Set<'image' | 'video'>();
  for (const item of media) {
    if (!Number.isFinite(item.size_bytes) || item.size_bytes <= 0 || item.size_bytes > 100 * 1024 * 1024) {
      return { ok: false, media_type: null, message: 'Each media file must be between 1 byte and 100MB.' };
    }
    if (item.mime_type.startsWith('image/')) types.add('image');
    else if (item.mime_type.startsWith('video/')) types.add('video');
    else return { ok: false, media_type: null, message: 'Only image and video campaign media is supported.' };
  }

  if (types.size > 1) return { ok: false, media_type: null, message: 'Campaign media cannot mix images and videos.' };
  if (types.has('video') && media.length > 1) return { ok: false, media_type: null, message: 'A video campaign can contain only one video.' };
  return { ok: true, media_type: types.has('video') ? 'video' : 'image' };
}

export function validateActivationRequest(input: {
  source_mode: CampaignSourceMode;
  platforms: Platform[];
  existing_posts?: { platform: Platform; url: string }[];
  allocation: Partial<Record<CampaignPlatform, number>>;
  media?: CampaignMediaInput[];
}): { ok: boolean; message?: string } {
  const platforms = Array.from(new Set(input.platforms)).filter((platform): platform is CampaignPlatform =>
    CAMPAIGN_PLATFORMS.includes(platform as CampaignPlatform)
  );
  if (!platforms.length) return { ok: false, message: 'Select at least one supported campaign platform.' };

  const allocationTotal = platforms.reduce((sum, platform) => sum + Number(input.allocation[platform] ?? 0), 0);
  if (allocationTotal !== 100) return { ok: false, message: 'Selected platform allocation must total 100%.' };
  if (platforms.some(platform => Number(input.allocation[platform] ?? 0) < 0)) {
    return { ok: false, message: 'Platform allocation cannot be negative.' };
  }

  if (input.source_mode === 'existing') {
    const urls = new Map((input.existing_posts ?? []).map(post => [post.platform, post.url.trim()]));
    if (platforms.some(platform => !urls.get(platform))) {
      return { ok: false, message: 'Provide one existing post URL for every selected platform.' };
    }
  }

  const mediaResult = validateMediaSet(input.media ?? []);
  if (!mediaResult.ok) return { ok: false, message: mediaResult.message };
  return { ok: true };
}

export function eligibleForCampaign(event: { kind: CampaignEventKind; text?: string | null }, keywords: string[]): boolean {
  if (event.kind === 'like' || event.kind === 'repost') return true;
  const normalizedKeywords = keywords.map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
  if (!normalizedKeywords.length) return true;
  const text = (event.text ?? '').toLowerCase();
  return normalizedKeywords.some(keyword => text.includes(keyword));
}
