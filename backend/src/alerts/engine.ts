// src/alerts/engine.ts — threshold detection → Alert rows (PRD Tool 1 & 9)
//
// Scans a brand's recent messages for three PRD alert conditions:
// sentiment drop, negative-volume spike, crisis-keyword spike. Raised alerts
// are persisted, broadcast over SSE, and (high/critical) emailed to the owner.
import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { broadcastToClients } from '../stream/eventQueue';
import { sendCrisisAlert } from '../utils/email';

const DEDUPE_WINDOW_MS = 6 * 3_600_000;

type AlertType = 'sentiment_drop' | 'negative_volume' | 'crisis_keyword';
type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertScanResult {
  brand_id: number;
  raised: number;
  types: string[];
}

async function notifyOwner(brandId: number, message: string, severity: Severity): Promise<void> {
  try {
    const brand = await prisma.brand.findUnique({
      where: { brandId },
      select: { name: true, ownerUserId: true },
    });
    if (!brand?.ownerUserId) return;
    const owner = await prisma.appUser.findUnique({
      where: { userId: brand.ownerUserId },
      select: { email: true },
    });
    if (owner?.email) await sendCrisisAlert(owner.email, brand.name, message, severity);
  } catch (err) {
    console.error(`[Alerts] crisis email failed for brand ${brandId}:`, (err as Error).message);
  }
}

/** Create an alert unless an open alert of the same type was raised recently. */
async function raiseAlert(
  brandId: number,
  type: AlertType,
  severity: Severity,
  title: string,
  message: string,
  metadata: Prisma.InputJsonValue,
): Promise<boolean> {
  const existing = await prisma.alert.findFirst({
    where: { brandId, type, status: 'open', createdAt: { gt: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
    select: { alertId: true },
  });
  if (existing) return false;

  const alert = await prisma.alert.create({
    data: { brandId, type, severity, title, message, metadata },
  });
  broadcastToClients(brandId, 'alert_raised', {
    alert_id: Number(alert.alertId), type, severity, title, message,
  });
  if (severity === 'critical' || severity === 'high') {
    await notifyOwner(brandId, message, severity);
  }
  return true;
}

export async function scanBrandAlerts(brandId: number): Promise<AlertScanResult> {
  const now = Date.now();
  const lastHour = new Date(now - 3_600_000);
  const last6h = new Date(now - 6 * 3_600_000);
  const last24h = new Date(now - 24 * 3_600_000);

  const messages = await prisma.socialMessage.findMany({
    where: { brandId, capturedAt: { gt: last24h } },
    select: { sentiment: true, text: true, capturedAt: true },
  });

  const result: AlertScanResult = { brand_id: brandId, raised: 0, types: [] };
  if (messages.length === 0) return result;

  const track = (raised: boolean, type: string): void => {
    if (raised) { result.raised += 1; result.types.push(type); }
  };

  // 1. Negative-volume spike — negatives in the last hour vs the prior-hours average.
  const negLastHour = messages.filter(m => m.capturedAt > lastHour && m.sentiment === 'negative').length;
  const negPrior = messages.filter(m => m.capturedAt <= lastHour && m.sentiment === 'negative').length;
  const priorHourlyAvg = negPrior / 23;
  if (negLastHour >= 5 && negLastHour > Math.max(2, priorHourlyAvg) * 2) {
    track(
      await raiseAlert(brandId, 'negative_volume', 'high',
        'Negative mention volume spike',
        `${negLastHour} negative mentions in the last hour — well above the recent hourly average.`,
        { negative_last_hour: negLastHour, prior_hourly_avg: Number(priorHourlyAvg.toFixed(2)) }),
      'negative_volume');
  }

  // 2. Sentiment drop — negative share in the last 6h vs the prior baseline.
  const recent = messages.filter(m => m.capturedAt > last6h);
  const baseline = messages.filter(m => m.capturedAt <= last6h);
  const recentNegRatio = recent.length
    ? recent.filter(m => m.sentiment === 'negative').length / recent.length : 0;
  const baseNegRatio = baseline.length
    ? baseline.filter(m => m.sentiment === 'negative').length / baseline.length : 0;
  if (recent.length >= 8 && recentNegRatio > 0.35 && recentNegRatio > baseNegRatio + 0.15) {
    track(
      await raiseAlert(brandId, 'sentiment_drop', 'high',
        'Sentiment drop detected',
        `Negative sentiment is ${Math.round(recentNegRatio * 100)}% of recent mentions, up from ${Math.round(baseNegRatio * 100)}%.`,
        { recent_neg_ratio: Number(recentNegRatio.toFixed(2)), baseline_neg_ratio: Number(baseNegRatio.toFixed(2)) }),
      'sentiment_drop');
  }

  // 3. Crisis-keyword spike — watchlist keyword hits in the last 6h.
  const brand = await prisma.brand.findUnique({
    where: { brandId },
    select: { watchlistKeywords: true },
  });
  const keywords = (brand?.watchlistKeywords ?? []).filter(k => k.trim());
  if (keywords.length) {
    const hits = recent.filter(m =>
      keywords.some(k => (m.text ?? '').toLowerCase().includes(k.toLowerCase())));
    if (hits.length >= 3) {
      const matched = keywords.filter(k =>
        hits.some(m => (m.text ?? '').toLowerCase().includes(k.toLowerCase())));
      track(
        await raiseAlert(brandId, 'crisis_keyword', 'critical',
          'Crisis keyword spike',
          `${hits.length} recent mentions contain watchlist keywords: ${matched.join(', ')}.`,
          { hit_count: hits.length, matched_keywords: matched }),
        'crisis_keyword');
    }
  }

  return result;
}

/** Scan every brand — used by the recurring ALERTS_SCAN job / scheduler. */
export async function scanAllBrandAlerts(): Promise<void> {
  const brands = await prisma.brand.findMany({ select: { brandId: true } });
  for (const b of brands) {
    try {
      await scanBrandAlerts(b.brandId);
    } catch (err) {
      console.error(`[Alerts] scan failed for brand ${b.brandId}:`, (err as Error).message);
    }
  }
}
