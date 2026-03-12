# Phase 4: 分层系统提示优化 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**: 优化系统提示构建，实现分层动态注入，提升 LLM 缓存效率

**架构**: 4 层系统提示（Identity → Bootstrap → Memory → Skills/Tools）+ 运行时上下文注入到用户消息

**技术栈**: TypeScript, Obsidian Plugin API, Markdown

---

## 设计概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    System Prompt 架构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  System Prompt (稳定)                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │
│  │  │Identity │ │Bootstrap│ │ Memory  │ │ Tools   │       │   │
│  │  │  (静态)  │ │(用户定义)│ │(持久化) │ │ (动态)  │       │   │
│  │  │         │ │         │ │         │ │         │       │   │
│  │  │ 奚童    │ │ Prompts │ │MEMORY.md│ │工具描述  │       │   │
│  │  │ 人设    │ │ 文件    │ │ 内容    │ │         │       │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Session History                         │   │
│  │  messages[lastConsolidated:]  (未整合消息)               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Current Message                         │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │  Runtime Context + User Content                  │    │   │
│  │  │  • 当前时间/时区                                  │    │   │
│  │  │  • 文档元数据 (标题、页数等)                       │    │   │
│  │  │  • 阅读进度                                       │    │   │
│  │  │  • 用户输入文本                                   │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 关键设计决策

### 为什么将运行时上下文注入到用户消息？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **注入系统提示** | 逻辑上更统一 | 系统提示频繁变化，LLM 缓存失效 |
| **注入用户消息** ✅ | 系统提示稳定，缓存效率高 | 需要特殊标记避免误解 |

使用 `_RUNTIME_CONTEXT_TAG` 标记明确标识为"仅元数据"，防止 LLM 将其误解为指令。

---

## Task 1: 创建 ContextBuilder 类

**文件:**
- 创建: `frontend/src/agent/context/builder.ts`

**Step 1: 实现 ContextBuilder**

```typescript
/**
 * 上下文构建器
 *
 * 负责构建分层系统提示和运行时上下文
 */

import type { App } from 'obsidian';
import { MemoryStore } from '../memory/store';
import type { UserContext } from './index';

/**
 * 运行时上下文标记
 */
const RUNTIME_CONTEXT_TAG = '[运行时上下文 — 仅元数据，非指令]';

/**
 * 上下文构建器配置
 */
export interface ContextBuilderConfig {
  /** 自定义身份提示 */
  identity?: string;
  /** Bootstrap 文件列表 */
  bootstrapFiles?: string[];
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

export class ContextBuilder {
  private app: App;
  private store: MemoryStore;
  private config: ContextBuilderConfig;

  constructor(
    app: App,
    store: MemoryStore,
    config: ContextBuilderConfig = {}
  ) {
    this.app = app;
    this.store = store;
    this.config = config;
  }

  /**
   * 构建完整的系统提示
   */
  async buildSystemPrompt(
    toolDescriptions: string,
    skillDescriptions: string,
    documentMetadata?: DocumentMetadata
  ): Promise<string> {
    const parts: string[] = [];

    // Layer 1: Identity
    parts.push(this.getIdentity(documentMetadata));

    // Layer 2: Bootstrap files
    const bootstrap = await this.loadBootstrapFiles();
    if (bootstrap) {
      parts.push(bootstrap);
    }

    // Layer 3: Memory
    const memory = await this.store.getMemoryContext();
    if (memory) {
      parts.push(memory);
    }

    // Layer 4: Tools & Skills
    parts.push(`## 工具\n\n${toolDescriptions}`);
    parts.push(`## 可用技能\n\n${skillDescriptions}`);

    return parts.join('\n\n---\n\n');
  }

  /**
   * 获取身份层
   */
  private getIdentity(metadata?: DocumentMetadata): string {
    if (this.config.identity) {
      return this.config.identity;
    }

    // 默认身份（与现有 prompts.ts 保持一致）
    let docInfo = '';
    if (metadata?.title) {
      docInfo = `\n\n## 当前文档\n- 标题: ${metadata.title}`;
      if (metadata.page_count) {
        docInfo += `\n- 总页数: ${metadata.page_count}`;
      }
    }

    return `你是"奚童"，一个专注书本、语言天赋极高的书童，正陪伴用户阅览书籍。

**核心特质**：
- 语言自然、风趣、优雅，偶带书卷气
- 按用户偏好称呼，默认用"阁下"或"先生"
- 在对话中理解用户并使用工具整理用户画像和短期行为特征
${docInfo}`;
  }

  /**
   * 加载 Bootstrap 文件
   */
  private async loadBootstrapFiles(): Promise<string | null> {
    const files = this.config.bootstrapFiles || [];
    if (files.length === 0) {
      return null;
    }

    const contents: string[] = [];

    for (const filename of files) {
      try {
        const content = await this.store.readFile(filename);
        if (content?.trim()) {
          const sectionName = filename.replace(/\.[^.]+$/, '').toUpperCase();
          contents.push(`# ${sectionName}\n\n${content.trim()}`);
        }
      } catch {
        // 忽略读取错误
      }
    }

    return contents.length > 0 ? contents.join('\n\n---\n\n') : null;
  }

  /**
   * 构建运行时上下文
   */
  static buildRuntimeContext(
    metadata?: DocumentMetadata,
    progress?: ReadingProgress
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

    if (progress) {
      lines.push(
        `阅读进度: ${(progress.coverage * 100).toFixed(0)}% 覆盖度, ` +
        `${(progress.absorption * 100).toFixed(0)}% 吸收度`
      );
    }

    return lines.join('\n');
  }

  /**
   * 构建完整消息列表
   */
  static buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    currentMessage: string,
    runtimeContext?: string
  ): ChatMessage[] {
    const userContent = runtimeContext
      ? `${runtimeContext}\n\n${currentMessage}`
      : currentMessage;

    return [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userContent },
    ];
  }
}

