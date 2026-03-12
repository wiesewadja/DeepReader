# Phase 2: 双层记忆系统 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**: 实现双层记忆系统，支持智能整合和用户可见的记忆文件

**架构**: Session (短期) + MEMORY.md (长期事实) + HISTORY.md (时间线日志)

**技术栈**: TypeScript, Obsidian Plugin API, Markdown

---

## 设计概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    双层记忆系统架构                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Obsidian Vault                                                 │
│  └── DeepReader/                                                │
│      ├── DeepReader.md      ← 用户配置（已有）                  │
│      ├── MEMORY.md           ← 长期记忆（用户画像/偏好）         │
│      └── HISTORY.md          ← 时间线日志（对话历史）            │
│                                                                 │
│  data.json                                                      │
│  └── chatCache.{sessionId}                                      │
│      ├── messages[]          ← 短期会话消息                      │
│      └── lastConsolidated    ← 已整合消息索引                    │
│                                                                 │
│  ┌─────────────────────┐                                        │
│  │   AgentLoop          │                                       │
│  │   • Token 阈值检测    │                                       │
│  │   • 自动触发整合      │                                       │
│  │   • LLM 生成摘要      │                                       │
│  └─────────────────────┘                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 与现有实现对比

| 特性 | 现有实现 | 新方案 |
|------|---------|--------|
| **存储位置** | `.obsidian/plugins/deepreader/data/memory/` (隐藏) | `DeepReader/` (用户可见) |
| **记忆文件** | `entries/*.md` + `summary.md` | `MEMORY.md` + `HISTORY.md` |
| **用户可编辑** | ❌ 不方便 | ✅ 直接在 Obsidian 中编辑 |
| **跨设备同步** | ❌ 需要手动 | ✅ 通过 Obsidian Sync 同步 |
| **整合触发** | 手动 `summarize_memory` | Token 阈值自动触发 |
| **整合方式** | 简单合并 | LLM 智能整合 |

---

## Task 1: 定义记忆类型

**文件:**
- 修改: `frontend/src/agent/context/loader.ts`

**Step 1: 扩展类型定义**

```typescript
/**
 * 记忆系统类型定义
 */

/**
 * 记忆类别
 */
export type MemoryCategory = 'preference' | 'correction' | 'info' | 'insight';

/**
 * 会话元数据（扩展）
 */
export interface SessionMetadata {
  sessionId: string;
  indexId: string;
  lastUpdated: number;
  /** 已整合到长期记忆的消息索引 */
  lastConsolidated: number;
}

/**
 * 记忆整合结果（LLM save_memory 工具返回）
 */
export interface ConsolidationResult {
  /** HISTORY.md 条目 */
  historyEntry: string;
  /** MEMORY.md 更新内容 */
  memoryUpdate: string;
}

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
}

export const DEFAULT_CONSOLIDATOR_CONFIG: ConsolidatorConfig = {
  tokenThreshold: 40000,
  targetRatio: 0.5,
  maxRounds: 5,
};
```

**Step 2: Commit**

```bash
git add frontend/src/agent/context/loader.ts
git commit -m "feat(agent): add memory consolidation types"
```

---

## Task 2: 创建 MemoryStore 类

**文件:**
- 创建: `frontend/src/agent/memory/store.ts`

**Step 1: 实现 MemoryStore**

