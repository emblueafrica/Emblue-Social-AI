import { createHmac, timingSafeEqual } from 'node:crypto';
import { CampaignPlatform } from './lifecycle';
import { Intent } from '../types';

export type CampaignMode = 'live' | 'post_url' | 'keyword';
export type LiveScopeType = 'all_owned_posts' | 'selected_posts';
export type CampaignDeliveryChannel = 'public_reply' | 'direct_message';

export type LiveCampaignCandidate = {
  campaignId: number;
  priority: number;
  platforms: CampaignPlatform[];
  scopeType: LiveScopeType;
  selectedPostIds?: string[];
  keywords: string[];
  intentFilter: Intent[];
  createdAt: Date;
};

export type LiveCampaignEvent = {
  platform: CampaignPlatform;
  postId: string | null;
  text: string;
  intent: Intent;
};

export function campaignModeFromSource(sourceMode: string | null | undefined): CampaignMode {
  return sourceMode === 'keyword' ? 'keyword' : 'post_url';
}

function normalized(values: string[]): string[] {
  return values.map(value => value.trim().toLowerCase()).filter(Boolean);
}

function matches(candidate: LiveCampaignCandidate, event: LiveCampaignEvent): boolean {
  if (!candidate.platforms.includes(event.platform)) return false;
  if (candidate.scopeType === 'selected_posts') {
    if (!event.postId || !(candidate.selectedPostIds ?? []).includes(event.postId)) return false;
  }
  const keywords = normalized(candidate.keywords);
  const text = event.text.toLowerCase();
  if (keywords.length && !keywords.some(keyword => text.includes(keyword))) return false;
  if (candidate.intentFilter.length && !candidate.intentFilter.includes(event.intent)) return false;
  return true;
}

function specificity(candidate: LiveCampaignCandidate): number {
  return (candidate.scopeType === 'selected_posts' ? 1000 : 0)
    + candidate.keywords.length * 10
    + candidate.intentFilter.length;
}

export function selectLiveCampaign(
  candidates: LiveCampaignCandidate[],
  event: LiveCampaignEvent,
): LiveCampaignCandidate | null {
  const eligible = candidates.filter(candidate => matches(candidate, event));
  eligible.sort((a, b) => b.priority - a.priority
    || specificity(b) - specificity(a)
    || a.createdAt.getTime() - b.createdAt.getTime()
    || a.campaignId - b.campaignId);
  return eligible[0] ?? null;
}

export function buildCampaignDeliveryJobId(
  campaignId: number,
  engagerId: number,
  channel: CampaignDeliveryChannel,
): string {
  return `campaign:${campaignId}:${engagerId}:${channel}`;
}

export function isPreviewFresh(fetchedAt: Date, now = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() <= 15 * 60 * 1000;
}

export function verifyMetaWebhookSignature(
  body: Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!signature?.startsWith('sha256=') || !appSecret) return false;
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
