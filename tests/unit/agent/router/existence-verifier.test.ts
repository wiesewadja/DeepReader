import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/pageindex/book-search-v2', () => ({
	searchBookV2: vi.fn(),
}));

import { searchBookV2 } from '@/pageindex/book-search-v2';
import {
	verifyExistence,
	needsExistenceCheck,
	extractExistenceConcept,
} from '@/agent/router/existence-verifier';
import { ReadingDepth } from '@/agent/graph/state';

const mockSearchBookV2 = vi.mocked(searchBookV2);

describe('needsExistenceCheck', () => {
	it('LLM 标记 [ANTI_HALLUCINATION]', () => {
		expect(needsExistenceCheck('x', '[ANTI_HALLUCINATION] machine learning')).toBe(true);
	});

	it('rawQuery 命中"有没有提到"', () => {
		expect(needsExistenceCheck('这本书里有没有提到量子计算', '量子计算')).toBe(true);
	});

	it('rawQuery 命中"是否讨论"', () => {
		expect(needsExistenceCheck('书中是否讨论过统计学习', 'x')).toBe(true);
	});

	it('非存在性问题', () => {
		expect(needsExistenceCheck('第三章讲了什么', 'x')).toBe(false);
	});
});

describe('extractExistenceConcept', () => {
	it('去掉"有没有提到"前缀', () => {
		const c = extractExistenceConcept('这本书里有没有提到量子纠缠', 'x');
		expect(c).toBe('量子纠缠');
	});

	it('去掉末尾标点', () => {
		const c = extractExistenceConcept('是否讨论过统计学习？', 'x');
		expect(c).toBe('统计学习');
	});

	it('LLM 标记时降级到 standaloneQuery（rawQuery 无内容时）', () => {
		// rawQuery 不含"有没有"等存在性词 → extracted 为空（被 trim 掉）
		// → fallback 到 standaloneQuery 去除 [ANTI_HALLUCINATION] 前缀
		const c = extractExistenceConcept('', '[ANTI_HALLUCINATION] deep learning');
		expect(c).toBe('deep learning');
	});
});

describe('verifyExistence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('非存在性问题：pass-through，不调 BM25', async () => {
		const r = await verifyExistence({
			rawQuery: '第三章讲了什么',
			standaloneQuery: '第三章',
			depth: ReadingDepth.ANALYTICAL,
			bookId: 'book1',
			app: {} as any,
		});
		expect(r.depth).toBe(ReadingDepth.ANALYTICAL);
		expect(r.antiHallucinationQuery).toBe('');
		expect(mockSearchBookV2).not.toHaveBeenCalled();
	});

	it('无 bookId/app：pass-through', async () => {
		const r = await verifyExistence({
			rawQuery: '有没有提到量子计算',
			standaloneQuery: '量子计算',
			depth: ReadingDepth.ANALYTICAL,
		});
		expect(r.depth).toBe(ReadingDepth.ANALYTICAL);
		expect(mockSearchBookV2).not.toHaveBeenCalled();
	});

	it('BM25 强命中：升级到 ANALYTICAL', async () => {
		mockSearchBookV2.mockResolvedValue([
			{
				score: 0.8,
				matchedBlocks: [{ content: '量子计算是一种基于量子力学的计算范式' }],
			},
		] as any);

		const r = await verifyExistence({
			rawQuery: '有没有提到量子计算',
			standaloneQuery: '量子计算',
			depth: ReadingDepth.CASUAL,
			bookId: 'book1',
			app: {} as any,
		});
		expect(r.depth).toBe(ReadingDepth.ANALYTICAL);
		expect(r.antiHallucinationQuery).toBe('');
	});

	it('BM25 未命中：强制 CASUAL + 返回 antiHallucinationQuery', async () => {
		mockSearchBookV2.mockResolvedValue([
			{ score: 0.2, matchedBlocks: [{ content: '不相关内容' }] },
		] as any);

		const r = await verifyExistence({
			rawQuery: '有没有提到量子计算',
			standaloneQuery: '量子计算',
			depth: ReadingDepth.ANALYTICAL,
			bookId: 'book1',
			app: {} as any,
		});
		expect(r.depth).toBe(ReadingDepth.CASUAL);
		expect(r.antiHallucinationQuery).toBe('量子计算');
	});

	it('BM25 抛错：不阻塞，pass-through', async () => {
		mockSearchBookV2.mockRejectedValue(new Error('network'));

		const r = await verifyExistence({
			rawQuery: '有没有提到量子计算',
			standaloneQuery: '量子计算',
			depth: ReadingDepth.ANALYTICAL,
			bookId: 'book1',
			app: {} as any,
		});
		// 触发了正则兜底（depth→CASUAL），但 BM25 失败，未再修改
		expect(r.depth).toBe(ReadingDepth.CASUAL);
		expect(r.antiHallucinationQuery).toBe('');
	});
});
