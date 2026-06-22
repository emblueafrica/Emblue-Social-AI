// src/stream/eventQueue.ts
import { Response } from 'express';
import { ApprovalQueueItem, SseClient } from '../types';
import { hasToolAccess } from '../tools/access';
import { ToolId } from '../tools/registry';
import prisma from '../db/prisma';
import { Prisma } from '@prisma/client';

// In-memory SSE client registry — keyed by brand_id
const clients = new Map<number, Set<Response>>();

const EVENT_TOOL_ACCESS: Record<string, ToolId> = {
  sync_complete: 'tool_1',
  listening_monitoring_complete: 'tool_1',
  listening_high_urgency: 'tool_1',
  listening_search_complete: 'tool_1',
  listening_search_failed: 'tool_1',
  new_message: 'tool_9',
  warroom_update: 'tool_9',
  approval_queued: 'tool_3',
  reply_approved: 'tool_3',
  reply_skipped: 'tool_3',
  reply_published: 'tool_3',
  reply_failed: 'tool_3',
  bot_blocked: 'tool_10',
  engage_queued: 'tool_10',
  engage_fired: 'tool_10',
  engage_manual_copy: 'tool_10',
  post_campaign_progress: 'tool_10',
  post_campaign_fetched: 'tool_10',
  post_campaign_complete: 'tool_10',
  engage_batch_complete: 'tool_10',
};

// ── SSE CLIENT MANAGEMENT ─────────────────────────────────────────────────────
export function addSseClient(brandId: number, res: Response): void {
  if (!clients.has(brandId)) {
    clients.set(brandId, new Set());
  }
  clients.get(brandId)!.add(res);

  res.on('close', () => {
    clients.get(brandId)?.delete(res);
    if (clients.get(brandId)?.size === 0) {
      clients.delete(brandId);
    }
  });
}

export function broadcastToClients(
  brandId: number,
  event:   string,
  data:    unknown
): void {
  void broadcastAllowedEvent(brandId, event, data);
}

async function broadcastAllowedEvent(
  brandId: number,
  event:   string,
  data:    unknown
): Promise<void> {
  const brandClients = clients.get(brandId);
  if (!brandClients?.size) return;

  const requiredTool = EVENT_TOOL_ACCESS[event];
  if (requiredTool) {
    try {
      if (!(await hasToolAccess(brandId, requiredTool))) return;
    } catch (err) {
      console.error(`[SSE] tool access filter failed for brand ${brandId}:`, (err as Error).message);
      return;
    }
  }

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  brandClients.forEach(res => {
    try {
      res.write(payload);
    } catch (_) {
      brandClients.delete(res);
    }
  });
}

// ── APPROVAL QUEUE ────────────────────────────────────────────────────────────
export async function enqueueForApproval(item: ApprovalQueueItem): Promise<void> {
  const commentId = item.meta?.comment_id ?? null;
  const tweetId = item.meta?.tweet_id ?? null;
  const postId = item.meta?.post_id ?? null;
  const authorId = item.meta?.author_id ?? null;
  const duplicate: Prisma.ApprovalQueueWhereInput = tweetId
    ? { brandId: item.brand_id, platform: item.platform as never, tweetId, status: 'pending' }
    : commentId
      ? { brandId: item.brand_id, platform: item.platform as never, commentId, status: 'pending' }
      : { brandId: item.brand_id, platform: item.platform as never, postId, authorId, originalText: item.original, status: 'pending' };

  const existing = await prisma.approvalQueue.findFirst({ where: duplicate, select: { queueId: true } });
  if (existing) return;
  await prisma.approvalQueue.create({
    data: {
      brandId: item.brand_id,
      campaignId: item.campaign_id ? BigInt(item.campaign_id) : null,
      platform: item.platform as never,
      authorId,
      authorHandle: item.author,
      originalText: item.original,
      replyText: item.reply,
      commentId,
      postId,
      tweetId,
      deliveryError: item.delivery_error ?? (typeof item.manual_copy_instructions === 'string' ? item.manual_copy_instructions : null),
      confidence: item.manual_copy_required ? 50 : 80,
      status: 'pending',
    },
  });
  broadcastToClients(item.brand_id, 'approval_queued', {
    platform: item.platform,
    author:   item.author,
    preview:  item.reply.slice(0, 80),
  });
}

export function getClientCount(): { total: number; brands: number } {
  let total = 0;
  clients.forEach(set => { total += set.size; });
  return { total, brands: clients.size };
}
