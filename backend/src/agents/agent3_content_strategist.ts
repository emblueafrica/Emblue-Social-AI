// src/agents/agent3_content_strategist.ts
import Anthropic from '@anthropic-ai/sdk';
import { Agent3Payload, Agent3Result, ContentRecommendation, Platform } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function normalizeRecommendation(rec: Partial<ContentRecommendation>, fallbackPlatform: Platform): ContentRecommendation {
  return {
    platform: rec.platform ?? fallbackPlatform,
    format: rec.format ?? 'post',
    headline: rec.headline ?? 'Audience-led content idea',
    brief: rec.brief ?? 'Create content that directly addresses the strongest audience conversation cluster.',
    status: rec.status ?? 'idea',
  };
}

export async function runAgent3(payload: Agent3Payload): Promise<Agent3Result> {
  if (!payload.clusters.length) {
    return { recommendations: [] };
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are Agent_ContentStrategist, a senior social strategist.
Turn audience clusters into practical campaign content recommendations.
Respect the requested platforms, objective, and tone.
Return ONLY valid JSON:
{
  "recommendations": [
    {
      "platform": "instagram|facebook|x|tiktok|youtube|reddit|whatsapp",
      "format": "post|reel|thread|story|carousel|video",
      "headline": "...",
      "brief": "...",
      "status": "idea"
    }
  ]
}`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(raw) as Partial<Agent3Result>;
    const fallbackPlatform = payload.platforms_target[0] ?? 'instagram';

    return {
      recommendations: (parsed.recommendations ?? []).map(rec => normalizeRecommendation(rec, fallbackPlatform)),
      error: parsed.error,
    };
  } catch (err) {
    return { recommendations: [], error: (err as Error).message };
  }
}
