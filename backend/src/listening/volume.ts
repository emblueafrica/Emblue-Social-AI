import { ClassifiedSearchItem, VolumeBuildResult, VolumeBucket, VolumeGranularity } from './types';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(day, mondayOffset);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function periodStartFor(date: Date, granularity: VolumeGranularity): Date {
  if (granularity === 'month') return startOfUtcMonth(date);
  if (granularity === 'week') return startOfUtcWeek(date);
  return startOfUtcDay(date);
}

function periodEndFor(start: Date, granularity: VolumeGranularity): Date {
  if (granularity === 'month') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  }
  if (granularity === 'week') return addDays(start, 6);
  return start;
}

function bucketKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function chooseGranularity(dateFrom?: Date | null, dateTo?: Date | null): VolumeGranularity {
  if (!dateFrom || !dateTo) return 'day';
  const days = Math.max(1, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / 86400000));
  if (days > 180) return 'month';
  if (days > 45) return 'week';
  return 'day';
}

export function buildVolumeChart(
  results: ClassifiedSearchItem[],
  granularity: VolumeGranularity = 'day'
): VolumeBuildResult {
  const buckets = new Map<string, VolumeBucket>();

  for (const result of results) {
    const postedAt = result.postedAt ?? new Date();
    const periodStart = periodStartFor(postedAt, granularity);
    const key = bucketKey(periodStart);
    const bucket = buckets.get(key) ?? {
      periodStart,
      periodEnd: periodEndFor(periodStart, granularity),
      periodType: granularity,
      mentionCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
    };

    bucket.mentionCount += 1;
    if (result.sentiment === 'positive') bucket.positiveCount += 1;
    else if (result.sentiment === 'negative') bucket.negativeCount += 1;
    else bucket.neutralCount += 1;
    buckets.set(key, bucket);
  }

  const ordered = Array.from(buckets.values()).sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  const peak = ordered.reduce<VolumeBucket | null>((best, bucket) => {
    if (!best || bucket.mentionCount > best.mentionCount) return bucket;
    return best;
  }, null);

  return {
    buckets: ordered,
    peakDate: peak?.periodStart ?? null,
    peakCount: peak?.mentionCount ?? 0,
  };
}
