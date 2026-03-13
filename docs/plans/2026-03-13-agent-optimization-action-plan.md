# Agent 优化行动计划

> **目标**: 完成 Phase 2-4 的剩余工作，统一代码架构，提升系统稳定性
> **创建日期**: 2026-03-13
> **负责人**: AI Assistant

---

## 一、任务总览

| 优先级 | 任务 | 预计工时 | 依赖 |
|--------|------|----------|------|
| P0 | 统一使用 ContextBuilder | 2h | 无 |
| P1 | 记忆整合非阻塞化 | 1h | 无 |
| P2 | 启用子 Agent 并行检索 | 3h | P0 |
| P3 | 添加记忆热重载机制 | 1h | P1 |
| P4 | 代码清理与测试 | 2h | P0-P3 |

---

## 二、详细任务

### Task 1: 统一使用 ContextBuilder（P0）

**问题**: `FrontendAgent` 仍使用旧的 `buildSystemPrompt`，未使用已实现的 `ContextBuilder`

**目标**: 完全迁移到 `ContextBuilder`，实现真正的分层系统提示

**修改文件**:
- `frontend/src/agent/index.ts`
- `frontend/src/agent/prompts.ts`（标记为废弃或删除）

**实现步骤**:

1. 修改 `FrontendAgent` 类，添加 `ContextBuilder` 实例
```typescript
export class FrontendAgent {
  private contextBuilder: ContextBuilder;
  
  constructor(private options: FrontendAgentOptions) {
    // ... existing code ...
    this.contextBuilder = new ContextBuilder(
      options.app,
      this.contextLoader.getStore(),
      { deepReaderDir: 'DeepReader' }
    );
  }
}
```

2. 修改 `chat()` 和 `continueChat()` 方法使用 `ContextBuilder`
```typescript
async chat(userMessage: string, context: ToolContext, callbacks: AgentLoopOptions) {
  await this.initialize();
  
  const systemPrompt = await this.contextBuilder.buildSystemPrompt(
    getToolDescriptions(this.skillLoader, context),
    this.skillLoader.getDescriptions(),
    context.documentMetadata
  );
  
  const messages = ContextBuilder.buildMessagesWithMetadata(
    systemPrompt,
    [],
    userMessage,
    context.documentMetadata,
    context.readingProgress
  );
  
  return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
}
```

3. 验证 Bootstrap 文件加载是否正常

**验收标准**:
- [ ] `AGENT_PROMPT.md` 等 Bootstrap 文件被正确加载
- [ ] 系统提示包含 4 层结构（Identity → Bootstrap → Memory → Tools）
- [ ] 运行时上下文正确注入到用户消息

---

### Task 2: 记忆整合非阻塞化（P1）

**问题**: `maybeConsolidateMemory` 使用 `await` 可能阻塞 UI 响应

**目标**: 记忆整合在后台异步执行，不影响用户体验

**修改文件**:
- `frontend/src/views/sidebar-view.ts`

**实现步骤**:

1. 修改 `onComplete` 回调
```typescript
onComplete: () => {
  this.messageList?.updateMessage(aiMessageId, {
    isStreaming: false
  });
  this.saveToCache();
  
  // 非阻塞执行记忆整合
  this.maybeConsolidateMemory().catch(err => {
    logError('[DeepPDF] 记忆整合失败:', err);
  });
  
  // 恢复输入状态
  this.isProcessing = false;
  this.isAiStreaming = false;
  this.chatInput?.setStreaming(false);
  this.chatInput?.setDisabled(false);
  this.chatInput?.focus();
  this.streamController = null;
}
```

2. 添加整合状态指示（可选）
```typescript
private memoryConsolidating = false;

private async maybeConsolidateMemory(): Promise<void> {
  if (this.memoryConsolidating) return;
  this.memoryConsolidating = true;
  
  try {
    // ... existing logic ...
  } finally {
    this.memoryConsolidating = false;
  }
}
```

**验收标准**:
- [ ] AI 回复完成后立即恢复输入框可用状态
- [ ] 记忆整合在后台执行，不阻塞用户发送新消息
- [ ] 整合失败不影响正常对话流程

---

### Task 3: 启用子 Agent 并行检索（P2）

