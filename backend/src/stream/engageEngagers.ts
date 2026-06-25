// src/stream/engageEngagers.ts
import { runAgent4 }  from '../agents/agent4_reply_assistant';
import { runAgent14 } from '../agents/agents9_to_14';
import { broadcastToClients, enqueueForApproval } from './eventQueue';
import prisma from '../db/prisma';
import {
  EngageEvent, EngageResult, CampaignConfig, Credentials,
  PlatformSendResult, Platform, Engager, PostUrlItem,
  PlatformAllocation, PostCampaignResults, ClassifiedMessage,
} from '../types';

// ── RATE LIMITER ──────────────────────────────────────────────────────────────
const hourlyCounter = new Map<string, { count: number; reset_at: number }>();

function checkRateLimit(brandId: number, maxPerHour = 50): boolean {
  const key  = String(brandId);
  const now  = Date.now();
  const slot = hourlyCounter.get(key);
  if (!slot || slot.reset_at < now) {
    hourlyCounter.set(key, { count: 1, reset_at: now + 3_600_000 });
    return true;
  }
  if (slot.count >= maxPerHour) return false;
  slot.count++;
  return true;
}

// ── DUPLICATE CHECK ───────────────────────────────────────────────────────────
const sentLog = new Map<string, number>();

function alreadySent(brandId: number, platform: string, authorId: string, campaignId: string): boolean {
  const key = `${brandId}_${platform}_${authorId}_${campaignId}`;
  return sentLog.has(key);
}

function markSent(brandId: number, platform: string, authorId: string, campaignId: string): void {
  const key = `${brandId}_${platform}_${authorId}_${campaignId}`;
  sentLog.set(key, Date.now());
  setTimeout(() => sentLog.delete(key), 24 * 3_600_000);
}

// ── VARIABLE SUBSTITUTION ─────────────────────────────────────────────────────
export function fillVariables(text: string, vars: Record<string, string> = {}): string {
  const handle = vars['handle'] ?? '';
  return text
    .replace(/@\{\{\s*handle\s*\}\}/g, handle.startsWith('@') ? handle : `@${handle}`)
    .replace(/\{\{\s*handle\s*\}\}/g,  handle)
    .replace(/\{\{\s*link\s*\}\}/g,    vars['link']    ?? '')
    .replace(/\{\{\s*brand\s*\}\}/g,   vars['brand']   ?? '')
    .replace(/\{\{\s*keyword\s*\}\}/g, vars['keyword'] ?? '')
    .replace(/\{\{\s*action\s*\}\}/g,  vars['action']  ?? '');
}

function formatMentionHandle(handle: string | null | undefined): string {
  const cleaned = (handle ?? '').trim();
  if (!cleaned) return '';
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
}

function approvalMeta(event: EngageEvent): {
  comment_id?: string | null;
  post_id?: string | null;
  tweet_id?: string | null;
  author_id?: string | null;
} {
  return {
    author_id: event.author_id ?? null,
    comment_id: event.comment_id ?? null,
    post_id: event.post_id ?? null,
    tweet_id: event.tweet_id ?? event.comment_id ?? null,
  };
}