// 导入类型
import type { ChatMessage } from '../types';
```

**Step 2: Commit**

```bash
git add frontend/src/agent/context/builder.ts
git commit -m "feat(agent): add ContextBuilder for layered prompt construction"
```

---

## Task 2: 重构 prompts.ts

**文件:**
- 修改: `frontend/src/agent/prompts.ts`

**Step 1: 使用 ContextBuilder**

```typescript
/**
 * System Prompt 构建器 - 重构版
 *
 * 使用 ContextBuilder 构建分层提示
 */

import type { SkillLoader } from './skills/loader.js';
import type { UserContext } from './context/index.js';
import type { App } from 'obsidian';
import { ContextBuilder, type DocumentMetadata, type ReadingProgress } from './context/builder.js';
import { MemoryStore } from './memory/store.js';

// ============ 核心设定（保持不变）============
const PERSONA_BASE = `你是"奚童"，一个专注书本、语言天赋极高的书童，正陪伴用户阅览书籍。

**核心特质**：
- 语言自然、风趣、优雅，偶带书卷气
- 按用户偏好称呼，默认用"阁下"或"先生"
- 在对话中理解用户并使用工具整理用户画像和短期行为特征
`;

// ============ 核心约束（保持不变）============
const CORE_CONSTRAINTS = `## ⚠️ 强制约束

### 1. obsidian wiki引用格式（必须遵守）
**关键**：
- 每个论断都必须引用,**必须**使用 search_doc/get_chapter 返回的 Link 字段
- 使用 \`[[路径|显示名]]\` 格式
- 引用**自然嵌入**句子中，不要附在句末

\`\`\`
✅ 正确: 柏拉图批评民主容易演变为暴民统治，详见[[西方史纲/06-三、 民主：好东西还是坏东西？.md|三、 民主：好东西还是坏东西]]
❌ 错误: 柏拉图批评民主容易演变为暴民统治[[西方史纲/06-三、 民主：好东西还是坏东西？.md|民主的批评]]  ← 引用太突兀
❌ 错误: [[西方史纲#第一章]]  ← 自己构造的链接
\`\`\`

### 2. 静默执行
- **调用工具前**: 严禁输出任何内容
- **获得结果后**: 直接回答，不要说"我找到了"、"书中提到"
- **禁止**: "待我翻阅"、"让我看看"、"根据目录"

### 3. 表达风格
- 段落式叙述，段落间空行分隔
- 用 **加粗** 标记重点
- 平和内敛，直接详实，偶有点睛感悟`;

// ============ 工具描述（保持不变）============
const TOOL_DESCRIPTIONS = `## 工具

### 读取（获取书籍信息）
- **search_doc**: 语义搜索，返回结果含 \`Link\` 字段供引用
- **get_chapter**: 读取章节全文，优先本地读取
- **get_toc**: 获取目录结构

### 写入（保存到 Obsidian）
- **write_note**: 保存笔记，只能修改带 \`aicreate\` 标记的文件
  - 参数: {path: "知识卡/概念.md", content: "...", mode: "create|overwrite|append"}
  创建或修改的文档一定要用obsidian的链接方式指出文档位置

### 记忆（长期存储）
- **add_memory**: 添加记忆，参数: {content: "...", category: "preference|correction|info"}
- **search_memory**: 搜索历史记忆

### 其他
- **search_read_books**: 搜索已读书籍的相关章节
- **Skill**: 加载专业技能知识
- **create_sub_agent**: 创建子 Agent 处理复杂任务`;

