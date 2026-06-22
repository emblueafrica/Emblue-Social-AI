// src/automation/scheduler.ts
import { getAllActiveBrandIds, getBrandById, getRecentMessages, getTopClusters } from '../db/queries';
import { persistAgent1Result, persistAgent2Result, persistAgent3Result,
         insertKpiSnapshot, persistAgent10Result, insertWarRoomSnapshot } from '../db/queries';
import { runAgent2 } from '../agents/agent2_clustering';
import { runAgent3 } from '../agents/agent3_content_strategist';
import { runAgent6 } from '../agents/agents567';
import { runAgent10, runAgent11 } from '../agents/agents9_to_14';
import { syncAllPlatforms } from '../auth/platformSync';
import { runActiveFunnels } from '../stream/funnelRunner';
import { scanBrandAlerts } from '../alerts/engine';
import { runRealtimeKeywordMonitoring } from '../listening/searchService';
import { syncTrackedCampaignEngagements } from '../campaigns/engagementSync';
import { syncKeywordCampaigns } from '../campaigns/keywordCampaignSync';
import { withSchedulerLease } from './schedulerLease';
import { broadcastToClients } from '../stream/eventQueue';
import { hasToolAccess } from '../tools/access';
import { ToolId } from '../tools/registry';

// Track active intervals per brand
const intervals = new Map<number, NodeJS.Timeout[]>();

function campaignEngagementSyncIntervalMs(): number {
  const parsed = Number(process.env.CAMPAIGN_ENGAGEMENT_SYNC_INTERVAL_MS ?? process.env.X_CAMPAIGN_SYNC_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 60_000;
}

function campaignKeywordSyncIntervalMs(): number {
  const parsed = Number(process.env.CAMPAIGN_KEYWORD_SYNC_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 300_000 ? parsed : 300_000;
}

async function canRunTool(brandId: number, toolId: ToolId, jobName: string): Promise<boolean> {
  const enabled = await hasToolAccess(brandId, toolId);
  if (!enabled) {
    console.log(`[Scheduler] skipped ${jobName} for brand ${brandId}: ${toolId} not enabled`);
  }
  return enabled;
}

async function runSync(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_1', 'platform sync'))) return;
    const result = await syncAllPlatforms(brandId);
    await persistAgent1Result(brandId, { classified: result.items ?? [] });
    broadcastToClients(brandId, 'sync_complete', { brand_id: brandId, total: result.total_items });
    console.log(`[Scheduler] sync brand ${brandId}: ${result.total_items} items`);
  } catch (err) {
    console.error(`[Scheduler] sync error brand ${brandId}:`, (err as Error).message);
  }
}

async function runListening(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_1', 'listening'))) return;
    const result = await runRealtimeKeywordMonitoring(brandId);
    if (result.runs > 0) {
      broadcastToClients(brandId, 'listening_monitoring_complete', result);
    }
    console.log(`[Scheduler] listening brand ${brandId}: ${result.runs} runs from ${result.groups} groups`);
  } catch (err) {
    console.error(`[Scheduler] listening error brand ${brandId}:`, (err as Error).message);
  }
}

async function runCluster(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_2', 'clustering'))) return;
    const messages = await getRecentMessages(brandId, 200);
    if (messages.length < 3) return;

    const result = await runAgent2({
      brand_id:              brandId,
      items:                 messages.map(m => ({ text: m.text, platform: m.platform, kind: m.kind ?? 'comment', captured_at: m.captured_at })),
      time_window_days:      7,
      min_items_per_cluster: 3,
    });

    if (!result.insufficient_data) {
      await persistAgent2Result(brandId, result);
    }
    console.log(`[Scheduler] cluster brand ${brandId}: ${result.clusters_created} clusters`);
  } catch (err) {
    console.error(`[Scheduler] cluster error brand ${brandId}:`, (err as Error).message);
  }
}

async function runStrategy(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_2', 'content strategy'))) return;
    const clusters = await getTopClusters(brandId, 3);
    if (!clusters.length) return;

    const brand = await getBrandById(brandId);
    const result = await runAgent3({
      brand_id:          brandId,
      clusters,
      platforms_target:  ['instagram', 'x', 'tiktok'],
      campaign_context:  { objective: brand?.campaign_objective ?? 'brand awareness' },
      ruleset:           { tone: brand?.tone ?? 'professional' },
    });

    if (!result.error) await persistAgent3Result(brandId, result);
  } catch (err) {
    console.error(`[Scheduler] strategy error brand ${brandId}:`, (err as Error).message);
  }
}

async function runKpi(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_5', 'kpi'))) return;
    const today = new Date().toISOString().slice(0, 10);
    const week  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const result = await runAgent6({
      brand_id:  brandId,
      date_from: week,
      date_to:   today,
      platforms: ['x', 'instagram', 'facebook', 'tiktok'],
    });
    if (!result.error) await insertKpiSnapshot(brandId, result, ['x', 'instagram', 'facebook', 'tiktok']);
  } catch (err) {
    console.error(`[Scheduler] kpi error brand ${brandId}:`, (err as Error).message);
  }
}

async function runMining(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_8', 'comment mining'))) return;
    const messages = await getRecentMessages(brandId, 500);
    if (messages.length < 10) return;

    const brand  = await getBrandById(brandId);
    const result = await runAgent10({
      brand_id:      brandId,
      comments:      messages.map(m => ({ platform: m.platform, author: m.author_handle ?? '', text: m.text })),
      brand_context: brand?.name ?? 'Brand',
    });
    if (!result.error) await persistAgent10Result(brandId, result);
  } catch (err) {
    console.error(`[Scheduler] mining error brand ${brandId}:`, (err as Error).message);
  }
}

