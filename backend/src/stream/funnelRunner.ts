// src/stream/funnelRunner.ts — Comment → DM Funnel runner (PRD Tool 4)
//
// Scans recent comments/mentions for a brand, matches them against a funnel's
// keyword triggers, renders a DM from the funnel's template and records a
// DmEvent. Per the PRD MVP ("manual ingestion and copy-to-post, upgrading to
// API posting once approvals are ready") DMs are recorded as `queued` for
// operator send — listening data only carries hashed author ids, so automatic
// API delivery is a later upgrade once real recipient ids are available.
import prisma from '../db/prisma';
import { broadcastToClients } from './eventQueue';
import { fillVariables } from './engageEngagers';

const LOOKBACK_HOURS = 24;
const MAX_SCAN = 500;

export interface FunnelRunResult {
  funnel_id: number;
  scanned: number;
  matched: number;
  dms_created: number;
  skipped_throttle: number;
  skipped_duplicate: number;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some(k => k.trim() && lower.includes(k.toLowerCase()));
}

/** Find-or-create a tracked short link for the funnel so DM clicks are attributable. */
async function resolveTrackedLink(brandId: number, funnelId: bigint, destUrl: string): Promise<string> {
  if (!destUrl) return '';
  const campaign = `funnel:${funnelId}`;
  let link = await prisma.trackedLink.findFirst({ where: { brandId, campaign }, select: { shortCode: true } });
  if (!link) {
    const shortCode = `fnl${funnelId}${Math.random().toString(36).slice(2, 7)}`;
    link = await prisma.trackedLink.create({
      data: { brandId, shortCode, destUrl, campaign, contentType: 'dm_funnel' },
      select: { shortCode: true },
    });
  }
  const base = (process.env.LINK_BASE_URL ?? 'https://seai.link').replace(/\/+$/, '');
  return `${base}/${link.shortCode}`;
}

export async function runFunnel(funnelId: number): Promise<FunnelRunResult> {
  const funnel = await prisma.funnel.findUnique({ where: { funnelId: BigInt(funnelId) } });
  if (!funnel || !funnel.brandId) throw new Error('Funnel not found');
  const brandId = funnel.brandId;

  const result: FunnelRunResult = {
    funnel_id: funnelId, scanned: 0, matched: 0, dms_created: 0,
    skipped_throttle: 0, skipped_duplicate: 0,
  };

  // DM template: funnel-specific first, else a brand-level template.
  const template =
    (await prisma.dmTemplate.findFirst({
      where: { funnelId: BigInt(funnelId), isActive: true },
      orderBy: { createdAt: 'desc' },
    })) ??
    (await prisma.dmTemplate.findFirst({
      where: { brandId, funnelId: null, isActive: true },
      orderBy: { createdAt: 'desc' },
    }));

  // Throttle: respect maxPerHour across DMs created for this funnel in the last hour.
  const hourAgo = new Date(Date.now() - 3_600_000);
  const createdThisHour = await prisma.dmEvent.count({
    where: { funnelId: BigInt(funnelId), createdAt: { gt: hourAgo } },
  });
  let budget = Math.max(0, (funnel.maxPerHour ?? 20) - createdThisHour);

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000);
  const messages = await prisma.socialMessage.findMany({
    where: {
      brandId,
      capturedAt: { gt: since },
      ...(funnel.platform ? { platform: funnel.platform } : {}),
    },
    orderBy: { capturedAt: 'desc' },
    take: MAX_SCAN,
    select: { messageId: true, text: true, authorHandle: true },
  });
  result.scanned = messages.length;

  const trackedLink = await resolveTrackedLink(brandId, funnel.funnelId, funnel.destUrl ?? '');
  const templateBody = template?.body ?? 'Hi {{handle}}, thanks for engaging! {{link}}';

  for (const msg of messages) {
    if (!msg.authorHandle) continue;
    if (!matchesKeywords(msg.text ?? '', funnel.keywords)) continue;
    result.matched += 1;

    if (budget <= 0) { result.skipped_throttle += 1; continue; }

    // One DM per author per funnel.
    const duplicate = await prisma.dmEvent.findFirst({
      where: { funnelId: BigInt(funnelId), authorHandle: msg.authorHandle },
      select: { eventId: true },
    });
    if (duplicate) { result.skipped_duplicate += 1; continue; }

    const dmText = fillVariables(templateBody, {
      handle: `@${msg.authorHandle}`,
      link: trackedLink,
    });

    await prisma.dmEvent.create({
      data: {
        brandId,
        funnelId: BigInt(funnelId),
        messageId: msg.messageId,
        authorHandle: msg.authorHandle,
        status: 'queued',
        dmText,
      },
    });
    result.dms_created += 1;
    budget -= 1;
  }

  broadcastToClients(brandId, 'funnel_run_complete', result);
  return result;
}

/** Run every active funnel — used by the recurring scheduler/queue job. */
export async function runActiveFunnels(brandId: number): Promise<void> {
  const funnels = await prisma.funnel.findMany({
    where: { brandId, isActive: true },
    select: { funnelId: true },
  });
  for (const f of funnels) {
    try {
      await runFunnel(Number(f.funnelId));
    } catch (err) {
      console.error(`[Funnel] run failed for funnel ${f.funnelId}:`, (err as Error).message);
    }
  }
}
