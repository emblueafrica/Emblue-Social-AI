import { ApifyClient } from 'apify-client';
import { Platform } from '../types';
import { KeywordSearchResult, NormalizedSearchItem } from './types';
import { buildXRecentSearchKeywordQuery, evaluateStrictKeywordMatch, validateKeywordGuardrails, XLocationFilter } from '../campaigns/keywordGuardrails';

const ACTOR_IDS: Record<Platform, string | null> = {
  instagram: 'apify/instagram-search-scraper',
  facebook: 'apify/facebook-posts-scraper',
  x: process.env.APIFY_X_ACTOR_ID?.trim() || 'apidojo/tweet-scraper',
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
  location?: XLocationFilter;
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

function nestedRecord(item: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = item[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeApifyItem(item: Record<string, unknown>, platform: Platform, matchedKeyword: string, parent?: Record<string, unknown>): NormalizedSearchItem | null {
  const author = nestedRecord(item, 'author');
  const user = nestedRecord(item, 'user');
  const publicMetrics = nestedRecord(item, 'public_metrics');
  const authorFromParent = parent ? nestedRecord(parent, 'author') : {};
  const text = asString(item['text'] ?? item['content'] ?? item['body'] ?? item['caption'] ?? item['message'] ?? item['commentText'] ?? item['title']);
  if (!text) return null;

  return {
    platform,
    matchedKeyword,
    text: text.slice(0, 4000),
    authorHandle: asString(
      item['username'] ??
      item['ownerUsername'] ??
      item['authorUsername'] ??
      item['authorName'] ??
      item['displayName'] ??
      item['channelName'] ??
      author['userName'] ??
      author['username'] ??
      author['name'] ??
      user['username'] ??
      user['userName'] ??
      parent?.['ownerUsername'] ??
      authorFromParent['userName'] ??
      authorFromParent['username'],
    ),
    authorIdExt: asString(
      item['authorId'] ??
      item['userId'] ??
      item['ownerId'] ??
      nestedOwnerId(item) ??
      item['channelId'] ??
      author['id'] ??
      author['rest_id'] ??
      user['id'] ??
      item['id'],
    ),
    url: asString(item['url'] ?? item['postUrl'] ?? item['tweetUrl'] ?? item['videoUrl'] ?? item['permalink'] ?? parent?.['url']),
    postedAt: asDate(item['timestamp'] ?? item['createdAt'] ?? item['created_at'] ?? item['date'] ?? item['publishedAt'] ?? item['created_time']),
    likes: asNumber(item['likes'] ?? item['likeCount'] ?? item['likesCount'] ?? publicMetrics['like_count'] ?? item['upVotes']),
    repliesCount: asNumber(item['replies'] ?? item['replyCount'] ?? item['repliesCount'] ?? publicMetrics['reply_count'] ?? item['commentsCount'] ?? item['numComments']),
    shares: asNumber(item['shares'] ?? item['shareCount'] ?? item['retweets'] ?? item['retweetCount'] ?? publicMetrics['retweet_count']),
    views: asNumber(item['views'] ?? item['viewCount'] ?? item['viewsCount'] ?? publicMetrics['impression_count'] ?? item['playCount'] ?? item['videoViewCount']),
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

function normalizeXRecentSearchTweet(
  tweet: Record<string, unknown>,
  users: Map<string, Record<string, unknown>>,
  places: Map<string, Record<string, unknown>>,
  matchedKeyword: string,
): NormalizedSearchItem | null {
  const text = asString(tweet['text']);
  if (!text) return null;

  const authorId = asString(tweet['author_id']);
  const user = authorId ? users.get(authorId) : undefined;
  const tweetId = asString(tweet['id']);
  const username = asString(user?.['username'] ?? user?.['name']);
  const publicMetrics = typeof tweet['public_metrics'] === 'object' && tweet['public_metrics'] !== null && !Array.isArray(tweet['public_metrics'])
    ? tweet['public_metrics'] as Record<string, unknown>
    : {};
  const geo = nestedRecord(tweet, 'geo');
  const placeId = asString(geo['place_id']);
  const place = placeId ? places.get(placeId) : undefined;

  return {
    platform: 'x',
    matchedKeyword,
    text: text.slice(0, 4000),
    authorHandle: username,
    authorIdExt: authorId,
    url: tweetId ? `https://x.com/i/web/status/${tweetId}` : null,
    postedAt: asDate(tweet['created_at']),
    likes: asNumber(publicMetrics['like_count']),
    repliesCount: asNumber(publicMetrics['reply_count']),
    shares: asNumber(publicMetrics['retweet_count']),
    views: asNumber(publicMetrics['impression_count']),
    raw: { ...tweet, author: user ?? null, place: place ?? null },
  };
}

async function runXRecentSearchForKeyword(input: PlatformKeywordSearchInput): Promise<KeywordSearchResult> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return runActorForKeyword('x', input);

  try {
    const requested = Math.max(1, input.maxItems ?? 100);
    const users = new Map<string, Record<string, unknown>>();
    const places = new Map<string, Record<string, unknown>>();
    const items: NormalizedSearchItem[] = [];
    let nextToken: string | undefined;

    do {
      const remaining = requested - items.length;
      const maxResults = Math.max(10, Math.min(100, remaining));
      const params = new URLSearchParams({
        query: buildXRecentSearchKeywordQuery(input.keyword, input.location),
        max_results: String(maxResults),
        'tweet.fields': 'author_id,created_at,conversation_id,public_metrics,geo',
        expansions: 'author_id,geo.place_id',
        'user.fields': 'username,name,verified,public_metrics,created_at,location',
        'place.fields': 'id,name,full_name,country,country_code,place_type,geo',
      });
      const startDate = input.dateFrom?.toISOString();
      const endDate = input.dateTo?.toISOString();
      if (startDate) params.set('start_time', startDate);
      if (endDate) params.set('end_time', endDate);
      if (nextToken) params.set('next_token', nextToken);

      const response = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as {
        data?: Record<string, unknown>[];
        includes?: { users?: Record<string, unknown>[]; places?: Record<string, unknown>[] };
        errors?: { message?: string; detail?: string }[];
        meta?: { next_token?: string };
        title?: string;
        detail?: string;
      };

      if (!response.ok || body.errors?.length) {
        const detail = body.errors?.[0]?.message ?? body.errors?.[0]?.detail ?? body.detail ?? body.title ?? `X recent search ${response.status}`;
        if (response.status === 401) return { items: [], errors: [`x:${input.keyword}: X bearer token is invalid or expired. ${detail}`] };
        if (response.status === 403) return { items: [], errors: [`x:${input.keyword}: X Recent Search is not available for this account/API plan. ${detail}`] };
        if (response.status === 429) return { items: [], errors: [`x:${input.keyword}: X Recent Search rate limit reached. Retry after the X API window resets. ${detail}`] };
        return { items: [], errors: [`x:${input.keyword}: ${detail}`] };
      }

      for (const user of body.includes?.users ?? []) {
        const id = asString(user['id']);
        if (id) users.set(id, user);
      }
      for (const place of body.includes?.places ?? []) {
        const id = asString(place['id']);
        if (id) places.set(id, place);
      }

      const pageItems = (body.data ?? [])
        .map(tweet => normalizeXRecentSearchTweet(tweet, users, places, input.keyword))
        .filter((item): item is NormalizedSearchItem => Boolean(item));
      items.push(...pageItems);
      nextToken = body.meta?.next_token;
    } while (nextToken && items.length < requested);

    return { items: items.slice(0, requested), errors: [] };
  } catch (err) {
    return { items: [], errors: [`x:${input.keyword}: ${(err as Error).message}`] };
  }
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
    const actorInput = platform === 'x'
      ? {
          searchTerms: [input.keyword],
          maxItems,
          sort: 'Latest',
          includeSearchTerms: false,
          start: dateOnly(input.dateFrom),
          end: dateOnly(input.dateTo),
        }
      : {
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
        };
    const run = await client.actor(actorId).call(actorInput);

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: maxItems });
    const normalized = items.flatMap(item => normalizeApifyItems(item as Record<string, unknown>, platform, input.keyword));
    const statusMessage = asString((run as { statusMessage?: unknown }).statusMessage);
    if (platform === 'x' && !normalized.length && statusMessage?.toLowerCase().includes('subscribe to a paid plan')) {
      return { items: [], errors: [`x:${input.keyword}: ${statusMessage.replace(/\s+/g, ' ')}`] };
    }

    return { items: normalized, errors: [] };
  } catch (err) {
    return { items: [], errors: [`${platform}:${input.keyword}: ${(err as Error).message}`] };
  }
}

export async function searchInstagramKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number): Promise<KeywordSearchResult> {
  return runActorForKeyword('instagram', { keyword, dateFrom, dateTo, maxItems });
}

