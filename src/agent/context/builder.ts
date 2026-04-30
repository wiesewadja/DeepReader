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
	identity?: string;
	bootstrapFiles?: string[];
	deepReaderDir?: string;
	maxDialogueSummaries?: number;
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
export class ContextBuilder implements IContextBuilder {
	private app: App;
	private store: MemoryStore;
	private config: ContextBuilderConfig;

	constructor(app: App, store: MemoryStore, config: ContextBuilderConfig = {}) {
		this.app = app;
		this.store = store;
		this.config = {
			deepReaderDir: 'DeepReader',
			maxDialogueSummaries: 10,
			...config,
		};
	}

	async loadRelevantDialogueSummaries(bookName: string, limit: number = 10): Promise<string> {
		const entries = await this.store.searchDialogueSummaries(bookName, limit);
		if (entries.length === 0) return '';

		const formatted = entries.map(e => e.trim()).join('\n\n');
		return `## 相关对话摘要\n\n${formatted}`;
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

		parts.push(this.buildIdentityLayer(documentMetadata, docDescription));

		const bootstrap = await this.loadBootstrapFiles();
		if (bootstrap) {
			parts.push(bootstrap);
		}

		const memory = await this.store.getMemoryContext();
		if (memory) {
			parts.push(memory);
		}

		if (documentMetadata?.title) {
			const dialogueSummaries = await this.loadRelevantDialogueSummaries(
				documentMetadata.title,
				this.config.maxDialogueSummaries ?? 10
			);
			if (dialogueSummaries) {
				parts.push(dialogueSummaries);
			}
		}

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
- 仿照书信体，避免过度格式化写作

# 📝 Obsidian 行内引用绝对规范
当你基于检索工具的内容生成回答时，必须完美融入用户的个人知识库：
1. **语法强制**：必须使用别名链接语法 \`[[书籍名称#核心锚点|自然展示文本]]\`。
2. **无缝嵌入**：引用必须作为句子中的主语、宾语或修饰语，严禁生硬地堆砌在句末。
3. **锚点保真**：只能使用工具实际返回的 \`^block_id\`。**绝对禁止凭空捏造 ID。**
【✅ 正确示范】：昭先生，面对时间紧迫的汇报，您可以尝试使用著名的[[麦肯锡方法#^0042|电梯陈述法]]，强迫自己在30秒内传递核心洞见。
【❌ 错误示范】：如果汇报时间短，你要在30秒内说清楚。[[麦肯锡方法#^0042]]

${docInfo}`;
	}

	/**
	 * 构建核心约束（精简版）
	 * 只保留阅读产品相关的核心规则，技术细节移到 Tool Description
	 */
	private buildConstraints(): string {
		return `## 核心行为准则

### 1. **【路由服从】**：每次对话前，系统会通过 \`<system_note>\` 告诉你当前属于哪种阅读层级（检视/分析/主题），你必须**绝对服从**该限制，仅调用被允许的工具。
### 2. 你的阅读动作定义
- **搜索 (search_book)**：8 阶段混合搜索（BM25 + 语义 + scope 过滤），返回 block_id 级匹配段落。大部分情况搜索结果已够用，无需再读完整章节。
- **精读 (read_book_section)**：按 node_ids 批量读取完整章节内容，或按 block_id 定位到具体段落。搜索结果不够详细时使用。

## 4. 静默执行纪律 (Silent Execution)
当你决定调用任何工具时，
**必须直接输出 JSON/Tool Call，绝对禁止在 content 字段输出任何自然语言文本**（例如“让我查一下”、“正在搜索”等废话）。
  `;
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
	 * @param systemNote 路由器动态指令（可选）
	 */
	static buildMessagesWithMetadata(
		systemPrompt: string,
		history: ChatMessage[],
		currentMessage: string,
		_metadata?: DocumentMetadata,
		systemNote?: string
	): ChatMessage[] {
		const runtimeContext = ContextBuilder.buildRuntimeContext();
		return ContextBuilder.buildMessages(systemPrompt, history, currentMessage, runtimeContext, systemNote);
	}
}


/**
 * ContextBuilder 实例方法接口
 *
 * 静态工具方法（buildRuntimeContext, buildMessages）不纳入接口，
 * 它们是无状态的纯函数，消费者可直接调用
 */
export interface IContextBuilder {
	loadRelevantDialogueSummaries(bookName: string, limit?: number): Promise<string>;
	buildSystemPrompt(skillsSummary: string, documentMetadata?: DocumentMetadata, docDescription?: string): Promise<string>;
}