// ── DB HELPERS ────────────────────────────────────────────────────────────────
async function getTrackedLink(brandId: number, campaignId: string): Promise<string | null> {
  try {
    const row = await prisma.trackedLink.findFirst({
      where: { brandId, campaign: campaignId },
      select: { shortCode: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return `${process.env.LINK_BASE_URL ?? 'https://seai.link'}/${row.shortCode}`;
  } catch { return null; }
}

async function getCampaignImage(brandId: number, campaignId: string): Promise<string | null> {
  try {
    const row = await prisma.campaignAsset.findFirst({
      where: { brandId, campaignId, isActive: true },
      select: { imageUrl: true },
      orderBy: { createdAt: 'desc' },
    });
    return row?.imageUrl ?? null;
  } catch { return null; }
}

function numericCampaignId(campaignId: string): number | null {
  const parsed = Number(campaignId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function persistPostUrlStart(
  brandId: number,
  campaignId: string,
  postUrl: PostUrlItem,
  postId: string
): Promise<number | null> {
  try {
    const parsedCampaignId = numericCampaignId(campaignId);
    const row = await prisma.campaignPostUrl.create({
      data: {
        brandId,
        campaignId: parsedCampaignId ? BigInt(parsedCampaignId) : null,
        platform: postUrl.platform as never,
        postUrl: postUrl.url,
        postIdExt: postId,
        includeCommenters: postUrl.include_commenters ?? true,
        includeLikers: postUrl.include_likers ?? true,
        status: 'fetching',
      },
      select: { urlId: true },
    });
    return Number(row.urlId);
  } catch {
    return null;
  }
}

async function persistPostUrlComplete(urlId: number | null, totalFetched: number): Promise<void> {
  if (!urlId) return;
  try {
    await prisma.campaignPostUrl.update({
      where: { urlId: BigInt(urlId) },
      data: { status: 'complete', totalFetched, completedAt: new Date() },
    });
  } catch { /* log only */ }
}

async function persistPostUrlError(urlId: number | null, error: string): Promise<void> {
  if (!urlId) return;
  try {
    await prisma.campaignPostUrl.update({
      where: { urlId: BigInt(urlId) },
      data: { status: 'error', errorMsg: error, completedAt: new Date() },
    });
  } catch { /* log only */ }
}

async function persistCampaignEngager(
  brandId: number,
  campaignId: string,
  engager: Engager
): Promise<void> {
  try {
    await prisma.campaignPostEngager.create({
      data: {
        brandId,
        campaignId,
        platform: engager.platform as never,
        action: engager.action,
        authorId: engager.author_id,
        externalEventId: engager.raw_tweet_id ?? engager.raw_comment_id ?? `${engager.action}:${engager.author_id}`,
        authorHandle: engager.author_handle,
        originalText: engager.text,
        status: 'pending',
      },
    });
  } catch { /* log only */ }
}

async function updateCampaignEngagerStatus(
  brandId: number,
  campaignId: string,
  engager: Engager,
  status: string
): Promise<void> {
  try {
    await prisma.campaignPostEngager.updateMany({
      where: {
        brandId,
        campaignId,
        platform: engager.platform as never,
        externalEventId: engager.raw_tweet_id ?? engager.raw_comment_id ?? `${engager.action}:${engager.author_id}`,
      },
      data: { status, processedAt: new Date() },
    });
  } catch { /* log only */ }
}

// ── PLATFORM SENDERS ──────────────────────────────────────────────────────────
async function sendInstagramDM(
  recipientId: string, text: string, imageUrl: string | null | undefined, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!token) return { manual_copy: true, text };
  try {
    const r = await fetch('https://graph.facebook.com/v19.0/me/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, access_token: token, messaging_type: 'RESPONSE' })
    });
    const d = await r.json() as { message_id?: string; error?: { message: string } };
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `IG DM ${r.status}`);
    if (imageUrl) {
      await fetch('https://graph.facebook.com/v19.0/me/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } }, access_token: token })
      });
    }
    return { success: true, message_id: d.message_id };
  } catch (err) { return { manual_copy: true, text, error: (err as Error).message }; }
}

async function sendInstagramCommentReply(
  commentId: string, replyText: string, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!commentId) return { manual_copy: true, text: replyText, reason: 'No Instagram comment ID' };
  if (!token) return { manual_copy: true, text: replyText, reason: 'No Meta token' };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: replyText }),
    });
    const d = await r.json() as { id?: string; error?: { message?: string } };
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `IG comment reply ${r.status}`);
    return { success: true, comment_id: d.id };
  } catch (err) {
    return { manual_copy: true, text: replyText, error: (err as Error).message };
  }
}

async function sendInstagramPrivateReply(
  pageId: string | null | undefined, commentId: string | null | undefined, replyText: string, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!pageId || !commentId) return { manual_copy: true, text: replyText, reason: 'No Meta Page ID or Instagram comment ID' };
  if (!token) return { manual_copy: true, text: replyText, reason: 'No Meta token' };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${pageId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: replyText },
        messaging_type: 'RESPONSE',
      }),
    });
    const d = await r.json() as { message_id?: string; error?: { message?: string } };
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `IG private reply ${r.status}`);
    return { success: true, message_id: d.message_id };
  } catch (err) {
    return { manual_copy: true, text: replyText, error: (err as Error).message };
  }
}

async function sendFacebookDM(
  recipientId: string, text: string, imageUrl: string | null | undefined, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!token) return { manual_copy: true, text };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, messaging_type: 'RESPONSE' })
    });
    const d = await r.json() as { message_id?: string; error?: { message: string } };
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `FB DM ${r.status}`);
    return { success: true, message_id: d.message_id };
  } catch (err) { return { manual_copy: true, text, error: (err as Error).message }; }
}

async function sendFacebookCommentReply(
  commentId: string, replyText: string, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!commentId) return { manual_copy: true, text: replyText, reason: 'No Facebook comment ID' };
  if (!token) return { manual_copy: true, text: replyText, reason: 'No Meta token' };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${commentId}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: replyText }),
    });
    const d = await r.json() as { id?: string; error?: { message?: string } };
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `FB comment reply ${r.status}`);
    return { success: true, comment_id: d.id };
  } catch (err) {
    return { manual_copy: true, text: replyText, error: (err as Error).message };
  }
}

async function sendFacebookPrivateReply(
  pageId: string | null | undefined, commentId: string | null | undefined, replyText: string, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!pageId || !commentId) return { manual_copy: true, text: replyText, reason: 'No Meta Page ID or Facebook comment ID' };
  if (!token) return { manual_copy: true, text: replyText, reason: 'No Meta token' };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${pageId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: replyText },
        messaging_type: 'RESPONSE',
      }),
    });
    const d = await r.json() as { message_id?: string; error?: { message?: string } };
    if (!r.ok || d.error) throw new Error(d.error?.message ?? `FB private reply ${r.status}`);
    return { success: true, message_id: d.message_id };
  } catch (err) {
    return { manual_copy: true, text: replyText, error: (err as Error).message };
  }
}

