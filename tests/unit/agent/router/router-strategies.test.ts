import { describe, it, expect } from 'vitest';
import {
	inheritDepthOnContinuity,
	CONTINUITY_THRESHOLD,
} from '@/agent/router/continuity-guard';
import { upgradeToSyntopical } from '@/agent/router/booklist-resolver';
import { ReadingDepth } from '@/agent/graph/state';

describe('inheritDepthOnContinuity', () => {
	it('短回复在深度讨论中途：CASUAL → ANALYTICAL', () => {
		const r = inheritDepthOnContinuity(
			ReadingDepth.CASUAL,
			'继续',
			[
				{ role: 'user', content: '解释' },
				{ role: 'assistant', content: 'x'.repeat(300) },
			],
		);
		expect(r.didUpgrade).toBe(true);
		expect(r.depth).toBe(ReadingDepth.ANALYTICAL);
	});

	it('非 CASUAL 深度：不触发', () => {
		const r = inheritDepthOnContinuity(
			ReadingDepth.ANALYTICAL,
			'继续',
			[{ role: 'assistant', content: 'x'.repeat(300) }],
		);
		expect(r.didUpgrade).toBe(false);
	});

	it('长回复：不触发', () => {
		const r = inheritDepthOnContinuity(
			ReadingDepth.CASUAL,
			'x'.repeat(CONTINUITY_THRESHOLD + 1),
			[{ role: 'assistant', content: 'x'.repeat(300) }],
		);
		expect(r.didUpgrade).toBe(false);
	});

	it('chatHistory 太短：不触发', () => {
		const r = inheritDepthOnContinuity(
			ReadingDepth.CASUAL,
			'嗯',
			[{ role: 'assistant', content: 'x'.repeat(300) }],
		);
		expect(r.didUpgrade).toBe(false);
	});

	it('上一轮 assistant 太短：不触发', () => {
		const r = inheritDepthOnContinuity(
			ReadingDepth.CASUAL,
			'嗯',
			[
				{ role: 'user', content: 'hi' },
				{ role: 'assistant', content: 'hello' },
			],
		);
		expect(r.didUpgrade).toBe(false);
	});
});

describe('upgradeToSyntopical', () => {
	it('用户选了书单 + 深度>=ANALYTICAL：升级 SYNTOPICAL', () => {
		const r = upgradeToSyntopical(ReadingDepth.ANALYTICAL, true);
		expect(r.didUpgrade).toBe(true);
		expect(r.depth).toBe(ReadingDepth.SYNTOPICAL);
	});

	it('用户选了书单 + 深度=CASUAL：不升级', () => {
		const r = upgradeToSyntopical(ReadingDepth.CASUAL, true);
		expect(r.didUpgrade).toBe(false);
		expect(r.depth).toBe(ReadingDepth.CASUAL);
	});

	it('用户没选书单：不升级', () => {
		const r = upgradeToSyntopical(ReadingDepth.ANALYTICAL, false);
		expect(r.didUpgrade).toBe(false);
		expect(r.depth).toBe(ReadingDepth.ANALYTICAL);
	});
});