```typescript
/**
 * MemoryStore - 用户可见的记忆存储
 *
 * 文件位置: Obsidian Vault/DeepReader/
 * - MEMORY.md: 长期记忆（用户画像、偏好）
 * - HISTORY.md: 时间线日志（对话历史）
 *
 * 参考: nanobot 的 memory.py 设计
 */

import { App, normalizePath } from 'obsidian';
import { agentLog } from '../../utils/logger';

/** DeepReader 目录名 */
const DEEPREADER_DIR = 'DeepReader';

export class MemoryStore {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 获取 DeepReader 目录路径
   */
  private get deepReaderPath(): string {
    return normalizePath(DEEPREADER_DIR);
  }

  /**
   * 获取 MEMORY.md 路径
   */
  private get memoryPath(): string {
    return normalizePath(`${DEEPREADER_DIR}/MEMORY.md`);
  }

  /**
   * 获取 HISTORY.md 路径
   */
  private get historyPath(): string {
    return normalizePath(`${DEEPREADER_DIR}/HISTORY.md`);
  }

  /**
   * 读取长期记忆
   */
  async readLongTermMemory(): Promise<string | null> {
    try {
      const exists = await this.app.vault.adapter.exists(this.memoryPath);
      if (!exists) return null;
      const content = await this.app.vault.adapter.read(this.memoryPath);
      return content.trim() || null;
    } catch (err) {
      agentLog('[MemoryStore] 读取 MEMORY.md 失败:', err);
      return null;
    }
  }

  /**
   * 写入长期记忆
   */
  async writeLongTermMemory(content: string): Promise<void> {
    await this.ensureDirectory();
    await this.app.vault.adapter.write(this.memoryPath, content);
    agentLog('[MemoryStore] MEMORY.md 已更新');
  }

  /**
   * 追加历史条目
   */
  async appendHistory(entry: string): Promise<void> {
    await this.ensureDirectory();

    const exists = await this.app.vault.adapter.exists(this.historyPath);
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const formattedEntry = `[${timestamp}] ${entry}\n\n`;

    if (exists) {
      const existing = await this.app.vault.adapter.read(this.historyPath);
      await this.app.vault.adapter.write(this.historyPath, existing + formattedEntry);
    } else {
      const header = `# 对话历史\n\n> 此文件记录与 DeepReader Agent 的对话摘要\n\n---\n\n`;
      await this.app.vault.adapter.write(this.historyPath, header + formattedEntry);
    }

    agentLog('[MemoryStore] HISTORY.md 已追加条目');
  }

  /**
   * 读取历史（最近 N 条）
   */
  async readHistory(limit: number = 50): Promise<string> {
    try {
      const exists = await this.app.vault.adapter.exists(this.historyPath);
      if (!exists) return '';
      const content = await this.app.vault.adapter.read(this.historyPath);
      const entries = content.split(/\n\n---\n\n/);
      return entries.slice(-limit).join('\n\n---\n\n');
    } catch {
      return '';
    }
  }

  /**
   * 获取记忆上下文（用于 System Prompt）
   */
  async getMemoryContext(): Promise<string> {
    const longTerm = await this.readLongTermMemory();
    if (longTerm) {
      // 移除 frontmatter 和标题，只保留内容
      const content = longTerm
        .replace(/^---[\s\S]*?---\n/, '')
        .replace(/^# Long-term Memory\n/, '');
      return `## 长期记忆\n${content.trim()}`;
    }
    return '';
  }

  /**
   * 初始化默认 MEMORY.md
   */
  async initializeMemory(): Promise<void> {
    await this.ensureDirectory();

    const exists = await this.app.vault.adapter.exists(this.memoryPath);
    if (exists) return;

    const defaultContent = `# 长期记忆

此文件存储关于用户的重要信息，会在对话中自动更新。

## 用户画像

（Agent 会在这里记录了解到的用户信息）

## 阅读偏好

（Agent 会在这里记录用户的阅读偏好）

## 兴趣主题

（Agent 会在这里记录用户感兴趣的主题）

---

*此文件由 DeepReader Agent 自动维护，你也可以直接编辑*
`;

    await this.app.vault.adapter.write(this.memoryPath, defaultContent);
    agentLog('[MemoryStore] 初始化 MEMORY.md');
  }

  /**
   * 确保 DeepReader 目录存在
   */
  private async ensureDirectory(): Promise<void> {
    const exists = await this.app.vault.adapter.exists(this.deepReaderPath);
    if (!exists) {
      await this.app.vault.adapter.mkdir(this.deepReaderPath);
      agentLog('[MemoryStore] 创建 DeepReader 目录');
    }
  }
}
```

**Step 2: 创建 index.ts**

```typescript
// frontend/src/agent/memory/index.ts
export * from './store';
export * from './consolidator';
export * from './types';
```

**Step 3: Commit**

```bash
git add frontend/src/agent/memory/
git commit -m "feat(agent): add MemoryStore with user-visible files in DeepReader/"
```

---

## Task 3: 创建 MemoryConsolidator 类

**文件:**
- 创建: `frontend/src/agent/memory/consolidator.ts`

**Step 1: 实现 Consolidator**

```typescript
/**
 * MemoryConsolidator - 记忆整合器
 *
 * 参考 nanobot 的 MemoryConsolidator 设计：
 * 1. Token 阈值检测
 * 2. 在用户消息边界切割
 * 3. 调用 LLM 生成整合结果
 * 4. 更新 MEMORY.md 和 HISTORY.md
 */

