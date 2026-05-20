// src/agents/agent1_listening.ts
import Anthropic from '@anthropic-ai/sdk';
import {
  Agent1Payload, Agent1Result, ClassifiedMessage,
  Sentiment, Intent, Platform,
} from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Agent_Listening, a senior social media analyst for Social Emblue AI.
Your job: classify each incoming social media message with 4 labels.

For each message return a JSON array. Each item must have:
- sentiment: "positive" | "neutral" | "negative"
- intent: "inquiry" | "complaint" | "praise" | "purchase_intent" | "objection" | "neutral"
- urgency_score: 1-5 (5 = reply immediately, 1 = low priority)
- topics: string[] (max 3 topic tags)

Rules:
- Purchase intent (asking about price, asking to buy, asking availability) = urgency 4-5
- Complaints with strong language = urgency 5
- General praise = urgency 1-2
- Questions = urgency 3-4 depending on tone
- Sarcasm counts as negative sentiment
- Nigerian Pidgin and code-switching: read full context before classifying

Return ONLY a valid JSON array. No markdown. No explanation.`;

export async function runAgent1(payload: Agent1Payload): Promise<Agent1Result> {
  const { brand_id, platform, items } = payload;

  if (!items.length) {
    return { classified: [], total_items: 0, errors: [], platform };
  }

  const classified: ClassifiedMessage[] = [];
  const errors: string[] = [];

  // Process in batches of 50 to stay within token limits
  const BATCH_SIZE = 50;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    try {
      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system:     SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: JSON.stringify({
            brand_id,
            platform,
            messages: batch.map((m, idx) => ({
              index:  i + idx,
              text:   m.text,
              author: m.author_handle,
              kind:   m.kind,
            }))
          })
        }]
      });

      const rawText = response.content[0].type === 'text'
        ? response.content[0].text
        : '[]';

      const labels = JSON.parse(rawText) as {
        sentiment:     Sentiment;
        intent:        Intent;
        urgency_score: number;
        topics:        string[];
      }[];

      batch.forEach((msg, batchIdx) => {
        const label = labels[batchIdx];
        if (!label) return;

        classified.push({
          ...msg,
          brand_id,
          platform:     msg.platform as Platform,
          sentiment:    label.sentiment,
          intent:       label.intent,
          urgency_score: label.urgency_score,
          topics:        label.topics ?? [],
        });
      });

    } catch (err) {
      const message = (err as Error).message;
      console.error(`[Agent1] Batch ${i / BATCH_SIZE + 1} error:`, message);
      errors.push(message);

      // Still include unclassified messages with neutral defaults
      batch.forEach(msg => {
        classified.push({
          ...msg,
          brand_id,
          platform:     msg.platform as Platform,
          sentiment:    'neutral',
          intent:       'neutral',
          urgency_score: 1,
          topics:        [],
        });
      });
    }
  }

  console.log(`[Agent1] ${platform}: ${classified.length} classified, ${errors.length} errors`);
  return { classified, total_items: classified.length, errors, platform };
}
