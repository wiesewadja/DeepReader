# DeepReader vs nanobot Agent 架构对比分析

> **分析日期**: 2026-03-13
> **分析对象**: DeepReader Agent (feature/agent-optimization 分支) vs nanobot Agent

---

## 一、总体对比

| 维度 | DeepReader | nanobot | 评估 |
|------|------------|---------|------|
| **架构模式** | ReAct + Tools | ReAct + Tools | ✅ 相同 |
| **语言** | TypeScript | Python | - 不同生态 |
| **迭代限制** | 10 轮 | 40 轮 (主) / 15 轮 (子) | ⚠️ DeepReader 更保守 |
| **上下文管理** | 4 层系统提示 + 运行时注入 | 4 层系统提示 + 运行时注入 | ✅ 相同设计 |
| **会话隔离** | sessionId 区分 | `{channel}:{chat_id}` | ✅ 相同概念 |
| **记忆整合** | Token 阈值触发 | Token 阈值触发 | ✅ 相同机制 |
| **子代理** | 已实现但未完全启用 | 完整实现 | ⚠️ DeepReader 待完善 |
| **多模态** | 未实现 | Base64 图片支持 | ❌ DeepReader 缺失 |
| **MCP 支持** | 未实现 | 已实现 | ❌ DeepReader 缺失 |
| **工具超时** | 60 秒 | 未明确 | ✅ DeepReader 更健壮 |

**结论**: 两者架构设计高度相似，DeepReader 在工具执行健壮性上有优势，nanobot 在功能完整性上更成熟。

---

## 二、ReAct 循环对比

### 2.1 核心循环实现

#### DeepReader (`agent-loop.ts`)

```typescript
export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  const maxIterations = options.maxIterations || 10;
  let iterations = 0;
  let workingMessages = [...messages];

  while (iterations < maxIterations) {
    iterations++;
    
    // 1. 调用 LLM（流式）
    await client.streamChat(workingMessages, tools, {
      onContent: (text) => {
        accumulatedContent += text;
        options.onContent(text);
      },
      onToolCall: (calls) => { toolCalls = calls; },
      onComplete: (reason) => { finishReason = reason; },
    });

    // 2. 处理工具调用
    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const result = await executeTool(toolRegistry, tc.name, args, context);
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: result,
        });
      }
    }

    // 3. 检查是否结束
    if (finishReason === 'stop') break;
  }
}
```

#### nanobot (`agent_loop.py`)

```python
async def _run_agent_loop(
    self,
    initial_messages: list[dict],
    on_progress: Callable[..., Awaitable[None]] | None = None,
) -> tuple[str | None, list[str], list[dict]]:
    messages = initial_messages
    iteration = 0

    while iteration < self.max_iterations:  # 默认 40 轮
        iteration += 1
        tool_defs = self.tools.get_definitions()

        # 1. 调用 LLM
        response = await self.provider.chat_with_retry(
            messages=messages,
            tools=tool_defs,
            model=self.model,
        )

        if response.has_tool_calls:
            # 2. 执行工具
            for tool_call in response.tool_calls:
                result = await self.tools.execute(tool_call.name, tool_call.arguments)
                messages = self.context.add_tool_result(messages, tool_call.id, 
                                                         tool_call.name, result)
        else:
            # 3. 返回最终响应
            final_content = response.content
            break

    return final_content, tools_used, messages
```

### 2.2 关键差异

| 特性 | DeepReader | nanobot | 评估 |
|------|------------|---------|------|
| **流式输出** | ✅ 原生支持 | ❌ 非流式 | DeepReader 更优 |
| **迭代限制** | 10 轮 | 40 轮 | nanobot 更灵活 |
| **错误提示** | 手动处理 | 自动附加 `_HINT` | nanobot 更智能 |
| **性能报告** | ✅ 详细报告 | ⚠️ 简单日志 | DeepReader 更完善 |
| **取消信号** | ✅ AbortSignal | ❌ 未明确 | DeepReader 更健壮 |
| **工具结果压缩** | ✅ 自动压缩 | ✅ 截断处理 | 两者相当 |

