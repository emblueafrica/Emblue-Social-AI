// src/db/queries.ts
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  Agent2Result, Agent3Result, Agent6Result, Agent10Result,
  Agent11Result, ApprovalQueueItem, ClassifiedMessage, Cluster,
  FaqItem, PainPoint, Platform,
} from '../types';

type DbSocialMessage = Prisma.SocialMessageGetPayload<Record<string, never>>;
type DbCluster = Prisma.ClusterGetPayload<Record<string, never>>;

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toJsonArray(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(Array.isArray(value) ? value : [])) as Prisma.InputJsonValue;
}

function mapSocialMessage(row: DbSocialMessage): ClassifiedMessage {
  return {
    message_id: Number(row.messageId),
    brand_id: row.brandId,
    platform: row.platform as Platform,
    kind: row.kind ?? 'comment',
    external_id: row.externalId ?? undefined,
    text: row.text,
    author_handle: row.authorHandle,
    author_id: row.authorIdHash,
    url: row.url,
    sentiment: row.sentiment ?? undefined,
    intent: row.intent ?? undefined,
    urgency_score: row.urgencyScore ?? undefined,
    topics: row.topics ?? [],
    metrics: row.rawMetrics as ClassifiedMessage['metrics'],
    raw: row.raw as Record<string, unknown>,
    captured_at: row.capturedAt,
  };
}

function mapCluster(row: DbCluster): Cluster {
  return {
    label: row.label,
    opportunity_score: row.opportunityScore ?? 0,
    message_count: row.messageCount ?? 0,
    top_phrases: row.topPhrases ?? [],
    recommendations: Array.isArray(row.recommendations)
      ? row.recommendations.map(String)
      : [],
  };
}

// ── MESSAGES ──────────────────────────────────────────────────────────────────

export async function insertClassifiedMessage(
  brandId: number,
  msg: ClassifiedMessage
): Promise<number | null> {
  try {
    const data = {
      brandId,
      platform: msg.platform as never,
      kind: msg.kind ?? 'comment',
      externalId: msg.external_id ?? msg.url ?? null,
      text: msg.text,
      authorHandle: msg.author_handle ?? null,
      authorIdHash: msg.author_id ?? null,
      url: msg.url ?? null,
      sentiment: msg.sentiment as never,
      intent: msg.intent as never,
      urgencyScore: msg.urgency_score ?? null,
      topics: msg.topics ?? [],
      rawMetrics: toJson(msg.metrics ?? {}),
      raw: toJson(msg.raw ?? {}),
    };

    const row = await prisma.socialMessage.create({ data });
    return Number(row.messageId);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null;
    }
    console.error('[DB] insertClassifiedMessage error:', (err as Error).message);
    return null;
  }
}

export async function getRecentMessages(
  brandId: number,
  limit = 200
): Promise<ClassifiedMessage[]> {
  const rows = await prisma.socialMessage.findMany({
    where: { brandId },
    orderBy: { capturedAt: 'desc' },
    take: limit,
  });
  return rows.map(mapSocialMessage);
}

export async function markMessageReplied(_messageId: number): Promise<void> {
  // The current schema does not include a replied column. Kept as a stable API.
}

// ── AGENT 1 PERSIST ───────────────────────────────────────────────────────────

export async function persistAgent1Result(
  brandId: number,
  result: { classified: ClassifiedMessage[] }
): Promise<void> {
  for (const msg of result.classified) {
    await insertClassifiedMessage(brandId, msg);
  }
}

// ── CLUSTERS ──────────────────────────────────────────────────────────────────

export async function persistAgent2Result(
  brandId: number,
  result: Agent2Result
): Promise<void> {
  for (const cluster of result.clusters) {
    await prisma.cluster.create({
      data: {
        brandId,
        label: cluster.label,
        opportunityScore: cluster.opportunity_score,
        messageCount: cluster.message_count,
        topPhrases: cluster.top_phrases ?? [],
        recommendations: toJsonArray(cluster.recommendations),
      },
    });
  }
}

