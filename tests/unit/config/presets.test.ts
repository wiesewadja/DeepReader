import { describe, it, expect } from 'vitest';
import { PRESETS, getPresetById, buildRolesFromPreset } from '@/config/presets';

describe('Presets', () => {
	it('should have 2 presets (agent-plan, xitong)', () => {
		expect(PRESETS).toHaveLength(2);
		expect(PRESETS[0].id).toBe('agent-plan');
		expect(PRESETS[1].id).toBe('xitong');
	});

	it('agent-plan should be recommended', () => {
		const ap = getPresetById('agent-plan')!;
		expect(PRESETS[0].id).toBe('agent-plan');
		expect(ap.recommended).toBe(true);
		expect(ap.free).toBe(false);
		expect(ap.provider).toBe('volcark');
	});

	it('xitong primary roles use xiaomi', () => {
		const xt = getPresetById('xitong')!;
		expect(xt.roleAssignments.chat).toBe('mimo-v2.5-pro');
		expect(xt.roleAssignments.router).toBe('mimo-v2.5');
		expect(xt.roleAssignments.pageindex).toBe('mimo-v2.5');
		expect(xt.roleAssignments.proposition).toBe('mimo-v2.5');
		expect(xt.roleAssignments.tts).toBe('mimo-v2.5-tts-voicedesign');
	});

	it('xitong secondary roles use siliconflow', () => {
		const xt = getPresetById('xitong')!;
		expect(xt.secondaryProvider).toBe('siliconflow');
		expect(xt.secondaryRoleAssignments!.router).toBeUndefined();
		expect(xt.secondaryRoleAssignments!.embedding).toBe('Qwen/Qwen3-Embedding-0.6B');
		expect(xt.secondaryRoleAssignments!.reranker).toBe('Qwen/Qwen3-Reranker-0.6B');
	});

	it('getPresetById should return undefined for unknown id', () => {
		expect(getPresetById('nonexistent')).toBeUndefined();
	});

	it('getPresetById should return undefined for removed presets', () => {
		expect(getPresetById('siliconflow-all')).toBeUndefined();
		expect(getPresetById('deepseek-economy')).toBeUndefined();
		expect(getPresetById('openai-standard')).toBeUndefined();
	});

	it('buildRolesFromPreset with all providers should build all 7 roles', () => {
		const xt = getPresetById('xitong')!;
		const allProviders = new Set(['siliconflow']);
		const roles = buildRolesFromPreset(xt, allProviders);
		expect(roles.chat).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-pro' });
		expect(roles.router).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.pageindex).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.proposition).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.embedding).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Embedding-0.6B' });
		expect(roles.reranker).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' });
		expect(roles.tts).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-tts-voicedesign' });
	});

	it('buildRolesFromPreset without providers only builds primary roles', () => {
		const xt = getPresetById('xitong')!;
		const emptySet = new Set<string>();
		const roles = buildRolesFromPreset(xt, emptySet);
		expect(roles.chat).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-pro' });
		expect(roles.router).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.embedding).toBeUndefined();
	});
});
