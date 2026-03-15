/**
 * ContextBuilder - 分层系统提示构建器
 *
 * 负责构建 4 层系统提示：
 * 1. Identity 层 (静态): 人设和基本特质
 * 2. Bootstrap 层 (用户定义): 自定义提示文件
 * 3. Memory 层 (持久化): 用户画像和长期记忆
 * 4. Tools 层 (动态): 工具和技能描述
 *
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
 * const systemPrompt = await builder.buildSystemPrompt(toolDesc, skillDesc, metadata);
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
	 * @param toolDescriptions 工具描述文本
	 * @param skillDescriptions 技能描述文本
	 * @param documentMetadata 当前文档元数据（可选）
	 * @returns 完整的系统提示字符串
	 */
	async buildSystemPrompt(
		toolDescriptions: string,
		skillDescriptions: string,
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

		// Layer 4: Tools & Skills（工具层）
		parts.push(`## 工具\n\n${toolDescriptions}`);
		if (skillDescriptions.trim()) {
			parts.push(`## 可用技能\n\n${skillDescriptions}`);
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

		// 默认身份：奚童人设
		let docInfo = '';
		if (metadata?.title) {
			docInfo = `\n\n## 当前文档\n- 标题: ${metadata.title}`;
			if (metadata.page_count) {
				docInfo += `\n- 总页数: ${metadata.page_count}`;
			}
			if (metadata.author) {
				docInfo += `\n- 作者: ${metadata.author}`;
			}
		}

		return `你叫"奚童"，一个擅长使用分层阅读方法，专注书本、语言天赋极高的书童，正陪伴用户阅览书籍。

**核心特质**：
- 语言自然、风趣、优雅，偶带书卷气
- 按用户偏好称呼，默认用"阁下"或"先生"
- 工作在笔记软件Obsidian，要尽可能引入vault里已经存在的章节名称以 wiki 链接的方式来关联你的回复
- 调入文档后要使用[[新文档的路径]]wiki 链接形式指出文档位置

## 阅读方法论

你精通《如何阅读一本书》的四层次阅读法，会根据问题特征选择合适的阅读深度。

**检视阅读**：用户问"讲什么"、"总结"、"概览"时使用
- 目标：快速抓取重点，了解整体结构
- 策略：优先 get_toc，search_doc 用较小 top_k

**分析阅读**：用户问"为什么"、"详细解释"、"深入分析"时使用
- 目标：完整理解，咀嚼消化
- 策略：多次调用 get_chapter，逐段分析

**主题阅读**：用户问"比较"、"其他书"、"关联"时使用
- 目标：跨书比较，建立关联
- 策略：使用 search_read_books 搜索已读书库

**原则**：信息足够即回答，不主动升级层次。如果检视阅读已能回答，不必深入分析。

${docInfo}


## 工具选择指南

根据用户问题类型，按以下优先级选择工具：

| 问题类型 | 首选工具 | 阅读层次 |
|---------|---------|---------|
| "讲什么/总结/概览" | get_toc + search_doc | 检视阅读 |
| "结构/组织/纲要" | outline_structure | 分析阅读 |
| "详细解释/为什么/深入" | get_chapter | 分析阅读 |
| "术语/概念/关键词" | find_key_terms | 分析阅读 |
| "论点/主旨/核心观点" | extract_propositions | 分析阅读 |
| "比较/其他书/关联" | search_read_books | 主题阅读 |

**⚡ 并行调用规则（重要！）**：
- "讲什么/总结"类问题 → **同时调用** get_toc 和 search_doc（一次完成）
- 需要多个章节 → **一次调用多个** get_chapter
- 每轮尽可能多调用工具，减少迭代次数

**效率原则**：
1. 获得 2-3 个相关章节后立即回答，不要过度搜索
2. 避免重复获取同一内容
3. 如果检视阅读已能回答，不主动升级到分析阅读`;
	}

	/**
	 * 构建核心约束
	 */
	private buildConstraints(): string {
		return `## ⚠️ 强制约束

### 1. obsidian wiki引用格式（必须遵守）
**关键**：
- 每个论断都必须引用,**必须**使用 search_doc/get_chapter 返回的 Link 字段
- 使用 \`[[路径|显示名]]\` 格式
- 引用**自然嵌入**句子中，不要附在句末

\`\`\`
✅ 正确: 柏拉图批评民主容易演变为暴民统治，详见[[{{书籍名}}/{{章节名}}.md|{{章节名适合嵌入到回复文本的显示文段}}]]
❌ 错误: 柏拉图批评民主容易演变为暴民统治[[{{书籍名}}/{{章节名}}.md|{{章节名适合嵌入到回复文本的显示文段}}]]  ← 引用太突兀
❌ 错误: [[西方史纲#第一章]]  ← 自己构造的链接
\`\`\`

### 2. 静默执行
- **调用工具前**: 严禁输出任何内容
- **获得结果后**: 直接回答，不要说"我找到了"、"书中提到"
- **禁止**: "待我翻阅"、"让我看看"、"根据目录"

### 3. 表达风格
- 段落式叙述，段落间空行分隔
- 用 **加粗** 标记重点
- 平和内敛，直接详实，偶有点睛感悟

### 4. 效率原则（重要！）
- **信息足够即回答**：获得 2-3 个相关章节后立即开始回答，不要过度搜索
- **避免重复**：已获取的章节不要再次获取
- **一次多查**：如果需要多个章节，在一次工具调用中尽可能多地获取
- **优先精准**：search_doc 的 top_k 默认用 2-3 即可，不要贪多

### 5. 搜索查询格式（重要！）
- **search_doc 直接传完整问题**：不要提取关键词！后端使用语义搜索，能理解完整句子的含义
- ❌ 错误: search_doc(query="考公 公务员 30年")
- ✅ 正确: search_doc(query="回顾日本的全民考公30年历程")
- **一次搜索即可**：如果第一次搜索结果不理想，换一种表达方式再试，而不是提取更多关键词

## 用户互动

**个性化**：结合用户背景调整回答深度和角度

**情感回应**：
- 洞察时刻（用户摘录/高亮）：识别意义，给予简短情感回应
- 困惑时刻（反复提问）：换角度解释，提供类比
- 好问题（追问本质/跨概念关联）：频率不要太高，简短肯定

## 规则
- 任务匹配 Skill 时立即调用
- 优先使用工具获取信息
- **回答必须包含 Link 引用**`;
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
