// src/agents/agent4_reply_assistant.ts
import Anthropic from '@anthropic-ai/sdk';
import { Agent4Payload, Agent4Result, ReplySuggestion } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY });

type ReplyFormat = NonNullable<Agent4Payload['reply_format']>;

function handleForReply(handle: string | undefined): string {
  const cleaned = (handle ?? '').trim();
  if (!cleaned) return '';
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
}

function stripQuotedMention(text: string): string {
  return text.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}

function clipReply(text: string, max = 260): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function requestedTone(payload: Agent4Payload): string {
  return (payload.ruleset?.tone || payload.tone || 'Professional').trim() || 'Professional';
}

function requestedFormat(payload: Agent4Payload): ReplyFormat {
  const format = payload.reply_format;
  if (format === 'short' || format === 'helpful' || format === 'question' || format === 'conversion' || format === 'de_escalation') {
    return format;
  }
  return 'helpful';
}

function looksLikeSuspicion(text: string): boolean {
  return /\b(sketchy|scam|fake|fraud|suspicious|shady|fishy|not legit|looks off|dodgy)\b/i.test(text);
}

function looksLikeComplaint(text: string): boolean {
  return /\b(bad|terrible|awful|angry|upset|issue|problem|wrong|broken|disappointed|complain|complaint|hate)\b/i.test(text);
}

function looksLikeQuestion(text: string): boolean {
  return /\?|\b(how|what|why|when|where|can you|could you|do you|is this|are you)\b/i.test(text);
}

export function contextualFallbackReply(payload: Agent4Payload): ReplySuggestion {
  const handle = handleForReply(payload.author_handle);
  const prefix = handle ? `${handle} ` : '';
  const message = stripQuotedMention(payload.message ?? '');
  const cta = payload.campaign_context?.cta_link ? ` ${payload.campaign_context.cta_link}` : '';
  const tone = requestedTone(payload);
  const format = requestedFormat(payload);

  let text: string;
  if (format === 'short') {
    text = looksLikeQuestion(message)
      ? `${prefix}Good question. We will check and reply clearly.${cta}`
      : `${prefix}Noted. We are reviewing this and will respond with useful details.${cta}`;
  } else if (format === 'question') {
    text = looksLikeSuspicion(message)
      ? `${prefix}What specifically looked suspicious to you? Share the detail so we can respond factually.${cta}`
      : `${prefix}Can you share one more detail so we can point you to the right answer?${cta}`;
  } else if (format === 'conversion') {
    text = `${prefix}We can help with this. Send the detail you need and we will point you to the next step.${cta}`;
  } else if (format === 'de_escalation' || looksLikeSuspicion(message)) {
    text = `${prefix}That concern is noted. Please share the specific detail so we can address it carefully and factually.${cta}`;
  } else if (looksLikeComplaint(message)) {
    text = `${prefix}Thanks for flagging this. We understand the concern and will review the details carefully before responding further.${cta}`;
  } else if (looksLikeQuestion(message)) {
    text = `${prefix}Good question. We are checking the details and will respond with the clearest answer we can.${cta}`;
  } else {
    text = `${prefix}Thanks for the comment. We are reviewing this and will follow up with a useful response.${cta}`;
  }

  return {
    text: clipReply(text),
    tone,
    confidence: 65,
    risk_flags: ['fallback_reply'],
  };
}

function parseAgentJson(raw: string): Agent4Result {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Agent4Result;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Agent 4 returned non-JSON output');
    return JSON.parse(match[0]) as Agent4Result;
  }
}

function normalizeReplies(result: Agent4Result): ReplySuggestion[] {
  return (result.replies ?? result.suggestions ?? [])
    .filter(reply => typeof reply?.text === 'string' || typeof reply?.reply_text === 'string')
    .map(reply => ({
      text: clipReply(reply.text ?? reply.reply_text ?? ''),
      tone: reply.tone ?? 'Professional',
      confidence: Math.max(0, Math.min(100, Math.round(reply.confidence ?? 75))),
      risk_flags: reply.risk_flags ?? [],
    }))
    .filter(reply => reply.text.length > 0);
}

export async function runAgent4(payload: Agent4Payload): Promise<Agent4Result> {
  try {
    const tone = requestedTone(payload);
    const format = requestedFormat(payload);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 2048,
      system: `You are Agent_Reply, an expert social media reply writer.
Generate exactly 3 reply options for the given message.
Each reply must feel personal, use the provided author_handle when present, match the requested brand tone exactly, and stay under 280 characters for X.
Only include a CTA link when campaign_context.cta_link is present.
Read the actual message and respond to its meaning. Do not use generic customer-support filler.
Never say "Thanks for reaching out" unless the user clearly asked for help.
For hostile, accusatory, suspicious, or risky comments, stay calm, ask for specifics, avoid validating unverified claims, and keep the discussion factual.
For comments accusing someone or a profile of being sketchy/scam/fake, acknowledge the concern without repeating the accusation as fact.
Do not invent facts, promises, investigations, discounts, or private actions.
Requested tone: ${tone}.
Requested reply format: ${format}.
Format rules:
- short: one compact sentence.
- helpful: answer directly and add one useful next step.
- question: ask one clear follow-up question.
- conversion: guide toward the CTA or next action without pressure.
- de_escalation: calm, factual, and non-defensive.
Use variation_seed only to avoid repeating prior wording; do not mention it.

Return ONLY valid JSON:
{
  "replies": [
    { "text": "...", "tone": "Direct|Warm|Empathetic|Playful|Professional|Conversion", "confidence": 0-100, "risk_flags": [] },
    ...
  ]
}`,
      messages: [{ role: 'user', content: JSON.stringify({ ...payload, tone, reply_format: format }) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = parseAgentJson(raw);
    const replies = normalizeReplies(parsed);
    if (!replies.length) {
      return { replies: [contextualFallbackReply(payload)], error: parsed.error ?? 'Agent 4 returned no usable reply suggestions' };
    }
    return { replies };
  } catch (err) {
    return { replies: [contextualFallbackReply(payload)], error: (err as Error).message };
  }
}
