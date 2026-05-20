// src/agents/agents567.ts
import Anthropic from '@anthropic-ai/sdk';
import { Agent6Payload, Agent6Result } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface RiskPayload {
  brand_id: number;
  message: string;
  author_handle?: string;
  escalation_keywords?: string[];
}

export interface RiskResult {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  reason?: string;
  matched_keywords?: string[];
  recommended_action?: string;
  error?: string;
}

function normalizeRiskLevel(value: unknown): RiskResult['risk_level'] {
  return value === 'medium' || value === 'high' || value === 'critical' ? value : 'low';
}

export async function runAgent6(payload: Agent6Payload): Promise<Agent6Result> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1536,
      system: `You are Agent_KPI, a social performance analyst.
Create an executive KPI snapshot for the requested brand, dates, and platforms.
Return ONLY valid JSON:
{
  "kpis": [{ "metric": "...", "value": 0, "change": "..." }],
  "alerts": ["..."],
  "listening_kpi": 0-100,
  "reply_kpi": 0-100,
  "funnel_kpi": 0-100,
  "risk_events": 0
}`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(raw) as Agent6Result;

    return {
      kpis: parsed.kpis ?? [],
      alerts: parsed.alerts ?? [],
      listening_kpi: Number(parsed.listening_kpi ?? 0),
      reply_kpi: Number(parsed.reply_kpi ?? 0),
      funnel_kpi: Number(parsed.funnel_kpi ?? 0),
      risk_events: Number(parsed.risk_events ?? 0),
      error: parsed.error,
    };
  } catch (err) {
    return {
      kpis: [],
      alerts: [],
      listening_kpi: 0,
      reply_kpi: 0,
      funnel_kpi: 0,
      risk_events: 0,
      error: (err as Error).message,
    };
  }
}

export async function runAgent7(payload: RiskPayload): Promise<RiskResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      system: `You are Agent_RiskEscalation.
Assess whether a social media message needs escalation.
Escalate threats, legal issues, safety issues, discrimination, fraud claims, severe complaints, or watchlist keyword matches.
Return ONLY valid JSON:
{
  "risk_level": "low|medium|high|critical",
  "reason": "...",
  "matched_keywords": ["..."],
  "recommended_action": "..."
}`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(raw) as Partial<RiskResult>;

    return {
      risk_level: normalizeRiskLevel(parsed.risk_level),
      reason: parsed.reason,
      matched_keywords: parsed.matched_keywords ?? [],
      recommended_action: parsed.recommended_action,
      error: parsed.error,
    };
  } catch (err) {
    const message = payload.message.toLowerCase();
    const matchedKeywords = (payload.escalation_keywords ?? []).filter(keyword =>
      keyword && message.includes(keyword.toLowerCase())
    );

    return {
      risk_level: matchedKeywords.length ? 'high' : 'low',
      reason: matchedKeywords.length ? 'Matched escalation keyword' : 'Risk analysis unavailable',
      matched_keywords: matchedKeywords,
      error: (err as Error).message,
    };
  }
}
