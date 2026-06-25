import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { runAgent14 } from '../agents/agents9_to_14';
import { createSearchRun, runListeningSearch } from '../listening/searchService';
import { mapEngageCampaign } from '../db/mappers';
import { buildCampaignReplyDraft } from '../stream/engageEngagers';
import { broadcastToClients } from '../stream/eventQueue';
import { Intent, Platform } from '../types';
import { evaluateKeywordCampaignEvent } from './lifecycle';

export type KeywordCampaignSyncResult = {
  checked: number;
  fetched: number;
  captured: number;
  sent: number;
  queued: number;
  review: number;
  ignored: number;
  failed: number;
  manual: number;
  errors: string[];
  platforms: Array<{ platform: Platform; checked: number; fetched: number; new: number; sent: number; queued: number; review: number; ignored: number; failed: number; manual: number; last_sync_time: string; error?: string }>;
};

function rawRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function externalEventId(platform: Platform, url: string | null, raw: Record<string, unknown>, author: string | null, text: string): string {
  const native = stringValue(raw['tweetId'] ?? raw['tweet_id'] ?? raw['commentId'] ?? raw['comment_id'] ?? raw['id']);
  if (native) return native;
  if (url) return createHash('sha256').update(`${platform}:${url}`).digest('hex');
  return createHash('sha256').update(`${platform}:${author ?? ''}:${text}`).digest('hex');
}

function eventIds(platform: Platform, url: string | null, raw: Record<string, unknown>, fallback: string) {
  const id = stringValue(raw['tweetId'] ?? raw['tweet_id'] ?? raw['commentId'] ?? raw['comment_id'] ?? raw['id']) ?? fallback;
  const postId = stringValue(raw['postId'] ?? raw['post_id'] ?? raw['mediaId'] ?? raw['media_id'] ?? raw['videoId'] ?? raw['video_id']);
  return { commentId: id, tweetId: platform === 'x' ? id : null, postId, url };
}

function emptyResult(): KeywordCampaignSyncResult {
  return { checked: 0, fetched: 0, captured: 0, sent: 0, queued: 0, review: 0, ignored: 0, failed: 0, manual: 0, errors: [], platforms: [] };
}