export async function getTopClusters(
  brandId: number,
  limit = 3
): Promise<Cluster[]> {
  const rows = await prisma.cluster.findMany({
    where: { brandId },
    orderBy: { opportunityScore: 'desc' },
    take: limit,
  });
  return rows.map(mapCluster);
}

// ── CONTENT RECOMMENDATIONS ───────────────────────────────────────────────────

export async function persistAgent3Result(
  brandId: number,
  result: Agent3Result
): Promise<void> {
  for (const rec of result.recommendations ?? []) {
    await prisma.contentRecommendation.create({
      data: {
        brandId,
        platform: rec.platform as never,
        format: rec.format,
        headline: rec.headline,
        brief: rec.brief,
        status: rec.status ?? 'idea',
      },
    });
  }
}

// ── KPI SNAPSHOTS ─────────────────────────────────────────────────────────────

export async function insertKpiSnapshot(
  brandId: number,
  result: Agent6Result,
  _platforms: string[]
): Promise<void> {
  const today = new Date();
  const week = new Date(Date.now() - 7 * 86400000);

  await prisma.kpiSnapshot.create({
    data: {
      brandId,
      periodStart: week,
      periodEnd: today,
      listeningKpi: result.listening_kpi ?? 0,
      replyKpi: result.reply_kpi ?? 0,
      funnelKpi: result.funnel_kpi ?? 0,
      riskEvents: result.risk_events ?? 0,
      kpis: toJsonArray(result.kpis ?? []),
      alerts: toJsonArray(result.alerts ?? []),
    },
  });
}

// ── COMMENT INSIGHTS ──────────────────────────────────────────────────────────

export async function persistAgent10Result(
  brandId: number,
  result: Agent10Result
): Promise<void> {
  const run = await prisma.insightRun.create({
    data: {
      brandId,
      messagesProcessed: (result.faqs?.length ?? 0) + (result.pain_points?.length ?? 0),
      faqsFound: result.faqs?.length ?? 0,
      painPoints: result.pain_points?.length ?? 0,
      summary: result.summary ?? '',
    },
  });

  for (const faq of result.faqs ?? []) {
    await prisma.faqItem.create({
      data: {
        brandId,
        runId: run.runId,
        question: faq.question,
        frequency: faq.frequency,
        platforms: faq.platforms ?? [],
      },
    });
  }

  for (const pp of result.pain_points ?? []) {
    await prisma.painPoint.create({
      data: {
        brandId,
        runId: run.runId,
        text: pp.text,
        severity: pp.severity,
        frequency: pp.frequency,
      },
    });
  }
}

// ── WAR ROOM ──────────────────────────────────────────────────────────────────

export async function insertWarRoomSnapshot(
  roomId: number,
  brandId: number,
  result: Agent11Result
): Promise<void> {
  await prisma.warRoom.upsert({
    where: { roomId: BigInt(roomId) },
    update: {
      brandId,
      health: result.campaign_health,
      summary: result.summary ?? '',
      alerts: toJsonArray(result.alerts ?? []),
      metrics: toJson(result.metrics ?? {}),
    },
    create: {
      roomId: BigInt(roomId),
      brandId,
      health: result.campaign_health,
      summary: result.summary ?? '',
      alerts: toJsonArray(result.alerts ?? []),
      metrics: toJson(result.metrics ?? {}),
    },
  });
}

// ── APPROVAL QUEUE ────────────────────────────────────────────────────────────

export async function insertApprovalQueueItem(
  item: ApprovalQueueItem
): Promise<void> {
  await prisma.approvalQueue.create({
    data: {
      brandId: item.brand_id,
      platform: item.platform as never,
      authorHandle: item.author,
      originalText: item.original,
      replyText: item.reply,
      confidence: 80,
      status: 'pending',
    },
  });
}

// ── TRACKED LINKS ─────────────────────────────────────────────────────────────

