/**
 * detectCurrentPreset 单元测试
 */
import { describe, it, expect } from 'vitest';
import { detectCurrentPreset, PRESETS } from '../presets';

describe('detectCurrentPreset', () => {
	it('returns null for empty roles', () => {
		expect(detectCurrentPreset({})).toBeNull();
	});

	it('returns null when no preset matches', () => {
		const roles = {
			chat: { provider: 'deepseek', model: 'deepseek-chat' },
			router: { provider: 'openai', model: 'gpt-4o' }, // mismatch: mixed providers
		};
		expect(detectCurrentPreset(roles)).toBeNull();
	});

	it('matches siliconflow-all preset', () => {
		const sf = PRESETS.find(p => p.id === 'siliconflow-all')!;
		const roles: Record<string, { provider: string; model: string } | null> = {};
		for (const [role, model] of Object.entries(sf.roleAssignments)) {
			roles[role] = { provider: 'siliconflow', model };
		}
		const result = detectCurrentPreset(roles);
		expect(result).not.toBeNull();
		expect(result!.id).toBe('siliconflow-all');
	});

	it('matches deepseek-economy preset', () => {
		const ds = PRESETS.find(p => p.id === 'deepseek-economy')!;
		const roles: Record<string, { provider: string; model: string } | null> = {};
		for (const [role, model] of Object.entries(ds.roleAssignments)) {
			roles[role] = { provider: 'deepseek', model };
		}
		expect(detectCurrentPreset(roles)?.id).toBe('deepseek-economy');
	});

	it('does not match when model differs', () => {
		const roles = {
			chat: { provider: 'deepseek', model: 'wrong-model' },
			router: { provider: 'deepseek', model: 'deepseek-chat' },
			pageindex: { provider: 'deepseek', model: 'deepseek-chat' },
		};
		expect(detectCurrentPreset(roles)).toBeNull();
	});

	it('does not match when role is null', () => {
		const roles = {
			chat: null,
			router: { provider: 'deepseek', model: 'deepseek-chat' },
			pageindex: { provider: 'deepseek', model: 'deepseek-chat' },
		};
		expect(detectCurrentPreset(roles)).toBeNull();
	});
});
