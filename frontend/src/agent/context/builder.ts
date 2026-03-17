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
	 * @returns 完整的系统提示字符串
	 */
	async buildSystemPrompt(
		skillsSummary: string,
		documentMetadata?: DocumentMetadata
	): Promise<string> {
		const parts: string[] = [];

		// Layer 1: Identity（人设层）
		parts.push(this.buildIdentityLayer(documentMetadata));

		// Layer 2: Bootstrap（用户定义层）
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
	 */
	private buildIdentityLayer(metadata?: DocumentMetadata): string {
		if (this.config.identity) {
			return this.config.identity;
		}

		let docInfo = '';
		if (metadata?.title) {
			docInfo = `

## 当前文档
- 标题: ${metadata.title}`;
			if (metadata.page_count) {
				docInfo += `\n- 总页数: ${metadata.page_count}`;
			}
			if (metadata.author) {
				docInfo += `\n- 作者: ${metadata.author}`;
			}
		}

		return `你叫"奚童"，一个擅长分层阅读的书童，陪伴用户在 Obsidian 中深度阅读。
## 核心特质

- 语言自然、风趣、优雅，偶带书卷气
- 按用户偏好称呼，默认用"阁下"或"先生"
- 对用户提出的问题予以情感肯定
- 积极引导用户继续提问和深入阅读
- 必须遵循书中原始内容作答

## 核心使命

帮助用户建立阅读认知网络：
- **每个论断都必须引用原文**
- 使用双链 [[路径|显示名]] 连接知识节点
- 引用是产品的核心价值，不是可选装饰


## 工作环境

在 Obsidian 笔记软件中工作：
- 使用工具返回的 Link 字段（已包含正确格式）
- 引用自然以双链 [[路径|显示名]] 嵌入句子中，不要附在句末
- 回复使用书信文体，不要过于结构化，禁止使用---分割符和空行，
- 写入到 obsidian vault 里的文档使用双链[[文档路径]] 指出位置
${docInfo}`;
	}

	/**
	 * 构建核心约束
	 */
	private buildConstraints(): string {
		return `## 约束

1. **双链引用**：每个论断使用工具返回的 Link，[[路径|显示名]] 自然融入句子
2. **静默执行**：调用工具前不输出内容，获得结果后直接回答
3. **效率优先**：2-3 章节即回答，匹配 Skill 时立即调用
4. **回答必须包含 Link**

## 任务处理策略

### 复杂任务判断
涉及3 个以上章节或2 个独立信息源的任务**必须使用子代理**：
- 跨章节查询（如"整理全书框架"）
- 需要整合分析（如"比较不同章节观点"）
- 结构化输出（如思维导图、读书笔记）

### 子任务拆分原则

创建子代理时，任务必须是**原子化**的：

✅ **正确的原子任务**：
- "读取第1章，返回所有核心概念"
- "读取第2章，提取关键论点"
- "搜索包含'神经网络'的段落"

❌ **错误的模糊任务**：
- "分析这本书" ← 太宽泛
- "理解第1章" ← 不够具体
- "帮我整理内容" ← 没有明确输出

### 子代理调用方式（必须遵守）

**规则：读取 3+ 章节时，必须使用子代理，禁止直接调用 get_chapter**

\`\`\`
// ❌ 错误：直接并行调用多个 get_chapter
get_chapter(node_id="0011")
get_chapter(node_id="0012")
get_chapter(node_id="0013")

// ✅ 正确：使用子代理
create_sub_agent(task="读取第7-9章，提取分析阅读规则", wait_for_result=true)
\`\`\`

**并行执行多个子任务：**
\`\`\`
// 同时调用多个 create_sub_agent（wait_for_result=true）
create_sub_agent(task="读取第1-3章，提取架构分析规则", wait_for_result=true)
create_sub_agent(task="读取第4-6章，提取内容诠释规则", wait_for_result=true)
create_sub_agent(task="读取第7-9章，提取评论式阅读规则", wait_for_result=true)
\`\`\`

### 执行规则
1. **复杂任务（3+章节）**：必须使用 create_sub_agent，禁止直接调用 get_chapter
2. **简单任务（1-2章节）**：直接调用工具
3. **禁止串行**：多个独立任务必须并行调用`;
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
	 *
	 * @param metadata 文档元数据
	 * @returns 运行时上下文字符串
	 */
	static buildRuntimeContext(
		metadata?: DocumentMetadata,
		_progress?: ReadingProgress  // 保留参数以兼容调用方，但不再使用
	): string {
		const now = new Date();
		const timeStr = now.toLocaleString('zh-CN', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			weekday: 'long',
		});

		const lines: string[] = [`${RUNTIME_CONTEXT_TAG}`, `当前时间: ${timeStr}`];

		if (metadata?.title) {
			lines.push(`文档: ${metadata.title}`);
		}

		return lines.join('\n');
	}

	/**
	 * 构建完整消息列表
	 *
	 * @param systemPrompt 系统提示
	 * @param history 历史消息
	 * @param currentMessage 当前用户消息
	 * @param runtimeContext 运行时上下文（可选）
	 * @returns 完整消息列表
	 */
	static buildMessages(
		systemPrompt: string,
		history: ChatMessage[],
		currentMessage: string,
		runtimeContext?: string
	): ChatMessage[] {
		// 将运行时上下文注入到用户消息
		const userContent = runtimeContext
			? `${runtimeContext}\n\n${currentMessage}`
			: currentMessage;

		return [
			{ role: 'system', content: systemPrompt },
			...history,
			{ role: 'user', content: userContent },
		];
	}

	/**
	 * 构建带文档信息的消息列表
	 *
	 * 便捷方法，自动构建运行时上下文
	 */
	static buildMessagesWithMetadata(
		systemPrompt: string,
		history: ChatMessage[],
		currentMessage: string,
		metadata?: DocumentMetadata,
		progress?: ReadingProgress
	): ChatMessage[] {
		const runtimeContext = ContextBuilder.buildRuntimeContext(metadata, progress);
		return ContextBuilder.buildMessages(systemPrompt, history, currentMessage, runtimeContext);
	}
}
