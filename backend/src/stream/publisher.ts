// src/stream/publisher.ts — Reply publisher (fires approved replies to platform APIs)
import prisma from "../db/prisma";
import { broadcastToClients } from "./eventQueue";
import { Platform } from "../types";

export interface PublishPayload {
  brand_id:      number;
  platform:      Platform;
  reply_text:    string;
  author_id?:    string;
  comment_id?:   string;
  tweet_id?:     string;
  image_url?:    string;
  tracked_link?: string;
  approval_id?:  number;
}

export interface PublishResult {
  success:    boolean;
  platform:   Platform;
  message_id?: string;
  error?:     string;
}

async function getToken(brandId: number, platform: Platform): Promise<string | null> {
  const row = await prisma.connectedAccount.findFirst({
    where: { brandId, platform: platform as never, isActive: true },
    select: { accessToken: true },
  });
  return row?.accessToken ?? null;
}

export async function publishReply(payload: PublishPayload): Promise<PublishResult> {
  const { brand_id, platform, reply_text } = payload;
  const token = await getToken(brand_id, platform);

  const result: PublishResult = { success: false, platform };

  if (platform === "instagram" || platform === "facebook") {
    if (!token) { result.error = "No Meta token"; } else {
      try {
        const r = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient: { id: payload.author_id }, message: { text: reply_text }, messaging_type: "RESPONSE" })
        });
        const d = await r.json() as { message_id?: string; error?: { message: string } };
        if (d.error) result.error = d.error.message;
        else { result.success = true; result.message_id = d.message_id; }
      } catch (err) { result.error = (err as Error).message; }
    }
  } else if (platform === "x") {
    const xToken = process.env.X_OAUTH_TOKEN ?? token;
    if (!xToken) { result.error = "No X token"; } else {
      try {
        const r = await fetch("https://api.twitter.com/2/tweets", {
          method: "POST",
          headers: { "Authorization": `Bearer ${xToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: reply_text, ...(payload.tweet_id && { reply: { in_reply_to_tweet_id: payload.tweet_id } }) })
        });
        const d = await r.json() as { data?: { id: string }; errors?: { message: string }[] };
        if (d.errors) result.error = d.errors[0]?.message ?? "X error";
        else { result.success = true; result.message_id = d.data?.id; }
      } catch (err) { result.error = (err as Error).message; }
    }
  } else if (platform === "tiktok") {
    const tikToken = process.env.TIKTOK_ACCESS_TOKEN ?? token;
    if (!tikToken) { result.error = "No TikTok token"; } else {
      try {
        const r = await fetch("https://open.tiktokapis.com/v2/comment/reply/post/", {
          method: "POST",
          headers: { "Authorization": `Bearer ${tikToken}`, "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ video_id: payload.comment_id, comment_id: payload.comment_id, text: reply_text.slice(0, 150) })
        });
        const d = await r.json() as { error?: { code: string; message: string }; data?: { comment_id: string } };
        if (d.error?.code && d.error.code !== "ok") result.error = d.error.message;
        else { result.success = true; result.message_id = d.data?.comment_id; }
      } catch (err) { result.error = (err as Error).message; }
    }
  }

  // Log and broadcast
  if (result.success) {
    try {
      await prisma.autoEngagement.create({
        data: {
          brandId: brand_id,
          platform: platform as never,
          replyText: reply_text,
          status: 'sent',
          firedAt: new Date(),
        },
      });
    } catch { /* non-fatal */ }
    broadcastToClients(brand_id, "reply_published", { platform, message_id: result.message_id, preview: reply_text.slice(0, 80) });
  } else {
    console.error(`[Publisher] ${platform} publish failed:`, result.error);
    broadcastToClients(brand_id, "reply_failed", { platform, error: result.error });
  }

  return result;
}
