// src/routes/campaigns.ts
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { mapEngageCampaign, toInputJson } from '../db/mappers';
import { engageEngager, fetchXPostEngagers, runPostUrlCampaign, extractPostId, fillVariables } from '../stream/engageEngagers';
import { publishReply } from '../stream/publisher';
import { getValidToken } from '../auth/platformAuth';
import { getConnectedAccountRecord } from '../db/queries';
import { runAgent4 } from '../agents/agent4_reply_assistant';
import { CampaignConfig, PostUrlItem, Credentials, Platform } from '../types';
import { canAccessBrandId, requireBrandAccess, requireBrandRole } from '../middleware/auth';
import { requireToolAccess } from '../middleware/toolAccess';
import {
  getRequiredBrandId,
  isHttpUrl,
  isPlatform,
  requireNonEmptyArray,
  sendServerError,
  sendValidationError,
  validateAllocationTotal,
} from '../utils/validation';

const router = Router();

const SOCIAL_RESPONSE_DAYS = 30;

function dayKey(date: Date | null | undefined): string {
  return (date ?? new Date()).toISOString().slice(0, 10);
}

function recentDayKeys(days: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    keys.push(dayKey(d));
  }
  return keys;
}

function dayLabel(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function severityFor(
  score: number | null | undefined,
  sentiment: string | null | undefined
): { severity: string; tag: string } {
  if ((score ?? 0) >= 5) return { severity: 'CRITICAL', tag: 'Urgent reply' };
  if ((score ?? 0) >= 4) return { severity: 'HIGH', tag: 'Priority reply' };
  if (sentiment === 'negative') return { severity: 'HIGH', tag: 'Negative sentiment' };
  return { severity: 'MEDIUM', tag: 'Needs review' };
}

function hasScope(scope: string | null | undefined, required: string): boolean {
  return String(scope ?? '')
    .split(/[,\s]+/)
    .map(item => item.trim())
    .includes(required);
}

function extractXStatusId(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  return extractPostId('x', url.trim());
}

function xStatusUrl(tweetId: string): string {
  return `https://x.com/i/web/status/${tweetId}`;
}

async function generateXReplyDraft(brandId: number, text: string, authorHandle?: string | null): Promise<{
  text: string;
  tone: string | null;
  confidence: number;
  riskFlags: unknown[];
}> {
  const result = await runAgent4({
    brand_id: brandId,
    message: text,
    platform: 'x',
    tone: 'warm and professional',
    campaign_context: {
      objective: 'respond to inbound replies on an X campaign post',
      action_type: 'thread_reply',
    },
    ruleset: {
      tone: 'warm and professional',
      do_not_say: [],
      required_words: [],
    },
    author_handle: authorHandle ?? undefined,
    reply_channel: 'thread_reply',
  });
  const best = (result.replies ?? result.suggestions ?? [])
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  const handle = authorHandle
    ? authorHandle.startsWith('@') ? authorHandle : `@${authorHandle}`
    : '';
  return {
    text: best?.text ?? best?.reply_text ?? `${handle ? `${handle} ` : ''}Thanks for reaching out. We will take a look and follow up.`,
    tone: best?.tone ?? 'Professional',
    confidence: Math.round(best?.confidence ?? 80),
    riskFlags: best?.risk_flags ?? [],
  };
}

async function persistCapturedXReply(params: {
  brandId: number;
  rootTweetId: string;
  replyTweetId: string;
  authorId: string;
  authorHandle?: string | null;
  text: string;
  capturedAt?: string | null;
}): Promise<{ created: boolean; messageId: bigint | null }> {
  const existing = await prisma.socialMessage.findUnique({
    where: {
      brandId_platform_externalId: {
        brandId: params.brandId,
        platform: 'x',
        externalId: params.replyTweetId,
      },
    },
    select: { messageId: true },
  });
  if (existing) return { created: false, messageId: existing.messageId };

  const row = await prisma.socialMessage.create({
    data: {
      brandId: params.brandId,
      platform: 'x',
      kind: 'reply',
      externalId: params.replyTweetId,
      text: params.text,
      authorHandle: params.authorHandle ?? null,
      authorIdHash: params.authorId,
      url: xStatusUrl(params.replyTweetId),
      sentiment: 'neutral',
      urgencyScore: 2,
      raw: {
        source: 'x_reply_sync',
        root_tweet_id: params.rootTweetId,
        reply_tweet_id: params.replyTweetId,
      },
      rawMetrics: {},
      capturedAt: params.capturedAt ? new Date(params.capturedAt) : new Date(),
    },
    select: { messageId: true },
  });

  return { created: true, messageId: row.messageId };
}

async function trackPublishedXPost(brandId: number, tweetId: string): Promise<void> {
  try {
    await prisma.campaignPostUrl.create({
      data: {
        brandId,
        campaignId: null,
        platform: 'x',
        postUrl: xStatusUrl(tweetId),
        postIdExt: tweetId,
        includeCommenters: true,
        includeLikers: false,
        status: 'complete',
        totalFetched: 0,
        completedAt: new Date(),
      },
    });
  } catch {
    // Tracking failure must not make a successful publish look failed.
  }
}

// ── LIST CAMPAIGNS ────────────────────────────────────────────────────────────
// ── CREATE / UPDATE CAMPAIGN ──────────────────────────────────────────────────
router.post('/', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as CampaignConfig & {
    campaign_id?: number;
    brand_id:     number;
    name:         string;
    platform:     Platform;
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!body.name?.trim()) { sendValidationError(res, 'name is required'); return; }
  if (!isPlatform(body.platform)) { sendValidationError(res, 'platform is invalid'); return; }
  if (body.platform_allocation) {
    const allocationResult = validateAllocationTotal(body.platform_allocation as Record<string, number | undefined>);
    if (!allocationResult.ok) { sendValidationError(res, allocationResult.message); return; }
  }

  try {
    let result;
    const campaignId = getRequiredBrandId(body.campaign_id);
    if (body.campaign_id !== undefined && !campaignId) {
      sendValidationError(res, 'campaign_id must be a positive integer');
      return;
    }
    if (campaignId) {
      const existing = await prisma.engageCampaign.findFirst({
        where: { campaignId: BigInt(campaignId), brandId },
        select: { campaignId: true },
      });
      if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }

      const row = await prisma.engageCampaign.update({
        where: { campaignId: existing.campaignId },
        data: {
          name: body.name,
          platform: body.platform as never,
          keywords: body.keywords ?? [],
          engageAll: body.engage_all ?? true,
          engageNegative: body.engage_negative ?? false,
          tone: body.tone ?? 'professional',
          replyTemplate: body.reply_template ?? null,
          fallbackTemplate: body.fallback_template ?? null,
          ctaLink: body.cta_link ?? null,
          imageUrl: body.image_url ?? null,
          autoFireThreshold: body.auto_fire_threshold ?? 85,
          maxPerHour: body.max_per_hour ?? 50,
          isActive: body.is_active ?? true,
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 }),
          updatedAt: new Date(),
        },
      });
      result = mapEngageCampaign(row);
    } else {
      const row = await prisma.engageCampaign.create({
        data: {
          brandId,
          name: body.name,
          platform: body.platform as never,
          keywords: body.keywords ?? [],
          engageAll: body.engage_all ?? true,
          engageNegative: body.engage_negative ?? false,
          tone: body.tone ?? 'professional',
          replyTemplate: body.reply_template ?? null,
          fallbackTemplate: body.fallback_template ?? null,
          ctaLink: body.cta_link ?? null,
          imageUrl: body.image_url ?? null,
          autoFireThreshold: body.auto_fire_threshold ?? 85,
          maxPerHour: body.max_per_hour ?? 50,
          isActive: body.is_active ?? true,
          platformAllocation: toInputJson(body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 }),
        },
      });
      result = mapEngageCampaign(row);
    }
    res.json({ ok: true, campaign: result });
  } catch (err) {
    sendServerError(res, 'Campaign lookup failed', err);
  }
});