**结论**: DeepReader 在流式输出和取消机制上更优，nanobot 在迭代灵活性和错误处理上更好。

---

## 三、工具系统对比

### 3.1 工具注册与执行

#### DeepReader

```typescript
// 工具类型定义
export interface ToolExecutor {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

// 注册表实现
export type ToolRegistry = Map<string, ToolExecutor>;

export function createToolRegistry(skillLoader: SkillLoader, context: ToolContext): ToolRegistry {
  const registry: ToolRegistry = new Map();
  registry.set('search_doc', searchDocTool);
  registry.set('get_toc', getTocTool);
  // ...
  return registry;
}

// 执行（带超时保护）
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  timeout: number = 60000
): Promise<string> {
  const executor = registry.get(name);
  if (!executor) return `Error: Unknown tool "${name}"`;

  return Promise.race([
    executor.execute(args, context),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
    ),
  ]);
}
```

#### nanobot

```python
class Tool(ABC):
    @property
    @abstractmethod
    def name(self) -> str: pass

    @property
    @abstractmethod
    def parameters(self) -> dict[str, Any]: pass

    @abstractmethod
    async def execute(self, **kwargs: Any) -> str: pass

class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    async def execute(self, name: str, params: dict[str, Any]) -> str:
        tool = self._tools.get(name)
        if not tool:
            return f"Error: Tool '{name}' not found"
        
        # 参数类型转换和验证
        params = tool.cast_params(params)
        errors = tool.validate_params(params)
        if errors:
            return f"Error: Invalid parameters"
        
        return await tool.execute(**params)
```

### 3.2 工具列表对比

| 工具 | DeepReader | nanobot | 说明 |
|------|------------|---------|------|
| `search_doc` | ✅ | ❌ | DeepReader 特有（PDF 搜索） |
| `get_chapter` | ✅ | ❌ | DeepReader 特有（章节读取） |
| `get_toc` | ✅ | ❌ | DeepReader 特有（目录获取） |
| `read_file` | ❌ | ✅ | nanobot 特有 |
| `write_file` | ❌ | ✅ | nanobot 特有 |
| `edit_file` | ❌ | ✅ | nanobot 特有 |
| `list_dir` | ❌ | ✅ | nanobot 特有 |
| `exec` | ❌ | ✅ | nanobot 特有 |
| `web_search` | ❌ | ✅ | nanobot 特有 |
| `web_fetch` | ❌ | ✅ | nanobot 特有 |
| `write_note` | ✅ | ❌ | DeepReader 特有（Obsidian 集成） |
| `add_memory` | ✅ | ❌ | DeepReader 特有 |
| `search_memory` | ✅ | ❌ | DeepReader 特有 |
| `create_sub_agent` | ✅ | ✅ | 两者都有 |
| `Skill` | ✅ | ✅ | 两者都有（技能系统） |

**结论**: 工具设计差异反映应用场景不同 - DeepReader 专注 PDF/阅读，nanobot 专注通用文件操作。

---

## 四、上下文管理对比

### 4.1 系统提示分层

两者都采用 **4 层架构**：

| 层级 | DeepReader | nanobot | 一致性 |
|------|------------|---------|--------|
| **Layer 1** | Identity（奚童人设） | Identity（nanobot 人设） | ✅ 相同 |
| **Layer 2** | Bootstrap（AGENT_PROMPT.md 等） | Bootstrap（AGENTS.md, SOUL.md 等） | ✅ 相同 |
| **Layer 3** | Memory（MEMORY.md） | Memory（MEMORY.md） | ✅ 相同 |
| **Layer 4** | Tools + Skills | Tools + Skills | ✅ 相同 |

### 4.2 运行时上下文注入

#### DeepReader

