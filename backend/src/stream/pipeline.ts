// src/stream/pipeline.ts — Real-time message processing pipeline
import { runAgent1 }  from "../agents/agent1_listening";
import { runAgent12 } from "../agents/agents9_to_14";
import { RiskPayload, runAgent7 } from "../agents/agents567";
import { insertClassifiedMessage, getConnectedAccount, getBrandById } from "../db/queries";
import prisma from "../db/prisma";
import { mapEngageCampaign } from "../db/mappers";
import { broadcastToClients } from "./eventQueue";
import { processNewComments } from "./engageEngagers";
import { ClassifiedMessage, Platform, Credentials } from "../types";
import { hasToolAccess } from "../tools/access";

export interface PipelineInput {
  brand_id:    number;
  platform:    Platform;
  raw_message: {
    text:          string;
    author_handle: string;
    author_id?:    string;
    comment_id?:   string;
    post_id?:      string;
    tweet_id?:     string;
    url?:          string;
    timestamp?:    string;
  };
}

export interface PipelineResult {
  message_id?:  number | null;
  classified:   ClassifiedMessage;
  risk:         "low" | "medium" | "high" | "critical";
  engaged:      boolean;
  engage_status?: string;
}

export async function processThroughPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { brand_id, platform, raw_message } = input;

  if (!(await hasToolAccess(brand_id, "tool_1"))) {
    throw new Error("Tool not enabled: tool_1");
  }

  // Step 1: Classify with Agent 1
  const agent1Result = await runAgent1({
    brand_id,
    platform,
    payload_type: "api_items",
    source_name:  "realtime_webhook",
    items: [{
      platform,
      kind:          "comment",
      text:          raw_message.text,
      author_handle: raw_message.author_handle,
      author_id:     raw_message.author_id,
      url:           raw_message.url ?? null,
    }],
  });

  const classified = agent1Result.classified[0];
  if (!classified) throw new Error("Classification failed");

  const warRoomEnabled = await hasToolAccess(brand_id, "tool_9");
  const engagersEnabled = await hasToolAccess(brand_id, "tool_10");

  // Step 2: Risk check with Agent 7 when War Room or engagement automation needs it
  const brand = await getBrandById(brand_id);
  let risk: PipelineResult["risk"] = "low";

  if (warRoomEnabled || engagersEnabled) {
    const watchlistKeywords = brand?.watchlist_keywords ?? [];
    const riskPayload: RiskPayload = {
      brand_id,
      message:              raw_message.text,
      author_handle:        raw_message.author_handle,
      escalation_keywords:  watchlistKeywords,
    };
    const riskResult = await runAgent7(riskPayload);
    risk = riskResult.risk_level;
  }

  // Step 3: Persist
  const messageId = await insertClassifiedMessage(brand_id, {
    ...classified,
    author_id: raw_message.author_id ?? null,
  });

  // Step 4: Broadcast to War Room SSE when enabled
  if (warRoomEnabled) {
    broadcastToClients(brand_id, "new_message", {
      text:     raw_message.text.slice(0, 100),
      platform,
      author:   raw_message.author_handle,
      sentiment: classified.sentiment,
      urgency:   classified.urgency_score,
      risk,
    });
  }

  // Step 5: Engage if not high risk
  let engaged = false;
  let engage_status: string | undefined;

  if (engagersEnabled && risk !== "high" && risk !== "critical") {
    const campaigns = await prisma.engageCampaign.findMany({
      where: { brandId: brand_id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (campaigns.length) {
      const accessToken = await getConnectedAccount(brand_id, platform);
      const credentials: Credentials = {
        META_PAGE_ACCESS_TOKEN: platform === "instagram" || platform === "facebook" ? accessToken?.access_token : null,
        X_OAUTH_TOKEN:          platform === "x" ? accessToken?.access_token : null,
        TIKTOK_ACCESS_TOKEN:    platform === "tiktok" ? accessToken?.access_token : process.env.TIKTOK_ACCESS_TOKEN,
      };

      const enrichedMsg: ClassifiedMessage = {
        ...classified,
        raw: { comment_id: raw_message.comment_id, post_id: raw_message.post_id, tweet_id: raw_message.tweet_id, media_id: raw_message.post_id },
        author_id: raw_message.author_id ?? null,
      };

      const engageResults = await processNewComments(brand_id, [enrichedMsg], mapEngageCampaign(campaigns[0]!), credentials);
      engaged        = engageResults.sent > 0 || engageResults.queued > 0;
      engage_status  = `sent:${engageResults.sent} queued:${engageResults.queued}`;
    }
  }

  return { message_id: messageId, classified, risk, engaged, engage_status };
}
