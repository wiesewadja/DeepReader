# DeepReader Agent 优化建议（详细版）

> **基于**: 2026-03-13 DeepReader vs nanobot 对比分析
> **目标**: 修复关键问题，提升架构成熟度
> **优先级**: P0（立即）/ P1（本周）/ P2（可选）

---

## 一、关键问题总览

| 优先级 | 问题 | 影响 | 文件位置 |
|--------|------|------|----------|
| **P0** | `last_consolidated` 未实际使用 | 上下文无限膨胀，Token 溢出 | `sidebar-view.ts` |
| **P0** | 消息历史无长度限制 | 内存泄漏，性能下降 | `agent-loop.ts` |
| **P1** | 历史未对齐用户消息边界 | 孤立的 tool 结果破坏对话 | `agent-loop.ts` |
| **P1** | `setupSubagentManager` 未调用 | 子代理工具无法使用 | `sidebar-view.ts` |
| **P1** | `reloadContext()` 为空实现 | 记忆整合后上下文不刷新 | `agent/index.ts` |
| **P2** | 缺少工具错误提示 | LLM 无法从错误中学习 | `agent-loop.ts` |

---

## 二、P0 级优化（立即执行）

### 2.1 修复 `last_consolidated` 实际使用

**问题分析**:
- `ChatCacheEntry` 中定义了 `lastConsolidated` 字段
- `MemoryConsolidator` 会更新这个字段
- 但加载历史时**从未使用**它来裁剪消息

**当前代码** (`sidebar-view.ts`):
```typescript
async continueChat(
  history: ChatMessage[],
  userMessage: string,
  context: ToolContext,
  callbacks: AgentLoopOptions
): Promise<ChatMessage[]> {
  // ...
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.filter(msg => msg.role !== 'system'),  // ❌ 使用完整历史
    { role: 'user', content: userMessage },
  ];
  return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
}
```

**优化后代码**:
```typescript
// frontend/src/agent/index.ts
async continueChat(
  history: ChatMessage[],
  userMessage: string,
  context: ToolContext,
  callbacks: AgentLoopOptions,
  lastConsolidated?: number  // 新增参数
): Promise<ChatMessage[]> {
  await this.initialize();
  
  const systemPrompt = await this.getSystemPromptAsync(context.documentMetadata);
  const toolRegistry = createToolRegistry(this.skillLoader, context);
  const tools = getToolDefinitions(toolRegistry);

  // ✅ 只加载未整合的消息（从 lastConsolidated 之后）
  const unconsolidatedHistory = lastConsolidated 
    ? history.slice(lastConsolidated)
    : history;

  // ✅ 限制历史长度（最多 500 条）
  const MAX_HISTORY_MESSAGES = 500;
  const trimmedHistory = unconsolidatedHistory.slice(-MAX_HISTORY_MESSAGES);

  // ✅ 对齐到用户消息边界
  const firstUserIndex = trimmedHistory.findIndex(m => m.role === 'user');
  const alignedHistory = firstUserIndex >= 0 
    ? trimmedHistory.slice(firstUserIndex)
    : trimmedHistory;

  // 构建消息
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...alignedHistory.filter(msg => msg.role !== 'system'),
    { role: 'user', content: userMessage },
  ];

  return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
}
```

**调用处修改** (`sidebar-view.ts`):
```typescript
// 在 handleAgentQuery 中获取 lastConsolidated
const cache = this.plugin.settings.chatCache?.[this.sessionId];
const lastConsolidated = cache?.lastConsolidated ?? 0;

// 传递给 continueChat
updatedHistory = await this.frontendAgent.continueChat(
  this.agentChatHistory,
  userMessage,
  context,
  callbacks,
  lastConsolidated  // 新增参数
);
```

---

### 2.2 消息历史长度限制

**问题分析**:
- `manageMessageHistory` 只在 Token 超限时压缩
- 没有消息数量限制，极端情况下可能数千条
- 应该像 nanobot 一样限制最多 500 条

**当前代码** (`agent-loop.ts`):
```typescript
function manageMessageHistory(messages: ChatMessage[]): ChatMessage[] {
  const currentTokens = estimateTokens(messages);
  if (currentTokens <= MAX_CONTEXT_TOKENS) {
    return messages;  // ❌ 无消息数量检查
  }
  // ... 压缩逻辑
}
```

