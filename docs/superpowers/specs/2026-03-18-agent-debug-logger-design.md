# Agent 调试日志系统设计

**日期**: 2026-03-18
**状态**: 待实现

## 1. 概述

为 FrontendAgent 添加详细的调试日志系统，完整记录 agent 工作过程，包括系统提示词、LLM 交互、工具调用、前后端通信等所有信息，便于开发调试和问题排查。

## 2. 需求确认

| 项目 | 选择 |
|------|------|
| 存储位置 | `frontend/debug-logs/` |
| 文件格式 | Markdown 主文件 + JSON 补充 |
| 触发方式 | 代码常量开关 `DEBUG_LOG_ENABLED` |
| 详细程度 | 完整记录，不截断 |
| 文件组织 | 每次提问创建目录，每个迭代单独文件 |
| 清理策略 | 保留全部，手动清理 |
| 调用信息 | 完整调用链（从入口到当前位置） |

## 3. 文件结构

```
frontend/
├── debug-logs/                          # 日志根目录 (加入 .gitignore)
│   └── 2026-03-18_14-30-25/             # 每次提问一个目录
│       ├── summary.md                    # 总览摘要
│       ├── iteration-1.md                # 迭代1详情
│       ├── iteration-1-messages.json     # 迭代1完整消息数据
│       ├── iteration-2.md
│       ├── iteration-2-messages.json
│       └── ...
├── src/agent/
│   └── debug/
│       └── logger.ts                     # DebugLogger 实现
```

## 4. 核心组件

### 4.1 DebugLogger 类

**文件**: `src/agent/debug/logger.ts`

```typescript
// 常量开关
const DEBUG_LOG_ENABLED = true;

class DebugLogger {
  // 会话管理
  startSession(userQuery: string): void;
  endSession(): void;

  // 迭代日志
  startIteration(iteration: number): void;
  endIteration(stats: IterationStats): void;

  // LLM 日志
  logLLMRequest(messages: ChatMessage[], tools: ToolDefinition[]): void;
  logLLMResponse(response: LLMResponse): void;
  logStreamChunk(chunk: string): void;

  // 工具日志
  logToolCall(toolName: string, args: any): void;
  logToolResult(toolName: string, result: any, duration: number): void;

  // 后端 API 日志
  logBackendRequest(url: string, method: string, body: any): void;
  logBackendResponse(url: string, status: number, body: any, duration: number): void;

  // 系统提示词
  logSystemPrompt(prompt: string): void;

  // 调用链
  getCallStack(): string;
}
```

### 4.2 调用栈获取

使用 `new Error().stack` 解析调用链，过滤 node_modules 和内部实现细节：

```typescript
function getCallStack(): string {
  const stack = new Error().stack?.split('\n') || [];
  // 过滤并格式化调用链
  return stack
    .filter(line => !line.includes('node_modules'))
    .filter(line => line.includes('.ts:'))
    .map(formatStackLine)
    .join('\n  → ');
}
```

## 5. 注入点

| 位置 | 记录内容 |
|------|----------|
| `FrontendAgent.chat()` | 会话开始/结束 |
| `AgentLoop.run()` | 迭代开始/结束 |
| `AgentLoop.executeIteration()` | 迭代详情 |
| `LLMClient.streamChat()` | 请求消息、响应数据 |
| `ToolRegistry.executeTool()` | 工具名、参数、执行时间 |
| `ContextBuilder.build()` | 系统提示词各层内容 |
| `deeppdfClient.*` | 后端 API 请求/响应 |

## 6. 日志格式

### 6.1 迭代日志 (iteration-N.md)

```markdown
# 迭代 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📍 调用链
```
index.ts:85 → chat()
  → agent-loop.ts:42 → run()
  → agent-loop.ts:145 → executeIteration()
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📥 发送给 LLM

### 系统提示词
**长度**: 4,521 字符

```
[完整系统提示词]
```

### 对话历史
**消息数**: 3 条

```json
[
  {"role": "user", "content": "你好"},
  {"role": "assistant", "content": "你好！有什么可以帮助你的？"},
  {"role": "user", "content": "这本书讲了什么？"}
]
```

### 发送的完整请求
**URL**: `https://api.deepseek.com/chat/completions`
**方法**: POST
**Headers**: `{ "Content-Type": "application/json", "Authorization": "Bearer sk-***" }`