async function sendTikTokCommentReply(
  commentId: string, videoId: string, replyText: string, token: string | null | undefined
): Promise<PlatformSendResult> {
  if (!token) return { manual_copy: true, text: replyText, reason: 'No TikTok token' };
  try {
    const r = await fetch('https://open.tiktokapis.com/v2/comment/reply/post/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ video_id: videoId, comment_id: commentId, text: replyText.slice(0, 150) })
    });
    const d = await r.json() as { error?: { code: string; message: string }; data?: { comment_id: string } };
    if (d.error?.code && d.error.code !== 'ok') {
      if (d.error.code === 'spam_risk_too_high') return { rate_limited: true, text: replyText };
      throw new Error(`TikTok: ${d.error.message}`);
    }
    return { success: true, comment_id: d.data?.comment_id };
  } catch (err) { return { manual_copy: true, text: replyText, error: (err as Error).message }; }
}

async function sendXReply(replyText: string, tweetId: string | null | undefined, token: string | null | undefined): Promise<PlatformSendResult> {
  if (!token) return { manual_copy: true, text: replyText };
  try {
    const r = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: replyText, ...(tweetId && { reply: { in_reply_to_tweet_id: tweetId } }) })
    });
    const d = await r.json() as {
      data?: { id: string };
      errors?: { message?: string; detail?: string }[];
      title?: string;
      detail?: string;
    };
    if (!r.ok || d.errors || !d.data?.id) {
      throw new Error(d.errors?.[0]?.message ?? d.errors?.[0]?.detail ?? d.detail ?? d.title ?? `X ${r.status}`);
    }
    return { success: true, tweet_id: d.data?.id };
  } catch (err) { return { manual_copy: true, text: replyText, error: (err as Error).message }; }
}

// ── GENERATE REPLY ────────────────────────────────────────────────────────────
async function generateReply(
  event: EngageEvent, config: CampaignConfig & { brand_id: number }, trackedLink: string | null, action: string
): Promise<{ text: string; confidence: number }> {
  const mentionHandle = formatMentionHandle(event.author_handle);
  if (config.reply_template) {
    return { text: fillVariables(config.reply_template, {
      handle:  mentionHandle,
      link:    trackedLink ?? '',
      brand:   config.brand_name ?? '',
      keyword: event.matched_keyword ?? '',
      action:  action === 'liked' ? 'liking our post' : 'your comment',
    }), confidence: 100 };
  }

  try {
    const result = await runAgent4({
      brand_id:         config.brand_id,
      message:          event.text || (action === 'liked' ? '[User liked your post]' : '[comment]'),
      platform:         event.platform,
      tone:             config.tone ?? 'warm and enthusiastic',
      campaign_context: { name: config.name, objective: config.objective ?? 'increase engagement', cta_link: trackedLink ?? config.cta_link, action_type: action },
      ruleset:          { tone: config.tone ?? '', required_words: config.required_words ?? [], do_not_say: config.do_not_say ?? [] },
      author_handle:    event.author_handle,
      reply_channel:    event.platform === 'x' ? 'thread_reply' : event.platform === 'tiktok' ? 'comment_reply' : 'dm',
    });

    const replies = result.replies ?? result.suggestions ?? [];
    const best    = replies.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    let text = best?.text ?? best?.reply_text ?? `Hey ${mentionHandle}! Thanks for engaging 🙌`;

    if (trackedLink && !text.includes(trackedLink)) text = text.trimEnd() + `\n${trackedLink}`;
    if (mentionHandle && !text.toLowerCase().includes(mentionHandle.toLowerCase())) text = `Hey ${mentionHandle}! ` + text;
    return { text, confidence: Math.max(0, Math.min(100, Math.round(best?.confidence ?? 0))) };
  } catch {
    return { text: config.fallback_template ?? `Hey ${mentionHandle}! Thank you ${action === 'liked' ? 'for the like' : 'for your comment'} 🙌 ${trackedLink ?? ''}`, confidence: 0 };
  }
}

// ── MAIN ENGAGE FUNCTION ──────────────────────────────────────────────────────
export async function buildCampaignReplyDraft(
  brandId: number,
  event: EngageEvent,
  config: CampaignConfig,
): Promise<{ reply: string; confidence: number; image_url: string | null; tracked_link: string | null }> {
  const campaignId = String(config.id ?? config.campaign_id ?? 'default');
  const trackedLink = await getTrackedLink(brandId, campaignId) ?? config.cta_link ?? null;
  const imageUrl = config.image_url ?? await getCampaignImage(brandId, campaignId);
  const action = event.action ?? 'commented';
  const generated = await generateReply(event, { ...config, brand_id: brandId }, trackedLink, action);
  return {
    reply: generated.text,
    confidence: generated.confidence,
    image_url: imageUrl,
    tracked_link: trackedLink,
  };
}