**优化后代码**:
```typescript
// frontend/src/agent/agent-loop.ts

/**
 * 管理消息历史（防止 token 和消息数量无限增长）
 * 
 * 策略：
 * 1. 限制消息数量（最多 500 条）
 * 2. 限制 token 数量（最多 40000）
 * 3. 压缩工具结果
 */
function manageMessageHistory(
  messages: ChatMessage[],
  maxMessages: number = 500,  // 新增：最大消息数
  maxTokens: number = MAX_CONTEXT_TOKENS
): ChatMessage[] {
  let managedMessages = [...messages];
  
  // 1. 首先限制消息数量（保留最新的）
  if (managedMessages.length > maxMessages) {
    const systemMessages = managedMessages.filter(m => m.role === 'system');
    const otherMessages = managedMessages.filter(m => m.role !== 'system');
    
    // 保留系统消息 + 最新的其他消息
    const keepCount = maxMessages - systemMessages.length;
    managedMessages = [
      ...systemMessages,
      ...otherMessages.slice(-keepCount)
    ];
    
    agentLog(`[AgentLoop] 消息数量超限 (${messages.length} > ${maxMessages})，已裁剪`);
  }
  
  // 2. 然后检查 token 数量
  const currentTokens = estimateTokens(managedMessages);
  if (currentTokens <= maxTokens) {
    return managedMessages;
  }
  
  agentLog(`[AgentLoop] ⚠️ Token 超限 (${currentTokens} > ${maxTokens})，开始压缩...`);
  
  // 3. 压缩工具结果（保留原有逻辑）
  const compressedMessages: ChatMessage[] = [];
  let savedTokens = 0;
  const targetTokens = maxTokens * 0.8;
  
  // 从后往前处理，保留最新的消息
  const reversedMessages = [...managedMessages].reverse();
  
  for (const msg of reversedMessages) {
    const msgTokens = estimateTokens([msg]);
    
    // 如果已经节省了足够的 token，直接保留
    if (savedTokens >= currentTokens - targetTokens) {
      compressedMessages.unshift(msg);
      continue;
    }
    
    // 压缩 tool 结果
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 2000) {
      const furtherCompressed = compressToolResult(msg.content, 2000);
      compressedMessages.unshift({
        ...msg,
        content: furtherCompressed,
      });
      savedTokens += msgTokens - estimateTokens([{ ...msg, content: furtherCompressed }]);
    } else {
      compressedMessages.unshift(msg);
    }
  }
  
  return compressedMessages;
}
```

**在 AgentLoop 中使用**:
```typescript
// agent-loop.ts 的 while 循环中
while (iterations < maxIterations) {
  iterations++;
  
  // ✅ 每轮都管理消息历史
  workingMessages = manageMessageHistory(workingMessages, 500, MAX_CONTEXT_TOKENS);
  
  // ... LLM 调用
}
```

---

## 三、P1 级优化（本周内）

### 3.1 初始化 SubagentManager

**问题分析**:
- `FrontendAgent.setupSubagentManager()` 已实现
- 但 `sidebar-view.ts` 中从未调用
- 导致 `create_sub_agent` 工具无法使用

**当前代码** (`sidebar-view.ts`):
```typescript
async handleAgentQuery(userMessage: string, aiMessageId: string) {
  // ...
  const context: ToolContext = {
    app: this.app,
    indexId: this.currentIndexId || '',
    pdfName: this.currentPdfName || '',
    // ...
  };
  
  // ❌ 缺少 SubagentManager 初始化
  
  await this.frontendAgent.chat(userMessage, context, callbacks);
}
```

**优化后代码**:
```typescript
// frontend/src/views/sidebar-view.ts

async handleAgentQuery(userMessage: string, aiMessageId: string) {
  // ...
  const context: ToolContext = {
    app: this.app,
    indexId: this.currentIndexId || '',
    pdfName: this.currentPdfName || '',
    // ...
  };
  
  // ✅ 初始化子 Agent 管理器
  this.frontendAgent?.setupSubagentManager(context);
  
  // 根据是否有历史选择不同的方法
  if (isNewConversation) {
    updatedHistory = await this.frontendAgent.chat(userMessage, context, callbacks);
  } else {
    // 获取 lastConsolidated
    const cache = this.plugin.settings.chatCache?.[this.sessionId];
    const lastConsolidated = cache?.lastConsolidated ?? 0;
    
    updatedHistory = await this.frontendAgent.continueChat(
      this.agentChatHistory,
      userMessage,
      context,
      callbacks,
      lastConsolidated
    );
  }
  
  // ...
}
```

