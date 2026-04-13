# 对话历史导入与三层记忆架构 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决对话历史导入断层问题，让多轮对话上下文不丢失：跨会话记忆（HISTORY.md 对话摘要）+ 当前会话内历史（S2 传入历史）。

**Architecture:** 扩展现有 MemoryConsolidator 的 SAVE_MEMORY_TOOL，增加 references 参数，将对话摘要写入 HISTORY.md；新增 history-summarizer.ts，为 S2 提供摘要化历史和已搜索范围。

**Tech Stack:** TypeScript, Obsidian Plugin API, Zod

---

## File Structure

### Part 1: 三层记忆架构（跨会话）

| 文件 | 修改类型 | 负责内容 |
|-----|---------|---------|
| `src/agent/memory/types.ts` | Modify | 扩展 ConsolidationResult（增加 references），扩展 ConsolidatorConfig（增加 skipThreshold） |
| `src/agent/memory/store.ts` | Modify | 新增 searchDialogueSummaries() 方法 |
| `src/agent/memory/consolidator.ts` | Modify | 扩展 SAVE_MEMORY_TOOL，修改 consolidate() 和整合 Prompt |
| `src/agent/context/builder.ts` | Modify | 新增 loadRelevantDialogueSummaries()，修改 buildSystemPrompt() |

### Part 2: S2 历史传入（当前会话内）

| 文件 | 修改类型 | 负责内容 |
|-----|---------|---------|
| `src/agent/cognitive-engine/types.ts` | Modify | SharedContext 新增 prevSearchedBlockIds, recentHistorySummaries |
| `src/agent/cognitive-engine/context.ts` | Modify | SharedContextImpl 新增字段 |
| `src/agent/cognitive-engine/utils/history-summarizer.ts` | Create | 历史摘要化函数 |
| `src/agent/cognitive-engine/prompts/analytical-prompt.ts` | Modify | buildAnalyticalUserMessage 新增参数和 `<history>` `<prev_searched>` 块 |
| `src/agent/cognitive-engine/states/analytical.ts` | Modify | 调用时传入新参数 |
| `src/agent/index.ts` | Modify | continueChat() 增加历史摘要提取 |

---

## Chunk 1: 三层记忆架构（跨会话）(Tasks 1-5, 约557行)

### Task 1: 扩展类型定义

**Files:**
- Modify: `src/agent/memory/types.ts:45-75`

- [ ] **Step 1: 扩展 ConsolidationResult 类型**

在 `src/agent/memory/types.ts` 的 `ConsolidationResult` interface 后添加：

```typescript
/**
 * 记忆整合结果（LLM save_memory 工具返回）
 */
export interface ConsolidationResult {
	/** HISTORY.md 条目 */
	historyEntry: string;
	/** 关键引用链接（新增） */
	references: string[];
	/** MEMORY.md 更新内容 */
	memoryUpdate: string;
}
```

- [ ] **Step 2: 扩展 ConsolidatorConfig 类型**

在 `ConsolidatorConfig` interface 后添加：

```typescript
/**
 * 整合器配置
 */
export interface ConsolidatorConfig {
	/** 触发整合的 Token 阈值 */
	tokenThreshold: number;
	/** 目标压缩比例 */
	targetRatio: number;
	/** 最大整合轮数 */
	maxRounds: number;
	/** 跳过阈值：条目长度小于此值视为闲聊（新增） */
	skipThreshold: number;
	/** 加载到 LLM 的最大对话摘要数（新增） */
	maxDialogueSummaries: number;
}
```

- [ ] **Step 3: 更新 DEFAULT_CONSOLIDATOR_CONFIG**

修改默认配置：

```typescript
export const DEFAULT_CONSOLIDATOR_CONFIG: ConsolidatorConfig = {
	tokenThreshold: 8000,
	targetRatio: 0.5,
	maxRounds: 5,
	skipThreshold: 20,
	maxDialogueSummaries: 10,
};
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run build`
Expected: 
- ✅ `src/agent/memory/types.ts` 无类型错误
- ⚠️ 其他文件可能有 unrelated warnings（如 `obsidian` 类型），可忽略
- ❌ 如果 `types.ts` 有错误，说明类型定义有冲突，需检查

- [ ] **Step 5: Commit**

