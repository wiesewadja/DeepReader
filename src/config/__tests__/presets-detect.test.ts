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
			router: { provider: 'openai', model: 'gpt-4o' },
		};
		expect(detectCurrentPreset(roles)).toBeNull();
	});

	it('matches xitong preset with both providers', () => {
		const xt = PRESETS.find(p => p.id === 'xitong')!;
		const roles: Record<string, { provider: string; model: string } | null> = {};

		// Primary roles
		for (const [role, model] of Object.entries(xt.roleAssignments)) {
			roles[role] = { provider: 'xiaomi', model };
		}
		// Secondary roles
		for (const [role, model] of Object.entries(xt.secondaryRoleAssignments!)) {
			roles[role] = { provider: 'siliconflow', model };
		}

		const result = detectCurrentPreset(roles);
		expect(result).not.toBeNull();
		expect(result!.id).toBe('xitong');
	});

	it('does not match when secondary role differs', () => {
		const xt = PRESETS.find(p => p.id === 'xitong')!;
		const roles: Record<string, { provider: string; model: string } | null> = {};

		for (const [role, model] of Object.entries(xt.roleAssignments)) {
			roles[role] = { provider: 'xiaomi', model };
		}
		// Change router to wrong model
		roles['router'] = { provider: 'siliconflow', model: 'wrong-model' };

		expect(detectCurrentPreset(roles)).toBeNull();
	});

	it('does not match when primary role differs', () => {
		const roles = {
			chat: { provider: 'xiaomi', model: 'wrong-model' },
			router: { provider: 'siliconflow', model: 'Step-3.5-Flash' },
		};
		expect(detectCurrentPreset(roles)).toBeNull();
	});

	it('does not match when role is null', () => {
		const roles = {
			chat: null,
			router: { provider: 'siliconflow', model: 'Step-3.5-Flash' },
		};
		expect(detectCurrentPreset(roles)).toBeNull();
	});
});