// ── TOGGLE ────────────────────────────────────────────────────────────────────
router.post('/:campaign_id/toggle', requireBrandRole('client_owner'), requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }

  try {
    const existing = await prisma.engageCampaign.findUnique({
      where: { campaignId: BigInt(campaignId) },
      select: { campaignId: true, brandId: true, isActive: true },
    });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (!canAccessBrandId(req.user, existing.brandId)) {
      res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
      return;
    }

    const row = await prisma.engageCampaign.update({
      where: { campaignId: existing.campaignId },
      data: { isActive: !(existing.isActive ?? false), updatedAt: new Date() },
      select: { campaignId: true, isActive: true },
    });
    res.json({ ok: true, campaign_id: Number(row.campaignId), is_active: row.isActive });
  } catch (err) {
    sendServerError(res, 'Campaign save failed', err);
  }
});

// ── PREVIEW ───────────────────────────────────────────────────────────────────
router.post('/:campaign_id/preview', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const campaignId = getRequiredBrandId(req.params['campaign_id']);
  if (!campaignId) { sendValidationError(res, 'campaign_id must be a positive integer'); return; }

  const { sample_comment = 'Great post!', sample_handle = 'testuser' } = req.body as {
    sample_comment?: string;
    sample_handle?:  string;
  };
  try {
    const row = await prisma.engageCampaign.findUnique({
      where: { campaignId: BigInt(campaignId) },
    });
    if (!row) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (!canAccessBrandId(req.user, row.brandId)) {
      res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this brand' });
      return;
    }

    const config = mapEngageCampaign(row);
    const text = fillVariables(
      config.reply_template ?? `Hey {{handle}}! Thank you for engaging. Check this out: {{link}}`,
      { handle: sample_handle.startsWith('@') ? sample_handle : `@${sample_handle}`, link: config.cta_link ?? '', brand: '' }
    );
    res.json({ preview: text, image_url: config.image_url, cta_link: config.cta_link });
  } catch (err) {
    sendServerError(res, 'Campaign toggle failed', err);
  }
});