```typescript
// ContextBuilder.buildRuntimeContext
static buildRuntimeContext(metadata?: DocumentMetadata, progress?: ReadingProgress): string {
  const lines: string[] = [`${RUNTIME_CONTEXT_TAG}`, `当前时间: ${timeStr}`];
  if (metadata?.title) lines.push(`文档: ${metadata.title}`);
  if (progress) lines.push(`阅读进度: ${progress.coverage}% 覆盖度`);
  return lines.join('\n');
}

// 注入到用户消息
static buildMessages(systemPrompt, history, currentMessage, runtimeContext): ChatMessage[] {
  const userContent = runtimeContext
    ? `${runtimeContext}\n\n${currentMessage}`
    : currentMessage;
  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ];
}
```

#### nanobot

```python
# ContextBuilder._build_runtime_context
@staticmethod
def _build_runtime_context(channel: str | None, chat_id: str | None) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M (%A)")
    tz = time.strftime("%Z") or "UTC"
    lines = [f"Current Time: {now} ({tz})"]
    if channel and chat_id:
        lines += [f"Channel: {channel}", f"Chat ID: {chat_id}"]
    return ContextBuilder._RUNTIME_CONTEXT_TAG + "\n" + "\n".join(lines)

# 注入到用户消息
def build_messages(self, history, current_message, ...):
    runtime_ctx = self._build_runtime_context(channel, chat_id)
    merged = f"{runtime_ctx}\n\n{current_message}"
    return [
        {"role": "system", "content": self.build_system_prompt(...)},
        *history,
        {"role": "user", "content": merged},
    ]
```

**结论**: ✅ **设计完全一致**，都使用运行时上下文标签注入用户消息，保持系统提示稳定。

---

## 五、会话历史管理对比

### 5.1 会话数据结构

#### DeepReader

```typescript
// data.json 中的 chatCache
interface ChatCacheEntry {
  sessionId: string;
  indexId: string;
  lastUpdated: number;
  messages: ChatMessage[];
  lastConsolidated?: number;  // 已整合消息索引
}
```

#### nanobot

```python
# JSONL 文件存储
@dataclass
class Session:
    key: str  # "{channel}:{chat_id}"
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    last_consolidated: int = 0
```

### 5.2 历史加载策略

#### DeepReader

```typescript
// 从 chatCache 加载完整历史
const cache = this.plugin.settings.chatCache?.[sessionId];
const messages = cache?.messages || [];

// 使用完整历史（未做 last_consolidated 裁剪）
const messages: ChatMessage[] = [
  { role: 'system', content: systemPrompt },
  ...history.filter(msg => msg.role !== 'system'),
  { role: 'user', content: userMessage },
];
```

#### nanobot

```python
def get_history(self, max_messages: int = 500) -> list[dict[str, Any]]:
    # 1. 只取未整合的消息
    unconsolidated = self.messages[self.last_consolidated:]
    
    # 2. 限制消息数量
    sliced = unconsolidated[-max_messages:]
    
    # 3. 确保从用户消息开始
    for i, m in enumerate(sliced):
        if m.get("role") == "user":
            sliced = sliced[i:]
            break
    
    return sliced
```

### 5.3 关键差异

| 特性 | DeepReader | nanobot | 评估 |
|------|------------|---------|------|
| **存储格式** | JSON (data.json) | JSONL (独立文件) | nanobot 更利于追加 |
| **last_consolidated 使用** | ⚠️ 未实际裁剪历史 | ✅ 实际裁剪历史 | nanobot 更优 |
| **消息边界对齐** | ❌ 未处理 | ✅ 自动对齐到用户消息 | nanobot 更严谨 |
| **最大消息数** | ❌ 未限制 | ✅ 默认 500 条 | nanobot 更安全 |
| **持久化时机** | 对话结束时 | 实时追加 | nanobot 更可靠 |

**结论**: nanobot 的会话历史管理更成熟，DeepReader 需要改进 `last_consolidated` 的实际使用。

---

## 六、记忆整合对比

### 6.1 触发机制

#### DeepReader

