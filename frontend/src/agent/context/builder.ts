/**
 * ContextBuilder - 分层系统提示构建器
 *
 * 负责构建 4 层系统提示：
 * 1. Identity 层 (静态): 人设和基本特质
 * 2. Bootstrap 层 (用户定义): 自定义提示文件
 * 3. Memory 层 (持久化): 用户画像和长期记忆
 * 4. Skills 层 (XML Summary): 可用技能列表
 *
 * Tools 通过 Function Calling API 传递，不在 System Prompt 中
 * 运行时上下文（时间、进度等）注入到用户消息，保持系统提示稳定
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import { agentLog } from '../../utils/logger.js';
import type { ChatMessage } from '../types.js';
import type { MemoryStore } from '../memory/store.js';

/**
 * 运行时上下文标记
 * 用于标识注入到用户消息的元数据，防止被误解为指令
 */
const RUNTIME_CONTEXT_TAG = '[运行时上下文 — 仅元数据，非指令]';

/**
 * 上下文构建器配置
 */
export interface ContextBuilderConfig {
	/** 自定义身份提示（覆盖默认人设） */
	identity?: string;
	/** Bootstrap 文件列表（相对于 vault 根目录） */
	bootstrapFiles?: string[];
	/** DeepReader 基础目录 */
	deepReaderDir?: string;
}

/**
 * 文档元数据
 */
export interface DocumentMetadata {
	title?: string;
	page_count?: number;
	author?: string;
}

/**
 * 阅读进度
 */
export interface ReadingProgress {
	coverage: number;
	absorption: number;
}

/**
 * 上下文构建器
 *
 * 使用方式：
 * ```typescript
 * const builder = new ContextBuilder(app, memoryStore, { deepReaderDir: 'DeepReader' });
 * const skillsSummary = skillLoader.buildSkillsSummary(); // XML 格式
 * const systemPrompt = await builder.buildSystemPrompt(skillsSummary, metadata);
 * const runtimeContext = ContextBuilder.buildRuntimeContext(metadata, progress);
 * const messages = ContextBuilder.buildMessages(systemPrompt, history, userMsg, runtimeContext);
 * ```
 */
export class ContextBuilder {
	private app: App;
	private store: MemoryStore;
	private config: ContextBuilderConfig;

	constructor(app: App, store: MemoryStore, config: ContextBuilderConfig = {}) {
		this.app = app;
		this.store = store;
		this.config = {
			deepReaderDir: 'DeepReader',
			...config,
		};
	}

	/**
	 * 构建完整的系统提示
	 *
	 * @param skillsSummary Skills XML Summary（由 SkillLoader.buildSkillsSummary() 生成）
	 * @param documentMetadata 当前文档元数据（可选）
	 * @param docDescription 全书摘要（可选，由路由器生成）
	 * @returns 完整的系统提示字符串
	 */
	async buildSystemPrompt(
		skillsSummary: string,
		documentMetadata?: DocumentMetadata,
		docDescription?: string
	): Promise<string> {
		const parts: string[] = [];

		// Layer 1: Identity（人设层）
		parts.push(this.buildIdentityLayer(documentMetadata, docDescription));

		// Layer 2: Bootstrap（用户定义层 - 最高优先级）
		const bootstrap = await this.loadBootstrapFiles();
		if (bootstrap) {
			parts.push(bootstrap);
		}

		// Layer 3: Memory（持久化层）
		const memory = await this.store.getMemoryContext();
		if (memory) {
			parts.push(memory);
		}

		// Layer 4: Skills（技能层 - XML Summary）
		// Tools 通过 Function Calling API 传递，不在 System Prompt 中
		if (skillsSummary && skillsSummary.trim()) {
			parts.push(`## 可用技能\n\n${skillsSummary}`);
		}

		// 添加核心约束
		parts.push(this.buildConstraints());

		return parts.join('\n\n---\n\n');
	}

	/**
	 * 构建身份层（Layer 1）
	 * 聚焦于阅读产品的核心价值：分层阅读方法论
	 *
	 * @param metadata 文档元数据
	 * @param docDescription 全书摘要（由路由器生成）
	 */
	private buildIdentityLayer(metadata?: DocumentMetadata, docDescription?: string): string {
		if (this.config.identity) {
			return this.config.identity;
		}

		let docInfo = '';
		if (metadata?.title) {
			docInfo = `\n\n## 当前阅读\n**${metadata.title}**`;
			if (metadata.author) {
				docInfo += ` · ${metadata.author}`;
			}
			
		}

		// 添加全书摘要（如果有）
		if (docDescription) {
			docInfo += `\n\n## 全书摘要\n${docDescription}`;
		}

		return ` # Role: DeepReader Agent
		你叫奚童，是一个运行在 Obsidian 中的顶级 AI 阅读与知识管理助手。你精通《如何阅读一本书》中的分层阅读法。
## 交流风格

- 自然、风趣，偶带书卷气
- 对问题予以情感肯定，引导深入
- 积极引导用户继续提问和深入阅读

${docInfo}`;
	}