async function runWarRoom(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_9', 'war room'))) return;
    const messages = await getRecentMessages(brandId, 50);
    const brand    = await getBrandById(brandId);
    const result   = await runAgent11({
      brand_id:           brandId,
      war_room_id:        1,
      live_messages:      messages,
      watchlist_keywords: brand?.watchlist_keywords ?? [],
      current_metrics:    {},
    });
    if (!result.error) await insertWarRoomSnapshot(1, brandId, result);
    broadcastToClients(brandId, 'warroom_update', {
      health:  result.campaign_health,
      alerts:  result.alerts?.length ?? 0,
    });
  } catch (err) {
    console.error(`[Scheduler] warroom error brand ${brandId}:`, (err as Error).message);
  }
}

async function runFunnels(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_4', 'funnels'))) return;
    await runActiveFunnels(brandId);
  } catch (err) {
    console.error(`[Scheduler] funnel error brand ${brandId}:`, (err as Error).message);
  }
}

async function runCampaignEngagementSync(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_10', 'campaign engagement sync'))) return;
    const leased = await withSchedulerLease(brandId, 'campaign_post_sync', campaignEngagementSyncIntervalMs() * 2, () => syncTrackedCampaignEngagements(brandId));
    if (!leased.acquired || !leased.value) {
      console.log(`[Scheduler] skipped overlapping campaign engagement sync for brand ${brandId}`);
      return;
    }
    const result = leased.value;
    if (result.checked > 0) {
      broadcastToClients(brandId, 'post_campaign_progress', {
        auto_sync: true,
        checked: result.checked,
        fetched: result.fetched,
        captured: result.captured,
        sent: result.sent,
        queued: result.queued,
        manual: result.manual,
        errors: result.errors.length,
      });
    }
    console.log(`[Scheduler] campaign engagement sync brand ${brandId}: checked ${result.checked}, captured ${result.captured}, sent ${result.sent}, queued ${result.queued}, manual ${result.manual}, errors ${result.errors.length}`);
  } catch (err) {
    console.error(`[Scheduler] campaign engagement sync error brand ${brandId}:`, (err as Error).message);
  }
}

async function runCampaignKeywordSync(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_10', 'campaign keyword sync'))) return;
    const leased = await withSchedulerLease(brandId, 'campaign_keyword_sync', 10 * 60 * 1000, () => syncKeywordCampaigns(brandId));
    if (!leased.acquired || !leased.value) {
      console.log(`[Scheduler] skipped overlapping campaign keyword sync for brand ${brandId}`);
      return;
    }
    const result = leased.value;
    console.log(`[Scheduler] campaign keyword sync brand ${brandId}: checked ${result.checked}, captured ${result.captured}, sent ${result.sent}, review ${result.review}, errors ${result.errors.length}`);
  } catch (err) {
    console.error(`[Scheduler] campaign keyword sync error brand ${brandId}:`, (err as Error).message);
  }
}

async function runAlerts(brandId: number): Promise<void> {
  try {
    if (!(await canRunTool(brandId, 'tool_1', 'alerts'))) return;
    await scanBrandAlerts(brandId);
  } catch (err) {
    console.error(`[Scheduler] alerts error brand ${brandId}:`, (err as Error).message);
  }
}

export function startAutomation(brandId: number): void {
  // Clear any existing intervals for this brand
  stopAutomation(brandId);

  const timers: NodeJS.Timeout[] = [
    setInterval(() => void runAlerts(brandId),    2 * 60 * 1000), // 2 min
    setInterval(() => void runCampaignEngagementSync(brandId), campaignEngagementSyncIntervalMs()),
    setInterval(() => void runCampaignKeywordSync(brandId), campaignKeywordSyncIntervalMs()),
    setInterval(() => void runSync(brandId),     5  * 60 * 1000), // 5 min
    setInterval(() => void runListening(brandId), 15 * 60 * 1000), // 15 min
    setInterval(() => void runCluster(brandId),  15 * 60 * 1000), // 15 min
    setInterval(() => void runFunnels(brandId),  15 * 60 * 1000), // 15 min
    setInterval(() => void runWarRoom(brandId),  30 * 60 * 1000), // 30 min
    setInterval(() => void runStrategy(brandId), 60 * 60 * 1000), // 1 hr
    setInterval(() => void runKpi(brandId),      60 * 60 * 1000), // 1 hr
    setInterval(() => void runMining(brandId),   24 * 60 * 60 * 1000), // 24 hr
  ];

  intervals.set(brandId, timers);
  console.log(`[Scheduler] Started automation for brand ${brandId}; campaign sync every ${campaignEngagementSyncIntervalMs()}ms`);

  // Run sync immediately on start
  void runSync(brandId);
  void runListening(brandId);
  void runCampaignEngagementSync(brandId);
  void runCampaignKeywordSync(brandId);
}

export function stopAutomation(brandId: number): void {
  const timers = intervals.get(brandId);
  if (timers) {
    timers.forEach(clearInterval);
    intervals.delete(brandId);
    console.log(`[Scheduler] Stopped automation for brand ${brandId}`);
  }
}

export function getAutomationStatus(brandId: number): { running: boolean } {
  return { running: intervals.has(brandId) };
}

export async function autoStartAll(): Promise<void> {
  try {
    const brandIds = await getAllActiveBrandIds();
    console.log(`[Scheduler] Auto-starting automation for ${brandIds.length} brands`);
    brandIds.forEach(startAutomation);
  } catch (err) {
    console.error('[Scheduler] autoStartAll error:', (err as Error).message);
  }
}
