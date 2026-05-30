/**
 * PiProcessManager 单元测试
 *
 * 测试并发拒绝、buildConfig、stop、状态管理。
 * 不依赖真实 PI 进程。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PiProcessManager } from '@/agent/pi/pi-manager';
import { PiProcessState } from '@/agent/pi/types';
import type { PiConfig, PiSkillContext } from '@/agent/pi/types';

function createMockApp() {
	return {
		vault: {
			adapter: { basePath: '/test-vault' },
		},
	} as any;
}

function createTestConfig(): PiConfig {
	return {
		apiKey: 'test-key',
		model: 'claude-sonnet-4-20250514',
		provider: 'anthropic',
		skillsDir: '/test-vault/DeepReader/skills',
		sessionDir: '/tmp/test-pi-sessions',
		exportsDir: '/test-vault/DeepReader/exports',
		workingDir: '/test-vault',
	};
}

function createTestContext(): PiSkillContext {
	return {
		book: { title: '《深度学习》', author: 'Ian Goodfellow' },
		context: { currentSection: '第1章 引言', analysisSummary: '本章介绍了深度学习的定义' },
		skillDescriptions: ['topic-mindmap: 主题思维导图', 'knowledge-card: 知识卡片'],
		outputPath: 'DeepReader/exports/test.md',
		userRequest: '画一个思维导图',
	};
}

describe('PiProcessManager', () => {
	let manager: PiProcessManager;

	beforeEach(() => {
		manager = new PiProcessManager(createMockApp());
	});

	describe('初始状态', () => {
		it('初始状态应为 STOPPED', () => {
			expect(manager.getState()).toBe(PiProcessState.STOPPED);
		});

		it('初始不 busy', () => {
			expect(manager.isBusy()).toBe(false);
		});

		it('初始不 ready', () => {
			expect(manager.isReady()).toBe(false);
		});
	});

	describe('buildConfig', () => {
		it('应从 App 实例构建完整 PiConfig', () => {
			const config = manager.buildConfig('my-key', 'gpt-4', 'openai');
			expect(config.apiKey).toBe('my-key');
			expect(config.model).toBe('gpt-4');
			expect(config.provider).toBe('openai');
			expect(config.skillsDir).toContain('.pi/skills');
			expect(config.workingDir).toBe('/test-vault');
		});
	});

	describe('并发拒绝', () => {
		it('busy 时 executeSkill 应立即返回拒绝错误', async () => {
			(manager as any).busy = true;

			const result = await manager.executeSkill(
				createTestContext(),
				createTestConfig(),
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('正在执行其他任务');
		});

		it('并发拒绝不应改变 busy 状态', async () => {
			(manager as any).busy = true;
			await manager.executeSkill(createTestContext(), createTestConfig());
			expect(manager.isBusy()).toBe(true);
		});
	});

	describe('stop', () => {
		it('无进程时 stop 不报错', async () => {
			await expect(manager.stop()).resolves.toBeUndefined();
		});

		it('stop 后状态应为 STOPPED', async () => {
			(manager as any).state = PiProcessState.READY;
			await manager.stop();
			expect(manager.getState()).toBe(PiProcessState.STOPPED);
		});
	});

	describe('ensureStarted', () => {
		it('进程存在时应跳过启动', async () => {
			(manager as any).process = { kill: () => {} } as any;
			(manager as any).state = PiProcessState.READY;

			await manager.ensureStarted(createTestConfig());
			expect(manager.getState()).toBe(PiProcessState.READY);
		});
	});

	describe('killProcess', () => {
		it('应清理进程并设为 ERROR 状态', () => {
			const mockProc = { kill: () => {} } as any;
			(manager as any).process = mockProc;
			(manager as any).state = PiProcessState.READY;

			(manager as any).killProcess();

			expect((manager as any).process).toBeNull();
			expect(manager.getState()).toBe(PiProcessState.ERROR);
		});

		it('无进程时不报错', () => {
			expect(() => (manager as any).killProcess()).not.toThrow();
		});
	});
});
