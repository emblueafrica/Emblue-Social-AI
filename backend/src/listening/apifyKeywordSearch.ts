import { ApifyClient } from 'apify-client';
import { Platform } from '../types';
import { KeywordSearchResult, NormalizedSearchItem } from './types';

const ACTOR_IDS: Record<Platform, string | null> = {
  instagram: 'apify/instagram-search-scraper',
  facebook: 'apify/facebook-posts-scraper',
  x: 'quacker/twitter-scraper',
  tiktok: 'clockworks/tiktok-scraper',
  youtube: 'streamers/youtube-scraper',
  reddit: 'trudax/reddit-scraper',
  whatsapp: null,
};

interface PlatformKeywordSearchInput {
  keyword: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  maxItems?: number;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnly(date?: Date | null): string | undefined {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : [];
}

function nestedOwnerId(item: Record<string, unknown>): unknown {
  const owner = item['owner'];
  return typeof owner === 'object' && owner !== null && !Array.isArray(owner)
    ? (owner as Record<string, unknown>)['id']
    : null;
}

function normalizeApifyItem(item: Record<string, unknown>, platform: Platform, matchedKeyword: string, parent?: Record<string, unknown>): NormalizedSearchItem | null {
  const text = asString(item['text'] ?? item['content'] ?? item['body'] ?? item['caption'] ?? item['message'] ?? item['commentText'] ?? item['title']);
  if (!text) return null;

  return {
    platform,
    matchedKeyword,
    text: text.slice(0, 4000),
    authorHandle: asString(item['username'] ?? item['ownerUsername'] ?? item['author'] ?? item['authorUsername'] ?? item['authorName'] ?? item['displayName'] ?? item['channelName'] ?? parent?.['ownerUsername']),
    authorIdExt: asString(item['authorId'] ?? item['userId'] ?? item['ownerId'] ?? nestedOwnerId(item) ?? item['channelId'] ?? item['id']),
    url: asString(item['url'] ?? item['postUrl'] ?? item['tweetUrl'] ?? item['videoUrl'] ?? item['permalink'] ?? parent?.['url']),
    postedAt: asDate(item['timestamp'] ?? item['createdAt'] ?? item['created_at'] ?? item['date'] ?? item['publishedAt'] ?? item['created_time']),
    likes: asNumber(item['likes'] ?? item['likeCount'] ?? item['likesCount'] ?? item['upVotes']),
    repliesCount: asNumber(item['replies'] ?? item['replyCount'] ?? item['repliesCount'] ?? item['commentsCount'] ?? item['numComments']),
    shares: asNumber(item['shares'] ?? item['shareCount'] ?? item['retweets'] ?? item['retweetCount']),
    views: asNumber(item['views'] ?? item['viewCount'] ?? item['viewsCount'] ?? item['playCount'] ?? item['videoViewCount']),
    raw: parent ? { ...item, parentPost: parent } : item,
  };
}

function normalizeApifyItems(item: Record<string, unknown>, platform: Platform, matchedKeyword: string): NormalizedSearchItem[] {
  const normalized: NormalizedSearchItem[] = [];
  const post = normalizeApifyItem(item, platform, matchedKeyword);
  if (post) normalized.push(post);

  for (const comment of asRecordArray(item['latestComments'])) {
    const normalizedComment = normalizeApifyItem(comment, platform, matchedKeyword, item);
    if (normalizedComment) normalized.push(normalizedComment);
  }

  return normalized;
}

async function runActorForKeyword(
  platform: Platform,
  input: PlatformKeywordSearchInput
): Promise<KeywordSearchResult> {
  const token = process.env.APIFY_API_TOKEN;
  const actorId = ACTOR_IDS[platform];

  if (!token) return { items: [], errors: ['No APIFY_API_TOKEN'] };
  if (!actorId) return { items: [], errors: [`No keyword-search actor configured for ${platform}`] };

  const client = new ApifyClient({ token });
  const maxItems = input.maxItems ?? 100;

  try {
    const run = await client.actor(actorId).call({
      query: input.keyword,
      keyword: input.keyword,
      search: input.keyword,
      searchTerms: [input.keyword],
      maxItems,
      maxResults: maxItems,
      limit: maxItems,
      since: dateOnly(input.dateFrom),
      until: dateOnly(input.dateTo),
      startDate: dateOnly(input.dateFrom),
      endDate: dateOnly(input.dateTo),
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: maxItems });
    const normalized = items.flatMap(item => normalizeApifyItems(item as Record<string, unknown>, platform, input.keyword));

    return { items: normalized, errors: [] };
  } catch (err) {
    return { items: [], errors: [`${platform}:${input.keyword}: ${(err as Error).message}`] };
  }
}

export async function searchInstagramKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('instagram', { keyword, dateFrom, dateTo, maxItems });
}

export async function searchXKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('x', { keyword, dateFrom, dateTo, maxItems });
}

export async function searchRedditKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('reddit', { keyword, dateFrom, dateTo, maxItems });
}

export async function searchYouTubeKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('youtube', { keyword, dateFrom, dateTo, maxItems });
}

export async function searchTikTokKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('tiktok', { keyword, dateFrom, dateTo, maxItems });
}

export async function searchFacebookKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('facebook', { keyword, dateFrom, dateTo, maxItems });
}

export async function runKeywordSearch(params: {
  keywords: string[];
  platforms: Platform[];
  dateFrom?: Date | null;
  dateTo?: Date | null;
  maxItemsPerPlatform?: number;
}): Promise<KeywordSearchResult> {
  const items: NormalizedSearchItem[] = [];
  const errors: string[] = [];

  for (const keyword of params.keywords) {
    for (const platform of params.platforms) {
      const result =
        platform === 'instagram' ? await searchInstagramKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'x' ? await searchXKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'reddit' ? await searchRedditKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'youtube' ? await searchYouTubeKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'tiktok' ? await searchTikTokKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'facebook' ? await searchFacebookKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        { items: [], errors: [`No keyword-search support for ${platform}`] };

      items.push(...result.items);
      errors.push(...result.errors);
    }
  }

  return { items, errors };
}
