import { describe, it, expect } from 'vitest';
import { PRESETS, getPresetById, buildRolesFromPreset } from '../presets';

describe('Presets', () => {
	it('should have 5 presets', () => {
		expect(PRESETS).toHaveLength(5);
	});

	it('minimax-token-plan should be the first and recommended', () => {
		const mm = getPresetById('minimax-token-plan')!;
		expect(PRESETS[0].id).toBe('minimax-token-plan');
		expect(mm.recommended).toBe(true);
		expect(mm.free).toBe(false);
		expect(mm.provider).toBe('minimax');
		expect(mm.roleAssignments.chat).toBe('MiniMax-M2.7');
		expect(mm.roleAssignments.router).toBe('MiniMax-M2.7');
		expect(mm.roleAssignments.pageindex).toBe('MiniMax-M2.7');
		expect(mm.roleAssignments.proposition).toBe('MiniMax-M2.7');
		expect(mm.roleAssignments.embedding).toBe('BAAI/bge-m3');
	});

	it('siliconflow-all should not be recommended anymore', () => {
		const sf = getPresetById('siliconflow-all');
		expect(sf).toBeDefined();
		expect(sf!.recommended).toBeUndefined();
		expect(sf!.free).toBe(true);
		expect(sf!.provider).toBe('siliconflow');
	});

	it('siliconflow-all should cover chat, router, pageindex, embedding, reranker', () => {
		const sf = getPresetById('siliconflow-all')!;
		expect(sf.roleAssignments.chat).toBe('Qwen/Qwen3-8B');
		expect(sf.roleAssignments.router).toBe('Qwen/Qwen3-8B');
		expect(sf.roleAssignments.pageindex).toBe('Qwen/Qwen3-8B');
		expect(sf.roleAssignments.embedding).toBe('BAAI/bge-m3');
		expect(sf.roleAssignments.reranker).toBe('BAAI/bge-reranker-v2-m3');
	});

	it('deepseek-economy should only cover chat roles', () => {
		const ds = getPresetById('deepseek-economy')!;
		expect(ds.roleAssignments.chat).toBeDefined();
		expect(ds.roleAssignments.embedding).toBeUndefined();
	});

	it('getPresetById should return undefined for unknown id', () => {
		expect(getPresetById('nonexistent')).toBeUndefined();
	});

	it('buildRolesFromPreset should build correct roles', () => {
		const sf = getPresetById('siliconflow-all')!;
		const roles = buildRolesFromPreset(sf);
		expect(roles.chat).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-8B' });
		expect(roles.embedding).toEqual({ provider: 'siliconflow', model: 'BAAI/bge-m3' });
	});

	it('buildRolesFromPreset should not include unassigned roles', () => {
		const ds = getPresetById('deepseek-economy')!;
		const roles = buildRolesFromPreset(ds);
		expect(roles.embedding).toBeUndefined();
	});
});