---

### 3.2 实现 `reloadContext()`

**问题分析**:
- `reloadContext()` 仅打印日志，没有实际刷新 MEMORY.md
- 记忆整合后，当前对话不会使用新记忆

**当前代码** (`agent/index.ts`):
```typescript
async reloadContext(): Promise<void> {
  // ⚠️ 实现为空
  log('[FrontendAgent] User context will be refreshed on next prompt');
}
```

**优化后代码**:
```typescript
// frontend/src/agent/index.ts

export class FrontendAgent {
  private memoryStore: MemoryStore;
  private contextBuilder: ContextBuilder;
  private memoryCache: string | null = null;  // 添加缓存
  private memoryCacheTime: number = 0;
  private readonly MEMORY_CACHE_TTL = 60000;  // 缓存 60 秒

  constructor(private options: FrontendAgentOptions) {
    // ...
    this.memoryStore = new MemoryStore(options.app);
    this.contextBuilder = new ContextBuilder(options.app, this.memoryStore, {
      deepReaderDir: 'DeepReader',
    });
  }

  /**
   * 重载用户上下文（重新加载 MEMORY.md）
   * 
   * 在记忆整合后调用，确保新记忆被立即使用
   */
  async reloadContext(): Promise<void> {
    // ✅ 清除缓存，强制下次重新读取
    this.memoryCache = null;
    this.memoryCacheTime = 0;
    
    // ✅ 可选：立即预加载新记忆
    try {
      const freshMemory = await this.memoryStore.readLongTermMemory();
      if (freshMemory) {
        this.memoryCache = freshMemory;
        this.memoryCacheTime = Date.now();
        log('[FrontendAgent] 上下文已刷新，新记忆已加载');
      } else {
        log('[FrontendAgent] 上下文已刷新，暂无记忆');
      }
    } catch (err) {
      logError('[FrontendAgent] 刷新上下文失败:', err);
    }
  }

  /**
   * 获取系统提示（带缓存）
   */
  async getSystemPromptAsync(documentMetadata?: DocumentMetadata): Promise<string> {
    await this.initialize();
    
    // 获取工具描述
    const tempContext = { app: this.options.app } as ToolContext;
    const toolRegistry = createToolRegistry(this.skillLoader, tempContext);
    const tools = getToolDefinitions(toolRegistry);

    const toolDescriptions = tools.map(t => {
      const func = t.function;
      return `### ${func.name}\n${func.description}`;
    }).join('\n\n');

    const skillDescriptions = this.skillLoader.getDescriptions();

    // ✅ ContextBuilder 会使用 MemoryStore，自动读取最新记忆
    return this.contextBuilder.buildSystemPrompt(
      toolDescriptions,
      skillDescriptions,
      documentMetadata
    );
  }
}
```

**在记忆整合后调用** (`sidebar-view.ts`):
```typescript
private async maybeConsolidateMemory(): Promise<void> {
  // ...
  const newLastConsolidated = await consolidator.maybeConsolidate(
    messages,
    lastConsolidated,
    (newIndex) => {
      if (this.plugin.settings.chatCache?.[sessionId]) {
        this.plugin.settings.chatCache[sessionId].lastConsolidated = newIndex;
        this.plugin.saveSettings();
      }
    }
  );

  // ✅ 整合完成后刷新上下文
  if (newLastConsolidated > lastConsolidated) {
    log(`[DeepPDF] 记忆整合完成，刷新上下文`);
    await this.frontendAgent?.reloadContext();
  }
}
```

---

### 3.3 对齐用户消息边界

**问题分析**:
- 裁剪历史后，可能从 tool 或 assistant 消息开始
- 导致孤立的 tool 结果，破坏对话完整性

**优化代码** (已包含在 2.1 中):
```typescript
// 在 continueChat 中
const trimmedHistory = unconsolidatedHistory.slice(-MAX_HISTORY_MESSAGES);

