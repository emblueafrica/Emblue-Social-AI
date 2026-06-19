// src/stream/publisher.ts — Reply publisher (fires approved replies to platform APIs)
import prisma from "../db/prisma";
import { broadcastToClients } from "./eventQueue";
import { getValidToken } from "../auth/platformAuth";
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
  media_ids?:    string[];
}

export interface PublishResult {
  success:    boolean;
  platform:   Platform;
  message_id?: string;
  error?:     string;
}

export async function publishReply(payload: PublishPayload): Promise<PublishResult> {
  const { brand_id, platform, reply_text } = payload;
  // getValidToken refreshes the token transparently when it is near expiry.
  const token = await getValidToken(brand_id, platform);

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
    const xToken = token;
    if (!xToken) { result.error = "No X token"; } else {
      try {
        const r = await fetch("https://api.x.com/2/tweets", {
          method: "POST",
          headers: { "Authorization": `Bearer ${xToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: reply_text,
            ...(payload.tweet_id && { reply: { in_reply_to_tweet_id: payload.tweet_id } }),
            ...(payload.media_ids?.length && { media: { media_ids: payload.media_ids } }),
          })
        });
        const d = await r.json() as {
          data?: { id: string };
          errors?: { message?: string; detail?: string }[];
          title?: string;
          detail?: string;
        };
        if (!r.ok || d.errors || !d.data?.id) {
          result.error = d.errors?.[0]?.message ?? d.errors?.[0]?.detail ?? d.detail ?? d.title ?? `X publish failed (${r.status})`;
        } else {
          result.success = true;
          result.message_id = d.data.id;
        }
      } catch (err) { result.error = (err as Error).message; }
    }
  } else if (platform === "tiktok") {
    const tikToken = token;
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

export async function uploadXMediaFromUrl(
  brandId: number,
  media: { url: string; mime_type: string; media_type: 'image' | 'video' },
  index = 0,
): Promise<{ success: boolean; media_id?: string; error?: string }> {
  const token = await getValidToken(brandId, 'x');
  if (!token) return { success: false, error: 'No X token' };
  try {
    const source = await fetch(media.url);
    if (!source.ok) return { success: false, error: `Could not download campaign media (${source.status})` };
    const bytes = await source.arrayBuffer();
    if (bytes.byteLength > 100 * 1024 * 1024) return { success: false, error: 'X campaign media exceeds the 100MB application limit' };

    const extension = media.mime_type === 'image/jpeg' ? 'jpg'
      : media.mime_type === 'image/png' ? 'png'
      : media.mime_type === 'image/webp' ? 'webp'
      : media.mime_type === 'video/quicktime' ? 'mov' : 'mp4';
    const form = new FormData();
    form.append('media', new Blob([bytes], { type: media.mime_type }), `campaign-${index + 1}.${extension}`);
    form.append('media_category', media.media_type === 'video' ? 'tweet_video' : 'tweet_image');
    form.append('media_type', media.mime_type);

    const response = await fetch('https://api.x.com/2/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = await response.json() as {
      data?: { id?: string; media_id?: string; media_id_string?: string };
      media_id?: string;
      media_id_string?: string;
      errors?: { message?: string; detail?: string }[];
      detail?: string;
      title?: string;
    };
    const mediaId = body.data?.id ?? body.data?.media_id_string ?? body.data?.media_id ?? body.media_id_string ?? body.media_id;
    if (!response.ok || !mediaId) {
      return { success: false, error: body.errors?.[0]?.detail ?? body.errors?.[0]?.message ?? body.detail ?? body.title ?? `X media upload failed (${response.status})` };
    }
    return { success: true, media_id: mediaId };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