**问题**: `SubagentManager` 已实现但未被使用，`create_sub_agent` 工具是占位实现

**目标**: 实现真正的并行检索能力，支持同时搜索多个章节

**修改文件**:
- `frontend/src/agent/tools/create-sub-agent.ts`
- `frontend/src/agent/tools/index.ts`
- `frontend/src/agent/index.ts`

**实现步骤**:

1. 修改 `FrontendAgent` 添加 `SubagentManager`
```typescript
export class FrontendAgent {
  private subagentManager: SubagentManager;
  
  async initialize(): Promise<void> {
    // ... existing code ...
    
    // 初始化子 Agent 管理器
    this.subagentManager = new SubagentManager(
      this.llmClient,
      createToolRegistry(this.skillLoader, { app: this.options.app }),
      { app: this.options.app },
      {},
      (task) => {
        log('[Subagent] 任务完成:', task.taskId, task.status);
      }
    );
  }
  
  getSubagentManager(): SubagentManager {
    return this.subagentManager;
  }
}
```

2. 实现 `create_sub_agent` 工具
```typescript
// frontend/src/agent/tools/create-sub-agent.ts
import { SubagentManager } from '../subagent/manager.js';

export function createSubAgentTool(manager: SubagentManager) {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'create_sub_agent',
        description: '创建子 Agent 并行处理子任务，适用于需要同时搜索多个章节或文档的场景',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: '子任务的详细描述',
            },
            label: {
              type: 'string',
              description: '任务标签（可选）',
            },
          },
          required: ['description'],
        },
      },
    },
    execute: async (args: { description: string; label?: string }, context: any) => {
      const taskId = manager.spawn(args.description, args.label, context.sessionId);
      
      // 等待任务完成（带超时）
      const task = await manager.waitFor(taskId, 60000);
      
      if (!task) {
        return '任务执行超时';
      }
      
      if (task.status === 'completed') {
        return task.result || '任务完成，无返回结果';
      } else if (task.status === 'failed') {
        return `任务失败: ${task.error || '未知错误'}`;
      } else if (task.status === 'cancelled') {
        return '任务已取消';
      }
      
      return '任务状态未知';
    },
  };
}
```

3. 在工具注册中添加子 Agent 工具
```typescript
// frontend/src/agent/tools/index.ts
export function createToolRegistry(skillLoader: SkillLoader, context: ToolContext): ToolRegistry {
  const registry = new Map<string, ToolExecutor>();
  
  // ... existing tools ...
  
  // 子 Agent 工具（如果上下文中有 SubagentManager）
  if (context.subagentManager) {
    const subAgentTool = createSubAgentTool(context.subagentManager);
    registry.set(subAgentTool.definition.function.name, {
      definition: subAgentTool.definition,
      execute: subAgentTool.execute,
    });
  }
  
  return registry;
}
```

**验收标准**:
- [ ] 可以成功创建子 Agent 任务
- [ ] 子 Agent 可以独立执行工具调用
- [ ] 支持同时运行多个子任务
- [ ] 任务结果正确返回给主 Agent

---

### Task 4: 添加记忆热重载机制（P3）

**问题**: 记忆整合后，当前对话不会立即使用更新后的记忆

**目标**: 记忆整合完成后，自动重新加载用户上下文

**修改文件**:
- `frontend/src/agent/memory/consolidator.ts`
- `frontend/src/agent/index.ts`
- `frontend/src/views/sidebar-view.ts`

**实现步骤**:

1. 添加回调接口
```typescript
// frontend/src/agent/memory/consolidator.ts
export interface ConsolidatorCallbacks {
  onConsolidated?: (newIndex: number) => void;
  onMemoryUpdated?: () => void;
}

export class MemoryConsolidator {
  constructor(
    private store: MemoryStore,
    private client: LLMClient,
    private config: Partial<ConsolidatorConfig> = {},
    private callbacks?: ConsolidatorCallbacks
  ) {}
  
  async consolidate(...): Promise<ConsolidationResult | null> {
    // ... existing logic ...
    
    if (response) {
      // ... write to files ...
      
      // 触发回调
      this.callbacks?.onMemoryUpdated?.();
      
      return response;
    }
  }
}
```