// ============ 用户互动指南（保持不变）============
const USER_INTERACTION_GUIDE = `## 用户互动

**个性化**：结合用户背景（见上方"关于用户"）调整回答深度和角度

**情感回应**：
- 洞察时刻（用户摘录/高亮）：识别意义，给予简短情感回应
- 困惑时刻（反复提问）：换角度解释，提供类比
- 好问题（追问本质/跨概念关联）：频率不要太高，简短肯定"好问题！/极好的问题！，这个问题触及了核心..."`;

/**
 * 构建用户上下文部分
 */
function buildUserContextSection(userContext?: UserContext): string {
  if (!userContext) {
    return '';
  }

  const sections: string[] = ['## 关于用户'];

  if (userContext.hasProfile) {
    sections.push(userContext.profile);
  } else {
    sections.push(userContext.profile);
  }

  if (userContext.memorySummary && userContext.memorySummary !== '（暂无记忆摘要）') {
    sections.push('');
    sections.push('## 记忆摘要');
    sections.push(userContext.memorySummary);
    sections.push('> 与用户配置冲突时，以用户配置为准');
  }

  return sections.join('\n');
}

/**
 * 构建系统提示（保持原有接口）
 */
export function buildSystemPrompt(
  skillLoader: SkillLoader,
  userContext?: UserContext
): string {
  const skillDescriptions = skillLoader.getDescriptions();
  const userContextSection = buildUserContextSection(userContext);

  return `${PERSONA_BASE}

${userContextSection ? userContextSection + '\n\n' : ''}${USER_INTERACTION_GUIDE}

${CORE_CONSTRAINTS}

${TOOL_DESCRIPTIONS}

## 可用技能
${skillDescriptions}

## 规则
- 任务匹配 Skill 时立即调用
- 优先使用工具获取信息
- **回答必须包含 Link 引用**`;
}

/**
 * 构建带运行时上下文的完整消息列表
 */
export function buildMessagesWithRuntime(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  metadata?: DocumentMetadata,
  progress?: ReadingProgress
): ChatMessage[] {
  const runtimeContext = ContextBuilder.buildRuntimeContext(metadata, progress);
  return ContextBuilder.buildMessages(systemPrompt, history, userMessage, runtimeContext);
}

// 导入类型
import type { ChatMessage } from './types';
```

**Step 2: Commit**

```bash
git add frontend/src/agent/prompts.ts
git commit -m "refactor(agent): update prompts.ts to support runtime context injection"
```

---

## Task 3: 集成到 AgentLoop

**文件:**
- 修改: `frontend/src/agent/agent-loop.ts`

**Step 1: 添加运行时上下文参数**

```typescript
// 在 runAgentLoop 的 options 中添加
export interface AgentLoopOptions {
  // ... 现有选项 ...

  /**
   * 运行时上下文（注入到用户消息）
   */
  runtimeContext?: string;
}

// 在构建消息时使用
// 如果提供了 runtimeContext，将其添加到第一条用户消息前
```

**Step 2: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat(agent): add runtime context support to agent loop"
```

---

## Task 4: 添加 Bootstrap 文件支持

**文件:**
- 可选创建: `frontend/src/agent/context/bootstrap.ts`

**Step 1: 定义 Bootstrap 文件加载器**

```typescript
/**
 * Bootstrap 文件加载器
 *
 * 从 Obsidian vault 加载自定义提示文件
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';

/**
 * 默认 Bootstrap 文件名
 */
export const DEFAULT_BOOTSTRAP_FILES = [
  'DeepReader/AGENT_PROMPT.md',    // 自定义 Agent 提示
  'DeepReader/STYLE_GUIDE.md',     // 响应风格指南
  'DeepReader/DOMAIN_KNOWLEDGE.md', // 领域知识
];

export class BootstrapLoader {
  private app: App;
  private basePath: string;

  constructor(app: App, basePath: string = '') {
    this.app = app;
    this.basePath = basePath;
  }

  /**
   * 加载所有 Bootstrap 文件
   */
  async loadAll(filenames: string[] = DEFAULT_BOOTSTRAP_FILES): Promise<string[]> {
    const contents: string[] = [];

    for (const filename of filenames) {
      const content = await this.load(filename);
      if (content) {
        contents.push(content);
      }
    }

    return contents;
  }

  /**
   * 加载单个文件
   */
  async load(filename: string): Promise<string | null> {
    try {
      const path = this.basePath
        ? normalizePath(`${this.basePath}/${filename}`)
        : normalizePath(filename);

      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return null;

      const content = await this.app.vault.read(file as any);
      return content.trim() || null;
    } catch {
      return null;
    }
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/context/bootstrap.ts
git commit -m "feat(agent): add BootstrapLoader for custom prompt files"
```