```json
{
  "model": "deepseek-chat",
  "messages": [...],
  "tools": [...],
  "stream": true
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🤖 LLM 响应

📍 调用链:
```
llm-client.ts:120 → streamChat()
```

### 响应元数据
| 字段 | 值 |
|------|-----|
| 模型 | deepseek-chat |
| finish_reason | tool_calls |
| 输入 Token | 1,500 |
| 输出 Token | 280 |
| TTFB | 320ms |

### 流式输出内容
```
[LLM 生成的文本内容]
```

### 工具调用请求
| ID | 工具名 | 参数 |
|----|--------|------|
| `call_abc123` | search_doc | 见下方详情 |

```json
{
  "query": "这本书的主题",
  "topK": 5
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔧 工具执行: search_doc

📍 调用链:
```
agent-loop.ts:180 → executeTools()
  → tools/index.ts:45 → executeTool()
  → tools/search-doc.ts:32 → execute()
```

### 🌐 后端 API 请求

**URL**: `http://localhost:6088/api/query`
**方法**: POST
**Headers**: `{ "Content-Type": "application/json" }`

**请求体**:
```json
{
  "query": "这本书的主题",
  "index_id": "pdf_abc123",
  "top_k": 5,
  "use_llm_tree_search": true
}
```

### 🌐 后端 API 响应

**状态码**: 200 OK
**耗时**: 1.23s

**响应体**:
```json
{
  "status": "success",
  "results": [...],
  "thinking": "...",
  "fallback": false
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📊 迭代 1 统计

| 指标 | 值 |
|------|-----|
| 迭代耗时 | 2.5s |
| LLM 耗时 | 1.2s |
| 工具耗时 | 1.3s |
| Token 变化 | 1,500 → 3,200 (+1,700) |
| 工具调用数 | 1 |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 6.2 摘要日志 (summary.md)

```markdown
# Agent 调试日志

**时间**: 2026-03-18 14:30:25
**用户问题**: 这本书讲了什么？
**总迭代数**: 3
**总耗时**: 8.5s

---

## 📊 总体统计

| 指标 | 值 |
|------|-----|
| 总 Token 消耗 | 1,200 → 5,800 (+4,600) |
| LLM 总耗时 | 5.2s (61%) |
| 工具总耗时 | 3.3s (39%) |
| 工具调用总数 | 4 |

## 🔧 工具调用汇总

| 迭代 | 工具 | 耗时 |
|------|------|------|
| 1 | search_doc | 1.2s |
| 2 | get_toc | 0.8s |
| 2 | get_chapter | 1.1s |
| 3 | create_note | 0.9s |

## 📁 文件列表

- [iteration-1.md](./iteration-1.md) - 搜索文档
- [iteration-2.md](./iteration-2.md) - 获取目录和章节
- [iteration-3.md](./iteration-3.md) - 创建笔记
- [iteration-1-messages.json](./iteration-1-messages.json)
- [iteration-2-messages.json](./iteration-2-messages.json)
- [iteration-3-messages.json](./iteration-3-messages.json)
```

### 6.3 JSON 补充文件 (iteration-N-messages.json)

存储完整的结构化数据，便于程序分析：

```json
{
  "iteration": 1,
  "timestamp": "2026-03-18T14:30:25.123Z",
  "callStack": "...",
  "llmRequest": {
    "messages": [...],
    "tools": [...]
  },
  "llmResponse": {
    "content": "...",
    "toolCalls": [...],
    "finishReason": "tool_calls"
  },
  "toolExecutions": [
    {
      "name": "search_doc",
      "args": {...},
      "result": {...},
      "duration": 1230
    }
  ],
  "backendCalls": [
    {
      "url": "http://localhost:6088/api/query",
      "method": "POST",
      "request": {...},
      "response": {...},
      "duration": 1230
    }
  ]
}
```

## 7. .gitignore 更新

```
# Agent debug logs
frontend/debug-logs/
```

## 8. 实现步骤

1. 创建 `src/agent/debug/logger.ts` - DebugLogger 核心类
2. 在 `AgentLoop` 中注入日志记录
3. 在 `LLMClient` 中注入日志记录
4. 在 `ToolRegistry` 中注入日志记录
5. 在 `ContextBuilder` 中注入日志记录
6. 在 `deeppdfClient` 中注入日志记录
7. 更新 `.gitignore`
8. 测试验证
