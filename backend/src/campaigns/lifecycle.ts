import { Intent, Platform } from '../types';

export const CAMPAIGN_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'x'] as const;
export type CampaignPlatform = typeof CAMPAIGN_PLATFORMS[number];
export type CampaignSourceMode = 'publish_new' | 'existing' | 'keyword';
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

export type KeywordCampaignInput = {
  keywords: string[];
  platforms: Platform[];
  intent_filter: Intent[];
  confidence_threshold: number;
  urgency_threshold: number;
  max_per_day: number;
  public_reply_enabled: boolean;
  direct_message_enabled: boolean;
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

  if (input.source_mode === 'keyword') {
    return { ok: false, message: 'Keyword campaigns must be activated through the keyword campaign endpoint.' };
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

export function validateKeywordCampaignInput(input: KeywordCampaignInput): { ok: boolean; message?: string } {
  const keywords = Array.from(new Set(input.keywords.map(keyword => keyword.trim()).filter(Boolean)));
  if (!keywords.length || keywords.length > 20) return { ok: false, message: 'Provide between 1 and 20 keywords.' };
  if (keywords.some(keyword => keyword.length > 100)) return { ok: false, message: 'Each keyword must be 100 characters or fewer.' };
  const platforms = Array.from(new Set(input.platforms));
  if (!platforms.length || platforms.some(platform => !CAMPAIGN_PLATFORMS.includes(platform as CampaignPlatform))) {
    return { ok: false, message: 'Select at least one supported campaign platform.' };
  }
  const allowedIntents: Intent[] = ['inquiry', 'complaint', 'praise', 'purchase_intent', 'objection', 'neutral'];
  if (input.intent_filter.some(intent => !allowedIntents.includes(intent))) return { ok: false, message: 'intent_filter contains an invalid intent.' };
  if (!Number.isInteger(input.confidence_threshold) || input.confidence_threshold < 0 || input.confidence_threshold > 100) return { ok: false, message: 'confidence_threshold must be between 0 and 100.' };
  if (!Number.isInteger(input.urgency_threshold) || input.urgency_threshold < 1 || input.urgency_threshold > 5) return { ok: false, message: 'urgency_threshold must be between 1 and 5.' };
  if (!Number.isInteger(input.max_per_day) || input.max_per_day < 1 || input.max_per_day > 500) return { ok: false, message: 'max_per_day must be between 1 and 500.' };
  if (!input.public_reply_enabled && !input.direct_message_enabled) return { ok: false, message: 'Enable public replies, direct messages, or both.' };
  return { ok: true };
}

export function evaluateKeywordCampaignEvent(
  event: { text: string; intent: Intent; urgency: number; confidence: number },
  rules: { keywords: string[]; intents: Intent[]; urgencyThreshold: number; confidenceThreshold: number },
): 'ignored_keyword' | 'ignored_intent' | 'ignored_urgency' | 'needs_review' | null {
  if (!eligibleForCampaign({ kind: 'comment', text: event.text }, rules.keywords)) return 'ignored_keyword';
  if (rules.intents.length && !rules.intents.includes(event.intent) && !textMatchesIntentFallback(event.text, rules.intents)) return 'ignored_intent';
  if (event.urgency < rules.urgencyThreshold) return 'ignored_urgency';
  if (event.confidence < rules.confidenceThreshold) return 'needs_review';
  return null;
}

function textMatchesIntentFallback(text: string, intents: Intent[]): boolean {
  const normalized = text.toLowerCase();
  const hasAny = (terms: string[]) => terms.some(term => normalized.includes(term));

  if (intents.includes('complaint') && hasAny([
    'failed',
    'failure',
    'problem',
    'issue',
    'trouble',
    'not received',
    'did not receive',
    "didn't receive",
    'money missing',
    'missing money',
    'reversed',
    'declined',
    'blocked',
    'error',
    'complain',
    'complaint',
  ])) return true;

  if (intents.includes('purchase_intent') && hasAny([
    'price',
    'buy',
    'order',
    'available',
    'interested',
    'need this',
    'want this',
    'how much',
    'where can i get',
    'link',
    'shop',
  ])) return true;

  if (intents.includes('inquiry') && hasAny([
    '?',
    'how',
    'what',
    'where',
    'when',
    'can you',
    'please help',
    'i need help',
    'support',
  ])) return true;

  if (intents.includes('praise') && hasAny([
    'great',
    'good',
    'love',
    'amazing',
    'excellent',
    'thanks',
    'thank you',
  ])) return true;

  if (intents.includes('objection') && hasAny([
    'too expensive',
    'costly',
    'not sure',
    'doubt',
    'scam',
    'sketchy',
    'fake',
    'concern',
  ])) return true;

  return false;
}

export function eligibleForCampaign(event: { kind: CampaignEventKind; text?: string | null }, keywords: string[]): boolean {
  if (event.kind === 'like' || event.kind === 'repost') return true;
  const normalizedKeywords = keywords.map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
  if (!normalizedKeywords.length) return true;
  const text = (event.text ?? '').toLowerCase();
  return normalizedKeywords.some(keyword => text.includes(keyword));
}