// ── ENGAGE NOW (manual trigger) ───────────────────────────────────────────────
router.post('/engage-now', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id:      number;
    campaign_id?:  number;
    platform:      Platform;
    author_handle: string;
    author_id?:    string;
    comment_id?:   string;
    tweet_id?:     string;
    post_id?:      string;
    text:          string;
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId || !isPlatform(body.platform) || !body.author_handle || !body.text) {
    res.status(400).json({ error: 'brand_id, platform, author_handle, text required' });
    return;
  }

  try {
    const metaToken =
      body.platform === 'instagram' || body.platform === 'facebook'
        ? await getValidToken(brandId, body.platform)
        : null;

    const config: CampaignConfig = {
      brand_id: brandId,
      name: 'manual',
      platform: body.platform,
      engage_all: true,
      max_per_hour: 100,
      auto_fire_threshold: 0,
    };

    const credentials: Credentials = {
      META_PAGE_ACCESS_TOKEN: metaToken,
      X_OAUTH_TOKEN: body.platform === 'x' ? await getValidToken(brandId, 'x') : null,
      TIKTOK_ACCESS_TOKEN: body.platform === 'tiktok' ? await getValidToken(brandId, 'tiktok') : null,
    };

    const result = await engageEngager(brandId, {
      platform:      body.platform,
      author_handle: body.author_handle,
      author_id:     body.author_id,
      comment_id:    body.comment_id,
      tweet_id:      body.tweet_id,
      post_id:       body.post_id,
      text:          body.text,
    }, config, credentials);

    res.json(result);
  } catch (err) {
    sendServerError(res, 'Campaign preview failed', err);
  }
});

