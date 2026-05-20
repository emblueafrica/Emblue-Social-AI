// src/agents/agent9_creative_predictor.ts
import Anthropic from '@anthropic-ai/sdk';
import { Agent9Payload, Agent9Result } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runAgent9(payload: Agent9Payload): Promise<Agent9Result> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 3000,
      system: `You are Agent_CreativePredictor. Score social media captions before they are posted.
Return a detailed analysis with grade (A-F), scores (0-100) for comment/save/share/reach potential,
ranked next_actions with before/after examples, a complete rewrite, and 3 alt hooks.
Return ONLY valid JSON matching the Agent9Result interface.`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as Agent9Result;
  } catch (err) {
    return {
      grade: 'C', overall_score: 50, verdict: 'Analysis unavailable.',
      scores: {}, next_actions: [], error: (err as Error).message
    };
  }
}

// ── AGENT 10: COMMENT MINER ───────────────────────────────────────────────────
import { Agent10Payload, Agent10Result } from '../types';

export async function runAgent10(payload: Agent10Payload): Promise<Agent10Result> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 4096,
      system: `You are Agent_CommentMiner. Extract structured intelligence from social media comments.
Return: faqs (question, frequency, platforms[]), pain_points (text, severity, frequency), summary.
Return ONLY valid JSON: { "faqs":[...], "pain_points":[...], "summary":"..." }`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as Agent10Result;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ── AGENT 11: COMMAND CENTRE (WAR ROOM) ───────────────────────────────────────
import { Agent11Payload, Agent11Result } from '../types';

export async function runAgent11(payload: Agent11Payload): Promise<Agent11Result> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 2048,
      system: `You are Agent_CommandCentre. Monitor live campaign health across all platforms.
Evaluate sentiment trends, engagement velocity, risk signals, and watchlist keyword hits.
Return: { "campaign_health":"green|amber|red|crisis", "summary":"...", "alerts":[...], "metrics":{...} }
Return ONLY valid JSON.`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as Agent11Result;
  } catch (err) {
    return { campaign_health: 'green', error: (err as Error).message };
  }
}

// ── AGENT 12: TRIGGER ENGINE ──────────────────────────────────────────────────
export interface TriggerPayload {
  brand_id:      number;
  message:       string;
  platform:      string;
  rules:         { keyword: string; action: string; confidence: number }[];
}

export interface TriggerResult {
  matched:    boolean;
  rule?:      string;
  action?:    string;
  confidence?: number;
  error?:     string;
}

export async function runAgent12(payload: TriggerPayload): Promise<TriggerResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 512,
      system: `You are Agent_TriggerEngine. Evaluate if a message matches any trigger rules.
Return ONLY valid JSON: { "matched": bool, "rule":"...", "action":"...", "confidence": 0-100 }`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as TriggerResult;
  } catch (err) {
    return { matched: false, error: (err as Error).message };
  }
}

// ── AGENT 13: AD PLACEMENT ────────────────────────────────────────────────────
export interface AdPlacementPayload {
  brand_id:  number;
  platform:  string;
  budget:    number;
  objective: string;
  audience:  string;
}

export interface AdPlacementResult {
  recommended_placements: { placement: string; score: number; rationale: string }[];
  budget_split:           Record<string, number>;
  error?:                 string;
}

export async function runAgent13(payload: AdPlacementPayload): Promise<AdPlacementResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1024,
      system: `You are Agent_AdPlacement. Recommend optimal ad placements and budget splits.
Return ONLY valid JSON: { "recommended_placements":[...], "budget_split":{...} }`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as AdPlacementResult;
  } catch (err) {
    return { recommended_placements: [], budget_split: {}, error: (err as Error).message };
  }
}

// ── AGENT 14: USER PROFILER ───────────────────────────────────────────────────
import { Agent14Payload, Agent14Result } from '../types';

export async function runAgent14(payload: Agent14Payload): Promise<Agent14Result> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 512,
      system: `You are Agent_UserProfiler. Classify a social media user.
Return ONLY valid JSON: { "classification":"influencer|regular|bot|brand", "tier":"micro|macro|mega", "risk_level":"low|medium|high", "engagement_rate":0.0, "follower_count":0 }`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(raw) as Agent14Result;
  } catch (err) {
    return { classification: 'regular', risk_level: 'low' };
  }
}
