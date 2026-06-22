import { Prisma } from '@prisma/client';
import { runAgent1 } from '../agents/agent1_listening';
import { runAgent2 } from '../agents/agent2_clustering';
import { runAgent10 } from '../agents/agents9_to_14';
import prisma from '../db/prisma';
import { getBrandById, persistAgent10Result, persistAgent2Result } from '../db/queries';
import { broadcastToClients } from '../stream/eventQueue';
import { ClassifiedMessage, Platform, RawMessage } from '../types';
import { runKeywordSearch } from './apifyKeywordSearch';
import { buildVolumeChart, chooseGranularity } from './volume';
import {
  ClassifiedSearchItem,
  KeywordSearchInput,
  NormalizedSearchItem,
  SearchMode,
  VolumeBucket,
} from './types';

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

export function coerceDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnly(date: Date | null): Date | null {
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sanitizeKeywords(keywords: string[]): string[] {
  return Array.from(new Set(keywords.map(keyword => keyword.trim()).filter(Boolean))).slice(0, 20);
}

function sanitizePlatforms(platforms: Platform[]): Platform[] {
  return Array.from(new Set(platforms)).filter(Boolean);
}

function dedupeItems(items: NormalizedSearchItem[]): NormalizedSearchItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.url
      ? `${item.platform}:${item.url}`
      : `${item.platform}:${item.authorHandle ?? ''}:${item.text.slice(0, 160)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toRawMessage(item: NormalizedSearchItem): RawMessage {
  return {
    platform: item.platform,
    kind: 'keyword_match',
    text: item.text,
    author_handle: item.authorHandle,
    author_id: item.authorIdExt,
    url: item.url,
    metrics: {
      likes: item.likes,
      replies: item.repliesCount,
      shares: item.shares,
      views: item.views,
    },
    raw: item.raw,
  };
}

async function classifySearchItems(brandId: number, items: NormalizedSearchItem[]): Promise<ClassifiedSearchItem[]> {
  const grouped = new Map<Platform, NormalizedSearchItem[]>();
  for (const item of items) {
    grouped.set(item.platform, [...(grouped.get(item.platform) ?? []), item]);
  }

  const classified: ClassifiedSearchItem[] = [];
  for (const [platform, platformItems] of grouped.entries()) {
    const result = await runAgent1({
      brand_id: brandId,
      platform,
      payload_type: 'api_items',
      source_name: `keyword_search_${platform}`,
      items: platformItems.map(toRawMessage),
    });

    platformItems.forEach((source, index) => {
      const label = result.classified[index];
      classified.push({
        ...source,
        brandId,
        sentiment: label?.sentiment ?? 'neutral',
        intent: label?.intent ?? 'neutral',
        urgencyScore: label?.urgency_score ?? 1,
        topics: label?.topics ?? [],
      });
    });
  }

  return classified;
}

export async function createSearchRun(input: KeywordSearchInput): Promise<number> {
  const keywords = sanitizeKeywords(input.keywords);
  const platforms = sanitizePlatforms(input.platforms);

  const row = await prisma.searchRun.create({
    data: {
      brandId: input.brandId,
      groupId: input.groupId ? BigInt(input.groupId) : null,
      keywords,
      platforms,
      dateFrom: toDateOnly(coerceDate(input.dateFrom)),
      dateTo: toDateOnly(coerceDate(input.dateTo)),
      mode: input.mode,
      status: 'pending',
    },
    select: { runId: true },
  });

  return Number(row.runId);
}

export async function saveSearchResults(
  runId: number,
  groupId: number | null,
  results: ClassifiedSearchItem[]
): Promise<number> {
  if (!results.length) return 0;

  const run = await prisma.searchRun.findUnique({
    where: { runId: BigInt(runId) },
    select: { brandId: true },
  });
  if (!run) throw new Error(`Search run ${runId} not found`);

  const data = results.map(result => ({
    runId: BigInt(runId),
    brandId: run.brandId,
    groupId: groupId ? BigInt(groupId) : null,
    matchedKeyword: result.matchedKeyword,
    platform: result.platform as never,
    text: result.text,
    authorHandle: result.authorHandle,
    authorIdExt: result.authorIdExt,
    url: result.url,
    postedAt: result.postedAt,
    sentiment: result.sentiment as never,
    intent: result.intent as never,
    urgencyScore: result.urgencyScore,
    topics: result.topics,
    likes: result.likes,
    repliesCount: result.repliesCount,
    shares: result.shares,
    views: result.views,
    engaged: false,
    raw: toJson(result.raw),
  }));

  const created = await prisma.searchResult.createMany({ data });
  return created.count;
}

async function saveSearchVolume(runId: number, buckets: VolumeBucket[]): Promise<void> {
  await prisma.searchVolume.deleteMany({ where: { runId: BigInt(runId) } });
  if (!buckets.length) return;

  await prisma.searchVolume.createMany({
    data: buckets.map(bucket => ({
      runId: BigInt(runId),
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      periodType: bucket.periodType,
      mentionCount: bucket.mentionCount,
      positiveCount: bucket.positiveCount,
      negativeCount: bucket.negativeCount,
      neutralCount: bucket.neutralCount,
    })),
  });
}

async function enrichRunWithAgents(brandId: number, classified: ClassifiedSearchItem[]): Promise<string | null> {
  if (classified.length >= 3) {
    const clusterResult = await runAgent2({
      brand_id: brandId,
      items: classified.map(item => ({
        text: item.text,
        platform: item.platform,
        kind: 'keyword_match',
        captured_at: item.postedAt ?? new Date(),
      })),
      time_window_days: 30,
      min_items_per_cluster: 3,
    });
    if (!clusterResult.insufficient_data) {
      await persistAgent2Result(brandId, clusterResult);
    }
  }

  if (classified.length < 1) return null;

  const brand = await getBrandById(brandId);
  const insightResult = await runAgent10({
    brand_id: brandId,
    comments: classified.slice(0, 500).map(item => ({
      platform: item.platform,
      author: item.authorHandle ?? '',
      text: item.text,
    })),
    brand_context: brand?.name ?? 'Brand',
  });

  if (!insightResult.error) {
    await persistAgent10Result(brandId, insightResult);
  }

  return insightResult.summary ?? null;
}

async function broadcastSearchAlerts(
  brandId: number,
  groupId: number | null,
  runId: number,
  results: ClassifiedSearchItem[]
): Promise<void> {
  const group = groupId
    ? await prisma.keywordGroup.findUnique({
      where: { groupId: BigInt(groupId) },
      select: { alertUrgencyThreshold: true, alertIntents: true },
    })
    : null;

  const threshold = group?.alertUrgencyThreshold ?? 4;
  const intents = group?.alertIntents ?? [];

  for (const result of results) {
    const intentAllowed = intents.length === 0 || intents.includes(result.intent);
    if (result.urgencyScore >= threshold && intentAllowed) {
      broadcastToClients(brandId, 'listening_high_urgency', {
        run_id: runId,
        group_id: groupId,
        platform: result.platform,
        matched_keyword: result.matchedKeyword,
        author_handle: result.authorHandle,
        sentiment: result.sentiment,
        intent: result.intent,
        urgency_score: result.urgencyScore,
        preview: result.text.slice(0, 160),
        url: result.url,
      });
    }
  }
}

export async function runListeningSearch(runId: number): Promise<void> {
  const run = await prisma.searchRun.findUnique({ where: { runId: BigInt(runId) } });
  if (!run) throw new Error(`Search run ${runId} not found`);
  const group = run.groupId ? await prisma.keywordGroup.findUnique({ where: { groupId: run.groupId }, select: { source: true } }) : null;
  const campaignOwned = group?.source === 'campaign';

  await prisma.searchRun.update({
    where: { runId: BigInt(runId) },
    data: { status: 'running', errorMsg: null },
  });

  try {
    const platforms = sanitizePlatforms(run.platforms as Platform[]);
    const keywordResult = await runKeywordSearch({
      keywords: sanitizeKeywords(run.keywords),
      platforms,
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
      maxItemsPerPlatform: run.mode === 'historical' ? 300 : 75,
    });

    const rawItems = dedupeItems(keywordResult.items);
    if (!rawItems.length && keywordResult.errors.length) {
      throw new Error(keywordResult.errors.join('; '));
    }

    const classified = await classifySearchItems(run.brandId, rawItems);
    await saveSearchResults(runId, run.groupId ? Number(run.groupId) : null, classified);

    const granularity = chooseGranularity(run.dateFrom, run.dateTo);
    const volume = buildVolumeChart(classified, granularity);
    await saveSearchVolume(runId, volume.buckets);

    const insightsSummary = campaignOwned ? null : await enrichRunWithAgents(run.brandId, classified);
    if (!campaignOwned) await broadcastSearchAlerts(run.brandId, run.groupId ? Number(run.groupId) : null, runId, classified);

    const positiveCount = classified.filter(item => item.sentiment === 'positive').length;
    const negativeCount = classified.filter(item => item.sentiment === 'negative').length;
    const neutralCount = classified.filter(item => item.sentiment === 'neutral').length;

    await prisma.searchRun.update({
      where: { runId: BigInt(runId) },
      data: {
        status: 'complete',
        totalResults: classified.length,
        positiveCount,
        negativeCount,
        neutralCount,
        peakDate: volume.peakDate,
        peakCount: volume.peakCount,
        insightsSummary,
        completedAt: new Date(),
        errorMsg: keywordResult.errors.length ? keywordResult.errors.join('; ') : null,
      },
    });

    if (run.groupId) {
      await prisma.keywordGroup.update({
        where: { groupId: run.groupId },
        data: { lastRunAt: new Date() },
      });
    }

    if (!campaignOwned) {
      broadcastToClients(run.brandId, 'listening_search_complete', {
        run_id: runId,
        total_results: classified.length,
        errors: keywordResult.errors,
      });
    }
  } catch (err) {
    await prisma.searchRun.update({
      where: { runId: BigInt(runId) },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMsg: (err as Error).message,
      },
    });
    if (!campaignOwned) broadcastToClients(run.brandId, 'listening_search_failed', { run_id: runId, error: (err as Error).message });
  }
}

export async function startListeningSearch(input: KeywordSearchInput): Promise<number> {
  const runId = await createSearchRun(input);
  void runListeningSearch(runId);
  return runId;
}

export async function runRealtimeKeywordMonitoring(brandId?: number): Promise<{ groups: number; runs: number }> {
  const groups = await prisma.keywordGroup.findMany({
    where: {
      ...(brandId ? { brandId } : {}),
      source: 'listening',
      isActive: true,
      OR: [{ mode: 'realtime' }, { mode: 'both' }],
    },
    orderBy: { createdAt: 'asc' },
  });

  let runs = 0;
  for (const group of groups) {
    const keywords = sanitizeKeywords(group.keywords);
    const platforms = sanitizePlatforms(group.platforms as Platform[]);
    if (!keywords.length || !platforms.length) continue;

    const runId = await createSearchRun({
      brandId: group.brandId,
      groupId: Number(group.groupId),
      keywords,
      platforms,
      mode: 'realtime',
      dateFrom: group.dateFrom,
      dateTo: group.dateTo,
    });
    runs += 1;
    await runListeningSearch(runId);
  }

  return { groups: groups.length, runs };
}

export function mapSearchResultToClassifiedMessage(result: ClassifiedSearchItem): ClassifiedMessage {
  return {
    brand_id: result.brandId,
    platform: result.platform,
    kind: 'keyword_match',
    text: result.text,
    author_handle: result.authorHandle,
    author_id: result.authorIdExt,
    url: result.url,
    sentiment: result.sentiment,
    intent: result.intent,
    urgency_score: result.urgencyScore,
    topics: result.topics,
    raw: result.raw,
    metrics: {
      likes: result.likes,
      replies: result.repliesCount,
      shares: result.shares,
      views: result.views,
    },
  };
}

export function normalizeSearchMode(value: unknown): SearchMode | null {
  return value === 'realtime' || value === 'historical' ? value : null;
}
