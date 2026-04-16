/**
 * Embedding Cache - Global LRU cache for query embeddings
 *
 * Avoids redundant embedding API calls when:
 * 1. Pre-search uses same keywords as ReAct tool calls
 * 2. Multiple search_book calls with similar keywords
 * 3. Retry/re-run scenarios
 */

import { generateEmbedding } from '../../pageindex/vault/vectors.js';
import type { EmbeddingOptions } from '../../pageindex/vault/types.js';
import { agentLog as log } from '../../utils/logger.js';

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map<string, CacheEntry>();

function getCacheKey(query: string, options: EmbeddingOptions): string {
  const normalizedQuery = query.toLowerCase().trim();
  return `${normalizedQuery}:${options.model}:${options.provider}`;
}

export async function getCachedEmbedding(
  query: string,
  options: EmbeddingOptions
): Promise<number[] | null> {
  if (!options || options.provider === 'local') {
    return null;
  }

  const key = getCacheKey(query, options);
  const entry = cache.get(key);

  if (entry) {
    const age = Date.now() - entry.timestamp;
    if (age < CACHE_TTL_MS) {
      log('[EmbeddingCache] Hit:', query.slice(0, 30));
      return entry.embedding;
    }
    cache.delete(key);
  }

  return null;
}

export async function getOrGenerateEmbedding(
  query: string,
  options: EmbeddingOptions
): Promise<number[]> {
  const cached = await getCachedEmbedding(query, options);
  if (cached) {
    return cached;
  }

  log('[EmbeddingCache] Miss, generating:', query.slice(0, 30));
  const embedding = await generateEmbedding(query, options);

  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(getCacheKey(query, options), {
    embedding,
    timestamp: Date.now(),
  });

  return embedding;
}

export function clearEmbeddingCache(): void {
  cache.clear();
  log('[EmbeddingCache] Cleared');
}

export function getCacheStats(): { size: number; maxAge: number } {
  let maxAge = 0;
  const now = Date.now();

  for (const entry of cache.values()) {
    const age = now - entry.timestamp;
    if (age > maxAge) maxAge = age;
  }

  return { size: cache.size, maxAge };
}