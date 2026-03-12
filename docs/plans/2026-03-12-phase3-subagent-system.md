# Phase 3: 子 Agent 系统 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**: 实现完整的子 Agent 系统，支持后台并行执行检索任务

**架构**: SubagentManager 管理后台任务，独立工具集，结果回调通知

**技术栈**: TypeScript, Obsidian Plugin API, async/await

---

## 设计概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      子 Agent 系统架构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Main Agent                    Subagent Manager                │
│   ┌──────────┐                  ┌──────────────┐               │
│   │ create   │─────────────────▶│ spawn()      │               │
│   │ _sub_agent│                  │ - 创建任务    │               │
│   │ 工具     │                   │ - 生成 ID    │               │
│   └──────────┘                  │ - 启动异步    │               │
│                                 └──────┬───────┘               │
│                                        │                        │
│                                 ┌──────▼───────┐               │
│                                 │ runSubagent  │               │
│                                 │ - 独立工具集  │               │
│                                 │ - 独立循环    │               │
│                                 │ - 最多 5 轮   │               │
│                                 └──────┬───────┘               │
│                                        │                        │
│                                 ┌──────▼───────┐               │
│                                 │ Callback     │               │
│                                 │ Notification │               │
│                                 │ - 状态更新   │               │
│                                 │ - 结果注入   │               │
│                                 └──────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 使用场景

在 DeepReader 中，子 Agent 主要用于：

1. **并行检索**: 同时搜索多个章节或文档
2. **深度分析**: 对特定章节进行详细分析
3. **后台任务**: 执行不需要立即响应的任务

---

## Task 1: 定义子 Agent 类型

**文件:**
- 创建: `frontend/src/agent/subagent/types.ts`

**Step 1: 定义类型**

```typescript
/**
 * 子 Agent 系统类型定义
 */

/**
 * 子 Agent 任务状态
 */
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 子 Agent 任务
 */
export interface SubagentTask {
  /** 任务 ID */
  taskId: string;
  /** 任务描述 */
  description: string;
  /** 显示标签 */
  label: string;
  /** 状态 */
  status: SubagentStatus;
  /** 结果（完成时） */
  result?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 创建时间 */
  createdAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 所属会话 ID */
  sessionId?: string;
}

/**
 * 子 Agent 配置
 */
export interface SubagentConfig {
  /** 最大迭代次数（默认 5） */
  maxIterations: number;
  /** 允许的工具列表（null 表示使用默认集） */
  allowedTools?: string[];
  /** 超时时间（毫秒，默认 60000） */
  timeout: number;
}

/**
 * 子 Agent 结果回调
 */
export type SubagentCallback = (task: SubagentTask) => void;

const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  maxIterations: 5,
  timeout: 60000,
};
```

**Step 2: Commit**

```bash
git add frontend/src/agent/subagent/types.ts
git commit -m "feat(agent): add subagent type definitions"
```

---

## Task 2: 创建 SubagentManager 类

**文件:**
- 创建: `frontend/src/agent/subagent/manager.ts`

**Step 1: 实现 SubagentManager**

```typescript
/**
 * 子 Agent 管理器
 *
 * 负责创建、执行和监控子 Agent 任务
 */

import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, ToolDefinition } from '../types';
import type { LLMClient } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';
import type { SubagentTask, SubagentConfig, SubagentCallback } from './types';
import { runAgentLoop } from '../agent-loop';
import { agentLog } from '../../utils/logger';

export class SubagentManager {
  private client: LLMClient;
  private toolRegistry: ToolRegistry;
  private context: ToolContext;
  private config: SubagentConfig;
  private onResult?: SubagentCallback;

  /** 运行中的任务 */
  private runningTasks: Map<string, Promise<void>> = new Map();
  /** 任务信息 */
  private taskInfo: Map<string, SubagentTask> = new Map();
  /** 会话任务映射 */
  private sessionTasks: Map<string, Set<string>> = new Map();

  constructor(
    client: LLMClient,
    toolRegistry: ToolRegistry,
    context: ToolContext,
    config: Partial<SubagentConfig> = {},
    onResult?: SubagentCallback
  ) {
    this.client = client;
    this.toolRegistry = toolRegistry;
    this.context = context;
    this.config = { maxIterations: 5, timeout: 60000, ...config };
    this.onResult = onResult;
  }

  /**
   * 创建并启动子 Agent 任务
   */
  spawn(
    description: string,
    label?: string,
    sessionId?: string
  ): string {
    const taskId = uuidv4().slice(0, 8);
    const displayLabel = label || (description.length > 30 ? description.slice(0, 30) + '...' : description);

    const task: SubagentTask = {
      taskId,
      description,
      label: displayLabel,
      status: 'running',
      createdAt: Date.now(),
      sessionId,
    };

    this.taskInfo.set(taskId, task);

    // 启动异步任务
    const promise = this.runSubagent(taskId, description);
    this.runningTasks.set(taskId, promise);

    // 关联到会话
    if (sessionId) {
      if (!this.sessionTasks.has(sessionId)) {
        this.sessionTasks.set(sessionId, new Set());
      }
      this.sessionTasks.get(sessionId)!.add(taskId);
    }

    agentLog(`[Subagent] 启动任务 ${taskId}: ${displayLabel}`);
    return taskId;
  }

  /**
   * 执行子 Agent
   */
  private async runSubagent(taskId: string, description: string): Promise<void> {
    const task = this.taskInfo.get(taskId);
    if (!task) return;

    try {
      // 构建子 Agent 的系统提示
      const systemPrompt = this.buildSubagentPrompt();

      // 获取允许的工具
      const tools = this.getAllowedTools();

      // 初始消息
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ];

      // 运行子 Agent 循环
      const result = await this.runLoop(taskId, messages, tools);

      // 更新任务状态
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();

      agentLog(`[Subagent] 任务 ${taskId} 完成`);

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();

      agentLog(`[Subagent] 任务 ${taskId} 失败: ${task.error}`);
    } finally {
      this.runningTasks.delete(taskId);

      // 触发回调
      if (this.onResult) {
        this.onResult(task);
      }
    }
  }

  /**
   * 运行子 Agent 循环
   */
  private async runLoop(
    taskId: string,
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<string> {
    let accumulatedContent = '';

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('子 Agent 超时'));
      }, this.config.timeout);

      runAgentLoop(
        this.client,
        messages,
        tools,
        this.toolRegistry,
        this.context,
        {
          maxIterations: this.config.maxIterations,
          onContent: (text) => {
            accumulatedContent += text;
          },
          onProgress: () => {},
          onComplete: () => {
            clearTimeout(timeout);
            resolve();
          },
          onError: (error) => {
            clearTimeout(timeout);
            reject(new Error(error));
          },
        }
      );
    });

    return accumulatedContent;
  }

  /**
   * 构建子 Agent 系统提示
   */
  private buildSubagentPrompt(): string {
    return `你是一个专门的分析助手，负责完成主助手分配给你的子任务。

