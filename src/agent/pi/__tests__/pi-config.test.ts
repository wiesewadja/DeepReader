/**
 * PiConfig 单元测试
 */

import { describe, it, expect } from 'vitest';
import { buildSpawnArgs } from '../pi-config.js';
import type { PiConfig } from '../types.js';

function createTestConfig(): PiConfig {
	return {
		apiKey: 'test-api-key',
		model: 'claude-sonnet-4-20250514',
		provider: 'anthropic',
		skillsDir: '/vault/DeepReader/skills',
		sessionDir: '/vault/DeepReader/pi/sessions',
		exportsDir: '/vault/DeepReader/exports',
		workingDir: '/vault',
	};
}

describe('PiConfig', () => {
	describe('buildSpawnArgs', () => {
		it('应包含所有必需参数', () => {
			const config = createTestConfig();
			const args = buildSpawnArgs(config);

			expect(args).toContain('--mode');
			expect(args).toContain('rpc');
			expect(args).toContain('--no-session');
			expect(args).toContain('--no-skills');
			expect(args).toContain('--no-context-files');
		});

		it('应设置正确的工具白名单', () => {
			const args = buildSpawnArgs(createTestConfig());
			const toolsIndex = args.indexOf('--tools');
			expect(args[toolsIndex + 1]).toBe('read,write,edit,grep,find,ls');
		});

		it('应传入 model（API key 通过环境变量传递）', () => {
			const config = createTestConfig();
			const args = buildSpawnArgs(config);

			// API key 不应在 CLI 参数中（通过环境变量 ANTHROPIC_API_KEY 传递）
			expect(args).not.toContain('--api-key');
			expect(args).toContain('--model');
			expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-20250514');
		});

		it('应设置 --no-skills 和 --skill 以隔离 vault skills', () => {
			const config = createTestConfig();
			const args = buildSpawnArgs(config);

			const noSkillsIdx = args.indexOf('--no-skills');
			const skillIdx = args.indexOf('--skill');
			expect(noSkillsIdx).toBeGreaterThan(-1);
			expect(skillIdx).toBeGreaterThan(-1);
			expect(args[skillIdx + 1]).toBe(config.skillsDir);
		});

		it('应包含 append-system-prompt', () => {
			const args = buildSpawnArgs(createTestConfig());
			expect(args).toContain('--append-system-prompt');
			const promptIdx = args.indexOf('--append-system-prompt');
			expect(args[promptIdx + 1]).toContain('奚童的技能执行引擎');
		});

		it('应设置 session-dir', () => {
			const config = createTestConfig();
			const args = buildSpawnArgs(config);
			const idx = args.indexOf('--session-dir');
			expect(args[idx + 1]).toBe(config.sessionDir);
		});
	});
});
