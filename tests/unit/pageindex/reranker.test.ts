import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock safe-request before importing reranker
vi.mock('@/utils/safe-request.js', () => ({
  safeRequest: vi.fn(),
}));

import { callRerankApi } from '@/pageindex/reranker';
import { safeRequest } from '@/utils/safe-request.js';
import type { RerankerOptions } from '@/pageindex/vault/types';

const mockSafeRequest = vi.mocked(safeRequest);

const defaultOptions: RerankerOptions = {
  provider: 'lmstudio',
  model: 'BAAI/bge-reranker-v2-m3',
  apiKey: 'lm-studio',
};

describe('callRerankApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RK-01: 空 documents 列表 → 返回空数组
  it('RK-01: should return empty array for empty documents', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 200,
      json: { results: [] },
      text: '',
      headers: {},
    });

    const result = await callRerankApi('query', [], defaultOptions);
    expect(result).toEqual([]);
  });

  // RK-02: 单个 document → 返回长度 1 数组
  it('RK-02: should return length-1 array for single document', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 200,
      json: { results: [{ index: 0, relevance_score: 0.95 }] },
      text: '',
      headers: {},
    });

    const result = await callRerankApi('query', ['doc1'], defaultOptions);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(0.95);
  });

  // RK-03: API 返回空 results → 所有分数为 0.5
  it('RK-03: should return all 0.5 scores when API returns empty results', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 200,
      json: { results: [] },
      text: '',
      headers: {},
    });

    const result = await callRerankApi('query', ['doc1', 'doc2', 'doc3'], defaultOptions);
    expect(result).toEqual([0.5, 0.5, 0.5]);
  });

  // RK-04: API 返回 index 越界 → 该条目被忽略
  it('RK-04: should ignore entries with out-of-bounds index', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 200,
      json: {
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 5, relevance_score: 0.8 }, // 越界，应被忽略
        ],
      },
      text: '',
      headers: {},
    });

    const result = await callRerankApi('query', ['doc1', 'doc2'], defaultOptions);
    expect(result).toEqual([0.9, 0.5]); // index 5 被忽略，保持默认 0.5
  });

  // RK-05: API 返回负数 index → 该条目被忽略
  it('RK-05: should ignore entries with negative index', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 200,
      json: {
        results: [
          { index: -1, relevance_score: 0.9 }, // 负数，应被忽略
          { index: 1, relevance_score: 0.85 },
        ],
      },
      text: '',
      headers: {},
    });

    const result = await callRerankApi('query', ['doc1', 'doc2'], defaultOptions);
    expect(result).toEqual([0.5, 0.85]); // index -1 被忽略，保持默认 0.5
  });

  // RK-06: API 返回 400+ → 抛出 Error
  it('RK-06: should throw Error when API returns 400+', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 400,
      json: { error: 'Bad Request' },
      text: 'Bad Request',
      headers: {},
    });

    await expect(
      callRerankApi('query', ['doc1'], defaultOptions)
    ).rejects.toThrow('Rerank API error: 400 - Bad Request');
  });

  // RK-08: 3 个 document，API 只返回 2 个 → 未返回的为 0.5
  it('RK-08: should default unmatched documents to 0.5', async () => {
    mockSafeRequest.mockResolvedValue({
      status: 200,
      json: {
        results: [
          { index: 0, relevance_score: 0.95 },
          { index: 2, relevance_score: 0.7 },
        ],
      },
      text: '',
      headers: {},
    });

    const result = await callRerankApi('query', ['doc1', 'doc2', 'doc3'], defaultOptions);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(0.95); // index 0 返回
    expect(result[1]).toBe(0.5);  // index 1 未返回，默认 0.5
    expect(result[2]).toBe(0.7);  // index 2 返回
  });
});
