/**
 * IntentRouter + ContextBuilder 集成测试
 *
 * 验证意图路由结果能正确注入到消息中
 * 验证全书摘要能正确注入到系统提示中
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentRouter } from '../router/intent-router.js';
import { ContextBuilder, type DocumentMetadata, type ReadingProgress } from '../context/builder.js';
import type { MemoryStore } from '../memory/store.js';
import type { App } from 'obsidian';

// ============================================================================
// Mocks
// ============================================================================

/**
 * 创建 Mock App
 */
function createMockApp(): App {
	return {
		vault: {
			adapter: {
				exists: vi.fn().mockResolvedValue(false),
				read: vi.fn().mockResolvedValue(''),
				write: vi.fn().mockResolvedValue(undefined),
				mkdir: vi.fn().mockResolvedValue(undefined),
			},
		},
	} as unknown as App;
}

/**
 * 创建 Mock MemoryStore
 */
function createMockMemoryStore(): MemoryStore {
	return {
		getMemoryContext: vi.fn().mockResolvedValue('## 长期记忆\n\n用户喜欢技术书籍'),
		readLongTermMemory: vi.fn().mockResolvedValue('# 长期记忆\n\n用户喜欢技术书籍'),
		writeLongTermMemory: vi.fn().mockResolvedValue(undefined),
		needsCompression: vi.fn().mockResolvedValue(false),
	} as unknown as MemoryStore;
}

// ============================================================================
// 测试用例
// ============================================================================