2. 在 `sidebar-view.ts` 中传递回调
```typescript
const consolidator = new MemoryConsolidator(
  store,
  this.frontendAgent?.getLLMClient() as any,
  DEFAULT_CONSOLIDATOR_CONFIG,
  {
    onConsolidated: (newIndex) => {
      if (this.plugin.settings.chatCache?.[sessionId]) {
        this.plugin.settings.chatCache[sessionId].lastConsolidated = newIndex;
        this.plugin.saveSettings();
      }
    },
    onMemoryUpdated: () => {
      // 重新加载用户上下文
      this.frontendAgent?.reloadContext().catch(err => {
        logError('[DeepPDF] 重新加载上下文失败:', err);
      });
    }
  }
);
```

**验收标准**:
- [ ] 记忆整合完成后触发回调
- [ ] 用户上下文自动重新加载
- [ ] 新对话使用更新后的记忆

---

### Task 5: 代码清理与测试（P4）

**目标**: 清理废弃代码，添加基础测试

**修改文件**:
- `frontend/src/agent/prompts.ts`
- `frontend/tests/`（新增）

**实现步骤**:

1. 标记废弃函数
```typescript
// frontend/src/agent/prompts.ts
/**
 * @deprecated 使用 ContextBuilder 替代
 */
export function buildSystemPrompt(...): string {
  // ... existing code ...
}
```

2. 添加基础单元测试
```typescript
// frontend/src/agent/__tests__/context-builder.test.ts
import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../context/builder.js';

describe('ContextBuilder', () => {
  it('should build runtime context with metadata', () => {
    const context = ContextBuilder.buildRuntimeContext(
      { title: '测试文档', page_count: 100 },
      { coverage: 0.5, absorption: 0.3 }
    );
    
    expect(context).toContain('测试文档');
    expect(context).toContain('50% 覆盖度');
  });
  
  it('should build messages with runtime context', () => {
    const messages = ContextBuilder.buildMessages(
      '系统提示',
      [],
      '用户消息',
      '运行时上下文'
    );
    
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('运行时上下文');
  });
});
```

3. 运行测试确保通过
```bash
cd frontend
npm run test:run
```

**验收标准**:
- [ ] 废弃代码已标记
- [ ] 新增单元测试通过
- [ ] 构建无错误

---

## 三、实施顺序

```
Week 1:
  Day 1-2: Task 1 (ContextBuilder 统一)
  Day 3:   Task 2 (记忆整合非阻塞化)
  Day 4-5: Task 3 (子 Agent 启用)

Week 2:
  Day 1:   Task 4 (记忆热重载)
  Day 2-3: Task 5 (代码清理与测试)
  Day 4-5: 集成测试与 Bug 修复
```

---

## 四、风险与应对

| 风险 | 可能性 | 影响 | 应对措施 |
|------|--------|------|----------|
| ContextBuilder 迁移引入回归 | 中 | 高 | 保留旧代码作为 fallback，逐步切换 |
| 子 Agent 并发导致性能问题 | 低 | 中 | 限制最大并发数，添加超时控制 |
| 记忆整合失败导致数据丢失 | 低 | 高 | 整合前备份，失败时回滚 |

---

## 五、验收清单

- [ ] Task 1: ContextBuilder 完全替换旧提示构建
- [ ] Task 2: 记忆整合不阻塞 UI
- [ ] Task 3: 子 Agent 可以并行执行任务
- [ ] Task 4: 记忆更新后自动重载上下文
- [ ] Task 5: 所有测试通过，构建成功
- [ ] 集成测试：完整对话流程无回归
- [ ] 性能测试：长对话（>50 轮）响应正常

---

## 六、相关文档

- [2026-03-12-agent-optimization-overview.md](./2026-03-12-agent-optimization-overview.md) - 优化总览
- [2026-03-12-phase2-dual-layer-memory.md](./2026-03-12-phase2-dual-layer-memory.md) - Phase 2 详细设计
- [2026-03-12-phase3-subagent-system.md](./2026-03-12-phase3-subagent-system.md) - Phase 3 详细设计
- [2026-03-12-phase4-layered-system-prompt.md](./2026-03-12-phase4-layered-system-prompt.md) - Phase 4 详细设计

---

*此文档为 Agent 优化项目的执行计划，具体实现请参考各 Task 的详细说明。*