// ── POST URL CAMPAIGN ─────────────────────────────────────────────────────────
router.post('/x/preflight', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as { brand_id: number; tweet_url?: string };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const [account, token] = await Promise.all([
      getConnectedAccountRecord(brandId, 'x'),
      getValidToken(brandId, 'x'),
    ]);
    const diagnostics: string[] = [];
    const scopes = account?.scope ?? '';
    if (!account || !token) diagnostics.push('X is not connected for this brand.');
    if (account && !account.refreshToken) diagnostics.push('X token is not refreshable. Reconnect X with offline.access.');
    for (const scope of ['tweet.read', 'tweet.write', 'users.read', 'offline.access']) {
      if (account && !hasScope(scopes, scope)) diagnostics.push(`Missing X scope: ${scope}`);
    }

    const tweetId = extractXStatusId(body.tweet_url);
    let recentSearch: { checked: boolean; ok: boolean; engager_count?: number; error?: string } = { checked: false, ok: false };
    if (tweetId && token) {
      try {
        const engagers = await fetchXPostEngagers(tweetId, token);
        recentSearch = { checked: true, ok: true, engager_count: engagers.length };
      } catch (err) {
        recentSearch = { checked: true, ok: false, error: (err as Error).message };
        diagnostics.push((err as Error).message);
      }
    }

    res.json({
      ok: diagnostics.length === 0,
      connected: Boolean(account && token),
      account_handle: account?.accountHandle ?? null,
      refreshable: Boolean(account?.refreshToken),
      scopes: {
        tweet_read: hasScope(scopes, 'tweet.read'),
        tweet_write: hasScope(scopes, 'tweet.write'),
        users_read: hasScope(scopes, 'users.read'),
        offline_access: hasScope(scopes, 'offline.access'),
      },
      recent_search: recentSearch,
      diagnostics,
    });
  } catch (err) {
    sendServerError(res, 'X campaign preflight failed', err);
  }
});

router.post('/x/post', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as { brand_id: number; text?: string; reply_to_url?: string };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) { sendValidationError(res, 'text is required'); return; }
  if (text.length > 280) { sendValidationError(res, 'text must be 280 characters or fewer for X'); return; }

  const replyTweetId = extractXStatusId(body.reply_to_url);
  if (body.reply_to_url && !replyTweetId) {
    sendValidationError(res, 'reply_to_url must be a valid X/Twitter status URL');
    return;
  }

  try {
    const account = await getConnectedAccountRecord(brandId, 'x');
    if (!account) {
      res.status(409).json({
        error: 'X is not connected',
        message: 'Connect X for this brand before publishing X campaign posts.',
      });
      return;
    }
    if (!hasScope(account.scope, 'tweet.write')) {
      res.status(409).json({
        error: 'Missing X permission',
        message: 'The connected X token is missing tweet.write. Reconnect X with write access enabled.',
      });
      return;
    }

    const result = await publishReply({
      brand_id: brandId,
      platform: 'x',
      reply_text: text,
      tweet_id: replyTweetId ?? undefined,
    });
    if (!result.success) {
      res.status(502).json({
        error: 'X publish failed',
        message: result.error ?? 'X rejected the publish request.',
      });
      return;
    }

    res.json({
      ok: true,
      platform: 'x',
      message_id: result.message_id,
      reply_to_tweet_id: replyTweetId,
    });
    if (result.message_id && !replyTweetId) {
      void trackPublishedXPost(brandId, result.message_id);
    }
  } catch (err) {
    sendServerError(res, 'X publish failed', err);
  }
});