export async function engageEngager(
  brandId: number, event: EngageEvent, config: CampaignConfig, credentials: Credentials
): Promise<EngageResult> {
  const campaignId = String(config.id ?? config.campaign_id ?? 'default');
  const persistedCampaignId = numericCampaignId(campaignId);

  if (!checkRateLimit(brandId, config.max_per_hour ?? 50)) return { status: 'rate_limited' };
  if (!persistedCampaignId && alreadySent(brandId, event.platform, event.author_id ?? event.author_handle, campaignId)) return { status: 'already_sent' };
  if (persistedCampaignId) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const deliveredToday = await prisma.campaignPostEngager.count({
      where: { brandId, campaignId, firstDeliveredAt: { gte: startOfDay } },
    });
    if (deliveredToday >= (config.max_per_day ?? 50)) return { status: 'rate_limited', error: 'Campaign daily delivery limit reached.' };
  }

  try {
    const profile = await runAgent14({ brand_id: brandId, user: { handle: event.author_handle, id: event.author_id, platform: event.platform, text: event.text } });
    if (profile.classification === 'bot' || profile.risk_level === 'high') {
      broadcastToClients(brandId, 'bot_blocked', { handle: event.author_handle, platform: event.platform });
      return { status: 'bot_blocked' };
    }
  } catch (err) {
    return { status: 'queued_for_approval', error: `Safety classification unavailable: ${(err as Error).message}` };
  }

  const trackedLink = await getTrackedLink(brandId, campaignId) ?? config.cta_link ?? null;
  const imageUrl    = config.image_url ?? await getCampaignImage(brandId, campaignId);
  const action      = event.action ?? 'commented';

  let generated: { text: string; confidence: number };
  try {
    generated = await generateReply(event, { ...config, brand_id: brandId }, trackedLink, action);
  } catch (err) {
    return { status: 'generation_failed', error: (err as Error).message };
  }

  const replyText = generated.text;
  const privateReplyText = config.private_followup_template
    ? fillVariables(config.private_followup_template, {
        handle: formatMentionHandle(event.author_handle),
        link: trackedLink ?? '',
        brand: config.brand_name ?? '',
        keyword: event.matched_keyword ?? '',
        action: action === 'liked' ? 'liking our post' : 'your comment',
      })
    : replyText;

  const confidence = generated.confidence;
  if (confidence < (config.auto_fire_threshold ?? 85)) {
    if (!persistedCampaignId) {
      await enqueueForApproval({ brand_id: brandId, platform: event.platform, author: event.author_handle, original: event.text, reply: replyText, image_url: imageUrl, tracked_link: trackedLink ?? undefined, meta: approvalMeta(event) });
    }
    broadcastToClients(brandId, 'engage_queued', { platform: event.platform, handle: event.author_handle, preview: replyText.slice(0, 80) });
    return { status: 'queued_for_approval', reply: replyText, confidence };
  }

  const deliveries: NonNullable<EngageResult['deliveries']> = [];
  const recordDelivery = (channel: 'public_reply' | 'direct_message', channelResult: PlatformSendResult, unsupported?: string) => {
    if (unsupported) deliveries.push({ channel, status: 'manual_action_required', error: unsupported });
    else if (channelResult.success) deliveries.push({ channel, status: 'sent', external_message_id: channelResult.message_id ?? channelResult.comment_id ?? channelResult.tweet_id });
    else if (channelResult.rate_limited) deliveries.push({ channel, status: 'rate_limited', error: channelResult.error ?? channelResult.reason });
    else deliveries.push({ channel, status: channelResult.manual_copy ? 'manual_action_required' : 'failed', error: channelResult.error ?? channelResult.reason ?? 'Platform delivery failed.' });
  };

  if (config.public_reply_enabled !== false) {
    let publicResult: PlatformSendResult;
    if (action !== 'commented') publicResult = { manual_copy: true, reason: 'Public replies require a comment or mention event.' };
    else if (event.platform === 'instagram') publicResult = await sendInstagramCommentReply(event.comment_id ?? '', replyText, credentials.META_PAGE_ACCESS_TOKEN);
    else if (event.platform === 'facebook') publicResult = await sendFacebookCommentReply(event.comment_id ?? '', replyText, credentials.META_PAGE_ACCESS_TOKEN);
    else if (event.platform === 'tiktok') publicResult = await sendTikTokCommentReply(event.comment_id ?? '', event.post_id ?? '', replyText, credentials.TIKTOK_ACCESS_TOKEN);
    else publicResult = await sendXReply(replyText, event.tweet_id ?? event.comment_id, credentials.X_OAUTH_TOKEN);
    recordDelivery('public_reply', publicResult);
  }

  if (config.direct_message_enabled !== false) {
    if (event.platform === 'instagram' && action === 'commented') recordDelivery('direct_message', await sendInstagramPrivateReply(credentials.META_PAGE_ID, event.comment_id, privateReplyText, credentials.META_PAGE_ACCESS_TOKEN));
    else if (event.platform === 'facebook' && action === 'commented') recordDelivery('direct_message', await sendFacebookPrivateReply(credentials.META_PAGE_ID, event.comment_id, privateReplyText, credentials.META_PAGE_ACCESS_TOKEN));
    else if (event.platform === 'instagram') recordDelivery('direct_message', await sendInstagramDM(event.author_id ?? '', privateReplyText, imageUrl, credentials.META_PAGE_ACCESS_TOKEN));
    else if (event.platform === 'facebook') recordDelivery('direct_message', await sendFacebookDM(event.author_id ?? '', privateReplyText, imageUrl, credentials.META_PAGE_ACCESS_TOKEN));
    else recordDelivery('direct_message', {}, `${event.platform === 'x' ? 'X' : 'TikTok'} direct messaging is not available for this campaign event through the connected API permissions.`);
  }

  const sentCount = deliveries.filter(item => item.status === 'sent').length;
  const rateLimitedCount = deliveries.filter(item => item.status === 'rate_limited').length;
  const blockedCount = deliveries.filter(item => item.status === 'manual_action_required').length;
  const errorText = deliveries.filter(item => item.status !== 'sent').map(item => item.error).filter(Boolean).join(' ');
  const result: PlatformSendResult = sentCount
    ? { success: true, partial: sentCount < deliveries.length, error: errorText || undefined }
    : rateLimitedCount ? { rate_limited: true, error: errorText }
      : blockedCount ? { manual_copy: true, error: errorText }
        : { error: errorText || 'No delivery channel was enabled.' };

  if (result.success) {
    markSent(brandId, event.platform, event.author_id ?? event.author_handle, campaignId);
    broadcastToClients(brandId, 'engage_fired', { platform: event.platform, handle: event.author_handle, preview: replyText.slice(0, 80), image: !!imageUrl, link: trackedLink, action });
    if (result.partial && !persistedCampaignId) {
      await enqueueForApproval({
        brand_id: brandId,
        platform: event.platform,
        author: event.author_handle,
        original: event.text,
        reply: replyText,
        manual_copy_required: true,
        manual_copy_instructions: result.error ?? 'One of the Meta reply actions failed. Check the platform thread and send the missing reply manually if needed.',
        meta: approvalMeta(event),
      });
    }
    try {
      await prisma.autoEngagement.create({
        data: {
          brandId,
          campaignId: persistedCampaignId ? BigInt(persistedCampaignId) : null,
          platform: event.platform as never,
          authorHandle: event.author_handle,
          originalText: event.text,
          replyText,
          imageUrl: imageUrl ?? null,
          trackedLink,
          status: 'sent',
          firedAt: new Date(),
        },
      });
    } catch { /* log only */ }
  } else if (result.manual_copy) {
    if (!persistedCampaignId) {
      await enqueueForApproval({ brand_id: brandId, platform: event.platform, author: event.author_handle, original: event.text, reply: replyText, manual_copy_required: true, delivery_error: result.error ?? result.reason, meta: approvalMeta(event) });
    }
    broadcastToClients(brandId, 'engage_manual_copy', { platform: event.platform, handle: event.author_handle, preview: replyText.slice(0, 80), reason: result.error ?? result.reason ?? 'Manual copy required' });
  }

  const status: EngageResult['status'] = result.success
    ? result.partial ? 'partial' : 'sent'
    : result.manual_copy ? 'manual_action_required' : result.rate_limited ? 'rate_limited' : 'error';
  return { status, platform: event.platform, author: event.author_handle, reply: replyText, image_url: imageUrl, tracked_link: trackedLink, error: result.error ?? result.reason, confidence, deliveries };
}

