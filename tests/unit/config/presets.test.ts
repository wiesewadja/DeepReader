import { describe, it, expect } from 'vitest';
import { PRESETS, getPresetById, buildRolesFromPreset } from '@/config/presets';

describe('Presets', () => {
	it('should have exactly 1 preset (xitong)', () => {
		expect(PRESETS).toHaveLength(1);
	});

	it('xitong should be recommended', () => {
		const xt = getPresetById('xitong')!;
		expect(PRESETS[0].id).toBe('xitong');
		expect(xt.recommended).toBe(true);
		expect(xt.free).toBe(false);
		expect(xt.provider).toBe('xiaomi');
	});

	it('xitong primary roles use xiaomi', () => {
		const xt = getPresetById('xitong')!;
		expect(xt.roleAssignments.chat).toBe('mimo-v2.5');
		expect(xt.roleAssignments.pageindex).toBe('mimo-v2.5');
		expect(xt.roleAssignments.proposition).toBe('mimo-v2.5');
		expect(xt.roleAssignments.tts).toBe('mimo-v2.5-tts-voicedesign');
	});

	it('xitong secondary roles use siliconflow', () => {
		const xt = getPresetById('xitong')!;
		expect(xt.secondaryProvider).toBe('siliconflow');
		expect(xt.secondaryRoleAssignments!.router).toBe('deepseek-ai/DeepSeek-V4-Flash');
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

	it('buildRolesFromPreset with secondary should build all 7 roles', () => {
		const xt = getPresetById('xitong')!;
		const roles = buildRolesFromPreset(xt, true);
		expect(roles.chat).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.router).toEqual({ provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4-Flash' });
		expect(roles.pageindex).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.proposition).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.embedding).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Embedding-0.6B' });
		expect(roles.reranker).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' });
		expect(roles.tts).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5-tts-voicedesign' });
	});

	it('buildRolesFromPreset without secondary only builds primary roles', () => {
		const xt = getPresetById('xitong')!;
		const roles = buildRolesFromPreset(xt, false);
		expect(roles.chat).toEqual({ provider: 'xiaomi', model: 'mimo-v2.5' });
		expect(roles.router).toBeUndefined();
		expect(roles.embedding).toBeUndefined();
	});
});
