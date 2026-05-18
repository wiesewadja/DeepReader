import { describe, it, expect } from 'vitest';
import { enrichMappingWithStats } from '../sync/mapping-stats';
import type { WereadMapping, WereadSyncState, MappingStats } from '../types';

describe('enrichMappingWithStats', () => {
	it('应从 syncState 向 mapping 注入 stats', () => {
		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'wr-001': {
					bookId: 'wr-001',
					title: '深度学习',
					author: 'Ian Goodfellow',
					noteCount: 45,
					reviewCount: 12,
					lastSyncTime: 1716000000000,
					filePath: '书籍摘录/深度学习/深度学习.md',
					progress: 72,
					readingTime: 66600, // 18小时30分钟
				},
			},
			excludedBooks: [],
		};

		const mapping: WereadMapping = {
			mappings: {
				'wr-001': {
					wereadBookId: 'wr-001',
					wereadTitle: '深度学习',
					deepReaderBookId: 'dr-abc',
					deepReaderTitle: '深度学习',
					matchMethod: 'title-author',
					matchedAt: Date.now(),
					confirmed: true,
				},
			},
		};

		const result = enrichMappingWithStats(mapping, syncState);

		expect(result.mappings['wr-001'].stats).toBeDefined();
		expect(result.mappings['wr-001'].stats!.noteCount).toBe(45);
		expect(result.mappings['wr-001'].stats!.reviewCount).toBe(12);
		expect(result.mappings['wr-001'].stats!.progress).toBe(72);
		expect(result.mappings['wr-001'].stats!.readingTime).toBe('18小时30分钟');
		expect(result.mappings['wr-001'].stats!.lastReadDate).toBe('2024-05-18');
	});

	it('mapping 中没有对应 syncState 条目时 stats 不变', () => {
		const syncState: WereadSyncState = {
			lastSyncTime: 0,
			syncedBooks: {},
			excludedBooks: [],
		};

		const mapping: WereadMapping = {
			mappings: {
				'wr-001': {
					wereadBookId: 'wr-001',
					wereadTitle: '深度学习',
					deepReaderBookId: 'dr-abc',
					deepReaderTitle: '深度学习',
					matchMethod: 'title-author',
					matchedAt: Date.now(),
					confirmed: true,
				},
			},
		};

		const result = enrichMappingWithStats(mapping, syncState);
		expect(result.mappings['wr-001'].stats).toBeUndefined();
	});

	it('旧 syncState 数据（无 progress/readingTime）应使用默认值', () => {
		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'wr-001': {
					bookId: 'wr-001',
					title: '测试书',
					author: '作者',
					noteCount: 5,
					reviewCount: 2,
					lastSyncTime: 1716000000000,
					filePath: '书籍摘录/测试书/测试书.md',
					// 无 progress 和 readingTime
				},
			},
			excludedBooks: [],
		};

		const mapping: WereadMapping = {
			mappings: {
				'wr-001': {
					wereadBookId: 'wr-001',
					wereadTitle: '测试书',
					deepReaderBookId: 'dr-abc',
					deepReaderTitle: '测试书',
					matchMethod: 'title-author',
					matchedAt: Date.now(),
					confirmed: true,
				},
			},
		};

		const result = enrichMappingWithStats(mapping, syncState);
		expect(result.mappings['wr-001'].stats!.progress).toBe(0);
		expect(result.mappings['wr-001'].stats!.readingTime).toBe('0分钟');
	});

	it('不应修改原始 mapping 对象', () => {
		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'wr-001': {
					bookId: 'wr-001',
					title: '书',
					author: '作者',
					noteCount: 1,
					reviewCount: 0,
					lastSyncTime: Date.now(),
					filePath: '',
					progress: 50,
					readingTime: 3600,
				},
			},
			excludedBooks: [],
		};

		const mapping: WereadMapping = {
			mappings: {
				'wr-001': {
					wereadBookId: 'wr-001',
					wereadTitle: '书',
					deepReaderBookId: 'dr-1',
					deepReaderTitle: '书',
					matchMethod: 'title-author',
					matchedAt: Date.now(),
					confirmed: true,
				},
			},
		};

		const result = enrichMappingWithStats(mapping, syncState);
		expect(result).not.toBe(mapping);
		expect(result.mappings['wr-001']).not.toBe(mapping.mappings['wr-001']);
	});
});