router.post('/x/sync-replies', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as { brand_id: number; tweet_url?: string; tweet_id?: string };
  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  const tweetId = typeof body.tweet_id === 'string' && /^\d+$/.test(body.tweet_id.trim())
    ? body.tweet_id.trim()
    : extractXStatusId(body.tweet_url);
  if (!tweetId) {
    sendValidationError(res, 'tweet_url or tweet_id must point to a valid X status');
    return;
  }

  try {
    const [account, token] = await Promise.all([
      getConnectedAccountRecord(brandId, 'x'),
      getValidToken(brandId, 'x'),
    ]);
    if (!account || !token) {
      res.status(409).json({
        error: 'X is not connected',
        message: 'Connect X for this brand before syncing replies.',
      });
      return;
    }
    if (!hasScope(account.scope, 'tweet.read') || !hasScope(account.scope, 'users.read')) {
      res.status(409).json({
        error: 'Missing X permission',
        message: 'Reconnect X with tweet.read and users.read before syncing replies.',
      });
      return;
    }

    const ownAccountIds = new Set(
      [account.accountIdExt, account.platformUserId].filter((value): value is string => Boolean(value))
    );
    const fetched = (await fetchXPostEngagers(tweetId, token))
      .filter(engager => !ownAccountIds.has(engager.author_id));

    const campaignId = `x-sync-${tweetId}`;
    let captured = 0;
    let queued = 0;
    let duplicates = 0;

    for (const engager of fetched) {
      const replyTweetId = engager.raw_tweet_id ?? engager.raw_comment_id;
      if (!replyTweetId) {
        duplicates += 1;
        continue;
      }

      const saved = await persistCapturedXReply({
        brandId,
        rootTweetId: tweetId,
        replyTweetId,
        authorId: engager.author_id,
        authorHandle: engager.author_handle,
        text: engager.text,
        capturedAt: engager.timestamp ?? null,
      });
      if (!saved.created) {
        duplicates += 1;
        continue;
      }
      captured += 1;

      await prisma.campaignPostEngager.create({
        data: {
          brandId,
          campaignId,
          platform: 'x',
          action: 'commented',
          authorId: replyTweetId,
          authorHandle: engager.author_handle,
          originalText: engager.text,
          status: 'queued_for_approval',
          processedAt: new Date(),
        },
      }).catch(() => undefined);

      const draft = await generateXReplyDraft(brandId, engager.text, engager.author_handle);
      await prisma.autoEngagement.create({
        data: {
          brandId,
          platform: 'x',
          authorHandle: engager.author_handle,
          originalText: engager.text,
          replyText: draft.text,
          status: 'queued_for_approval',
          firedAt: new Date(),
        },
      }).catch(() => undefined);

      if (saved.messageId) {
        await prisma.replySuggestion.create({
          data: {
            brandId,
            messageId: saved.messageId,
            text: draft.text,
            tone: draft.tone,
            confidence: draft.confidence,
            riskFlags: draft.riskFlags as never,
            status: 'pending',
          },
        }).catch(() => undefined);
      }

      const existingQueueItem = await prisma.approvalQueue.findFirst({
        where: {
          brandId,
          platform: 'x',
          status: 'pending',
          tweetId: replyTweetId,
        },
        select: { queueId: true },
      });
      if (!existingQueueItem) {
        await prisma.approvalQueue.create({
          data: {
            brandId,
            platform: 'x',
            authorId: engager.author_id,
            authorHandle: engager.author_handle,
            originalText: engager.text,
            replyText: draft.text,
            tweetId: replyTweetId,
            confidence: draft.confidence,
            status: 'pending',
          },
        });
        queued += 1;
      }
    }

    await prisma.campaignPostUrl.updateMany({
      where: { brandId, platform: 'x', postIdExt: tweetId },
      data: {
        status: 'complete',
        totalFetched: fetched.length,
        completedAt: new Date(),
        errorMsg: null,
      },
    }).catch(() => undefined);

    res.json({
      ok: true,
      tweet_id: tweetId,
      fetched: fetched.length,
      captured,
      queued,
      duplicates,
      message: captured
        ? `${captured} new X replies captured. ${queued} reply drafts are waiting in the AI Reply Engine.`
        : 'No new X replies were found for this post.',
    });
  } catch (err) {
    sendServerError(res, 'X reply sync failed', err);
  }
});

