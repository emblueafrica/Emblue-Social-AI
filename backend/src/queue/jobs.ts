// src/queue/jobs.ts — BullMQ production job queue
// Activate by setting REDIS_URL in .env (Upstash Redis)
// Falls back gracefully to setInterval scheduler if Redis not configured

import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { runAgent2 } from "../agents/agent2_clustering";
import { runAgent3 } from "../agents/agent3_content_strategist";
import { runAgent6 } from "../agents/agents567";
import { runAgent10, runAgent11 } from "../agents/agents9_to_14";
import {
  persistAgent2Result, persistAgent3Result, insertKpiSnapshot,
  persistAgent10Result, insertWarRoomSnapshot, getRecentMessages,
  getTopClusters, getBrandById, persistAgent1Result,
} from "../db/queries";
import { syncAllPlatforms } from "../auth/platformSync";
import { runActiveFunnels } from "../stream/funnelRunner";
import { scanBrandAlerts } from "../alerts/engine";
import { broadcastToClients } from "../stream/eventQueue";
import { Platform } from "../types";
import { hasToolAccess } from "../tools/access";
import { ToolId } from "../tools/registry";
import { CampaignDeliveryJobData, processCampaignDeliveryJob } from '../campaigns/deliveryWorker';
import { CampaignDeliveryChannel, buildCampaignDeliveryJobId } from '../campaigns/unified';

export const JOB = {
  PLATFORM_SYNC:    "platform_sync",
  CLUSTERING:       "clustering",
  CONTENT_STRATEGY: "content_strategy",
  KPI_SNAPSHOT:     "kpi_snapshot",
  COMMENT_MINING:   "comment_mining",
  WAR_ROOM:         "war_room",
  FUNNEL_RUN:       "funnel_run",
  ALERTS_SCAN:      "alerts_scan",
  CAMPAIGN_DELIVERY: "campaign_delivery",
} as const;

type JobName = typeof JOB[keyof typeof JOB];
interface JobData { brand_id: number; [k: string]: unknown }

let connection: IORedis | null = null;
let mainQueue:  Queue | null   = null;
let bullWorker: Worker | null  = null;
let bullEnabled = false;

export function isBullEnabled(): boolean { return bullEnabled; }

async function canProcessTool(brandId: number, toolId: ToolId, jobName: string): Promise<boolean> {
  const enabled = await hasToolAccess(brandId, toolId);
  if (!enabled) console.log(`[BullMQ] skipped ${jobName} for brand ${brandId}: ${toolId} not enabled`);
  return enabled;
}

export async function initBullQueue(): Promise<boolean> {
  if (!process.env.REDIS_URL) {
    console.log("[BullMQ] No REDIS_URL — using setInterval scheduler");
    return false;
  }
  try {
    connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    await connection.connect();
    mainQueue  = new Queue<JobData>("se-ai-jobs", { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50, attempts: 3, backoff: { type: "exponential", delay: 5000 } } });
    bullWorker = new Worker<JobData>("se-ai-jobs", processJob, { connection });
    bullWorker.on("completed", (j: Job<JobData>) => console.log(`[BullMQ] ${j.name} done for brand ${j.data.brand_id}`));
    bullWorker.on("failed",    (j: Job<JobData> | undefined, e: Error) => console.error(`[BullMQ] ${j?.name} failed:`, e.message));
    bullEnabled = true;
    return true;
  } catch (err) {
    console.warn("[BullMQ] Init failed — falling back to scheduler:", (err as Error).message);
    return false;
  }
}