import type { ChatMessage } from '../types';
import type { LLMClient } from '../llm-client';
import { MemoryStore } from './store';
import type { ConsolidationResult, ConsolidatorConfig } from './types';
import { estimateTokens } from '../agent-loop';
import { agentLog } from '../../utils/logger';

/**
 * save_memory 工具定义（参考 nanobot）
 */
const SAVE_MEMORY_TOOL = [{
  type: 'function',
  function: {
    name: 'save_memory',
    description: '保存记忆整合结果到持久化存储。',
    parameters: {
      type: 'object',
      properties: {
        history_entry: {
          type: 'string',
          description: '一段总结关键事件/决策/主题的文字。以 [YYYY-MM-DD HH:MM] 开头。包含对 grep 搜索有用的细节。',
        },
        memory_update: {
          type: 'string',
          description: '完整的更新后长期记忆（markdown 格式）。包含所有现有事实和新事实。如果没有新信息则返回不变。',
        },
      },
      required: ['history_entry', 'memory_update'],
    },
  },
}];

export class MemoryConsolidator {
  private store: MemoryStore;
  private client: LLMClient;
  private config: ConsolidatorConfig;

  constructor(
    store: MemoryStore,
    client: LLMClient,
    config: Partial<ConsolidatorConfig> = {}
  ) {
    this.store = store;
    this.client = client;
    this.config = { ...DEFAULT_CONSOLIDATOR_CONFIG, ...config };
  }

  /**
   * 检查是否需要整合
   */
  needsConsolidation(messages: ChatMessage[]): boolean {
    const tokens = estimateTokens(messages);
    return tokens >= this.config.tokenThreshold;
  }

  /**
   * 选择整合边界（在用户消息处切割）
   *
   * 参考 nanobot: pick_consolidation_boundary
   */
  pickConsolidationBoundary(
    messages: ChatMessage[],
    lastConsolidated: number,
    tokensToRemove: number
  ): number | null {
    const start = lastConsolidated;
    if (start >= messages.length || tokensToRemove <= 0) {
      return null;
    }

    let removedTokens = 0;
    let lastBoundary: number | null = null;

    for (let idx = start; idx < messages.length; idx++) {
      const message = messages[idx];

      // 在用户消息边界记录
      if (idx > start && message.role === 'user') {
        lastBoundary = idx;
        if (removedTokens >= tokensToRemove) {
          return lastBoundary;
        }
      }

      removedTokens += estimateTokens([message]);
    }

    return lastBoundary;
  }

  /**
   * 执行整合（调用 LLM）
   */
  async consolidate(
    messages: ChatMessage[],
    lastConsolidated: number,
    boundary: number
  ): Promise<ConsolidationResult | null> {
    const toConsolidate = messages.slice(lastConsolidated, boundary);
    if (toConsolidate.length === 0) {
      return null;
    }

    const currentMemory = await this.store.readLongTermMemory() || '(空)';
    const formattedMessages = this.formatMessages(toConsolidate);

    const prompt = `处理这段对话并调用 save_memory 工具保存整合结果。

## 当前长期记忆
${currentMemory}

## 待处理对话
${formattedMessages}`;

    try {
      // 调用 LLM
      const response = await this.callLLM(prompt);

      if (response) {
        // 写入文件
        if (response.historyEntry) {
          await this.store.appendHistory(response.historyEntry);
        }
        if (response.memoryUpdate) {
          await this.store.writeLongTermMemory(response.memoryUpdate);
        }
        return response;
      }
    } catch (err) {
      agentLog('[Consolidator] 整合失败:', err);
    }

    return null;
  }