export async function searchXKeyword(keyword: string, dateFrom?: Date | null, dateTo?: Date | null, maxItems?: number, location?: XLocationFilter): Promise<KeywordSearchResult> {
  return runXRecentSearchForKeyword({ keyword, dateFrom, dateTo, maxItems, location });
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
  xLocation?: XLocationFilter;
}): Promise<KeywordSearchResult> {
  const items: NormalizedSearchItem[] = [];
  const errors: string[] = [];
  const rejected: NonNullable<KeywordSearchResult['rejected']> = [];

  for (const keyword of params.keywords) {
    const guardrail = validateKeywordGuardrails([keyword]);
    if (!guardrail.ok) {
      errors.push(`keyword:${keyword}: ${guardrail.message ?? 'Keyword is too broad for campaign search.'}`);
      continue;
    }

    for (const platform of params.platforms) {
      const result =
        platform === 'instagram' ? await searchInstagramKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'x' ? await searchXKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform, params.xLocation) :
        platform === 'reddit' ? await searchRedditKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'youtube' ? await searchYouTubeKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'tiktok' ? await searchTikTokKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        platform === 'facebook' ? await searchFacebookKeyword(keyword, params.dateFrom, params.dateTo, params.maxItemsPerPlatform) :
        { items: [], errors: [`No keyword-search support for ${platform}`] };

      for (const item of result.items) {
        const decision = evaluateStrictKeywordMatch(item.text, [keyword]);
        if (decision.ok) {
          items.push({ ...item, matchedKeyword: decision.matchedKeyword ?? item.matchedKeyword });
        } else {
          rejected.push({
            platform,
            keyword,
            reason: decision.reason ?? 'keyword_guardrail_rejected',
            text: item.text.slice(0, 240),
            url: item.url,
          });
        }
      }
      errors.push(...result.errors);
      rejected.push(...(result.rejected ?? []));
    }
  }

  return { items, errors, rejected };
}
