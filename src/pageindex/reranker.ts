import { safeRequest } from '../utils/safe-request.js';
import type { RerankerOptions } from './vault/types.js';

export interface RerankApiResult {
  index: number;
  relevance_score: number;
}

/**
 * 统一的 rerank API 调用。
 * 支持 lmstudio / ollama / openai / siliconflow / deepseek provider。
 */
export async function callRerankApi(
  query: string,
  documents: string[],
  options: RerankerOptions
): Promise<number[]> {
  const provider = options.provider || 'lmstudio';
  const baseUrl = options.baseUrl || (
    provider === 'lmstudio' ? 'http://localhost:1234/v1'
    : provider === 'ollama' ? 'http://localhost:11434'
    : 'https://api.openai.com/v1'
  );
  const model = options.model || 'BAAI/bge-reranker-v2-m3';
  const apiKey = options.apiKey || (provider === 'lmstudio' ? 'lm-studio' : '');

  const response = await safeRequest({
    url: `${baseUrl}/rerank`,
    method: 'POST',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      query,
      documents,
      top_n: documents.length,
    }),
  });

  if (response.status >= 400) {
    throw new Error(`Rerank API error: ${response.status} - ${response.text}`);
  }

  const data = response.json as { results: RerankApiResult[] };
  // Convert to array indexed by original document order
  const scores = new Array(documents.length).fill(0.5);
  for (const r of data.results) {
    if (r.index >= 0 && r.index < scores.length) {
      scores[r.index] = r.relevance_score;
    }
  }
  return scores;
}
