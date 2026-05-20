// src/agents/agent4_reply_assistant.ts
import Anthropic from '@anthropic-ai/sdk';
import { Agent4Payload, Agent4Result } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runAgent4(payload: Agent4Payload): Promise<Agent4Result> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 2048,
      system: `You are Agent_Reply, an expert social media reply writer.
Generate exactly 3 reply options for the given message.
Each reply must feel personal (use @handle), match the brand tone, include the CTA link, and stay under 280 characters for X.

Return ONLY valid JSON:
{
  "replies": [
    { "text": "...", "tone": "Direct|Warm|Empathetic|Playful|Professional|Conversion", "confidence": 0-100, "risk_flags": [] },
    ...
  ]
}`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as Agent4Result;
  } catch (err) {
    return { replies: [], error: (err as Error).message };
  }
}
