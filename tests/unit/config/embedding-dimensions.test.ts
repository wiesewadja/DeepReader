/**
 * embedding-dimensions.ts 单元测试
 */
import { describe, it, expect } from 'vitest';
import { inferEmbeddingDimensions, EMBEDDING_DIMENSIONS } from '@/config/embedding-dimensions';

describe('inferEmbeddingDimensions', () => {
	it('returns correct dimensions for known models', () => {
		expect(inferEmbeddingDimensions('text-embedding-3-small')).toBe(1536);
		expect(inferEmbeddingDimensions('text-embedding-3-large')).toBe(3072);
		expect(inferEmbeddingDimensions('bge-m3')).toBe(1024);
		expect(inferEmbeddingDimensions('BAAI/bge-m3')).toBe(1024);
	});

	it('returns undefined for unknown models', () => {
		expect(inferEmbeddingDimensions('unknown-model')).toBeUndefined();
		expect(inferEmbeddingDimensions('')).toBeUndefined();
	});

	it('handles prefix-stripped matching', () => {
		// 'bge-m3' without 'BAAI/' prefix should also work
		expect(inferEmbeddingDimensions('bge-m3')).toBe(1024);
	});
});