```bash
git add src/agent/memory/types.ts
git commit -m "feat(memory): 扩展 ConsolidationResult 和 ConsolidatorConfig 类型"
```

---

### Task 2: 扩展 MemoryStore

**Files:**
- Modify: `src/agent/memory/store.ts`

**Pre-check:** `store.ts` 已有 `agentLog` import（第17行：`import { agentLog } from '../../utils/logger';`）

- [ ] **Step 1: 确认 import 存在**

Run: `grep "agentLog" src/agent/memory/store.ts`
Expected: 找到 import 行

- [ ] **Step 2: 新增 searchDialogueSummaries 方法**

在 `src/agent/memory/store.ts` 的 `searchHistory()` 方法后添加：

```typescript
/**
 * 搜索对话摘要（根据书籍名称过滤）
 *
 * @param bookName 书籍名称
 * @param limit 返回条目数
 */
async searchDialogueSummaries(bookName: string, limit: number = 10): Promise<string[]> {
	try {
		const content = await this.readHistory(100);
		if (!content) return [];

		const entries = content.split(/\n\n---\n\n/);
		const dialogueEntries = entries.filter(entry => 
			entry.includes('💬') && 
			(entry.includes(`《${bookName}》`) || entry.includes(bookName))
		);

		return dialogueEntries.slice(-limit).map(e => e.trim());
	} catch (err) {
		agentLog('[MemoryStore] 搜索对话摘要失败:', err);
		return [];
	}
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/agent/memory/store.ts
git commit -m "feat(memory): 新增 searchDialogueSummaries 方法"
```

---

### Task 3: 扩展 MemoryConsolidator

**Files:**
- Modify: `src/agent/memory/consolidator.ts`

**注意:** 此 Task 分为 4 个子步骤，分别修改不同位置

- [ ] **Step 1: 扩展 SAVE_MEMORY_TOOL 常量**（约第22-46行）

修改 `SAVE_MEMORY_TOOL` 的 parameters，添加 `references` 字段：

```typescript
const SAVE_MEMORY_TOOL = [
	{
		type: 'function',
		function: {
			name: 'save_memory',
			description: '保存记忆整合结果到持久化存储。',
			parameters: {
				type: 'object',
				properties: {
					history_entry: {
						type: 'string',
						description: '对话摘要条目。格式：💬 关于《书名》讨论了主题，得出结论Y。引用：[[书名#^blockId]]。如果是闲聊或无实质内容（条目长度<20字符），返回空字符串。',
					},
					references: {
						type: 'array',
						items: { type: 'string' },
						description: '关键引用链接，格式：[[书名#^blockId]]。最多保留3个重要引用。',
					},
					memory_update: {
						type: 'string',
						description: '完整的更新后长期记忆（markdown格式）。包含所有现有事实和新事实。如果没有新信息则返回不变。',
					},
				},
				required: ['history_entry', 'memory_update'],
			},
		},
	},
];
```

- [ ] **Step 2: 修改整合 Prompt**

修改 `consolidate()` 方法中的 prompt：

```typescript
const prompt = `分析这段对话，提取核心信息并调用 save_memory 工具。

## 当前长期记忆
${currentMemory}

## 待分析对话
${formattedMessages}