## 任务
完成分配给你的具体任务，并返回简洁的结果摘要。

## 约束
- 专注于给定的任务
- 使用可用的工具获取信息
- 提供简洁的摘要，不要过度展开
- 如果无法完成任务，说明原因

## 禁止
- 不能与用户直接交流
- 不能创建新的子任务
- 最多执行 ${this.config.maxIterations} 轮

完成任务后，直接返回你的发现。`;
  }

  /**
   * 获取允许的工具列表
   */
  private getAllowedTools(): ToolDefinition[] {
    // 子 Agent 可用的工具（受限）
    const allowed = this.config.allowedTools || [
      'search_doc',
      'get_chapter',
      'get_toc',
      'search_read_books',
    ];

    // 从工具注册表获取工具定义
    const allTools = this.toolRegistry.getToolDefinitions();
    return allTools.filter(tool => allowed.includes(tool.function.name));
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): SubagentTask | undefined {
    return this.taskInfo.get(taskId);
  }

  /**
   * 列出所有任务
   */
  listTasks(sessionId?: string): SubagentTask[] {
    if (sessionId) {
      const taskIds = this.sessionTasks.get(sessionId) || new Set();
      return Array.from(taskIds)
        .map(id => this.taskInfo.get(id))
        .filter((t): t is SubagentTask => t !== undefined);
    }
    return Array.from(this.taskInfo.values());
  }

  /**
   * 取消任务
   */
  async cancel(taskId: string): Promise<boolean> {
    const task = this.taskInfo.get(taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();

    // 注意：实际的取消需要 AbortController 支持
    // 这里只是标记状态

    agentLog(`[Subagent] 取消任务 ${taskId}`);
    return true;
  }

  /**
   * 取消会话的所有任务
   */
  async cancelBySession(sessionId: string): Promise<number> {
    const taskIds = this.sessionTasks.get(sessionId) || new Set();
    let count = 0;

    for (const taskId of taskIds) {
      if (await this.cancel(taskId)) {
        count++;
      }
    }

    return count;
  }

  /**
   * 清理已完成的任务
   */
  cleanup(): number {
    let count = 0;

    for (const [taskId, task] of this.taskInfo) {
      if (task.status !== 'running') {
        this.taskInfo.delete(taskId);

        // 从会话映射中移除
        if (task.sessionId) {
          this.sessionTasks.get(task.sessionId)?.delete(taskId);
        }

        count++;
      }
    }

    return count;
  }
}
```

**Step 2: 创建 index.ts 导出**

```typescript
// frontend/src/agent/subagent/index.ts
export * from './types';
export * from './manager';
```

**Step 3: Commit**

```bash
git add frontend/src/agent/subagent/
git commit -m "feat(agent): add SubagentManager for background task execution"
```

---

## Task 3: 实现 create_sub_agent 工具

**文件:**
- 修改: `frontend/src/agent/tools/create-sub-agent.ts`

**Step 1: 完整实现**