export async function getTrackedLinkByCode(
  brandId: number,
  shortCode: string
): Promise<{ dest_url: string } | null> {
  const row = await prisma.trackedLink.findFirst({
    where: { brandId, shortCode },
    select: { destUrl: true },
  });
  return row ? { dest_url: row.destUrl } : null;
}

export async function incrementLinkClick(shortCode: string): Promise<void> {
  await prisma.trackedLink.updateMany({
    where: { shortCode },
    data: { clicks: { increment: 1 } },
  });
}

// ── BRANDS ────────────────────────────────────────────────────────────────────

export async function getAllActiveBrandIds(): Promise<number[]> {
  const [accounts, keywordGroups] = await Promise.all([
    prisma.connectedAccount.findMany({
      where: { isActive: true },
      select: { brandId: true },
      distinct: ['brandId'],
    }),
    prisma.keywordGroup.findMany({
      where: {
        isActive: true,
        OR: [{ mode: 'realtime' }, { mode: 'both' }],
      },
      select: { brandId: true },
      distinct: ['brandId'],
    }),
  ]);

  return Array.from(new Set([
    ...accounts.map(account => account.brandId),
    ...keywordGroups.map(group => group.brandId),
  ]));
}

export async function getBrandById(brandId: number): Promise<{
  brand_id: number;
  name: string;
  campaign_objective: string;
  tone: string;
  watchlist_keywords: string[];
} | null> {
  const row = await prisma.brand.findUnique({
    where: { brandId },
    select: {
      brandId: true,
      name: true,
      campaignObjective: true,
      tone: true,
      watchlistKeywords: true,
    },
  });

  if (!row) return null;
  return {
    brand_id: row.brandId,
    name: row.name,
    campaign_objective: row.campaignObjective ?? '',
    tone: row.tone ?? '',
    watchlist_keywords: row.watchlistKeywords ?? [],
  };
}

// ── CONNECTED ACCOUNTS ────────────────────────────────────────────────────────

export async function getConnectedAccount(
  brandId: number,
  platform: string
): Promise<{ access_token: string; account_id_ext: string } | null> {
  const row = await prisma.connectedAccount.findFirst({
    where: { brandId, platform: platform as never, isActive: true },
    select: { accessToken: true, accountIdExt: true },
  });

  return row
    ? { access_token: row.accessToken, account_id_ext: row.accountIdExt ?? '' }
    : null;
}

export async function upsertConnectedAccount(
  brandId: number,
  platform: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  handle: string,
  accountIdExt: string,
  scope: string
): Promise<void> {
  await prisma.connectedAccount.upsert({
    where: {
      brandId_platform: {
        brandId,
        platform: platform as never,
      },
    },
    update: {
      accessToken,
      refreshToken,
      tokenExpiresAt: expiresAt,
      accountHandle: handle,
      accountIdExt,
      scope,
      isActive: true,
      updatedAt: new Date(),
    },
    create: {
      brandId,
      platform: platform as never,
      accessToken,
      refreshToken,
      tokenExpiresAt: expiresAt,
      accountHandle: handle,
      accountIdExt,
      scope,
      isActive: true,
    },
  });
}

export type ConnectedAccountRecord = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  accountHandle: string | null;
  accountIdExt: string | null;
  scope: string | null;
};

/** Full token record for a connected account — used by the token-refresh path. */
export async function getConnectedAccountRecord(
  brandId: number,
  platform: string
): Promise<ConnectedAccountRecord | null> {
  return prisma.connectedAccount.findFirst({
    where: { brandId, platform: platform as never, isActive: true },
    select: {
      accessToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
      accountHandle: true,
      accountIdExt: true,
      scope: true,
    },
  });
}

/** Persist a freshly refreshed token without touching the rest of the record. */
export async function updateConnectedAccountTokens(
  brandId: number,
  platform: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null
): Promise<void> {
  await prisma.connectedAccount.updateMany({
    where: { brandId, platform: platform as never },
    data: { accessToken, refreshToken, tokenExpiresAt: expiresAt, updatedAt: new Date() },
  });
}