```typescript
// 默认配置
const DEFAULT_CONSOLIDATOR_CONFIG: ConsolidatorConfig = {
  tokenThreshold: 8000,  // 约 16000 中文字符
  targetRatio: 0.5,
  maxRounds: 5,
};

// 触发检查
needsConsolidation(messages: ChatMessage[]): boolean {
  const tokens = estimateTokens(messages);
  return tokens >= this.config.tokenThreshold;
}
```

#### nanobot

```python
# 动态计算阈值
async def maybe_consolidate_by_tokens(self, session: Session) -> None:
    target = self.context_window_tokens // 2  # 50% 阈值
    estimated, source = self.estimate_session_prompt_tokens(session)
    
    if estimated >= self.context_window_tokens:
        # 触发整合
        for round_num in range(self._MAX_CONSOLIDATION_ROUNDS):
            if estimated <= target:
                return
            boundary = self.pick_consolidation_boundary(session, estimated - target)
            # ...
```

### 6.2 整合边界选择

#### DeepReader

```typescript
pickConsolidationBoundary(
  messages: ChatMessage[],
  lastConsolidated: number,
  tokensToRemove: number
): number | null {
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
```

#### nanobot

```python
def pick_consolidation_boundary(self, session, tokens_to_remove):
    # 相同算法：在用户消息边界切割
    for idx in range(start, len(session.messages)):
        msg = session.messages[idx]
        if idx > start and msg.get("role") == "user":
            last_boundary = idx
            if removed_tokens >= tokens_to_remove:
                return (last_boundary, removed_tokens)
        removed_tokens += self.estimate_tokens([msg])
```

**结论**: ✅ **算法完全一致**，都在用户消息边界切割。

### 6.3 整合结果存储

| 特性 | DeepReader | nanobot | 一致性 |
|------|------------|---------|--------|
| **HISTORY.md** | ✅ 时间线日志 | ✅ 时间线日志 | ✅ 相同 |
| **MEMORY.md** | ✅ 长期记忆 | ✅ 长期记忆 | ✅ 相同 |
| **LLM 工具** | `save_memory` | `save_memory` | ✅ 相同 |
| **自动触发** | ✅ 异步执行 | ✅ 异步执行 | ✅ 相同 |

---

## 七、子代理系统对比

### 7.1 架构设计

#### DeepReader

```typescript
class SubagentManager {
  private runningTasks: Map<string, Promise<void>> = new Map();
  private taskInfo: Map<string, SubagentTask> = new Map();
  private sessionTasks: Map<string, Set<string>> = new Map();

  spawn(description: string, label?: string, sessionId?: string): string {
    const taskId = uuidv4().slice(0, 8);
    const abortController = new AbortController();
    
    const task: SubagentTask = {
      taskId, description, label, status: 'running',
      createdAt: Date.now(), sessionId, abortController,
    };
    
    // 启动异步任务
    const promise = this.runSubagent(taskId, description, abortController.signal);
    this.runningTasks.set(taskId, promise);
    
    return taskId;
  }

  private async runSubagent(taskId: string, description: string, abortSignal: AbortSignal): Promise<void> {
    // 受限工具集
    const tools = this.getAllowedTools();
    
    // 运行 Agent 循环
    const result = await runAgentLoop(this.client, messages, tools, ...);
    
    // 更新任务状态
    task.status = 'completed';
    task.result = result;
  }
}
```

#### nanobot

```python
class SubagentManager:
    def __init__(self, provider, workspace, bus, model, ...):
        self._running_tasks: dict[str, asyncio.Task[None]] = {}
        self._session_tasks: dict[str, set[str]] = {}

    async def spawn(self, task: str, label: str | None = None, ...) -> str:
        task_id = str(uuid.uuid4())[:8]
        
        bg_task = asyncio.create_task(
            self._run_subagent(task_id, task, display_label, origin)
        )
        self._running_tasks[task_id] = bg_task
        
        return f"Subagent [{display_label}] started (id: {task_id})"

    async def _run_subagent(self, task_id: str, task: str, label: str, origin: dict) -> None:
        # 受限工具集（无 message/spawn 工具）
        tools = ToolRegistry()
        tools.register(ReadFileTool(...))
        # ...
        
        # 运行 Agent 循环
        response = await self.provider.chat_with_retry(messages, tools, ...)
        
        # 通过消息总线通知主代理
        await self._announce_result(task_id, label, task, final_result, origin, "ok")
```