export async function syncKeywordCampaigns(brandId: number, selectedCampaignId?: number): Promise<KeywordCampaignSyncResult> {
  const groups = await prisma.keywordGroup.findMany({
    where: { brandId, source: 'campaign', isActive: true, ...(selectedCampaignId ? { campaignId: BigInt(selectedCampaignId) } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  const totals = emptyResult();

  for (const group of groups) {
    if (!group.campaignId) continue;
    const campaign = await prisma.engageCampaign.findFirst({ where: { brandId, campaignId: group.campaignId, isActive: true, sourceMode: 'keyword' } });
    if (!campaign) continue;
    const config = mapEngageCampaign(campaign);
    totals.checked += 1;
    const campaignId = Number(campaign.campaignId);
    const runId = await createSearchRun({ brandId, groupId: Number(group.groupId), keywords: group.keywords, platforms: group.platforms as Platform[], mode: 'realtime' });
    await runListeningSearch(runId);
    const run = await prisma.searchRun.findUnique({ where: { runId: BigInt(runId) } });
    if (run?.status === 'failed') {
      totals.errors.push(run.errorMsg ?? `Keyword search ${runId} failed.`);
      totals.failed += 1;
      continue;
    }
    const results = await prisma.searchResult.findMany({ where: { runId: BigInt(runId) }, orderBy: { createdAt: 'asc' } });
    totals.fetched += results.length;

    for (const platform of group.platforms as Platform[]) {
      const syncedAt = new Date().toISOString();
      const platformResults = results.filter(item => item.platform === platform);
      const platformSummary = { platform, checked: 1, fetched: platformResults.length, new: 0, sent: 0, queued: 0, review: 0, ignored: 0, failed: 0, manual: 0, last_sync_time: syncedAt };
      for (const item of platformResults) {
        const raw = rawRecord(item.raw);
        const externalId = externalEventId(platform, item.url, raw, item.authorIdExt ?? item.authorHandle, item.text);
        const ids = eventIds(platform, item.url, raw, externalId);
        const preStatus = evaluateKeywordCampaignEvent({
          text: item.text,
          intent: (item.intent ?? 'neutral') as Intent,
          urgency: item.urgencyScore ?? 1,
          confidence: 100,
        }, {
          keywords: campaign.keywords,
          intents: campaign.intentFilter as Intent[],
          urgencyThreshold: campaign.urgencyThreshold,
          confidenceThreshold: campaign.autoFireThreshold ?? 75,
        });
        let profile: Awaited<ReturnType<typeof runAgent14>> | null = null;
        try {
          profile = await runAgent14({
            brand_id: brandId,
            user: { handle: item.authorHandle ?? item.authorIdExt ?? 'unknown', id: item.authorIdExt, platform, text: item.text },
          });
        } catch { profile = null; }
        const profileStatus = !profile ? 'needs_review'
          : profile.classification === 'bot' || profile.risk_level === 'high' ? 'bot_blocked'
            : null;
        const initialStatus = profileStatus ?? preStatus ?? 'pending';
        const createdEngagement = await prisma.campaignPostEngager.create({
          data: {
            brandId,
            campaignId: String(campaignId),
            platform,
            action: 'commented',
            authorId: externalId,
            platformAuthorId: item.authorIdExt,
            externalEventId: externalId,
            commentId: ids.commentId,
            postId: ids.postId,
            authorHandle: item.authorHandle,
            originalText: item.text,
            source: 'keyword',
            intent: item.intent,
            urgencyScore: item.urgencyScore,
            status: initialStatus,
            profileClassification: profile?.classification ?? null,
            profileFollowerCount: profile?.follower_count ?? null,
            profileStatus: profile ? 'classified' : 'unknown',
          },
        }).catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
          throw error;
        });
        const engagement = createdEngagement ?? await prisma.campaignPostEngager.findFirst({
          where: { brandId, campaignId: String(campaignId), platform, externalEventId: externalId },
        });
        if (!engagement) continue;
        const canReprocessExisting = !createdEngagement && ['ignored_keyword', 'ignored_intent', 'ignored_urgency', 'needs_review'].includes(engagement.status ?? '');
        if (!createdEngagement && !canReprocessExisting) continue;
        if (createdEngagement) {
          totals.captured += 1;
          platformSummary.new += 1;
        }
        if (initialStatus.startsWith('ignored_')) {
          if (!createdEngagement && engagement.status !== initialStatus) {
            await prisma.campaignPostEngager.update({
              where: { engagerId: engagement.engagerId },
              data: {
                status: initialStatus,
                intent: item.intent,
                urgencyScore: item.urgencyScore,
                updatedAt: new Date(),
              },
            });
          }
          totals.ignored += 1;
          platformSummary.ignored += 1;
          continue;
        }
        if (initialStatus === 'bot_blocked') {
          if (!createdEngagement && engagement.status !== 'bot_blocked') {
            await prisma.campaignPostEngager.update({
              where: { engagerId: engagement.engagerId },
              data: { status: 'bot_blocked', updatedAt: new Date() },
            });
          }
          totals.review += 1;
          platformSummary.review += 1;
          continue;
        }
        const draft = await buildCampaignReplyDraft(brandId, {
          platform,
          author_handle: item.authorHandle ?? item.authorIdExt ?? 'customer',
          author_id: item.authorIdExt,
          comment_id: ids.commentId,
          post_id: ids.postId,
          tweet_id: ids.tweetId,
          text: item.text,
          action: 'commented',
          matched_keyword: item.matchedKeyword ?? undefined,
        }, config);
        await prisma.campaignPostEngager.update({
          where: { engagerId: engagement.engagerId },
          data: { replyText: draft.reply, replyConfidence: draft.confidence, updatedAt: new Date() },
        });
        // Keyword campaign matches are reviewed in AI Reply Engine before any platform action is sent.
        await prisma.campaignPostEngager.update({
          where: { engagerId: engagement.engagerId },
          data: { status: 'needs_review', processedAt: new Date(), updatedAt: new Date() },
        });
        totals.review += 1;
        platformSummary.review += 1;
      }
      totals.platforms.push(platformSummary);
    }
  }

  if (totals.checked) broadcastToClients(brandId, 'campaign_keyword_sync_complete', totals);
  return totals;
}