router.post('/post-urls/run', requireBrandRole('client_owner'), requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const body = req.body as {
    brand_id:           number;
    campaign_id?:       string;
    post_urls:          PostUrlItem[];
    platform_allocation?: { instagram?: number; facebook?: number; tiktok?: number; x?: number };
    tone?:              string;
    reply_template?:    string;
    cta_link?:          string;
    image_url?:         string;
    auto_fire_threshold?: number;
    max_per_hour?:      number;
  };

  const brandId = getRequiredBrandId(body.brand_id);
  if (!brandId || !requireNonEmptyArray<PostUrlItem>(body.post_urls)) {
    res.status(400).json({ error: 'brand_id and post_urls[] required' });
    return;
  }

  const alloc = body.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 };
  const allocationResult = validateAllocationTotal(alloc);
  if (!allocationResult.ok) {
    res.status(400).json({ error: allocationResult.message });
    return;
  }

  const validated = body.post_urls.map(p => ({
    ...p,
    post_id_ext: extractPostId(p.platform, p.url),
  })).filter(p => isPlatform(p.platform) && isHttpUrl(p.url) && p.post_id_ext);

  if (!validated.length) {
    sendValidationError(res, 'No valid post URLs were provided. Check platform selection and URL format.');
    return;
  }

  let credentials: Credentials;
  try {
    const [instagramAccount, metaToken, tiktokToken, xAccount, xToken] = await Promise.all([
      getConnectedAccountRecord(brandId, 'instagram'),
      getValidToken(brandId, 'instagram').then(token => token ?? getValidToken(brandId, 'facebook')),
      getValidToken(brandId, 'tiktok'),
      getConnectedAccountRecord(brandId, 'x'),
      getValidToken(brandId, 'x'),
    ]);
    credentials = {
      META_PAGE_ACCESS_TOKEN: metaToken,
      META_IG_USER_ID: instagramAccount?.accountIdExt ?? null,
      TIKTOK_ACCESS_TOKEN: tiktokToken,
      X_OAUTH_TOKEN: xToken,
    };

    const platforms = new Set(validated.map(item => item.platform));
    const diagnostics: string[] = [];
    if ((platforms.has('instagram') || platforms.has('facebook')) && !metaToken) {
      diagnostics.push('Meta is not connected for this brand. Connect a Facebook Page with a linked Instagram Business/Creator account.');
    }
    if (platforms.has('instagram') && !instagramAccount?.accountIdExt) {
      diagnostics.push('Instagram Business/Creator account ID is missing. Reconnect Meta after linking Instagram to a Facebook Page.');
    }
    if (platforms.has('tiktok') && !tiktokToken) {
      diagnostics.push('TikTok is not connected for this brand.');
    }
    if (platforms.has('x') && !xToken) {
      diagnostics.push('X is not connected for this brand.');
    }
    if (platforms.has('x') && !xAccount?.refreshToken) {
      diagnostics.push('X token is not refreshable. Reconnect X with offline.access enabled.');
    }
    if (diagnostics.length) {
      res.status(409).json({
        error: 'Campaign preflight failed',
        message: diagnostics[0],
        diagnostics,
      });
      return;
    }
  } catch (err) {
    sendServerError(res, 'Campaign preflight failed', err);
    return;
  }

  const campaignId = body.campaign_id ?? String(Date.now());

  res.json({
    ok:         true,
    message:    `Processing ${validated.length} post URLs`,
    campaign_id: campaignId,
    post_count: validated.length,
  });

  const config: CampaignConfig = {
    id:                   campaignId,
    brand_id:             brandId,
    tone:                 body.tone,
    reply_template:       body.reply_template,
    cta_link:             body.cta_link,
    image_url:            body.image_url,
    auto_fire_threshold:  body.auto_fire_threshold ?? 85,
    max_per_hour:         body.max_per_hour ?? 50,
    platform_allocation:  alloc,
  };

  void runPostUrlCampaign(brandId, config, validated, credentials);
});

router.get('/post-urls/status/:brand_id/:campaign_id', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  const campaignId = typeof req.params['campaign_id'] === 'string' ? req.params['campaign_id'] : '';
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }
  if (!/^\d+$/.test(campaignId)) { sendValidationError(res, 'campaign_id must be the numeric ID returned by post-urls/run'); return; }

  try {
    const [urls, engagers] = await Promise.all([
      prisma.campaignPostUrl.findMany({
        where: { brandId, campaignId: BigInt(campaignId) },
        orderBy: { submittedAt: 'desc' },
        select: {
          platform: true,
          postUrl: true,
          status: true,
          totalFetched: true,
          errorMsg: true,
          submittedAt: true,
          completedAt: true,
        },
      }),
      prisma.campaignPostEngager.findMany({
        where: { brandId, campaignId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          platform: true,
          action: true,
          authorHandle: true,
          status: true,
          processedAt: true,
          createdAt: true,
        },
      }),
    ]);
    const sent = engagers.filter(item => item.status === 'sent').length;
    const manual = engagers.filter(item => item.status === 'manual_copy').length;
    const queued = engagers.filter(item => item.status === 'queued_for_approval' || item.status === 'queued').length;
    const errors = engagers.filter(item => item.status === 'error').length + urls.filter(item => item.status === 'error').length;
    const fetched = urls.reduce((sum, item) => sum + (item.totalFetched ?? 0), 0);
    res.json({
      campaign_id: campaignId,
      summary: {
        post_urls: urls.length,
        fetched,
        engagers: engagers.length,
        sent,
        manual,
        queued,
        errors,
        complete: urls.length > 0 && urls.every(item => item.status === 'complete' || item.status === 'error'),
      },
      post_urls: urls.map(item => ({
        platform: item.platform,
        url: item.postUrl,
        status: item.status,
        total_fetched: item.totalFetched ?? 0,
        error: item.errorMsg,
        submitted_at: item.submittedAt,
        completed_at: item.completedAt,
      })),
      engagers: engagers.slice(0, 25).map(item => ({
        platform: item.platform,
        action: item.action,
        author_handle: item.authorHandle,
        status: item.status,
        created_at: item.createdAt,
        processed_at: item.processedAt,
      })),
    });
  } catch (err) {
    sendServerError(res, 'Post URL campaign status lookup failed', err);
  }
});