async function processJob(job: Job<JobData>): Promise<void> {
  const { brand_id } = job.data;
  switch (job.name as JobName) {
    case JOB.PLATFORM_SYNC: {
      if (!(await canProcessTool(brand_id, "tool_1", JOB.PLATFORM_SYNC))) break;
      const r = await syncAllPlatforms(brand_id);
      await persistAgent1Result(brand_id, { classified: r.items ?? [] });
      broadcastToClients(brand_id, "sync_complete", { brand_id, total: r.total_items });
      break;
    }
    case JOB.CLUSTERING: {
      if (!(await canProcessTool(brand_id, "tool_2", JOB.CLUSTERING))) break;
      const msgs = await getRecentMessages(brand_id, 200);
      if (msgs.length < 3) break;
      const r = await runAgent2({ brand_id, items: msgs.map(m => ({ text: m.text, platform: m.platform, kind: m.kind ?? "comment", captured_at: m.captured_at })), time_window_days: 7, min_items_per_cluster: 3 });
      if (!r.insufficient_data) await persistAgent2Result(brand_id, r);
      break;
    }
    case JOB.CONTENT_STRATEGY: {
      if (!(await canProcessTool(brand_id, "tool_2", JOB.CONTENT_STRATEGY))) break;
      const clusters = await getTopClusters(brand_id, 3);
      const brand    = await getBrandById(brand_id);
      if (!clusters.length) break;
      const r = await runAgent3({ brand_id, clusters, platforms_target: ["instagram","x","tiktok"], campaign_context: { objective: brand?.campaign_objective ?? "brand awareness" }, ruleset: { tone: brand?.tone ?? "professional" } });
      if (!r.error) await persistAgent3Result(brand_id, r);
      break;
    }
    case JOB.KPI_SNAPSHOT: {
      if (!(await canProcessTool(brand_id, "tool_5", JOB.KPI_SNAPSHOT))) break;
      const today = new Date().toISOString().slice(0, 10);
      const week  = new Date(Date.now() - 7*86400000).toISOString().slice(0, 10);
      const platforms: Platform[] = ["x","instagram","facebook","tiktok"];
      const r = await runAgent6({ brand_id, date_from: week, date_to: today, platforms });
      if (!r.error) await insertKpiSnapshot(brand_id, r, platforms);
      break;
    }
    case JOB.COMMENT_MINING: {
      if (!(await canProcessTool(brand_id, "tool_8", JOB.COMMENT_MINING))) break;
      const msgs  = await getRecentMessages(brand_id, 500);
      const brand = await getBrandById(brand_id);
      if (msgs.length < 10) break;
      const r = await runAgent10({ brand_id, comments: msgs.map(m => ({ platform: m.platform, author: m.author_handle ?? "", text: m.text })), brand_context: brand?.name ?? "Brand" });
      if (!r.error) await persistAgent10Result(brand_id, r);
      break;
    }
    case JOB.WAR_ROOM: {
      if (!(await canProcessTool(brand_id, "tool_9", JOB.WAR_ROOM))) break;
      const msgs  = await getRecentMessages(brand_id, 50);
      const brand = await getBrandById(brand_id);
      const r = await runAgent11({ brand_id, war_room_id: 1, live_messages: msgs, watchlist_keywords: brand?.watchlist_keywords ?? [], current_metrics: {} });
      if (!r.error) await insertWarRoomSnapshot(1, brand_id, r);
      broadcastToClients(brand_id, "warroom_update", { health: r.campaign_health, alerts: r.alerts?.length ?? 0 });
      break;
    }
    case JOB.FUNNEL_RUN: {
      if (!(await canProcessTool(brand_id, "tool_4", JOB.FUNNEL_RUN))) break;
      await runActiveFunnels(brand_id);
      break;
    }
    case JOB.ALERTS_SCAN: {
      if (!(await canProcessTool(brand_id, "tool_1", JOB.ALERTS_SCAN))) break;
      await scanBrandAlerts(brand_id);
      break;
    }
    case JOB.CAMPAIGN_DELIVERY: {
      if (!(await canProcessTool(brand_id, "tool_10", JOB.CAMPAIGN_DELIVERY))) break;
      const delivery = job.data as unknown as CampaignDeliveryJobData;
      const result = await processCampaignDeliveryJob(delivery);
      if (result.fallback_to_public) {
        await enqueueCampaignDelivery({ ...delivery, channel: 'public_reply' }, 0);
      }
      broadcastToClients(brand_id, 'campaign_delivery_update', {
        campaign_id: delivery.campaign_id,
        engager_id: delivery.engager_id,
        channel: delivery.channel,
        status: result.status,
        error: result.error,
      });
      break;
    }
    default: console.warn("[BullMQ] Unknown job:", job.name);
  }
}

export async function enqueueJob(jobName: JobName, brandId: number, delay = 0): Promise<void> {
  if (!mainQueue || !bullEnabled) return;
  await mainQueue.add(jobName, { brand_id: brandId }, { delay, jobId: `${jobName}_${brandId}_${Date.now()}` });
}

export async function enqueueCampaignDelivery(
  data: CampaignDeliveryJobData,
  delay = 0,
): Promise<boolean> {
  if (!mainQueue || !bullEnabled) return false;
  const jobId = buildCampaignDeliveryJobId(data.campaign_id, data.engager_id, data.channel as CampaignDeliveryChannel);
  await mainQueue.add(JOB.CAMPAIGN_DELIVERY, data, {
    delay,
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  return true;
}

export async function scheduleRecurringJobs(brandId: number): Promise<void> {
  if (!mainQueue || !bullEnabled) return;
  const repeatables = await mainQueue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.id?.includes(String(brandId))) await mainQueue.removeRepeatableByKey(job.key);
  }
  const jobs: { name: JobName; every: number }[] = [
    { name: JOB.ALERTS_SCAN,      every: 2*60*1000 },
    { name: JOB.PLATFORM_SYNC,    every: 5*60*1000 },
    { name: JOB.CLUSTERING,       every: 15*60*1000 },
    { name: JOB.FUNNEL_RUN,       every: 15*60*1000 },
    { name: JOB.WAR_ROOM,         every: 30*60*1000 },
    { name: JOB.CONTENT_STRATEGY, every: 60*60*1000 },
    { name: JOB.KPI_SNAPSHOT,     every: 60*60*1000 },
    { name: JOB.COMMENT_MINING,   every: 24*60*60*1000 },
  ];
  for (const { name, every } of jobs) {
    await mainQueue.add(name, { brand_id: brandId }, { repeat: { every }, jobId: `${name}_${brandId}` });
  }
  console.log(`[BullMQ] Recurring jobs scheduled for brand ${brandId}`);
}

export async function getQueueStats(): Promise<{ waiting: number; active: number; failed: number; completed: number }> {
  if (!mainQueue) return { waiting: 0, active: 0, failed: 0, completed: 0 };
  const [waiting, active, failed, completed] = await Promise.all([mainQueue.getWaitingCount(), mainQueue.getActiveCount(), mainQueue.getFailedCount(), mainQueue.getCompletedCount()]);
  return { waiting, active, failed, completed };
}

export async function shutdownQueue(): Promise<void> {
  await bullWorker?.close();
  await mainQueue?.close();
  await connection?.quit();
  console.log("[BullMQ] Shut down");
}