describe('IntentRouter + ContextBuilder 集成测试', () => {
	let router: IntentRouter;
	let mockApp: App;
	let mockStore: MemoryStore;
	let contextBuilder: ContextBuilder;

	beforeEach(() => {
		router = new IntentRouter();
		mockApp = createMockApp();
		mockStore = createMockMemoryStore();
		contextBuilder = new ContextBuilder(mockApp, mockStore, { deepReaderDir: 'DeepReader' });
	});

	describe('测试 1: 意图路由结果应能正确注入到消息中', () => {
		it('画一个全书的思维导图 - 应检测到"检视阅读"意图', () => {
			const result = router.analyze('画一个全书的思维导图');

			// 验证意图检测
			expect(result.detectedIntents).toContain('检视阅读');
			expect(result.detectedIntents).toContain('动作输出');

			// 验证工具允许
			expect(result.allowedTools).toContain('get_document_outline');
			expect(result.allowedTools).toContain('excalidraw');

			// 验证 systemNote 包含路由信息
			expect(result.systemNote).toContain('Router 强制路由');
			expect(result.systemNote).toContain('检视阅读');
		});

		it('路由结果应能通过 ContextBuilder.buildMessages 注入到用户消息', () => {
			const userInput = '画一个全书的思维导图';
			const result = router.analyze(userInput);

			// 构建消息列表
			const systemPrompt = '测试系统提示';
			const messages = ContextBuilder.buildMessages(
				systemPrompt,
				[],
				userInput,
				undefined, // runtimeContext
				result.systemNote
			);

			// 验证消息结构
			expect(messages).toHaveLength(2);
			expect(messages[0].role).toBe('system');
			expect(messages[0].content).toBe(systemPrompt);

			// 验证用户消息包含路由指令
			expect(messages[1].role).toBe('user');
			expect(messages[1].content).toContain('Router 强制路由');
			expect(messages[1].content).toContain(userInput);
		});

		it('完整流程: 意图路由 -> 消息构建', async () => {
			const userInput = '画一个全书的思维导图';
			const metadata: DocumentMetadata = { title: '测试书籍', page_count: 100 };

			// 1. 意图路由
			const intentResult = router.analyze(userInput);
			expect(intentResult.detectedIntents).toContain('检视阅读');
			expect(intentResult.allowedTools).toContain('get_document_outline');

			// 2. 构建系统提示
			const skillsSummary = '<skill name="test">测试技能</skill>';
			const systemPrompt = await contextBuilder.buildSystemPrompt(skillsSummary, metadata);

			// 3. 构建消息列表
			const messages = ContextBuilder.buildMessagesWithMetadata(
				systemPrompt,
				[],
				userInput,
				metadata,
				undefined,
				intentResult.systemNote
			);

			// 验证
			expect(messages).toHaveLength(2);
			expect(messages[0].role).toBe('system');
			expect(messages[0].content).toContain('奚童'); // 包含人设
			expect(messages[0].content).toContain('测试书籍'); // 包含文档信息

			expect(messages[1].role).toBe('user');
			expect(messages[1].content).toContain('Router 强制路由'); // 包含路由指令
			expect(messages[1].content).toContain(userInput); // 包含用户消息
		});
	});

	describe('测试 2: 全书摘要应能注入到系统提示中', () => {
		it('buildSystemPrompt 应包含 docDescription', async () => {
			const skillsSummary = '<skill name="test">测试技能</skill>';
			const metadata: DocumentMetadata = { title: '如何阅读一本书', author: '艾德勒', page_count: 400 };
			const docDescription = '这是一本关于阅读方法的经典著作，系统介绍了检视阅读、分析阅读和主题阅读三个层次。';

			const systemPrompt = await contextBuilder.buildSystemPrompt(skillsSummary, metadata, docDescription);

			// 验证系统提示包含全书摘要
			expect(systemPrompt).toContain('全书摘要');
			expect(systemPrompt).toContain(docDescription);
			expect(systemPrompt).toContain('如何阅读一本书');
			expect(systemPrompt).toContain('艾德勒');
		});

		it('无 docDescription 时不应包含摘要区块', async () => {
			const skillsSummary = '<skill name="test">测试技能</skill>';
			const metadata: DocumentMetadata = { title: '测试书籍' };

			const systemPrompt = await contextBuilder.buildSystemPrompt(skillsSummary, metadata, undefined);

			// 不应包含全书摘要区块
			expect(systemPrompt).not.toContain('## 全书摘要');
			expect(systemPrompt).toContain('测试书籍');
		});

		it('完整流程: 带 docDescription 的消息构建', async () => {
			const userInput = '总结一下这本书';
			const metadata: DocumentMetadata = { title: '深度学习', page_count: 500 };
			const docDescription = '本书系统介绍了深度学习的基础理论和实践方法。';
			const progress: ReadingProgress = { coverage: 0.3, absorption: 0.5 };

			// 1. 意图路由
			const intentResult = router.analyze(userInput);
			expect(intentResult.detectedIntents).toContain('检视阅读');

			// 2. 构建系统提示（带 docDescription）
			const skillsSummary = '<skill name="get_document_outline">获取目录</skill>';
			const systemPrompt = await contextBuilder.buildSystemPrompt(skillsSummary, metadata, docDescription);

			// 验证系统提示结构
			expect(systemPrompt).toContain('奚童'); // Identity 层
			expect(systemPrompt).toContain('深度学习'); // 文档信息
			expect(systemPrompt).toContain('全书摘要'); // 摘要区块
			expect(systemPrompt).toContain(docDescription); // 摘要内容

			// 3. 构建消息列表
			const messages = ContextBuilder.buildMessagesWithMetadata(
				systemPrompt,
				[],
				userInput,
				metadata,
				progress,
				intentResult.systemNote
			);

			// 验证消息结构
			expect(messages).toHaveLength(2);
			expect(messages[0].content).toContain('全书摘要');
			expect(messages[1].content).toContain('Router 强制路由');
		});
	});

	describe('测试 3: 多意图路由场景', () => {
		it('章节定位 + 微观检索场景', () => {
			const userInput = '第3章里提到的金字塔原理是什么？';
			const result = router.analyze(userInput);

			// 应检测到定位章节意图
			expect(result.detectedIntents).toContain('分析阅读-定位');
			expect(result.allowedTools).toContain('read_markdown_section');
		});

		it('主题阅读场景', () => {
			const userInput = '对比这本书和《思考，快与慢》关于决策的观点';
			const result = router.analyze(userInput);

			expect(result.detectedIntents).toContain('主题阅读');
			expect(result.allowedTools).toContain('search_read_books');
		});

		it('兜底场景 - 无匹配意图', () => {
			const userInput = '作者认为什么是好习惯？';
			const result = router.analyze(userInput);

			// "什么是" 模式会命中 concept_inquiry 规则
			expect(result.detectedIntents).toContain('分析阅读-概念探究');
			expect(result.allowedTools).toContain('search_markdown_text');
		});
	});

	describe('测试 4: ContextBuilder 分层验证', () => {
		it('系统提示应包含所有层级', async () => {
			const skillsSummary = '<skill name="get_document_outline">获取目录</skill>';
			const metadata: DocumentMetadata = { title: '测试书籍' };
			const docDescription = '这是测试书籍的摘要。';

			const systemPrompt = await contextBuilder.buildSystemPrompt(skillsSummary, metadata, docDescription);

			// 验证层级
			// Layer 1: Identity（人设层）
			expect(systemPrompt).toContain('奚童');
			expect(systemPrompt).toContain('阅读');

			// Layer 3: Memory（持久化层）- 通过 mock 返回
			expect(systemPrompt).toContain('长期记忆');

			// Constraints（核心约束）
			expect(systemPrompt).toContain('Obsidian');
			expect(systemPrompt).toContain('行内引用');

			// docDescription
			expect(systemPrompt).toContain('全书摘要');
		});
	});
});
