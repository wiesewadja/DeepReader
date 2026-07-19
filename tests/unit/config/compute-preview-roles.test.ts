import { describe, it, expect } from 'vitest';
import { computePreviewRoles } from '@/config/presets';
import type { RoleType } from '@/config/types';

describe('computePreviewRoles', () => {
	it('should throw for unknown preset', () => {
		expect(() => computePreviewRoles('nonexistent', new Set())).toThrow('Unknown preset');
	});

	it('agent-plan with no extra keys → only volcark roles, tts/reranker null', () => {
		const roles = computePreviewRoles('agent-plan', new Set());
		expect(roles.chat).toEqual({ provider: 'volcark', model: 'doubao-seed-2.0-pro' });
		expect(roles.router).toEqual({ provider: 'volcark', model: 'doubao-seed-2.0-lite' });
		expect(roles.pageindex).toEqual({ provider: 'volcark', model: 'doubao-seed-2.0-lite' });
		expect(roles.proposition).toEqual({ provider: 'volcark', model: 'doubao-seed-2.0-lite' });
		expect(roles.embedding).toEqual({ provider: 'volcark', model: 'doubao-embedding-vision' });
		expect(roles.tts).toBeNull();
		expect(roles.reranker).toBeNull();
	});

	it('agent-plan + xiaomi key → tts enabled', () => {
		const roles = computePreviewRoles('agent-plan', new Set(['xiaomi']));
		expect(roles.chat).toEqual({ provider: 'volcark', model: 'doubao-seed-2.0-pro' });
		expect(roles.tts).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-tts-voicedesign' });
		expect(roles.reranker).toBeNull();
	});

	it('agent-plan + siliconflow key → reranker enabled', () => {
		const roles = computePreviewRoles('agent-plan', new Set(['siliconflow']));
		expect(roles.reranker).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' });
		expect(roles.tts).toBeNull();
	});

	it('agent-plan + both extra keys → all roles enabled', () => {
		const roles = computePreviewRoles('agent-plan', new Set(['xiaomi', 'siliconflow']));
		expect(roles.tts).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-tts-voicedesign' });
		expect(roles.reranker).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' });
		expect(roles.embedding).toEqual({ provider: 'volcark', model: 'doubao-embedding-vision' });
	});

	it('xitong with no sf key → embedding/reranker null, tts enabled (xiaomi primary)', () => {
		const roles = computePreviewRoles('xitong', new Set());
		expect(roles.chat).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-pro' });
		expect(roles.router).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.tts).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-tts-voicedesign' });
		expect(roles.embedding).toBeNull();
		expect(roles.reranker).toBeNull();
	});

	it('xitong + sf key → embedding + reranker enabled', () => {
		const roles = computePreviewRoles('xitong', new Set(['siliconflow']));
		expect(roles.embedding).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Embedding-0.6B' });
		expect(roles.reranker).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' });
		expect(roles.chat).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-pro' });
	});

	it('should return Record keyed by RoleType with all 8 roles present', () => {
		const roles = computePreviewRoles('agent-plan', new Set(['xiaomi', 'siliconflow']));
		const expectedRoles: RoleType[] = ['chat', 'router', 'pageindex', 'proposition', 'embedding', 'reranker', 'tts', 'imagegen'];
		for (const r of expectedRoles) {
			expect(roles).toHaveProperty(r);
		}
		// imagegen never assigned by presets
		expect(roles.imagegen).toBeNull();
	});
});