### 7.2 关键差异

| 特性 | DeepReader | nanobot | 评估 |
|------|------------|---------|------|
| **取消机制** | ✅ AbortController | ✅ asyncio.Task.cancel | 两者相当 |
| **结果通知** | ⚠️ 回调函数 | ✅ 消息总线 | nanobot 更解耦 |
| **工具限制** | ✅ 白名单 | ✅ 独立注册表 | 两者相当 |
| **超时控制** | ✅ 60 秒 | ⚠️ 未明确 | DeepReader 更健壮 |
| **会话隔离** | ✅ 按 sessionId | ✅ 按 session_key | 两者相当 |
| **等待结果** | ✅ `waitFor()` | ✅ `wait_for()` | 两者相当 |

**结论**: 两者设计相似，nanobot 的消息总线通知机制更优雅，DeepReader 的超时控制更明确。

---

## 八、DeepReader 需要改进的要点

基于对比分析，DeepReader 需要在以下方面改进：

### 8.1 高优先级

1. **实际使用 `last_consolidated` 裁剪历史**
   ```typescript
   // 当前：加载完整历史
   const messages = cache?.messages || [];
   
   // 应该：只加载未整合的消息
   const messages = cache.messages.slice(cache.lastConsolidated || 0);
   ```

2. **限制消息历史长度**
   ```typescript
   const MAX_HISTORY_MESSAGES = 500;
   const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);
   ```

3. **对齐到用户消息边界**
   ```typescript
   // 确保历史从 user 消息开始
   const firstUserIndex = history.findIndex(m => m.role === 'user');
   const alignedHistory = firstUserIndex >= 0 ? history.slice(firstUserIndex) : history;
   ```

### 8.2 中优先级

4. **添加错误提示机制**
   ```typescript
   // 工具执行错误后自动附加提示
   if (result.startsWith("Error")) {
     return result + "\n\n[Analyze the error above and try a different approach.]";
   }
   ```

5. **增加迭代限制灵活性**
   ```typescript
   // 根据任务复杂度动态调整
   const maxIterations = options.maxIterations || 
     (isComplexTask ? 20 : 10);
   ```

### 8.3 低优先级

6. **考虑多模态支持**（如果需要）
7. **考虑 MCP 协议支持**（如果需要）
8. **优化会话存储格式**（JSON → JSONL）

---

## 九、总结

### 架构一致性：90%

DeepReader 和 nanobot 在核心架构上高度一致：
- ✅ 相同的 ReAct + Tools 模式
- ✅ 相同的 4 层系统提示设计
- ✅ 相同的运行时上下文注入策略
- ✅ 相同的记忆整合机制
- ✅ 相同的子代理设计

### DeepReader 优势

1. **流式输出原生支持** - 更好的用户体验
2. **工具超时保护** - 更健壮的执行
3. **性能报告详细** - 更好的可观测性
4. **PDF 专用工具** - 更专业的阅读场景

### nanobot 优势

1. **会话历史管理更成熟** - 实际使用 `last_consolidated`
2. **消息总线通知** - 更解耦的子代理结果通知
3. **多模态支持** - 图片输入支持
4. **MCP 协议** - 外部工具扩展能力
5. **通用文件工具** - 更广泛的适用场景

### 建议

**DeepReader 应该**：
1. 修复 `last_consolidated` 的实际使用（高优先级）
2. 保持流式输出和性能报告优势
3. 考虑引入消息总线机制改进子代理通知
4. 专注 PDF/阅读场景，不盲目追求通用性

**两者可以互相学习**：
- DeepReader → nanobot: 流式输出、工具超时、性能报告
- nanobot → DeepReader: 会话历史裁剪、消息总线、多模态

---

*此分析基于 2026-03-13 的代码状态。*
