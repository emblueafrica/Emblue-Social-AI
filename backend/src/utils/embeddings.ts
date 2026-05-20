// src/utils/embeddings.ts — OpenAI semantic deduplication
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface EmbeddingResult {
  text:      string;
  embedding: number[];
}

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[Embeddings] No OPENAI_API_KEY — deduplication disabled");
    return null;
  }
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 1000),
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[Embeddings] Error:", (err as Error).message);
    return null;
  }
}

export async function getEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!process.env.OPENAI_API_KEY) return texts.map(() => null);
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texts.map(t => t.slice(0, 1000)),
    });
    return response.data.map(d => d.embedding ?? null);
  } catch (err) {
    console.error("[Embeddings] Batch error:", (err as Error).message);
    return texts.map(() => null);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function isDuplicate(
  newEmbedding:       number[],
  existingEmbeddings: number[][],
  threshold         = 0.92
): boolean {
  return existingEmbeddings.some(e => cosineSimilarity(newEmbedding, e) >= threshold);
}

export async function deduplicateMessages<T extends { text: string }>(
  newMessages:      T[],
  existingMessages: T[],
  threshold       = 0.92
): Promise<T[]> {
  if (!process.env.OPENAI_API_KEY || !newMessages.length) return newMessages;

  const existingTexts = existingMessages.map(m => m.text);
  const allTexts      = [...existingTexts, ...newMessages.map(m => m.text)];
  const allEmbeddings = await getEmbeddingsBatch(allTexts);

  const existingEmbeddings = allEmbeddings.slice(0, existingTexts.length).filter((e): e is number[] => e !== null);
  const newEmbeddings      = allEmbeddings.slice(existingTexts.length);

  return newMessages.filter((msg, i) => {
    const emb = newEmbeddings[i];
    if (!emb) return true; // Keep if no embedding (fail open)
    return !isDuplicate(emb, existingEmbeddings, threshold);
  });
}