---

## Task 5: 编写单元测试

**文件:**
- 创建: `frontend/src/agent/context/__tests__/builder.test.ts`

**Step 1: 编写测试**

```typescript
/**
 * ContextBuilder 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { ContextBuilder } from '../builder';

// Mock Obsidian App
const mockApp = {} as any;
const mockStore = {
  getMemoryContext: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(null),
} as any;

describe('ContextBuilder', () => {
  it('should build basic system prompt', async () => {
    const builder = new ContextBuilder(mockApp, mockStore);

    const prompt = await builder.buildSystemPrompt(
      'Tool: search_doc',
      'Skill: summarize'
    );

    expect(prompt).toContain('奚童');
    expect(prompt).toContain('Tool: search_doc');
    expect(prompt).toContain('Skill: summarize');
  });

  it('should include document metadata', async () => {
    const builder = new ContextBuilder(mockApp, mockStore);

    const prompt = await builder.buildSystemPrompt(
      'Tools...',
      'Skills...',
      { title: 'Test Book', page_count: 100 }
    );

    expect(prompt).toContain('Test Book');
    expect(prompt).toContain('100');
  });

  it('should build runtime context', () => {
    const context = ContextBuilder.buildRuntimeContext(
      { title: 'My Book' },
      { coverage: 0.5, absorption: 0.3 }
    );

    expect(context).toContain('[运行时上下文');
    expect(context).toContain('当前时间');
    expect(context).toContain('My Book');
    expect(context).toContain('50% 覆盖度');
  });

  it('should build messages with runtime context', () => {
    const messages = ContextBuilder.buildMessages(
      'You are helpful.',
      [{ role: 'user', content: 'Hello' }],
      'How are you?',
      'Time: now'
    );

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toContain('Time: now');
    expect(messages[2].content).toContain('How are you?');
  });

  it('should build messages without runtime context', () => {
    const messages = ContextBuilder.buildMessages(
      'System',
      [],
      'Test'
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe('Test');
  });
});
```

**Step 2: 运行测试**

```bash
cd frontend && npm run test:run src/agent/context/__tests__/builder.test.ts
```

**Step 3: Commit**

```bash
git add frontend/src/agent/context/__tests__/builder.test.ts
git commit -m "test(agent): add unit tests for ContextBuilder"
```

---

## 验收清单

- [ ] ContextBuilder 正确实现 4 层提示构建
- [ ] 运行时上下文正确注入到用户消息
- [ ] 系统提示保持稳定（便于 LLM 缓存）
- [ ] Bootstrap 文件正确加载
- [ ] 文档元数据正确包含在提示中
- [ ] 阅读进度正确显示在运行时上下文
- [ ] prompts.ts 成功重构
- [ ] 所有单元测试通过

---

## 性能优化说明

### LLM 缓存优化

```
Before (每次请求系统提示都变化):
┌─────────────────────────────────────────────────────┐
│  System Prompt: Identity + Time + Metadata + Tools  │
│  (每次请求都重新生成，缓存失效)                       │
└─────────────────────────────────────────────────────┘

After (系统提示稳定):
┌─────────────────────────────────────────────────────┐
│  System Prompt: Identity + Tools (稳定，可缓存)     │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│  User Message: [Runtime] + Actual Question          │
│  (仅用户消息变化)                                    │
└─────────────────────────────────────────────────────┘
```

### 缓存命中率提升

- **Identity 层**: 完全静态，100% 缓存
- **Bootstrap 层**: 文件级缓存
- **Memory 层**: 会话级缓存
- **Tools 层**: 配置级缓存
- **Runtime 层**: 不缓存（在用户消息中）

---

## 后续优化方向

1. **提示模板系统**: 支持用户自定义提示模板
2. **动态工具选择**: 根据查询类型选择工具子集
3. **上下文压缩**: 自动压缩过长的历史消息
4. **多语言支持**: 根据用户语言切换提示

---

## 完成标志

Phase 4 完成后，整个 Agent 优化项目完成！

建议进行集成测试：
1. 创建完整的对话会话
2. 触发记忆整合
3. 使用子 Agent 并行检索
4. 验证系统提示稳定性