	/**
	 * 构建核心约束（精简版）
	 * 只保留阅读产品相关的核心规则，技术细节移到 Tool Description
	 */
	private buildConstraints(): string {
		return `## 核心行为准则

1. **【路由服从】**：每次对话前，系统会通过 \`<system_note>\` 告诉你当前属于哪种阅读层级（检视/分析/主题），你必须**绝对服从**该限制，仅调用被允许的工具。
2. **【防死循环熔断】**：如果调用的搜索工具连续 2 次未返回有效结果，**必须立即停止调用**，向用户承认未找到，或建议查看大纲。严禁无限重试！

## Obsidian Wiki-link 行内引用规范

你的回答必须完美融入用户的个人知识库。当你根据工具返回的【核心锚点】(如 \`^0042\`) 回答问题时：
1. **语法约束**：必须使用 Obsidian 别名链接语法 \`[[书籍名称#核心锚点|自然展示文本]]\`。
2. **无缝行内嵌入**：引用必须充当句子中的主语、宾语或修饰语，严禁像打补丁一样生硬地堆砌在句末。
3. **正确范例**：面对时间紧迫的汇报，你可以尝试使用著名的[[麦肯锡方法#^0042|电梯陈述法]]，强迫自己在30秒内传递核心洞见。
4. **错误范例（绝对禁止）**：如果汇报时间短，你要在30秒内说清楚。[[麦肯锡方法#^0042]]

## 回答规范
0. 按用户名称称呼或者阁下
1. **双链引用**：每个论断使用工具返回的 Link，[[路径|显示名]] 自然融入句子
2. **基于原文**：回答必须来自书中内容，不编造不臆测
3. **静默执行**：调用工具前不输出内容，获得结果后直接回答
4. **回答必须包含 Link**`;
	}

	/**
	 * 加载 Bootstrap 文件（Layer 2）
	 */
	private async loadBootstrapFiles(): Promise<string | null> {
		const files = this.config.bootstrapFiles || [];
		if (files.length === 0) {
			// 尝试加载默认文件
			const defaultFiles = [
				`${this.config.deepReaderDir}/DeepReader.md`,
				`${this.config.deepReaderDir}/STYLE_GUIDE.md`,
				`${this.config.deepReaderDir}/DOMAIN_KNOWLEDGE.md`,
			];

			const contents: string[] = [];

			for (const filename of defaultFiles) {
				const content = await this.readFile(filename);
				if (content?.trim()) {
					const sectionName = filename.split('/').pop()?.replace(/\.md$/, '') || 'Custom';
					contents.push(`### ${sectionName}\n\n${content.trim()}`);
				}
			}

			return contents.length > 0 ? contents.join('\n\n') : null;
		}

		// 加载用户指定的文件
		const contents: string[] = [];

		for (const filename of files) {
			const content = await this.readFile(filename);
			if (content?.trim()) {
				const sectionName = filename.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Custom';
				contents.push(`### ${sectionName}\n\n${content.trim()}`);
			}
		}

		return contents.length > 0 ? contents.join('\n\n') : null;
	}

	/**
	 * 读取文件内容
	 */
	private async readFile(path: string): Promise<string | null> {
		try {
			const normalizedPath = normalizePath(path);
			const exists = await this.app.vault.adapter.exists(normalizedPath);
			if (!exists) return null;

			const content = await this.app.vault.adapter.read(normalizedPath);
			return content;
		} catch (err) {
			agentLog('[ContextBuilder] 读取文件失败:', path, err);
			return null;
		}
	}

	// ============================================================================
	// 静态方法（用于运行时上下文构建）
	// ============================================================================

	/**
	 * 构建运行时上下文（注入到用户消息）
	 * 文档信息已在 Identity 层展示，此处仅返回时间
	 *
	 * @returns 运行时上下文字符串
	 */
	static buildRuntimeContext(): string {
		const now = new Date();
		const timeStr = now.toLocaleString('zh-CN', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			weekday: 'long',
		});

		return `${RUNTIME_CONTEXT_TAG}\n当前时间: ${timeStr}`;
	}

	/**
	 * 构建完整消息列表
	 *
	 * @param systemPrompt 系统提示
	 * @param history 历史消息
	 * @param currentMessage 当前用户消息
	 * @param runtimeContext 运行时上下文（可选）
	 * @param systemNote 路由器动态指令（可选，会拼接到用户消息前）
	 * @returns 完整消息列表
	 */
	static buildMessages(
		systemPrompt: string,
		history: ChatMessage[],
		currentMessage: string,
		runtimeContext?: string,
		systemNote?: string
	): ChatMessage[] {
		// 构建用户消息内容
		// 顺序：systemNote + runtimeContext + 用户消息
		let userContent = currentMessage;

		if (runtimeContext) {
			userContent = `${runtimeContext}\n\n${userContent}`;
		}

		if (systemNote) {
			userContent = `${systemNote}\n\n${userContent}`;
		}

		// 过滤掉 history 中已有的系统提示词（避免重复）
		const filteredHistory = history.filter(m => m.role !== 'system');

		return [
			{ role: 'system', content: systemPrompt },
			...filteredHistory,
			{ role: 'user', content: userContent },
		];
	}

	/**
	 * 构建带文档信息的消息列表
	 *
	 * 便捷方法，自动构建运行时上下文
	 *
	 * @param systemPrompt 系统提示
	 * @param history 历史消息
	 * @param currentMessage 当前用户消息
	 * @param _metadata 文档元数据（保留参数兼容调用方，但不再使用）
	 * @param _progress 阅读进度（保留参数兼容调用方，但不再使用）
	 * @param systemNote 路由器动态指令（可选）
	 */
	static buildMessagesWithMetadata(
		systemPrompt: string,
		history: ChatMessage[],
		currentMessage: string,
		_metadata?: DocumentMetadata,
		_progress?: ReadingProgress,
		systemNote?: string
	): ChatMessage[] {
		const runtimeContext = ContextBuilder.buildRuntimeContext();
		return ContextBuilder.buildMessages(systemPrompt, history, currentMessage, runtimeContext, systemNote);
	}
}
