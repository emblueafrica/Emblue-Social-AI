import { apiRequest, type ApprovalQueueItem, type QueueAttachmentPayload } from "@/lib/api";

export type AiReplyPlatform = "instagram" | "facebook" | "x" | "tiktok" | "youtube" | "reddit" | "whatsapp";

export type AiReplyRequest = {
  brand_id: number;
  message: string;
  platform: AiReplyPlatform;
  tone: string;
  reply_format?: "short" | "helpful" | "question" | "conversion" | "de_escalation";
  variation_seed?: string;
  campaign_context: {
    name?: string;
    objective: string;
    cta_link?: string;
    action_type?: string;
  };
  ruleset: {
    tone: string;
    required_words?: string[];
    do_not_say?: string[];
  };
  author_handle?: string;
  reply_channel?: "dm" | "thread_reply" | "comment_reply";
};

export type AiReplySuggestion = {
  text: string;
  reply_text?: string;
  tone: string;
  confidence: number;
  risk_flags?: string[];
};

export type AiReplyResponse = {
  replies?: AiReplySuggestion[];
  suggestions?: AiReplySuggestion[];
  error?: string;
};

export function generateAiReplies(payload: AiReplyRequest) {
  return apiRequest<AiReplyResponse>("/api/v1/reply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAiReplyQueue(brandId: number) {
  return apiRequest<{ queue: ApprovalQueueItem[] }>(`/api/v1/rt/reply-queue/${brandId}`);
}

export function approveAiReplyQueueItem(
  brandId: number,
  queueId: number | string,
  replyText?: string,
  attachments: QueueAttachmentPayload = {},
) {
  return apiRequest<{
    ok: true;
    item: ApprovalQueueItem;
    publish?: { success: boolean; platform: AiReplyPlatform; message_id?: string; error?: string };
  }>(`/api/v1/rt/queue/${encodeURIComponent(String(queueId))}/approve`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, reply_text: replyText, ...attachments }),
  });
}

export function skipAiReplyQueueItem(brandId: number, queueId: number | string) {
  return apiRequest<{ ok: true; item: ApprovalQueueItem }>(`/api/v1/rt/queue/${encodeURIComponent(String(queueId))}/skip`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId }),
  });
}