// ── POST URL FETCHERS ─────────────────────────────────────────────────────────
export async function fetchInstagramPostEngagers(mediaId: string, token: string | null | undefined, incComments = true, incLikers = true): Promise<Engager[]> {
  const engagers: Engager[] = [];
  if (!token) return engagers;
  if (incComments) {
    let url: string | null = `https://graph.facebook.com/v19.0/${mediaId}/comments?fields=id,username,text,timestamp&limit=100&access_token=${token}`;
    while (url) {
      try {
        const r = await fetch(url);
        const d = await r.json() as { data?: { id: string; username: string; text: string; timestamp: string }[]; paging?: { next?: string }; error?: unknown };
        if (d.error) break;
        (d.data ?? []).forEach(c => engagers.push({ platform: 'instagram', action: 'commented', author_id: c.id, author_handle: c.username ?? c.id, text: c.text ?? '', timestamp: c.timestamp, raw_comment_id: c.id, raw_video_id: mediaId }));
        url = d.paging?.next ?? null;
      } catch { break; }
    }
  }
  if (incLikers) {
    try {
      let url: string | null = `https://graph.facebook.com/v19.0/${mediaId}/likes?fields=id,username&limit=100&access_token=${token}`;
      while (url) {
        const r = await fetch(url);
        const d = await r.json() as { data?: { id: string; username: string }[]; paging?: { next?: string }; error?: unknown };
        if (d.error) break;
        (d.data ?? []).forEach(u => { if (!engagers.find(e => e.author_id === u.id)) engagers.push({ platform: 'instagram', action: 'liked', author_id: u.id, author_handle: u.username ?? u.id, text: '[liked your post]', timestamp: new Date().toISOString(), raw_video_id: mediaId }); });
        url = d.paging?.next ?? null;
      }
    } catch { /* continue */ }
  }
  return engagers;
}