// ✅ 对齐到用户消息边界
const firstUserIndex = trimmedHistory.findIndex(m => m.role === 'user');
const alignedHistory = firstUserIndex >= 0 
  ? trimmedHistory.slice(firstUserIndex)
  : trimmedHistory;
```

---

## 四、P2 级优化（可选）

### 4.1 添加工具错误提示

**问题分析**:
- nanobot 在工具错误后自动附加提示，帮助 LLM 学习
- DeepReader 缺少这个机制

**优化代码** (`agent-loop.ts`):
```typescript
// 在工具执行后
const result = await executeTool(toolRegistry, tc.name, args, context);

// ✅ 添加错误提示
const ERROR_HINT = "\n\n[Analyze the error above and try a different approach.]";
const finalResult = result.startsWith("Error") 
  ? result + ERROR_HINT 
  : result;

workingMessages.push({
  role: 'tool',
  tool_call_id: tc.id,
  name: tc.name,
  content: finalResult,
});
```

---

### 4.2 优化会话存储格式

**问题分析**:
- 当前使用 JSON 存储在 data.json 中
- 大对话会频繁重写整个文件
- nanobot 使用 JSONL 格式，支持追加写入

**优化建议** (可选，改动较大):
```typescript
// 考虑将会话历史存储为独立的 JSONL 文件
// 路径: DeepReader/sessions/{sessionId}.jsonl

interface SessionStorage {
  saveMessage(sessionId: string, message: ChatMessage): Promise<void>;  // 追加
  loadMessages(sessionId: string, lastConsolidated?: number): Promise<ChatMessage[]>;  // 读取
  updateLastConsolidated(sessionId: string, index: number): Promise<void>;
}
```

---

## 五、完整修改清单

### 文件 1: `frontend/src/agent/index.ts`

```typescript
// 修改 continueChat 方法签名
async continueChat(
  history: ChatMessage[],
  userMessage: string,
  context: ToolContext,
  callbacks: AgentLoopOptions,
  lastConsolidated?: number  // 新增
): Promise<ChatMessage[]> {
  // ... 实现见上文 2.1
}

// 修改 reloadContext 实现
async reloadContext(): Promise<void> {
  // ... 实现见上文 3.2
}
```

### 文件 2: `frontend/src/agent/agent-loop.ts`

```typescript
// 修改 manageMessageHistory 签名
function manageMessageHistory(
  messages: ChatMessage[],
  maxMessages?: number,
  maxTokens?: number
): ChatMessage[] {
  // ... 实现见上文 2.2
}

// 在 while 循环中调用
workingMessages = manageMessageHistory(workingMessages, 500, MAX_CONTEXT_TOKENS);

// 添加错误提示（可选）
const finalResult = result.startsWith("Error") ? result + ERROR_HINT : result;
```

### 文件 3: `frontend/src/views/sidebar-view.ts`

```typescript
// 在 handleAgentQuery 中添加
this.frontendAgent?.setupSubagentManager(context);

// 获取 lastConsolidated 并传递给 continueChat
const cache = this.plugin.settings.chatCache?.[this.sessionId];
const lastConsolidated = cache?.lastConsolidated ?? 0;

// 在 maybeConsolidateMemory 中添加
if (newLastConsolidated > lastConsolidated) {
  await this.frontendAgent?.reloadContext();
}
```

---

## 六、验证清单

实施完成后，验证以下功能：

- [ ] **P0**: 长对话（>50 轮）后，Token 数量控制在合理范围
- [ ] **P0**: `lastConsolidated` 更新后，历史消息正确裁剪
- [ ] **P1**: 子 Agent 可以成功创建并执行任务
- [ ] **P1**: 记忆整合后，新对话使用更新后的 MEMORY.md
- [ ] **P1**: 历史消息始终从 user 消息开始
- [ ] **P2**: 工具错误后，LLM 收到错误提示

---

## 七、风险评估

| 修改 | 风险 | 缓解措施 |
|------|------|----------|
| `lastConsolidated` 裁剪 | 可能丢失重要上下文 | 保留最近 500 条，足够覆盖多轮对话 |
| 消息数量限制 | 极端长对话可能丢失早期信息 | 已整合到 MEMORY.md，信息未丢失 |
| SubagentManager 初始化 | 可能引入新的内存泄漏 | 确保在会话结束时清理 |

---

*此文档提供具体的代码修改建议，可直接用于实施。*