  /**
   * 调用 LLM 获取整合结果
   */
  private async callLLM(prompt: string): Promise<ConsolidationResult | null> {
    // 使用 LLMClient 的流式 API，但我们需要完整的工具调用结果
    // 这里需要一个同步获取工具调用的方法

    let result: ConsolidationResult | null = null;

    await new Promise<void>((resolve) => {
      this.client.streamChat(
        [
          { role: 'system', content: '你是一个记忆整合助手。分析对话并提取重要信息。必须调用 save_memory 工具。' },
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

  /**
   * 格式化消息（用于 LLM 输入）
   */
  private formatMessages(messages: ChatMessage[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      if (!msg.content) continue;

      const role = msg.role.toUpperCase();
      const content = typeof msg.content === 'string'
        ? msg.content.slice(0, 500) + (msg.content.length > 500 ? '...' : '')
        : '(复杂内容)';

      lines.push(`[${role}] ${content}`);
    }

    return lines.join('\n');
  }

  /**
   * 执行多轮整合（如果需要）
   */
  async maybeConsolidate(
    messages: ChatMessage[],
    lastConsolidated: number,
    onConsolidated: (newIndex: number) => void
  ): Promise<number> {
    let currentTokens = estimateTokens(messages);
    const targetTokens = this.config.tokenThreshold * this.config.targetRatio;
    let newLastConsolidated = lastConsolidated;

    for (let round = 0; round < this.config.maxRounds; round++) {
      if (currentTokens < this.config.tokenThreshold) {
        break;
      }

      const tokensToRemove = currentTokens - targetTokens;
      const boundary = this.pickConsolidationBoundary(
        messages,
        newLastConsolidated,
        tokensToRemove
      );

      if (boundary === null) {
        agentLog(`[Consolidator] 第 ${round + 1} 轮: 无法找到安全边界`);
        break;
      }

      const result = await this.consolidate(messages, newLastConsolidated, boundary);

      if (result) {
        newLastConsolidated = boundary;
        onConsolidated(newLastConsolidated);

        // 重新计算 tokens
        currentTokens = estimateTokens(messages.slice(newLastConsolidated));

        agentLog(`[Consolidator] 第 ${round + 1} 轮整合完成，整合了 ${boundary - newLastConsolidated} 条消息`);
      } else {
        break;
      }
    }

    return newLastConsolidated;
  }
}

// 导入默认配置
import { DEFAULT_CONSOLIDATOR_CONFIG } from './types';
```

**Step 2: Commit**

```bash
git add frontend/src/agent/memory/consolidator.ts
git commit -m "feat(agent): add MemoryConsolidator with LLM-based consolidation"
```

---

## Task 4: 扩展会话元数据

**文件:**
- 修改: `frontend/src/types.ts` 或 `frontend/src/chat/chat-cache.ts`

**Step 1: 添加 lastConsolidated 字段**

找到 `CachedSession` 类型定义，添加字段：

```typescript
interface CachedSession {
  sessionId: string;
  indexId: string;
  lastUpdated: number;
  messages: ChatMessage[];
  isCrossBook?: boolean;
  /** 已整合到长期记忆的消息索引 - 新增 */
  lastConsolidated?: number;  // 默认 0
}
```

**Step 2: 更新默认值**

在创建新会话时设置 `lastConsolidated: 0`

**Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/chat/chat-cache.ts
git commit -m "feat(agent): add lastConsolidated field to session metadata"
```

---

## Task 5: 更新 ContextLoader

**文件:**
- 修改: `frontend/src/agent/context/loader.ts`

**Step 1: 使用新的 MemoryStore**

```typescript
import { MemoryStore } from '../memory/store';

export class ContextLoader {
  private app: App;
  private memoryStore: MemoryStore;
  // ...

  constructor(app: App) {
    this.app = app;
    this.memoryStore = new MemoryStore(app);
    // ...
  }

  /**
   * 加载用户上下文（使用新的 MEMORY.md）
   */
  async loadContext(): Promise<UserContext> {
    const profile = await this.loadProfile();

    // 使用 MemoryStore 读取长期记忆
    const memoryContent = await this.memoryStore.getMemoryContext();
    const memorySummary = memoryContent || '（暂无长期记忆）';

    return {
      profile: profile.content,
      hasProfile: profile.exists,
      memorySummary,
    };
  }

  // 移除旧的 loadMemorySummary, searchMemory, addMemoryEntry 方法
  // 这些功能现在由 MemoryStore 和记忆工具提供
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/context/loader.ts
git commit -m "refactor(agent): update ContextLoader to use MemoryStore"
```

---

## Task 6: 更新记忆工具

**文件:**
- 修改: `frontend/src/agent/tools/memory.ts`

**Step 1: 使用 MemoryStore**

```typescript
import { MemoryStore } from '../memory/store';

// 更新 add_memory 工具
export function createAddMemoryTool(app: any): ToolExecutor {
  const store = new MemoryStore(app);

  return {
    definition: addMemoryDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const content = args.content as string;
      const category = args.category as string | undefined;

      if (!content) {
        return 'Error: content 参数是必需的';
      }

      try {
        // 直接追加到 HISTORY.md 作为简单记录
        const entry = category ? `[${category}] ${content}` : content;
        await store.appendHistory(entry);

        return '记忆已保存到 HISTORY.md。';
      } catch (err) {
        return `保存记忆失败: ${err}`;
      }
    },
  };
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/tools/memory.ts
git commit -m "refactor(agent): update memory tools to use MemoryStore"
```

---

## Task 7: 集成到 AgentLoop

**文件:**
- 修改: `frontend/src/agent/agent-loop.ts`

**Step 1: 添加整合检查**

```typescript
import { MemoryConsolidator } from './memory/consolidator';
import { MemoryStore } from './memory/store';

export interface AgentLoopOptions {
  // ... 现有选项 ...

  /** 记忆整合器（可选） */
  consolidator?: MemoryConsolidator;
  /** 上次整合位置 */
  lastConsolidated?: number;
  /** 整合完成回调 */
  onConsolidated?: (newIndex: number) => void;
}

export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  // ... 现有代码 ...

  // 在循环开始前检查是否需要整合
  if (options.consolidator && options.lastConsolidated !== undefined) {
    if (options.consolidator.needsConsolidation(workingMessages)) {
      agentLog('[AgentLoop] Token 超过阈值，开始记忆整合...');

      const newIndex = await options.consolidator.maybeConsolidate(
        workingMessages,
        options.lastConsolidated,
        (idx) => {
          if (options.onConsolidated) {
            options.onConsolidated(idx);
          }
        }
      );

      // 整合后，只保留未整合的消息
      workingMessages = workingMessages.slice(newIndex);
    }
  }

  // ... 现有循环代码 ...
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat(agent): integrate memory consolidation into agent loop"
```

---

## Task 8: 初始化 MEMORY.md

**文件:**
- 修改: `frontend/src/main.ts` 或插件初始化位置

**Step 1: 在插件加载时初始化**

```typescript
import { MemoryStore } from './agent/memory/store';

// 在 plugin onload 中
async onload() {
  // ... 现有初始化 ...

  // 初始化记忆文件
  const memoryStore = new MemoryStore(this.app);
  await memoryStore.initializeMemory();
}
```

**Step 2: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat(agent): initialize MEMORY.md on plugin load"
```

---

## 验收清单

- [ ] MemoryStore 正确读写 `DeepReader/MEMORY.md` 和 `DeepReader/HISTORY.md`
- [ ] 文件在 Obsidian 中可见且可编辑
- [ ] MemoryConsolidator 正确检测 Token 阈值
- [ ] 边界选择算法正确（只在用户消息边界切割）
- [ ] LLM 整合成功生成 history_entry 和 memory_update
- [ ] 会话元数据包含 lastConsolidated 字段
- [ ] AgentLoop 成功集成整合检查
- [ ] 长对话自动触发整合

---

## 文件结构

```
Obsidian Vault/
└── DeepReader/
    ├── DeepReader.md      # 用户配置（已有）
    ├── MEMORY.md          # 长期记忆（新增）
    └── HISTORY.md         # 时间线日志（新增）
```

### MEMORY.md 示例

```markdown
# 长期记忆

此文件存储关于用户的重要信息，会在对话中自动更新。

## 用户画像

- 软件工程师，关注 AI 和认知科学
- 喜欢深入理解概念，而非浅尝辄止

## 阅读偏好

- 偏好段落式叙述，避免列表堆砌
- 喜欢引用格式: Obsidian wikilinks
- 希望回答有深度，包含跨章节关联

## 兴趣主题

- 学习方法论（检视阅读、主题阅读）
- 知识管理（卡片笔记法、双向链接）
- 认知科学（记忆、理解）

---

*此文件由 DeepReader Agent 自动维护*
```

### HISTORY.md 示例

```markdown
# 对话历史

> 此文件记录与 DeepReader Agent 的对话摘要

---

[2026-03-12 10:00] 讨论了《如何阅读一本书》中检视阅读的概念。用户对"系统性略读"的方法表示感兴趣，询问了具体步骤。

[2026-03-12 10:15] 探讨主动阅读的核心原则。用户对"提出问题"这一技巧表示困惑，提供了类比和具体例子帮助理解。

[2026-03-12 10:30] 用户摘录了关于"分析阅读"的关键段落。识别到用户对方法论的系统化有强烈需求。
```

---

## 后续工作

Phase 2 完成后，进入 Phase 3: 子 Agent 系统

- [Phase 3 计划](./2026-03-12-phase3-subagent-system.md)
