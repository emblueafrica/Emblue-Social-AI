// src/auth/apifySync.ts — Apify social media scraper (Month 2)
// Activate by setting APIFY_API_TOKEN in .env
// Costs $29-249/mo on Apify Starter plan
// Covers: Instagram, TikTok, X, Reddit, YouTube without official API costs

import { ApifyClient } from "apify-client";
import { runAgent1 }   from "../agents/agent1_listening";
import { persistAgent1Result } from "../db/queries";
import { Platform, RawMessage } from "../types";

const ACTOR_IDS: Record<string, string> = {
  instagram: "apify/instagram-comment-scraper",
  tiktok:    "clockworks/tiktok-comments-scraper",
  x:         "quacker/twitter-scraper",
  reddit:    "trudax/reddit-scraper",
  youtube:   "streamers/youtube-comment-scraper",
};

export interface ApifySyncConfig {
  brand_id:   number;
  platform:   Platform;
  target_url: string;
  max_items?: number;
}

export interface ApifySyncResult {
  brand_id:    number;
  platform:    Platform;
  total_items: number;
  errors:      string[];
}

function normaliseApifyItem(item: Record<string, unknown>, platform: Platform): RawMessage | null {
  const text =
    (item["text"] ?? item["content"] ?? item["commentText"] ?? item["body"]) as string | undefined;
  if (!text) return null;

  return {
    platform,
    kind:          "comment",
    text:          String(text).slice(0, 2000),
    author_handle: String(item["authorId"] ?? item["username"] ?? item["author"] ?? "unknown"),
    author_id:     String(item["authorId"] ?? item["id"] ?? ""),
    url:           String(item["url"] ?? item["postUrl"] ?? ""),
    metrics: {
      likes:   Number(item["likesCount"] ?? item["likes"] ?? 0),
      replies: Number(item["repliesCount"] ?? item["replies"] ?? 0),
      shares:  0,
      views:   Number(item["viewsCount"] ?? 0),
    },
    raw: item,
  };
}

export async function runApifySync(config: ApifySyncConfig): Promise<ApifySyncResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.warn("[Apify] No APIFY_API_TOKEN — skipping");
    return { brand_id: config.brand_id, platform: config.platform, total_items: 0, errors: ["No APIFY_API_TOKEN"] };
  }

  const actorId = ACTOR_IDS[config.platform];
  if (!actorId) {
    return { brand_id: config.brand_id, platform: config.platform, total_items: 0, errors: [`No Apify actor for ${config.platform}`] };
  }

  const client = new ApifyClient({ token });

  try {
    console.log(`[Apify] Starting ${config.platform} scrape for brand ${config.brand_id}`);

    const run = await client.actor(actorId).call({
      startUrls: [{ url: config.target_url }],
      maxItems:  config.max_items ?? 200,
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const rawItems: RawMessage[] = [];

    for (const item of items) {
      const normalised = normaliseApifyItem(item as Record<string, unknown>, config.platform);
      if (normalised) rawItems.push(normalised);
    }

    if (!rawItems.length) {
      return { brand_id: config.brand_id, platform: config.platform, total_items: 0, errors: [] };
    }

    const result = await runAgent1({
      brand_id:     config.brand_id,
      platform:     config.platform,
      payload_type: "api_items",
      source_name:  `apify_${config.platform}`,
      items:        rawItems,
    });

    await persistAgent1Result(config.brand_id, result);
    console.log(`[Apify] ${config.platform}: ${result.total_items} items classified`);

    return { brand_id: config.brand_id, platform: config.platform, total_items: result.total_items, errors: result.errors };

  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[Apify] ${config.platform} error:`, msg);
    return { brand_id: config.brand_id, platform: config.platform, total_items: 0, errors: [msg] };
  }
}

export async function runApifyForAllPlatforms(
  brandId:    number,
  targetUrls: Partial<Record<Platform, string>>,
  maxItems  = 200
): Promise<ApifySyncResult[]> {
  const results: ApifySyncResult[] = [];

  for (const [platform, url] of Object.entries(targetUrls)) {
    if (!url) continue;
    const result = await runApifySync({
      brand_id:   brandId,
      platform:   platform as Platform,
      target_url: url,
      max_items:  maxItems,
    });
    results.push(result);
    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }

  return results;
}