export async function fetchFacebookPostEngagers(postId: string, token: string | null | undefined, incComments = true, incLikers = true): Promise<Engager[]> {
  const engagers: Engager[] = [];
  if (!token) return engagers;
  if (incComments) {
    let url: string | null = `https://graph.facebook.com/v19.0/${postId}/comments?fields=id,from,message,created_time&limit=100&access_token=${token}`;
    while (url) {
      try {
        const r = await fetch(url);
        const d = await r.json() as { data?: { id: string; from?: { id: string; name: string }; message?: string; created_time?: string }[]; paging?: { next?: string }; error?: unknown };
        if (d.error) break;
        (d.data ?? []).forEach(c => engagers.push({ platform: 'facebook', action: 'commented', author_id: c.from?.id ?? c.id, author_handle: c.from?.name ?? c.id, text: c.message ?? '', timestamp: c.created_time, raw_comment_id: c.id, raw_video_id: postId }));
        url = d.paging?.next ?? null;
      } catch { break; }
    }
  }
  if (incLikers) {
    try {
      let url: string | null = `https://graph.facebook.com/v19.0/${postId}/likes?fields=id,name&limit=100&access_token=${token}`;
      while (url) {
        const r = await fetch(url);
        const d = await r.json() as { data?: { id: string; name: string }[]; paging?: { next?: string }; error?: unknown };
        if (d.error) break;
        (d.data ?? []).forEach(u => { if (!engagers.find(e => e.author_id === u.id)) engagers.push({ platform: 'facebook', action: 'liked', author_id: u.id, author_handle: u.name ?? u.id, text: '[liked your post]', timestamp: new Date().toISOString(), raw_video_id: postId }); });
        url = d.paging?.next ?? null;
      }
    } catch { /* continue */ }
  }
  return engagers;
}

export async function fetchTikTokPostEngagers(videoId: string, token: string | null | undefined): Promise<Engager[]> {
  const engagers: Engager[] = [];
  if (!token) return engagers;
  let cursor = 0, hasMore = true;
  while (hasMore && engagers.length < 1000) {
    try {
      const r = await fetch('https://open.tiktokapis.com/v2/video/comment/list/?fields=id,video_id,text,create_time,display_name,username', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, cursor, count: 100 })
      });
      const d = await r.json() as { error?: { code: string }; data?: { comments?: { id: string; username?: string; display_name?: string; text: string; create_time: number }[]; has_more?: boolean; cursor?: number } };
      if (d.error?.code && d.error.code !== 'ok') break;
      (d.data?.comments ?? []).forEach(c => engagers.push({ platform: 'tiktok', action: 'commented', author_id: c.id, author_handle: c.username ?? c.display_name ?? c.id, text: c.text ?? '', timestamp: new Date(c.create_time * 1000).toISOString(), raw_comment_id: c.id, raw_video_id: videoId }));
      hasMore = d.data?.has_more ?? false;
      cursor  = d.data?.cursor ?? 0;
    } catch { break; }
  }
  return engagers;
}