## 分析要点
1. **讨论主题**：这段对话讨论了什么？（简短概括）
2. **关键结论**：得出的结论或给出的建议是什么？
3. **引用链接**：返回了哪些 [[书名#^blockId]] 链接？（最多保留3个重要引用）
4. **用户特征**：是否有新的用户偏好/兴趣发现？如有则更新 memory_update

## 输出要求
- history_entry 格式：💬 关于《书名》讨论了主题，得出结论Y。引用：[[书名#^blockId]]
- 每轮对话生成一条摘要（精简，<100字）
- **跳过规则**：如果对话无实质内容（条目长度<20字符），history_entry 返回空字符串
- 必须调用 save_memory 工具`;
```

- [ ] **Step 3: 修改 callLLM 解析逻辑**

修改 `callLLM()` 方法，解析新增的 `references` 字段：

```typescript
private async callLLM(prompt: string): Promise<ConsolidationResult | null> {
	let result: ConsolidationResult | null = null;

	await new Promise<void>((resolve) => {
		this.client.streamChat(
			[
				{
					role: 'system',
					content: '你是一个记忆整合助手。分析对话并提取重要信息。必须调用 save_memory 工具。',
				},
				{ role: 'user', content: prompt },
			],
			SAVE_MEMORY_TOOL as any,
			{
				onContent: () => {},
				onToolCall: (calls) => {
					if (calls.length > 0 && calls[0].name === 'save_memory') {
						try {
							const args = JSON.parse(calls[0].arguments);
							result = {
								historyEntry: args.history_entry || '',
								references: args.references || [],
								memoryUpdate: args.memory_update || '',
							};
						} catch {
							// 解析失败
						}
					}
				},
				onComplete: () => resolve(),
				onError: () => resolve(),
			}
		);
	});

	return result;
}
```

- [ ] **Step 4: 修改 consolidate() 写入逻辑**

修改 `consolidate()` 方法，写入对话摘要到 HISTORY.md：

```typescript
async consolidate(
	messages: ChatMessage[],
	lastConsolidated: number,
	boundary: number
): Promise<ConsolidationResult | null> {
	const toConsolidate = messages.slice(lastConsolidated, boundary);
	if (toConsolidate.length === 0) {
		return null;
	}

	const currentMemory = (await this.store.readLongTermMemory()) || '(空)';
	const formattedMessages = this.formatMessages(toConsolidate);

	const prompt = `分析这段对话，提取核心信息并调用 save_memory 工具。

## 当前长期记忆
${currentMemory}

## 待分析对话
${formattedMessages}

## 分析要点
1. **讨论主题**：这段对话讨论了什么？（简短概括）
2. **关键结论**：得出的结论或给出的建议是什么？
3. **引用链接**：返回了哪些 [[书名#^blockId]] 链接？（最多保留3个重要引用）
4. **用户特征**：是否有新的用户偏好/兴趣发现？如有则更新 memory_update

## 输出要求
- history_entry 格式：💬 关于《书名》讨论了主题，得出结论Y。引用：[[书名#^blockId]]
- 每轮对话生成一条摘要（精简，<100字）
- **跳过规则**：如果对话无实质内容（条目长度<20字符），history_entry 返回空字符串
- 必须调用 save_memory 工具`;

	try {
		const response = await this.callLLM(prompt);

		if (response) {
			// 1. 写入对话摘要到 HISTORY.md（如果有实质内容）
			if (response.historyEntry && response.historyEntry.length >= this.config.skipThreshold) {
				await this.store.appendHistory(response.historyEntry);
				agentLog('[Consolidator] 对话摘要已写入 HISTORY.md:', response.historyEntry.slice(0, 50));
			}

			// 2. 更新 MEMORY.md（如果有用户特征更新）
			if (response.memoryUpdate && response.memoryUpdate.trim()) {
				await this.store.writeLongTermMemory(response.memoryUpdate);
				agentLog('[Consolidator] MEMORY.md 已更新');

				await this.maybeCompressMemory();
			}
			return response;
		}
	} catch (err) {
		agentLog('[Consolidator] 整合失败:', err);
	}

	return null;
}
```

- [ ] **Step 5: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add src/agent/memory/consolidator.ts
git commit -m "feat(memory): 扩展 SAVE_MEMORY_TOOL，增加对话摘要写入 HISTORY.md"
```

---

### Task 4: 扩展 ContextBuilder

**Files:**
- Modify: `src/agent/context/builder.ts`

- [ ] **Step 1: 新增 loadRelevantDialogueSummaries 方法**

在 `src/agent/context/builder.ts` 的 `buildSystemPrompt()` 方法前添加：

```typescript
/**
 * 加载与当前书籍相关的对话摘要
 *
 * @param bookName 当前书籍名称
 * @param limit 最大条目数
 */
async loadRelevantDialogueSummaries(bookName: string, limit: number = 10): Promise<string> {
	const entries = await this.memoryStore.searchDialogueSummaries(bookName, limit);
	if (entries.length === 0) return '';

	const formatted = entries.map(e => e.trim()).join('\n\n');
	return `## 相关对话摘要\n\n${formatted}`;
}
```

- [ ] **Step 2: 修改 buildSystemPrompt 调用新方法**

修改 `buildSystemPrompt()` 方法，在构建 prompt 时调用新方法：

```typescript
async buildSystemPrompt(
	skillsSummary: string,
	documentMetadata?: DocumentMetadata,
	docDescription?: string
): Promise<string> {
	const parts: string[] = [];

	// Layer 1: Identity
	parts.push(this.buildIdentityLayer());

	// Layer 2: Bootstrap files
	const bootstrapContent = await this.loadBootstrapFiles();
	if (bootstrapContent) {
		parts.push(bootstrapContent);
	}

	// Layer 3: Long-term memory
	const memoryContext = await this.store.getMemoryContext();
	if (memoryContext) {
		parts.push(memoryContext);
	}

	// Layer 4: Dialogue summaries (NEW)
	if (documentMetadata?.title) {
		const dialogueSummaries = await this.loadRelevantDialogueSummaries(
			documentMetadata.title,
			this.config.maxDialogueSummaries
		);
		if (dialogueSummaries) {
			parts.push(dialogueSummaries);
		}
	}

	// Layer 5: Constraints
	parts.push(this.buildConstraints());

	// Layer 6: Skills
	if (skillsSummary) {
		parts.push(`<skills>\n${skillsSummary}\n</skills>`);
	}

	return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 3: 更新 ContextBuilderOptions 类型**

在 `src/agent/context/builder.ts` 的 `ContextBuilderOptions` interface 中添加：

```typescript
interface ContextBuilderOptions {
	deepReaderDir: string;
	maxDialogueSummaries?: number;  // 新增
}
```

并在构造函数中设置默认值：

```typescript
constructor(app: App, store: MemoryStore, options: ContextBuilderOptions) {
	this.app = app;
	this.store = store;
	this.config = {
		deepReaderDir: options.deepReaderDir,
		maxDialogueSummaries: options.maxDialogueSummaries ?? 10,
	};
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add src/agent/context/builder.ts
git commit -m "feat(context): 新增 loadRelevantDialogueSummaries，system prompt 加载相关对话摘要"
```

---

### Task 5: 验证 Part 1 实现

- [ ] **Step 1: 创建测试文件**

Create: `src/agent/memory/__tests__/dialogue-summary.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryStore } from '../store';
import { MemoryConsolidator } from '../consolidator';
import { DEFAULT_CONSOLIDATOR_CONFIG } from '../types';

describe('Dialogue Summary', () => {
	let store: MemoryStore;
	let mockClient: any;

	beforeEach(() => {
		const mockApp = {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(true),
					read: vi.fn().mockResolvedValue('# 长期记忆\n\n用户画像：喜欢深度讨论'),
					write: vi.fn().mockResolvedValue(undefined),
				},
			},
		};
		store = new MemoryStore(mockApp as any);
		mockClient = {
			streamChat: vi.fn().mockImplementation((messages, tools, callbacks) => {
				callbacks.onToolCall([
					{
						name: 'save_memory',
						arguments: JSON.stringify({
							history_entry: '💬 关于《测试书籍》讨论了"MECE原则"，得出结论：MECE=互斥完备',
							references: ['[[测试书籍#^b1]]'],
							memory_update: '# 长期记忆\n\n用户画像：喜欢深度讨论\n\n兴趣主题：MECE原则',
						}),
					},
				]);
				callbacks.onComplete();
			}),
		};
	});

	it('should extract references from tool call', async () => {
		const consolidator = new MemoryConsolidator(store, mockClient, DEFAULT_CONSOLIDATOR_CONFIG);
		const messages = [
			{ role: 'user', content: '什么是MECE？' },
			{ role: 'assistant', content: 'MECE是Mutually Exclusive Collectively Exhaustive的缩写...' },
		];

		const result = await consolidator.consolidate(messages, 0, 2);

		expect(result).not.toBeNull();
		expect(result?.historyEntry).toContain('💬');
		expect(result?.references).toContain('[[测试书籍#^b1]]');
	});

	it('should skip empty history_entry', async () => {
		mockClient.streamChat = vi.fn().mockImplementation((messages, tools, callbacks) => {
			callbacks.onToolCall([
				{
					name: 'save_memory',
					arguments: JSON.stringify({
						history_entry: '',  // 空字符串
						references: [],
						memory_update: '# 长期记忆',
					}),
				},
			]);
			callbacks.onComplete();
		});

		const consolidator = new MemoryConsolidator(store, mockClient, {
			...DEFAULT_CONSOLIDATOR_CONFIG,
			skipThreshold: 20,
		});
		const messages = [
			{ role: 'user', content: '你好' },
			{ role: 'assistant', content: '你好！有什么可以帮助你的吗？' },
		];

		const result = await consolidator.consolidate(messages, 0, 2);

		expect(result?.historyEntry).toBe('');
		expect(result?.historyEntry.length).toBeLessThan(DEFAULT_CONSOLIDATOR_CONFIG.skipThreshold);
	});
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:run src/agent/memory/__tests__/dialogue-summary.test.ts`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/agent/memory/__tests__/dialogue-summary.test.ts
git commit -m "test(memory): 添加对话摘要单元测试"
```

---

## Chunk 2: S2 历史传入（当前会话内）

### Task 6: 创建 history-summarizer.ts

**Files:**
- Create: `src/agent/cognitive-engine/utils/history-summarizer.ts`

- [ ] **Step 1: 创建文件并实现摘要化函数**

```typescript
/**
 * 历史摘要化工具
 * 
 * 将完整的 user/assistant 消息转换为精简摘要，供 S2 Analytical 使用
 */

import type { ChatMessage } from '../../types';

/**
 * 历史摘要结构
 */
export interface HistorySummary {
	/** 讨论 topic（从 user 消息推断） */
	topic: string;
	/** 核心结论（assistant 消息前100字） */
	conclusion: string;
	/** 引用的 block_ids */
	blockIds: string[];
}

/**
 * 正则匹配 [[书名/章节#^blockId]] 格式的引用
 */
const BLOCK_ID_REGEX = /\[\[([^\]]+#\^([^\]]+))\]\]/g;

/**
 * 从 assistant 消息中提取所有 block_ids
 */
export function extractBlockIds(content: string): string[] {
	const matches = [...content.matchAll(BLOCK_ID_REGEX)];
	return matches.map(m => m[2]).filter(id => id.length > 0);
}

/**
 * 截取文本（最多指定字数）
 */
function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return text.slice(0, maxChars) + '...';
}

/**
 * 从 user 消息推断讨论 topic
 * 
 * 简单策略：取问句中的关键词（去掉"什么是"、"如何"等通用词）
 */
function inferTopic(userMessage: string): string {
	// 去掉常见问句前缀
	const cleanQuery = userMessage
		.replace(/^(什么是|如何理解|请问|帮我|解释一下|讲讲|详细说说)/i, '')
		.replace(/[？?。.!！，,]/g, '')
		.trim();
	
	return truncate(cleanQuery, 50);
}

/**
 * 摘要化单轮对话
 */
export function summarizeRound(
	userMessage: ChatMessage,
	assistantMessage: ChatMessage
): HistorySummary {
	const userContent = typeof userMessage.content === 'string' 
		? userMessage.content 
		: '';
	const assistantContent = typeof assistantMessage.content === 'string' 
		? assistantMessage.content 
		: '';

	return {
		topic: inferTopic(userContent),
		conclusion: truncate(assistantContent.replace(/\n/g, ' '), 100),
		blockIds: extractBlockIds(assistantContent),
	};
}

/**
 * 摘要化最近 N 轮对话历史
 * 
 * @param history 完整对话历史
 * @param maxRounds 最大轮数（每轮 = user + assistant）
 * @returns 摘要数组
 */
export function summarizeRecentHistory(
	history: ChatMessage[],
	maxRounds: number = 3
): HistorySummary[] {
	// 按轮次分组（每轮 = user + assistant）
	const rounds: Array<[ChatMessage, ChatMessage]> = [];
	
	for (let i = history.length - 1; i >= 1; i--) {
		if (history[i].role === 'assistant' && history[i - 1]?.role === 'user') {
			rounds.push([history[i - 1], history[i]]);
			if (rounds.length >= maxRounds) break;
			i--; // 跳过 user 消息
		}
	}

	// 反转顺序（从旧到新）
	rounds.reverse();

	return rounds.map(([user, assistant]) => summarizeRound(user, assistant));
}

/**
 * 提取上一轮搜索的所有 block_ids
 * 
 * @param history 完整对话历史
 * @returns block_ids 数组
 */
export function extractPrevBlockIds(history: ChatMessage[]): string[] {
	// 找最后一条 assistant 消息
	const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
	if (!lastAssistant || typeof lastAssistant.content !== 'string') {
		return [];
	}

	return extractBlockIds(lastAssistant.content);
}

/**
 * 格式化摘要为 S2 prompt 中的 <history> 块
 */
export function formatHistoryBlock(summaries: HistorySummary[]): string {
	if (summaries.length === 0) return '';

	const lines = summaries.map((s, i) => 
		`[第${i + 1}轮] 用户问"${s.topic}"，分析发现${truncate(s.conclusion, 80)}`
	);

	return `<history>
${lines.join('\n')}
</history>`;
}

/**
 * 格式化已搜索范围为 <prev_searched> 块
 */
export function formatPrevSearchedBlock(blockIds: string[], maxIds: number = 10): string {
	if (blockIds.length === 0) return '';

	const displayIds = blockIds.slice(0, maxIds);
	return `<prev_searched>
已搜索的段落（避免重复）：${displayIds.join(', ')}
</prev_searched>`;
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/cognitive-engine/utils/history-summarizer.ts
git commit -m "feat(cognitive): 新增 history-summarizer 历史摘要化工具"
```

---

### Task 7: 扩展 SharedContext 类型

**Files:**
- Modify: `src/agent/cognitive-engine/types.ts`
- Modify: `src/agent/cognitive-engine/context.ts`

- [ ] **Step 1: 在 types.ts 中新增字段**

在 `SharedContext` interface 中添加：

```typescript
// 找到 SharedContext interface，在现有字段后添加：

/** 最近历史摘要（供 S2 使用） */
recentHistorySummaries?: HistorySummary[];
/** 上一轮搜索的 block_ids（供 S2 避免重复） */
prevSearchedBlockIds?: string[];
```

需要在文件顶部导入 HistorySummary：

```typescript
import type { HistorySummary } from './utils/history-summarizer';
```

- [ ] **Step 2: 在 context.ts 中初始化新字段**

在 `SharedContextImpl` class 中添加字段：

```typescript
// 在 class SharedContextImpl 的字段声明区添加：

// S2 history support
recentHistorySummaries?: HistorySummary[];
prevSearchedBlockIds?: string[];
```

在构造函数中添加参数：

```typescript
// 修改 createSharedContext 函数的参数类型：
export function createSharedContext(params: {
  indexId: string;
  pdfName: string;
  rawUserQuery: string;
  chatHistory?: ChatMessage[];
  markdownFiles?: Record<string, string>;
  abortSignal?: AbortSignal;
  docDescription?: string;
  memoryContext?: string;
  // Engine dependencies
  llmClient?: LLMClient;
  llmClientManager?: LLMClientManager;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
  // S2 history support (NEW)
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
}): SharedContextImpl

// 在构造函数调用中传入新参数：
constructor(
  indexId: string,
  pdfName: string,
  rawUserQuery: string,
  chatHistory: ChatMessage[],
  markdownFiles?: Record<string, string>,
  abortSignal?: AbortSignal,
  docDescription?: string,
  memoryContext?: string,
  llmClient?: LLMClient,
  llmClientManager?: LLMClientManager,
  toolRegistry?: ToolRegistry,
  toolContext?: ToolContext,
  recentHistorySummaries?: HistorySummary[],  // 新增
  prevSearchedBlockIds?: string[]              // 新增
)

// 在构造函数体中赋值：
this.recentHistorySummaries = recentHistorySummaries;
this.prevSearchedBlockIds = prevSearchedBlockIds;
```

- [ ] **Step 3: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/agent/cognitive-engine/types.ts src/agent/cognitive-engine/context.ts
git commit -m "feat(cognitive): SharedContext 新增 recentHistorySummaries 和 prevSearchedBlockIds"
```

---

### Task 8: 修改 S2 Analytical Prompt

**Files:**
- Modify: `src/agent/cognitive-engine/prompts/analytical-prompt.ts`
- Modify: `src/agent/cognitive-engine/states/analytical.ts`

- [ ] **Step 1: 在 analytical-prompt.ts 中新增参数和块**

修改 `buildAnalyticalUserMessage` 函数：

```typescript
import type { HistorySummary } from '../utils/history-summarizer';
import { formatHistoryBlock, formatPrevSearchedBlock } from '../utils/history-summarizer';

/**
 * Build user message for analytical state with history context
 */
export function buildAnalyticalUserMessage(
  standaloneQuery: string,
  betterQuestion?: string,
  recentHistory?: HistorySummary[],      // 新增
  prevSearchedBlockIds?: string[]        // 新增
): string {
  // 构建 history 块
  const historyBlock = recentHistory && recentHistory.length > 0
    ? formatHistoryBlock(recentHistory) + '\n'
    : '';

  // 构建 prev_searched 块
  const prevBlock = prevSearchedBlockIds && prevSearchedBlockIds.length > 0
    ? formatPrevSearchedBlock(prevSearchedBlockIds) + '\n'
    : '';

  // 构建 query 块
  if (betterQuestion && betterQuestion !== standaloneQuery) {
    return `${historyBlock}${prevBlock}<original_query>${standaloneQuery}</original_query>
<refined_query>${betterQuestion}</refined_query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  }

  return `${historyBlock}${prevBlock}<query>
${standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
}
```

- [ ] **Step 2: 在 analytical.ts 中传入新参数**

修改 `AnalyticalState.execute()` 方法中的调用：

```typescript
// 在 runStateLoop 调用中修改 userMessage 构建：
const response = await runStateLoop(
  ctx.llmClientManager,
  ctx.toolRegistry,
  ctx.toolContext,
  {
    stateName: this.name,
    model: this.model,
    systemPrompt: this.buildSystemPrompt(ctx),
    userMessage: buildAnalyticalUserMessage(
      ctx.standaloneQuery || ctx.rawUserQuery,
      ctx.betterQuestion,
      ctx.recentHistorySummaries,  // 新增
      ctx.prevSearchedBlockIds     // 新增
    ),
    availableTools: this.tools,
    toolInterceptor: interceptor,
    maxIterations: 8,
    maxToolCalls: 5,
    abortSignal: ctx.abortSignal,
    traceContext: ctx.traceContext,
    forcedConclusionContext: {
      pdfName: ctx.pdfName,
      scopeNodeIds: ctx.scopeNodeIds,
    },
  }
);
```

- [ ] **Step 3: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/agent/cognitive-engine/prompts/analytical-prompt.ts src/agent/cognitive-engine/states/analytical.ts
git commit -m "feat(cognitive): S2 Analytical 传入历史摘要和已搜索范围"
```

---

### Task 9: 修改 FrontendAgent continueChat

**Files:**
- Modify: `src/agent/index.ts`

- [ ] **Step 1: 在 continueChat 中提取历史摘要**

修改 `continueChat()` 方法：

```typescript
import { summarizeRecentHistory, extractPrevBlockIds } from './cognitive-engine/utils/history-summarizer';

async continueChat(
  history: ChatMessage[],
  userMessage: string,
  context: ToolContext,
  callbacks: AgentLoopOptions
): Promise<ChatMessage[]> {
  await this.initialize();

  const toolRegistry = createToolRegistry(this.skillLoader, context);

  const engineCallbacks: EngineCallbacks = {
    onProgress: callbacks.onProgress || (() => {}),
    onContent: callbacks.onContent || (() => {}),
    onReasoning: callbacks.onReasoning,
    onComplete: callbacks.onComplete || (() => {}),
    onError: callbacks.onError || (() => {}),
  };

  // 提取纯净历史（只有 user 和 assistant 消息）
  const cleanHistory = history.filter(m => m.role === 'user' || m.role === 'assistant');

  // 提取历史摘要（供 S2 使用）
  const recentHistorySummaries = summarizeRecentHistory(cleanHistory, 3);
  
  // 提取上一轮搜索的 block_ids（供 S2 避免重复）
  const prevSearchedBlockIds = extractPrevBlockIds(cleanHistory);

  // 读取长期记忆上下文
  const memoryContext = await this.memoryStore.getMemoryContext();

  // 创建 SharedContext（传入新参数）
  const ctx = createSharedContext({
    indexId: context.indexId || '',
    pdfName: context.pdfName || '',
    rawUserQuery: userMessage,
    chatHistory: cleanHistory,
    markdownFiles: context.markdownFiles,
    abortSignal: callbacks.abortSignal,
    docDescription: context.docDescription,
    memoryContext,
    llmClientManager: this.llmClientManager,
    toolRegistry: toolRegistry,
    toolContext: context,
    recentHistorySummaries,    // 新增
    prevSearchedBlockIds,      // 新增
  });

  await runCognitiveEngine(ctx, engineCallbacks);

  return ctx.chatHistory;
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run build`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/index.ts
git commit -m "feat(agent): continueChat 提取历史摘要传入 S2"
```

---

### Task 10: 验证 Part 2 实现

- [ ] **Step 1: 创建测试文件**

Create: `src/agent/cognitive-engine/utils/__tests__/history-summarizer.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  extractBlockIds,
  summarizeRecentHistory,
  formatHistoryBlock,
  formatPrevSearchedBlock,
} from '../history-summarizer';
import type { ChatMessage } from '../../types';

describe('history-summarizer', () => {
	const mockHistory: ChatMessage[] = [
		{ role: 'user', content: '什么是MECE？' },
		{ role: 'assistant', content: 'MECE是Mutually Exclusive Collectively Exhaustive的缩写，表示互斥完备。参见 [[测试书籍/章节1#^b001|MECE定义]]' },
		{ role: 'user', content: 'MECE有什么应用？' },
		{ role: 'assistant', content: 'MECE常用于商业分析框架，如BCG矩阵。参见 [[测试书籍/章节2#^b002|MECE应用]]' },
		{ role: 'user', content: '再深入讲讲第一个问题' },
		{ role: 'assistant', content: 'MECE的核心是确保分类无遗漏且无重叠...' },
	];

	it('should extract block_ids from content', () => {
		const content = '参见 [[书名/章节#^b001]] 和 [[书名/章节#^b002]]';
		const ids = extractBlockIds(content);
		expect(ids).toEqual(['b001', 'b002']);
	});

	it('should summarize recent history', () => {
		const summaries = summarizeRecentHistory(mockHistory, 2);
		expect(summaries.length).toBe(2);
		expect(summaries[0].topic).toContain('MECE有什么应用');
		expect(summaries[1].topic).toContain('再深入讲讲');
	});

	it('should format history block', () => {
		const summaries = summarizeRecentHistory(mockHistory, 2);
		const block = formatHistoryBlock(summaries);
		expect(block).toContain('<history>');
		expect(block).toContain('[第1轮]');
		expect(block).toContain('[第2轮]');
	});

	it('should format prev_searched block', () => {
		const blockIds = ['b001', 'b002', 'b003'];
		const block = formatPrevSearchedBlock(blockIds, 3);
		expect(block).toContain('<prev_searched>');
		expect(block).toContain('b001, b002, b003');
	});

	it('should handle empty history', () => {
		const summaries = summarizeRecentHistory([], 3);
		expect(summaries.length).toBe(0);
		
		const block = formatHistoryBlock([]);
		expect(block).toBe('');
	});
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:run src/agent/cognitive-engine/utils/__tests__/history-summarizer.test.ts`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/agent/cognitive-engine/utils/__tests__/history-summarizer.test.ts
git commit -m "test(cognitive): 添加 history-summarizer 单元测试"
```

---

## Final: 集成验证

- [ ] **Step 1: 运行完整构建**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 2: 运行所有测试**

Run: `npm run test:run`
Expected: 所有测试通过

- [ ] **Step 3: 手动验证（在 Obsidian 中）**

1. 打开 Obsidian，加载插件
2. 选择一本书籍，开始对话
3. 第一轮：问"什么是 XX？"
4. 第二轮：问"再深入讲讲" → 检查是否不重复搜索
5. 触发整合（多轮对话超过阈值）→ 检查 HISTORY.md 是否有 💬 条目
6. 新会话：选择同一本书 → 检查是否加载了之前的对话摘要

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: 实现对话历史导入与三层记忆架构

- Part 1: 跨会话记忆
  - 扩展 SAVE_MEMORY_TOOL，增加 references 参数
  - 对话摘要写入 HISTORY.md
  - ContextBuilder 加载相关书籍的对话摘要

- Part 2: 当前会话内历史
  - S2 Analytical 传入最近 3 轮摘要化历史
  - 记录已搜索范围避免重复
  - 新增 history-summarizer.ts"
```

---

## References

- Spec: `docs/superpowers/specs/2026-04-13-dialogue-history-import-design.md`
- Related files:
  - `src/agent/memory/consolidator.ts` - MemoryConsolidator 整合逻辑
  - `src/agent/memory/store.ts` - MemoryStore 存储
  - `src/agent/cognitive-engine/states/analytical.ts` - S2 Analytical State