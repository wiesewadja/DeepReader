/**
 * ProfileFacts 数据结构测试
 */
import { describe, it, expect } from 'vitest';
import {
	DEFAULT_DIMENSIONS,
	type ProfileFactDimension,
	parseFactsText,
	mergeFacts,
	buildDimensionList,
	createEmptyFacts,
} from '../profile-facts';

describe('DEFAULT_DIMENSIONS', () => {
	it('has exactly 8 built-in dimensions', () => {
		expect(DEFAULT_DIMENSIONS).toHaveLength(8);
	});

	it('each dimension has key and label', () => {
		for (const d of DEFAULT_DIMENSIONS) {
			expect(d.key).toBeTruthy();
			expect(d.label).toBeTruthy();
		}
	});

	it('contains required keys', () => {
		const keys = DEFAULT_DIMENSIONS.map(d => d.key);
		expect(keys).toContain('identity');
		expect(keys).toContain('family');
		expect(keys).toContain('work');
		expect(keys).toContain('interests');
		expect(keys).toContain('personality');
		expect(keys).toContain('emotions');
		expect(keys).toContain('values');
		expect(keys).toContain('reading');
	});
});

describe('buildDimensionList', () => {
	it('returns default dimensions when no custom', () => {
		const result = buildDimensionList([]);
		expect(result).toHaveLength(8);
		expect(result[0].key).toBe('identity');
	});

	it('appends custom dimensions after defaults', () => {
		const result = buildDimensionList([{ key: 'learning', label: '学习' }]);
		expect(result).toHaveLength(9);
		expect(result[8]).toEqual({ key: 'learning', label: '学习' });
	});
});

describe('parseFactsText', () => {
	it('parses dimension facts from text format', () => {
		const text = `[时间] 2025-01 ~ 2025-03
[身份与阶段] 技术负责人
[家庭与关系] 女儿3岁
[工作与事业] 主导重构
[兴趣与投入] 学钢琴
[性格与思维] 先想透再动手
[情绪与状态] 对进度焦虑
[价值观与信念] 做有意义的事`;

		const facts = parseFactsText(text, DEFAULT_DIMENSIONS);
		expect(facts.identity).toEqual(['技术负责人']);
		expect(facts.family).toEqual(['女儿3岁']);
		expect(facts.work).toEqual(['主导重构']);
	});

	it('handles multi-line facts separated by ；', () => {
		const text = `[身份与阶段] 技术负责人；开始考虑创业`;
		const facts = parseFactsText(text, DEFAULT_DIMENSIONS);
		expect(facts.identity).toEqual(['技术负责人', '开始考虑创业']);
	});

	it('returns empty arrays for missing dimensions', () => {
		const text = `[身份与阶段] 技术负责人`;
		const facts = parseFactsText(text, DEFAULT_DIMENSIONS);
		expect(facts.identity).toEqual(['技术负责人']);
		expect(facts.family).toEqual([]);
	});
});

describe('mergeFacts', () => {
	it('appends new facts to existing', () => {
		const existing = { identity: ['技术负责人'] } as Record<string, string[]>;
		const incoming = { identity: ['开始考虑创业'], family: ['女儿3岁'] };

		const result = mergeFacts(existing, incoming);
		expect(result.identity).toEqual(['技术负责人', '开始考虑创业']);
		expect(result.family).toEqual(['女儿3岁']);
	});

	it('deduplicates identical facts', () => {
		const existing = { identity: ['技术负责人'] } as Record<string, string[]>;
		const incoming = { identity: ['技术负责人'] };

		const result = mergeFacts(existing, incoming);
		expect(result.identity).toEqual(['技术负责人']);
	});

	it('preserves all existing keys', () => {
		const existing = { identity: ['A'], work: ['B'] } as Record<string, string[]>;
		const incoming = { identity: ['C'] };

		const result = mergeFacts(existing, incoming);
		expect(result.work).toEqual(['B']);
	});
});


describe('createEmptyFacts', () => {
	it('creates facts with all default dimension keys', () => {
		const facts = createEmptyFacts('journal');
		expect(facts.version).toBe(1);
		expect(facts.sourceDir).toBe('journal');
		expect(facts.lastExtractTime).toBeTruthy();
		for (const d of DEFAULT_DIMENSIONS) {
			expect(facts.dimensions[d.key]).toEqual([]);
		}
	});
});

describe('buildDimensionList with custom dimensions', () => {
	it('generates dimension lines for prompt', () => {
		const dims = buildDimensionList([{ key: 'learning', label: '学习与成长' }]);
		const lines = dims.map(d => `[${d.label}] `);
		expect(lines).toHaveLength(9);
		expect(lines[0]).toBe('[身份与阶段] ');
		expect(lines[8]).toBe('[学习与成长] ');
	});

	it('custom dimensions appear in parseFactsText', () => {
		const dims = buildDimensionList([{ key: 'learning', label: '学习与成长' }]);
		const text = '[学习与成长] 在学 Rust；读完了一本关于认知科学的书';
		const facts = parseFactsText(text, dims);
		expect(facts.learning).toEqual(['在学 Rust', '读完了一本关于认知科学的书']);
	});
});