export async function fetchXPostEngagers(tweetId: string, token: string | null | undefined): Promise<Engager[]> {
  const bearerToken = token?.trim();
  if (!bearerToken) return [];

  const engagers: Engager[] = [];
  const users = new Map<string, { id: string; username?: string; name?: string }>();
  let nextToken: string | undefined;

  do {
    const params = new URLSearchParams({
      query: `conversation_id:${tweetId}`,
      'tweet.fields': 'author_id,created_at,conversation_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
      max_results: '100',
    });
    if (nextToken) params.set('next_token', nextToken);

    const r = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const d = await r.json() as {
      data?: { id: string; text: string; author_id: string; created_at?: string }[];
      includes?: { users?: { id: string; username?: string; name?: string }[] };
      errors?: { message?: string; detail?: string }[];
      meta?: { next_token?: string };
      title?: string;
      detail?: string;
    };
    if (!r.ok || d.errors) {
      const message = d.errors?.[0]?.message ?? d.errors?.[0]?.detail ?? d.detail ?? d.title ?? `X search ${r.status}`;
      if (r.status === 401) {
        throw new Error(`X authorization failed. Reconnect X and confirm the app has tweet.read, tweet.write, users.read and offline.access scopes. ${message}`);
      }
      if (r.status === 403) {
        throw new Error(`X recent search is not available for this token or API plan. Enable the required X API access for post URL campaigns, or use manual campaign input. ${message}`);
      }
      if (r.status === 429) {
        throw new Error(`X recent search rate limit reached. Retry after the X API window resets. ${message}`);
      }
      throw new Error(message);
    }

    for (const user of d.includes?.users ?? []) users.set(user.id, user);
    for (const tweet of d.data ?? []) {
      if (tweet.id === tweetId) continue;
      const user = users.get(tweet.author_id);
      engagers.push({
        platform: 'x' as Platform,
        action: 'commented' as const,
        author_id: tweet.author_id,
        author_handle: user?.username ?? user?.name ?? tweet.author_id,
        text: tweet.text ?? '',
        timestamp: tweet.created_at,
        raw_comment_id: tweet.id,
        raw_tweet_id: tweet.id,
      });
    }
    nextToken = d.meta?.next_token;
  } while (nextToken && engagers.length < 1000);

  return engagers;
}

export function extractPostId(platform: Platform, url: string): string | null {
  try {
    if (platform === 'instagram') return (url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/))?.[1] ?? null;
    if (platform === 'facebook')  return (url.match(/\/posts\/(\d+)/) ?? url.match(/fbid=(\d+)/) ?? url.match(/\/videos\/(\d+)/))?.[1] ?? null;
    if (platform === 'tiktok')    return url.match(/\/video\/(\d+)/)?.[1] ?? null;
    if (platform === 'x')         return url.match(/\/status\/(\d+)/)?.[1] ?? null;
    return null;
  } catch { return null; }
}

