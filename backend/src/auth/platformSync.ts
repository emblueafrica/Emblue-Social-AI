// src/auth/platformSync.ts
import prisma from '../db/prisma';
import { runAgent1 } from '../agents/agent1_listening';
import { persistAgent1Result } from '../db/queries';
import { RawMessage, Platform } from '../types';

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
        raw:           c,
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
      `?tweet.fields=created_at,public_metrics&max_results=100`,
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );
    const data = await res.json() as {
      data?: { id: string; text: string; created_at: string; public_metrics: { like_count: number } }[];
      errors?: unknown;
    };
    if (data.errors || !data.data) return [];

    return data.data.map(t => ({
      platform:      'x' as Platform,
      kind:          'mention',
      text:          t.text,
      author_handle: null,
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