```typescript
/**
 * create_sub_agent 工具
 *
 * 创建子 Agent 执行后台任务
 */

import type { Tool, ToolContext } from './types';
import type { SubagentManager } from '../subagent/manager';

export class CreateSubAgentTool implements Tool {
  name = 'create_sub_agent';
  description = '创建一个子助手在后台执行任务，用于并行处理或复杂分析';

  private manager: SubagentManager;
  private sessionId?: string;

  constructor(manager: SubagentManager, sessionId?: string) {
    this.manager = manager;
    this.sessionId = sessionId;
  }

  parameters = {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: '子助手要执行的任务描述',
      },
      label: {
        type: 'string',
        description: '任务的显示标签（可选）',
      },
    },
    required: ['task'],
  };

  async execute(args: { task: string; label?: string }, context: ToolContext): Promise<string> {
    const taskId = this.manager.spawn(
      args.task,
      args.label,
      this.sessionId
    );

    return JSON.stringify({
      success: true,
      taskId,
      message: `子助手已启动，任务 ID: ${taskId}`,
      note: '子助手完成后，结果将通过系统通知返回',
    });
  }
}

/**
 * 检查子 Agent 状态的工具
 */
export class CheckSubAgentTool implements Tool {
  name = 'check_sub_agent';
  description = '检查子助手的执行状态和结果';

  private manager: SubagentManager;

  constructor(manager: SubagentManager) {
    this.manager = manager;
  }

  parameters = {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: '要检查的任务 ID',
      },
    },
    required: ['task_id'],
  };

  async execute(args: { task_id: string }, context: ToolContext): Promise<string> {
    const task = this.manager.getTask(args.task_id);

    if (!task) {
      return JSON.stringify({
        success: false,
        error: '任务不存在',
      });
    }

    return JSON.stringify({
      success: true,
      taskId: task.taskId,
      label: task.label,
      status: task.status,
      result: task.result,
      error: task.error,
    });
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/tools/create-sub-agent.ts
git commit -m "feat(agent): implement create_sub_agent tool"
```

---

## Task 4: 集成到工具注册表

**文件:**
- 修改: `frontend/src/agent/tools/index.ts`

**Step 1: 注册子 Agent 工具**

```typescript
import { CreateSubAgentTool, CheckSubAgentTool } from './create-sub-agent';
import type { SubagentManager } from '../subagent/manager';

// 在工具注册函数中添加
export function registerSubagentTools(
  registry: ToolRegistry,
  manager: SubagentManager,
  sessionId?: string
): void {
  registry.register(new CreateSubAgentTool(manager, sessionId));
  registry.register(new CheckSubAgentTool(manager));
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/tools/index.ts
git commit -m "feat(agent): register subagent tools in registry"
```

---

## Task 5: 添加子 Agent 状态 UI（可选）

**文件:**
- 创建: `frontend/src/views/SubagentStatusView.ts`

**Step 1: 创建状态视图**

```typescript
/**
 * 子 Agent 状态视图
 *
 * 显示运行中的子任务状态
 */

import { App, Modal } from 'obsidian';
import type { SubagentTask } from '../agent/subagent/types';

export class SubagentStatusModal extends Modal {
  private tasks: SubagentTask[];

  constructor(app: App, tasks: SubagentTask[]) {
    super(app);
    this.tasks = tasks;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: '子助手任务状态' });

    const list = contentEl.createEl('div', { cls: 'subagent-list' });

    for (const task of this.tasks) {
      const item = list.createEl('div', { cls: `subagent-item subagent-${task.status}` });

      item.createEl('div', { cls: 'subagent-label', text: task.label });
      item.createEl('div', { cls: 'subagent-status', text: task.status });

      if (task.result) {
        item.createEl('div', { cls: 'subagent-result', text: task.result.slice(0, 100) + '...' });
      }

      if (task.error) {
        item.createEl('div', { cls: 'subagent-error', text: task.error });
      }
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/views/SubagentStatusView.ts
git commit -m "feat(ui): add subagent status modal"
```

---

## 验收清单

- [ ] SubagentManager 正确管理后台任务
- [ ] spawn() 返回有效的 taskId
- [ ] 子 Agent 使用受限工具集
- [ ] 子 Agent 最多执行 5 轮迭代
- [ ] cancel() 正确取消任务
- [ ] 回调函数在任务完成时触发
- [ ] create_sub_agent 工具正确实现
- [ ] check_sub_agent 工具返回正确状态

---

## DeepReader 使用示例

### 场景：并行检索多个章节

```
用户问题："比较第一章和第三章的主要观点"

主 Agent 决策：
1. 使用 create_sub_agent 创建两个子任务
2. 子任务 1：分析第一章的主要观点
3. 子任务 2：分析第三章的主要观点
4. 等待结果并整合

# 工具调用
create_sub_agent(task="分析第一章的主要观点和论据", label="Chapter 1")
create_sub_agent(task="分析第三章的主要观点和论据", label="Chapter 3")

# 子 Agent 独立执行：
# - 使用 search_doc 搜索相关内容
# - 使用 get_chapter 阅读章节
# - 返回分析结果

# 主 Agent 整合两个结果后回复用户
```

---

## 后续工作

Phase 3 完成后，进入 Phase 4: 分层系统提示优化

- [Phase 4 计划](./2026-03-12-phase4-layered-system-prompt.md)
