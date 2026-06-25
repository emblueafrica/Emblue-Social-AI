import { Intent, Platform, Sentiment } from '../types';

export type KeywordGroupMode = 'realtime' | 'historical' | 'both';
export type SearchMode = 'realtime' | 'historical';
export type SearchRunStatus = 'pending' | 'running' | 'complete' | 'failed';
export type VolumeGranularity = 'day' | 'week' | 'month';

export interface KeywordSearchInput {
  brandId: number;
  keywords: string[];
  platforms: Platform[];
  mode: SearchMode;
  groupId?: number | null;
  dateFrom?: string | Date | null;
  dateTo?: string | Date | null;
  maxItemsPerPlatform?: number;
}

export interface NormalizedSearchItem {
  platform: Platform;
  matchedKeyword: string;
  text: string;
  authorHandle: string | null;
  authorIdExt: string | null;
  url: string | null;
  postedAt: Date | null;
  likes: number;
  repliesCount: number;
  shares: number;
  views: number;
  raw: Record<string, unknown>;
}

export interface ClassifiedSearchItem extends NormalizedSearchItem {
  brandId: number;
  sentiment: Sentiment;
  intent: Intent;
  urgencyScore: number;
  topics: string[];
}

export interface KeywordSearchResult {
  items: NormalizedSearchItem[];
  errors: string[];
  rejected?: Array<{
    platform: Platform;
    keyword: string;
    reason: string;
    text: string;
    url: string | null;
  }>;
}

export interface VolumeBucket {
  periodStart: Date;
  periodEnd: Date;
  periodType: VolumeGranularity;
  mentionCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
}

export interface VolumeBuildResult {
  buckets: VolumeBucket[];
  peakDate: Date | null;
  peakCount: number;
}
