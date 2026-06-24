// src/auth/platformSync.ts
import prisma from '../db/prisma';
import { runAgent1 } from '../agents/agent1_listening';
import { contextualFallbackReply, runAgent4 } from '../agents/agent4_reply_assistant';
import { persistAgent1Result } from '../db/queries';
import { RawMessage, Platform } from '../types';
import { enqueueForApproval } from '../stream/eventQueue';

interface SyncResult {
  brand_id:    number;
  total_items: number;
  items:       import('../types').ClassifiedMessage[];
  errors:      string[];
}

async function fetchInstagramComments(
  mediaId: string,
  accessToken: string
): Promise<RawMessage[]> {
  const items: RawMessage[] = [];
  let url: string | null =
    `https://graph.facebook.com/v19.0/${mediaId}/comments` +
    `?fields=id,username,text,timestamp&limit=100&access_token=${accessToken}`;

  while (url) {
    try {
      const res  = await fetch(url);
      const data = await res.json() as {
        data: { id: string; username: string; text: string; timestamp: string }[];
        paging?: { next?: string };
        error?: { message: string };
      };
      if (data.error) break;

      (data.data ?? []).forEach(c => items.push({
        platform:      'instagram',
        kind:          'comment',
        text:          c.text,
        author_handle: c.username,
        url:           null,
        metrics:       { likes: 0, replies: 0, shares: 0, views: 0 },
        raw:           { ...c, media_id: mediaId },
      }));
      url = data.paging?.next ?? null;
    } catch {
      break;
    }
  }
  return items;
}

async function fetchXMentions(
  bearerToken: string,
  accountId: string
): Promise<RawMessage[]> {
  try {
    const res  = await fetch(
      `https://api.x.com/2/users/${accountId}/mentions` +
      `?tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username&max_results=100`,
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );
    const data = await res.json() as {
      data?: { id: string; text: string; created_at: string; author_id?: string; public_metrics: { like_count: number } }[];
      includes?: { users?: { id: string; username?: string }[] };
      errors?: unknown;
    };
    if (data.errors || !data.data) return [];
    const usersById = new Map((data.includes?.users ?? []).map(user => [user.id, user.username ?? null]));

    return data.data.map(t => ({
      platform:      'x' as Platform,
      kind:          'mention',
      text:          t.text,
      author_handle: t.author_id ? usersById.get(t.author_id) ?? null : null,
      author_id:     t.author_id ?? null,
      url:           `https://x.com/i/web/status/${t.id}`,
      metrics: {
        likes:   t.public_metrics?.like_count ?? 0,
        replies: 0, shares: 0, views: 0,
      },
      raw: t,
    }));
  } catch {
    return [];
  }
}

function replyChannelFor(platform: Platform): 'dm' | 'thread_reply' | 'comment_reply' {
  if (platform === 'x') return 'thread_reply';
  if (platform === 'tiktok') return 'comment_reply';
  return 'comment_reply';
}

async function queueAiReplyDraft(brandId: number, item: RawMessage): Promise<void> {
  const author = item.author_handle?.trim() || item.author_id?.trim() || 'customer';
  const payload = {
    brand_id: brandId,
    message: item.text,
    platform: item.platform,
    tone: 'Empathetic',
    reply_format: 'helpful' as const,
    variation_seed: `${item.platform}:${String(item.raw?.['id'] ?? item.url ?? item.text).slice(0, 80)}`,
    campaign_context: {
      name: 'AI Reply Engine',
      objective: 'draft a helpful reply to a non-campaign social mention or comment',
    },
    ruleset: {
      tone: 'Empathetic',
      do_not_say: ['internal policy', 'AI generated'],
    },
    author_handle: author,
    reply_channel: replyChannelFor(item.platform),
  };
  const generated = await runAgent4(payload);
  const suggestion = generated.replies?.[0] ?? generated.suggestions?.[0] ?? contextualFallbackReply(payload);
  const rawId = typeof item.raw?.['id'] === 'string' ? item.raw['id'] : null;
  const mediaId = typeof item.raw?.['media_id'] === 'string' ? item.raw['media_id'] : null;
  await enqueueForApproval({
    brand_id: brandId,
    platform: item.platform,
    author,
    original: item.text,
    reply: suggestion.text ?? suggestion.reply_text ?? '',
    delivery_error: generated.error ? `AI provider fallback used: ${generated.error}` : undefined,
    meta: {
      author_id: item.author_id ?? (typeof item.raw?.['author_id'] === 'string' ? item.raw['author_id'] : null),
      comment_id: item.platform === 'x' ? null : rawId,
      post_id: mediaId,
      tweet_id: item.platform === 'x' ? rawId : null,
    },
  });
}

export async function syncAllPlatforms(brandId: number): Promise<SyncResult> {
  const allItems: import('../types').ClassifiedMessage[] = [];
  const errors:   string[] = [];

  try {
    const accounts = await prisma.connectedAccount.findMany({
      where: { brandId, isActive: true },
      select: {
        platform: true,
        accessToken: true,
        accountIdExt: true,
      },
    });

    for (const account of accounts) {
      try {
        let rawItems: RawMessage[] = [];

        if (account.platform === 'instagram') {
          // Fetch recent media first
          const mediaRes  = await fetch(
            `https://graph.facebook.com/v19.0/${account.accountIdExt}/media` +
            `?fields=id&limit=10&access_token=${account.accessToken}`
          );
          const mediaData = await mediaRes.json() as {
            data?: { id: string }[];
          };

          for (const media of mediaData.data ?? []) {
            const comments = await fetchInstagramComments(media.id, account.accessToken);
            rawItems.push(...comments);
          }
        } else if (account.platform === 'x') {
          rawItems = account.accountIdExt ? await fetchXMentions(account.accessToken, account.accountIdExt) : [];
        }

        if (rawItems.length > 0) {
          const result = await runAgent1({
            brand_id:     brandId,
            platform:     account.platform as Platform,
            payload_type: 'api_items',
            source_name:  `oauth_${account.platform}`,
            items:        rawItems,
          });
          await persistAgent1Result(brandId, result);
          await Promise.allSettled(rawItems.map(item => queueAiReplyDraft(brandId, item)));
          allItems.push(...result.classified);
        }
      } catch (err) {
        errors.push(`${account.platform}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`DB error: ${(err as Error).message}`);
  }

  return { brand_id: brandId, total_items: allItems.length, items: allItems, errors };
}