export async function resolveInstagramMediaId(shortcodeOrMediaId: string, token: string | null | undefined, igUserId: string | null | undefined): Promise<string> {
  if (/^\d+$/.test(shortcodeOrMediaId)) return shortcodeOrMediaId;
  if (!token) throw new Error('Meta token is missing; reconnect Meta before running Instagram post URL campaigns');
  if (!igUserId) throw new Error('Instagram Business/Creator account ID is missing; reconnect Meta after linking Instagram to a Facebook Page');

  let url: string | null = `https://graph.facebook.com/v19.0/${igUserId}/media?fields=id,permalink,timestamp&limit=100&access_token=${token}`;
  let scanned = 0;
  while (url && scanned < 500) {
    const response = await fetch(url);
    const body = await response.json() as {
      data?: { id: string; permalink?: string }[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok || body.error) {
      throw new Error(body.error?.message ?? `Instagram media lookup failed (${response.status})`);
    }
    for (const media of body.data ?? []) {
      scanned += 1;
      const permalink = media.permalink ?? '';
      if (
        permalink.includes(`/p/${shortcodeOrMediaId}`) ||
        permalink.includes(`/reel/${shortcodeOrMediaId}`) ||
        permalink.includes(`/tv/${shortcodeOrMediaId}`)
      ) {
        return media.id;
      }
    }
    url = body.paging?.next ?? null;
  }

  throw new Error('Could not resolve Instagram post URL to a media ID. Confirm the post belongs to the connected Instagram professional account.');
}

export function applyPlatformAllocation(engagersByPlatform: Record<string, Engager[]>, allocation: PlatformAllocation): Engager[] {
  const result: Engager[] = [];
  for (const [platform, pct] of Object.entries(allocation)) {
    if (!pct || pct <= 0) continue;
    const list = engagersByPlatform[platform] ?? [];
    const cap  = Math.ceil(list.length * (pct / 100));
    result.push(...list.slice(0, cap));
  }
  return result;
}

export async function runPostUrlCampaign(
  brandId: number, config: CampaignConfig, postUrls: PostUrlItem[], credentials: Credentials
): Promise<PostCampaignResults> {
  const campaignId  = String(config.id ?? config.campaign_id ?? 'post-campaign');
  const allocation  = config.platform_allocation ?? { instagram: 25, facebook: 25, tiktok: 25, x: 25 };
  const engagersByPlatform: Record<string, Engager[]> = { instagram: [], facebook: [], tiktok: [], x: [] };
  const progress = { total_fetched: 0, posts_processed: 0, errors: [] as string[] };

  for (const postUrl of postUrls) {
    const postId = postUrl.post_id_ext ?? extractPostId(postUrl.platform, postUrl.url);
    if (!postId) { progress.errors.push(`Cannot parse: ${postUrl.url}`); continue; }
    const urlId = await persistPostUrlStart(brandId, campaignId, postUrl, postId);

    try {
      let engagers: Engager[] = [];
      if      (postUrl.platform === 'instagram') {
        const mediaId = await resolveInstagramMediaId(postId, credentials.META_PAGE_ACCESS_TOKEN, credentials.META_IG_USER_ID);
        engagers = await fetchInstagramPostEngagers(mediaId, credentials.META_PAGE_ACCESS_TOKEN, postUrl.include_commenters, postUrl.include_likers);
      }
      else if (postUrl.platform === 'facebook')  engagers = await fetchFacebookPostEngagers(postId, credentials.META_PAGE_ACCESS_TOKEN, postUrl.include_commenters, postUrl.include_likers);
      else if (postUrl.platform === 'tiktok')    { engagers = await fetchTikTokPostEngagers(postId, credentials.TIKTOK_ACCESS_TOKEN); engagers.forEach(e => { e.raw_video_id = postId; }); }
      else if (postUrl.platform === 'x')         engagers = await fetchXPostEngagers(postId, credentials.X_OAUTH_TOKEN);
      await Promise.all(engagers.map(engager => persistCampaignEngager(brandId, campaignId, engager)));
      engagersByPlatform[postUrl.platform]?.push(...engagers);
      progress.total_fetched += engagers.length;
      progress.posts_processed++;
      await persistPostUrlComplete(urlId, engagers.length);
      broadcastToClients(brandId, 'post_campaign_progress', { post_url: postUrl.url, platform: postUrl.platform, fetched: engagers.length, total_so_far: progress.total_fetched });
    } catch (err) {
      const message = (err as Error).message;
      await persistPostUrlError(urlId, message);
      progress.errors.push(`${postUrl.platform} ${postUrl.url}: ${message}`);
    }
  }

  const allocated = applyPlatformAllocation(engagersByPlatform, allocation);
  broadcastToClients(brandId, 'post_campaign_fetched', { total: progress.total_fetched, after_allocation: allocated.length, by_platform: Object.fromEntries(Object.entries(engagersByPlatform).map(([p, e]) => [p, e.length])) });

  const results = { sent: 0, queued: 0, skipped: 0, manual: 0, total_errors: 0 };
  for (const engager of allocated) {
    try {
      const r = await engageEngager(brandId, { platform: engager.platform, author_handle: engager.author_handle, author_id: engager.author_id, comment_id: engager.raw_comment_id, post_id: engager.raw_video_id, tweet_id: engager.raw_tweet_id ?? engager.raw_comment_id, text: engager.text, action: engager.action }, config, credentials);
      if      (r.status === 'sent')              results.sent++;
      else if (r.status === 'queued_for_approval') results.queued++;
      else if (r.status === 'manual_copy')        results.manual++;
      else if (['rate_limited', 'already_sent', 'bot_blocked'].includes(r.status)) results.skipped++;
      else results.total_errors++;
      await updateCampaignEngagerStatus(brandId, campaignId, engager, r.status);
    } catch { results.total_errors++; }
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  broadcastToClients(brandId, 'post_campaign_complete', results);
  return { ...progress, ...results, total_engagers: allocated.length };
}

// ── BATCH PROCESSOR (live comment stream) ────────────────────────────────────
export async function processNewComments(
  brandId:        number,
  newMessages:    ClassifiedMessage[],
  campaignConfig: CampaignConfig,
  credentials:    Credentials
): Promise<{ processed: number; sent: number; queued: number; skipped: number; manual: number }> {
  if (!newMessages?.length) return { processed: 0, sent: 0, queued: 0, skipped: 0, manual: 0 };
  const results = { processed: 0, sent: 0, queued: 0, skipped: 0, manual: 0 };

  for (const msg of newMessages) {
    if (!msg.author_handle || (msg as any).replied) { results.skipped++; continue; }

    if (campaignConfig.keywords?.length) {
      const matched = campaignConfig.keywords.some(k =>
        (msg.text ?? "").toLowerCase().includes(k.toLowerCase())
      );
      if (!matched && !campaignConfig.engage_all) { results.skipped++; continue; }
    }

    if (msg.sentiment === "negative" && !campaignConfig.engage_negative) { results.skipped++; continue; }

    try {
      const r = await engageEngager(brandId, {
        platform:      msg.platform,
        author_handle: msg.author_handle,
        author_id:     msg.author_id ?? undefined,
        comment_id:    (msg.raw as any)?.comment_id ?? (msg.raw as any)?.id,
        post_id:       (msg.raw as any)?.post_id ?? (msg.raw as any)?.media_id ?? (msg.raw as any)?.video_id,
        tweet_id:      (msg.raw as any)?.tweet_id ?? (msg.raw as any)?.id,
        text:          msg.text,
      }, campaignConfig, credentials);

      results.processed++;
      if      (r.status === "sent")               results.sent++;
      else if (r.status === "queued_for_approval") results.queued++;
      else if (r.status === "manual_copy")         results.manual++;
      else                                         results.skipped++;
    } catch { results.skipped++; }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  broadcastToClients(brandId, "engage_batch_complete", results);
  return results;
}
