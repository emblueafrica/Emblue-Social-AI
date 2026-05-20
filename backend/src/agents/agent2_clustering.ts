// src/agents/agent2_clustering.ts
import Anthropic from '@anthropic-ai/sdk';
import { Agent2Payload, Agent2Result, Cluster } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function normalizeCluster(cluster: Partial<Cluster>): Cluster {
  return {
    label: cluster.label ?? 'Audience conversation',
    opportunity_score: Math.max(0, Math.min(100, Number(cluster.opportunity_score ?? 50))),
    message_count: Math.max(0, Number(cluster.message_count ?? 0)),
    top_phrases: Array.isArray(cluster.top_phrases) ? cluster.top_phrases.slice(0, 8) : [],
    recommendations: Array.isArray(cluster.recommendations) ? cluster.recommendations.slice(0, 5) : [],
  };
}

export async function runAgent2(payload: Agent2Payload): Promise<Agent2Result> {
  const { items, min_items_per_cluster } = payload;

  if (items.length < min_items_per_cluster) {
    return { clusters_created: 0, clusters: [], insufficient_data: true };
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: `You are Agent_Clustering, a social listening analyst.
Group related audience messages into practical opportunity clusters.
Return ONLY valid JSON:
{
  "clusters_created": 0,
  "clusters": [
    {
      "label": "short human-readable label",
      "opportunity_score": 0-100,
      "message_count": 0,
      "top_phrases": ["..."],
      "recommendations": ["..."]
    }
  ],
  "insufficient_data": false
}`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(raw) as Partial<Agent2Result>;
    const clusters = (parsed.clusters ?? []).map(normalizeCluster);

    return {
      clusters_created: Number(parsed.clusters_created ?? clusters.length),
      clusters,
      insufficient_data: parsed.insufficient_data ?? clusters.length === 0,
    };
  } catch (err) {
    return {
      clusters_created: 0,
      clusters: [],
      insufficient_data: true,
    };
  }
}