router.get('/:brand_id', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const rows = await prisma.engageCampaign.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ campaigns: rows.map(mapEngageCampaign) });
  } catch (err) {
    sendServerError(res, 'Engagement run failed', err);
  }
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/:brand_id/stats', requireBrandAccess, requireToolAccess('tool_10'), async (req: Request, res: Response) => {
  const brandId = getRequiredBrandId(req.params['brand_id']);
  if (!brandId) { sendValidationError(res, 'brand_id must be a positive integer'); return; }

  try {
    const since = new Date(Date.now() - SOCIAL_RESPONSE_DAYS * 86400000);
    const trendKeys = recentDayKeys(7);
    const [
      grouped,
      engagements,
      messages,
      kpiSnapshots,
      linkTotals,
      riskMessages,
    ] = await Promise.all([
      prisma.autoEngagement.groupBy({
        by: ['platform', 'status'],
        where: { brandId, firedAt: { gt: since } },
        _count: { _all: true },
      }),
      prisma.autoEngagement.findMany({
        where: { brandId, firedAt: { gt: since } },
        select: { platform: true, status: true, firedAt: true },
      }),
      prisma.socialMessage.findMany({
        where: { brandId, capturedAt: { gt: since } },
        select: { capturedAt: true, sentiment: true, urgencyScore: true },
      }),
      prisma.kpiSnapshot.findMany({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        take: 7,
        select: {
          createdAt: true,
          listeningKpi: true,
          replyKpi: true,
          funnelKpi: true,
          riskEvents: true,
        },
      }),
      prisma.trackedLink.aggregate({
        where: { brandId },
        _sum: { clicks: true, conversions: true },
      }),
      prisma.socialMessage.findMany({
        where: {
          brandId,
          capturedAt: { gt: since },
          OR: [
            { urgencyScore: { gte: 4 } },
            { sentiment: 'negative' },
          ],
        },
        orderBy: { capturedAt: 'desc' },
        take: 10,
        select: {
          capturedAt: true,
          platform: true,
          text: true,
          sentiment: true,
          urgencyScore: true,
          topics: true,
        },
      }),
    ]);

    const byPlatform = new Map<string, { platform: string; total: number; sent: number; manual: number; queued: number }>();
    for (const row of grouped) {
      if (!row.platform) continue;
      const stats = byPlatform.get(row.platform) ?? { platform: row.platform, total: 0, sent: 0, manual: 0, queued: 0 };
      const count = row._count._all;
      stats.total += count;
      if (row.status === 'sent') stats.sent += count;
      if (row.status === 'manual_copy') stats.manual += count;
      if (row.status === 'queued' || row.status === 'queued_for_approval') stats.queued += count;
      byPlatform.set(row.platform, stats);
    }

    const messageVolume = new Map<string, { d: string; classified: number; total: number }>();
    const sentiment = new Map<string, { d: string; pos: number; neu: number; neg: number }>();
    for (const key of trendKeys) {
      messageVolume.set(key, { d: dayLabel(key), classified: 0, total: 0 });
      sentiment.set(key, { d: dayLabel(key), pos: 0, neu: 0, neg: 0 });
    }

    for (const message of messages) {
      const key = dayKey(message.capturedAt);
      if (!messageVolume.has(key)) continue;
      const volume = messageVolume.get(key)!;
      volume.classified += 1;
      volume.total += 1;

      const sentimentBucket = sentiment.get(key)!;
      if (message.sentiment === 'positive') sentimentBucket.pos += 1;
      else if (message.sentiment === 'negative') sentimentBucket.neg += 1;
      else sentimentBucket.neu += 1;
    }

    const sentByDay = new Map<string, number>();
    const manualByDay = new Map<string, number>();
    const queuedByDay = new Map<string, number>();
    for (const engagement of engagements) {
      const key = dayKey(engagement.firedAt);
      if (!trendKeys.includes(key)) continue;
      if (engagement.status === 'sent') sentByDay.set(key, (sentByDay.get(key) ?? 0) + 1);
      if (engagement.status === 'manual_copy') manualByDay.set(key, (manualByDay.get(key) ?? 0) + 1);
      if (engagement.status === 'queued' || engagement.status === 'queued_for_approval') queuedByDay.set(key, (queuedByDay.get(key) ?? 0) + 1);
    }

    const latestKpi = kpiSnapshots[0];
    const fallbackScores = {
      listening: latestKpi?.listeningKpi === null || latestKpi?.listeningKpi === undefined ? null : Number(latestKpi.listeningKpi),
      reply: latestKpi?.replyKpi === null || latestKpi?.replyKpi === undefined ? null : Number(latestKpi.replyKpi),
      funnel: latestKpi?.funnelKpi === null || latestKpi?.funnelKpi === undefined ? null : Number(latestKpi.funnelKpi),
    };
    const snapshotByDay = new Map(kpiSnapshots.map(snapshot => [dayKey(snapshot.createdAt), snapshot]));
    const score_trend = trendKeys.map(key => {
      const snapshot = snapshotByDay.get(key);
      return {
        d: dayLabel(key),
        listening: snapshot?.listeningKpi === null || snapshot?.listeningKpi === undefined ? fallbackScores.listening : Number(snapshot.listeningKpi),
        reply: snapshot?.replyKpi === null || snapshot?.replyKpi === undefined ? fallbackScores.reply : Number(snapshot.replyKpi),
        funnel: snapshot?.funnelKpi === null || snapshot?.funnelKpi === undefined ? fallbackScores.funnel : Number(snapshot.funnelKpi),
      };
    });

    const stats = Array.from(byPlatform.values());
    const totals = stats.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        sent: acc.sent + row.sent,
        manual: acc.manual + row.manual,
        queued: acc.queued + row.queued,
      }),
      { total: 0, sent: 0, manual: 0, queued: 0 },
    );

    const risk_events = riskMessages.map(message => {
      const risk = severityFor(message.urgencyScore, message.sentiment);
      return {
        time: message.capturedAt.toISOString(),
        platform: message.platform,
        tag: risk.tag,
        severity: risk.severity,
        text: message.text,
        sentiment: message.sentiment,
        urgency_score: message.urgencyScore,
        topics: message.topics,
      };
    });

    res.json({
      stats,
      summary: {
        total_messages: messages.length,
        replies_sent: totals.sent,
        manual_reviews: totals.manual,
        queued: totals.queued,
        listening_score: fallbackScores.listening,
        reply_score: fallbackScores.reply,
        funnel_score: fallbackScores.funnel,
        risk_events: risk_events.length || latestKpi?.riskEvents || 0,
        avg_response_time_minutes: null,
        revenue_attributed: null,
      },
      score_trend,
      message_volume: Array.from(messageVolume.values()),
      sentiment: Array.from(sentiment.values()),
      risk_events,
      attribution: {
        clicks: linkTotals._sum.clicks ?? 0,
        conversions: linkTotals._sum.conversions ?? 0,
        revenue: null,
      },
    });
  } catch (err) {
    sendServerError(res, 'Post URL campaign run failed', err);
  }
});

export default router;
