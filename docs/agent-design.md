# DeepReader Agent 设计文档

> **版本**: v1.0  
> **最后更新**: 2026-03-19  
> **状态**: 生产就绪

---

## 目录

1. [概述](#1-概述)
2. [整体架构](#2-整体架构)
3. [认知状态机](#3-认知状态机)
4. [工具系统](#4-工具系统)
5. [记忆系统](#5-记忆系统)
6. [会话管理](#6-会话管理)
7. [上下文构建](#7-上下文构建)
8. [意图路由器](#8-意图路由器)
9. [数据流](#9-数据流)
10. [调试日志系统](#10-调试日志系统)
11. [关键设计决策](#11-关键设计决策)

---

## 1. 概述

### 1.1 定位

DeepReader Agent 是一个运行在 Obsidian 中的智能阅读助手，基于艾德勒《如何阅读一本书》的分层阅读方法论设计。

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| **认知状态机** | 替代传统 ReAct 循环，基于阅读方法论的状态流转 |
| **本地优先** | 核心工具直接操作 Obsidian Vault，零外部依赖 |
| **双层记忆** | 长期记忆 (MEMORY.md) + 会话存储 (JSONL) |
| **范围锁定** | 物理限制 LLM 只能访问锁定章节内的内容 |
| **拟人化进度** | 将技术状态转换为用户友好的提示 |

### 1.3 技术栈

- **语言**: TypeScript
- **运行环境**: Obsidian Plugin
- **LLM 协议**: OpenAI 兼容 API（支持 DeepSeek、Kimi 等）
- **测试框架**: Vitest

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FrontendAgent                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         入口层 (index.ts)                             │   │
│  │  - initialize()                                                       │   │
│  │  - chat() / continueChat()                                            │   │
│  │  - getSystemPromptAsync()                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│          ┌───────────────────────────┼───────────────────────────┐         │
│          ▼                           ▼                           ▼         │
│  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐   │
│  │ CognitiveEngine│          │ ContextBuilder │          │  MemoryStore  │   │
│  │   (状态机)     │          │  (提示构建)    │          │  (记忆存储)   │   │
│  └───────────────┘          └───────────────┘          └───────────────┘   │
│          │                           │                           │         │
│          ▼                           ▼                           ▼         │
│  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐   │
│  │ ToolRegistry  │          │ SessionStore  │          │  LLMClient    │   │
│  │  (工具注册)   │          │  (会话存储)   │          │  (LLM 调用)   │   │
│  └───────────────┘          └───────────────┘          └───────────────┘   │
│                                      │                                       │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │
                                       ▼
                          ┌───────────────────────┐
                          │    Obsidian Vault     │
                          │  - DeepReader/*.md    │
                          │  - MEMORY.md          │
                          │  - HISTORY.md         │
                          └───────────────────────┘
```

### 2.1 核心模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **FrontendAgent** | `index.ts` | 统一入口，协调各子系统 |
| **CognitiveEngine** | `cognitive-engine/` | 状态机编排，阅读流程控制 |
| **ToolRegistry** | `tools/index.ts` | 工具注册与执行 |
| **ContextBuilder** | `context/builder.ts` | 系统提示构建 |
| **MemoryStore** | `memory/store.ts` | 长期记忆读写 |
| **SessionStore** | `session/store.ts` | 会话持久化 |
| **IntentRouter** | `router/intent-router.ts` | 意图识别与工具过滤 |
| **LLMClient** | `llm-client.ts` | LLM API 调用封装 |

---

## 3. 认知状态机

### 3.1 设计理念

基于艾德勒《如何阅读一本书》的分层阅读法，将 Agent 的执行流程建模为确定性的状态机，而非传统的 ReAct 循环。

**核心优势**：
- **可预测性**：状态流转明确，便于调试和监控
- **方法论对齐**：每个状态对应阅读方法论的一个阶段
- **工具隔离**：不同状态只能访问特定工具，防止越界

### 3.2 状态定义

```
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────┐
│  S0     │    │     S1       │    │     S2      │    │    S4     │
│ Router  │───▶│ Inspectional │───▶│ Analytical  │───▶│ Formatter │
│         │    │              │    │             │    │           │
│ 意图检测 │    │ 范围锁定     │    │ 深度分析    │    │ 格式化输出 │
│ 查询重写 │    │ (get_outline)│    │ (search_doc)│    │           │
└─────────┘    └──────────────┘    └─────────────┘    └───────────┘
     │
     │ depth=0
     ▼
┌───────────┐
│  直接跳到  │
│  S4       │
└───────────┘
```

| 状态 | 名称 | 模型 | 工具 | 职责 |
|------|------|------|------|------|
| **S0** | Router | fast | 无 | 意图检测、查询重写、深度判断 |
| **S1** | Inspectional | fast | `get_document_outline` | 获取目录、锁定章节范围 |
| **S2** | Analytical | main | `search_markdown_text`, `read_markdown_section` | 深度分析、提取论点 |
| **S3** | Syntopical | main | `search_read_books` | 跨书主题阅读（暂未实现） |
| **S4** | Formatter | main | 无 | 格式化输出、生成双链 |

### 3.3 阅读深度 (ReadingDepth)

```typescript
type ReadingDepth = 0 | 1 | 2 | 3;
```

| 深度 | 名称 | 触发条件 | 执行流程 |
|------|------|----------|----------|
| **0** | 日常闲聊 | 打招呼、系统指令 | S0 → S4 |
| **1** | 检视阅读 | 询问大纲、宏观框架 | S0 → S1 → S4 |
| **2** | 分析阅读 | 探究概念、逻辑推演 | S0 → S1 → S2 → S4 |
| **3** | 主题阅读 | 跨书对比、批判评价 | S0 → S1 → S2 → S3 → S4（降级为 2） |

### 3.4 状态实现

#### S0: Router

```typescript
// frontend/src/agent/cognitive-engine/states/router.ts
export class RouterState extends StateNode {
  readonly name = 'Router';
  readonly model = 'fast';
  readonly tools = []; // 无工具

  async execute(ctx: SharedContext): Promise<void> {
    // 1. 调用 LLM 进行意图识别
    const response = await runStateLoop(ctx.llmClient, ...);
    
    // 2. 解析输出
    const parsed = parseStateOutput(response.content, RouterOutputSchema);
    ctx.depth = parsed.depth;
    ctx.standaloneQuery = parsed.standalone_query;
  }
}
```

**输出 Schema**:
```json
{
  "depth": 2,
  "standalone_query": "作者是如何定义MECE原则的？",
  "reason": "探究特定概念定义"
}
```

#### S1: Inspectional

```typescript
// frontend/src/agent/cognitive-engine/states/inspectional.ts
export class InspectionalState extends StateNode {
  readonly name = 'Inspectional';
  readonly model = 'fast';
  readonly tools = ['get_document_outline']; // 只有目录工具！
}
```

**关键约束**：S1 只能看到 `get_document_outline`，物理剥夺搜索能力。

**输出**:
```json
{
  "scopeNodeIds": ["0004", "0005"],
  "tocSummary": "第一、二章讨论MECE原则的定义与应用"
}
```

#### S2: Analytical

```typescript
// frontend/src/agent/cognitive-engine/states/analytical.ts
export class AnalyticalState extends StateNode {
  readonly name = 'Analytical';
  readonly model = 'main';
  readonly tools = ['search_markdown_text', 'read_markdown_section'];
}
```

**范围锁定机制**：
```typescript
// 创建拦截器，物理限制搜索范围
const interceptor = createScopeInterceptor(ctx.scopeNodeIds);

// 拦截器会自动注入 scopeNodeIds 参数
const response = await runStateLoop(..., { toolInterceptor: interceptor });
```

#### S4: Formatter

```typescript
// frontend/src/agent/cognitive-engine/states/formatter.ts
export class FormatterState extends StateNode {
  readonly name = 'Formatter';
  readonly model = 'main';
  readonly tools = []; // 无工具，纯格式化
}
```

**职责**：
- 将原始分析结果转换为 Obsidian 格式
- 生成 `[[书籍名#^block_id|显示文本]]` 双链
- 流式输出到前端

### 3.5 SharedContext

状态间共享的上下文对象：

```typescript
interface SharedContext {
  // ===== 聊天历史 =====
  chatHistory: ChatMessage[];
  rawUserQuery: string;

  // ===== S0 输出 =====
  depth: ReadingDepth;
  detectedIntents: string[];
  standaloneQuery?: string;

  // ===== S1 输出 =====
  scopeNodeIds?: string[];      // 锁定的章节范围
  tocSummary?: string;          // 目录摘要

  // ===== S2 输出 =====
  rawResults?: RawToolResult[]; // 原始搜索结果
  analysisResult?: string;      // 分析结论

  // ===== 引擎依赖 =====
  llmClient?: LLMClient;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;

  // ===== 状态追踪 =====
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;
}
```

---

## 4. 工具系统

### 4.1 工具分类

```
┌─────────────────────────────────────────────────────────────────┐
│                        ToolRegistry                              │
├─────────────────────────────────────────────────────────────────┤
│  本地工具 (零外部依赖)                                            │
│  ├─ get_document_outline    获取文档大纲                         │
│  ├─ search_markdown_text    本地文本搜索                         │
│  └─ read_markdown_section   读取章节内容                         │
├─────────────────────────────────────────────────────────────────┤
│  后端工具 (需要 API)                                              │
│  ├─ search_doc              后端语义搜索                         │
│  └─ search_read_books       跨书搜索                             │
├─────────────────────────────────────────────────────────────────┤
│  写入工具                                                        │
│  ├─ write_note              写入 Obsidian 笔记                   │
│  ├─ canvas                  创建 Canvas 文件                     │
│  └─ excalidraw              创建 Excalidraw 图表                 │
├─────────────────────────────────────────────────────────────────┤
│  记忆工具                                                        │
│  ├─ add_memory              添加记忆条目                         │
│  ├─ search_memory           搜索记忆                             │
│  └─ update_profile          更新用户画像                         │
├─────────────────────────────────────────────────────────────────┤
│  子代理工具                                                      │
│  ├─ create_sub_agent        创建子代理                           │
│  └─ check_sub_agent         检查子代理状态                       │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 本地 Markdown 工具

#### get_document_outline

**用途**：获取书籍目录大纲，用于检视阅读阶段。

**参数**：
```typescript
interface GetOutlineArgs {
  max_depth?: number;  // 限制层级深度
}
```

**返回**：
```json
{
  "status": "SUCCESS",
  "book_title": "如何阅读一本书",
  "total_chapters": 12,
  "outline": [
    {
      "heading": "第一篇 阅读的层次",
      "line": 1,
      "summary": "本章探讨...",
      "children": []
    }
  ]
}
```

#### search_markdown_text

**用途**：本地文本搜索，AND 逻辑，带摩擦力机制。

**参数**：
```typescript
interface SearchArgs {
  keywords: string[];    // 关键词数组（AND 逻辑）
  use_regex?: boolean;   // 是否启用正则
}
```

**摩擦力机制**：
- 命中超过 10 处返回 `ERROR_TOO_BROAD`
- 强迫 Agent 使用更精准的关键词

**返回**：
```json
{
  "status": "SUCCESS",
  "hits": [
    {
      "location": {
        "heading": "MECE原则",
        "path": ["第一篇", "第一章", "MECE原则"],
        "file_path": "DeepReader/书名/08-MECE原则.md"
      },
      "line_number": 42,
      "snippet": "MECE 原则是...",
      "block_id": "^ch2-p42"
    }
  ]
}
```

#### read_markdown_section

**用途**：读取完整章节内容，带防爆阀机制。

**参数**：
```typescript
interface ReadSectionArgs {
  heading?: string;    // 标题名称（包含匹配）
  block_id?: string;   // 块引用 ID
}
```

**防爆阀机制**：
- Token 上限：4000 tokens
- 超限返回截断内容 + 子标题列表

**返回**：
```json
{
  "status": "SUCCESS_FULL_SECTION",
  "heading": "MECE原则",
  "word_count": 2500,
  "token_estimate": 1250,
  "content": "# MECE原则\n\n..."
}
```

### 4.3 工具执行器接口

```typescript
interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}
```

### 4.4 工具拦截器

用于物理限制工具行为：

```typescript
type ToolInterceptor = (
  toolName: string,
  toolArgs: Record<string, unknown>
) => Record<string, unknown>;

// 示例：范围锁定拦截器
function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor {
  return (toolName, toolArgs) => {
    if (toolName === 'search_markdown_text') {
      return { ...toolArgs, scopeNodeIds };
    }
    return toolArgs;
  };
}
```

---

## 5. 记忆系统

### 5.1 双层记忆架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        记忆系统架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────┐         ┌─────────────────┐              │
│   │   MEMORY.md     │         │   HISTORY.md    │              │
│   │   (长期记忆)     │         │   (阅读历程)    │              │
│   │                 │         │                 │              │
│   │  - 用户画像     │         │  - 里程碑日志   │              │
│   │  - 阅读偏好     │         │  - 最近 30 天   │              │
│   │  - 兴趣主题     │         │  - 自动归档     │              │
│   └─────────────────┘         └─────────────────┘              │
│           │                           │                         │
│           │ 读取                      │ 追加                    │
│           ▼                           ▼                         │
│   ┌─────────────────────────────────────────────────┐          │
│   │              MemoryStore                         │          │
│   │  - readLongTermMemory()                          │          │
│   │  - writeLongTermMemory()                         │          │
│   │  - appendHistory()                               │          │
│   │  - getMemoryContext() → 注入 System Prompt       │          │
│   └─────────────────────────────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 MEMORY.md 结构

```markdown
# 长期记忆

## 用户画像

- 职业：产品经理
- 阅读目标：提升逻辑思维能力

## 阅读偏好

- 偏好深度分析而非快速浏览
- 喜欢带具体案例的说明

## 兴趣主题

- MECE 原则
- 金字塔原理
- 批判性思维
```

### 5.3 记忆压缩

当 MEMORY.md 超过 8000 字符时，自动触发 LLM 压缩：

```typescript
// 检查是否需要压缩
async needsCompression(): Promise<boolean> {
  const content = await this.readLongTermMemory();
  return content && content.length > MemoryStore.MAX_MEMORY_CHARS;
}

// LLM 压缩
private async compressMemoryWithLLM(currentMemory: string): Promise<string | null> {
  const prompt = `激进压缩以下长期记忆，目标：100 行以内，8000 字符以内。
  
## 压缩规则
1. 合并重复概念
2. 删除临时状态
3. 极简表达
4. 保持结构

${currentMemory}`;

  return await this.llmClient.chat([...], []);
}
```

### 5.4 记忆工具

| 工具 | 用途 | 触发时机 |
|------|------|----------|
| `add_memory` | 添加记忆条目 | 用户主动要求或 Agent 判断重要 |
| `search_memory` | 搜索记忆 | Agent 需要回忆用户偏好 |
| `update_profile` | 更新用户画像 | 用户透露个人信息 |

---

## 6. 会话管理

### 6.1 JSONL 存储格式

```
.obsidian/plugins/deepreader/sessions/
├── index.json           # 会话索引
├── session_abc123.jsonl # 会话文件
└── session_def456.jsonl
```

**JSONL 文件结构**：
```
{"_type":"metadata","sessionId":"abc123","indexId":"idx_001","createdAt":"2026-03-19T10:00:00Z"}
{"role":"user","content":"什么是MECE？","timestamp":"2026-03-19 10:01:00"}
{"role":"assistant","content":"MECE 是...","timestamp":"2026-03-19 10:01:05"}
```

### 6.2 SessionStore API

```typescript
class SessionStore {
  // 创建会话
  async create(sessionId: string, indexId: string): Promise<Session>;
  
  // 获取会话（懒加载 + LRU 缓存）
  async get(sessionId: string): Promise<Session | null>;
  
  // 追加消息（高效追加写入）
  async appendMessage(sessionId: string, message: ChatMessage): Promise<void>;
  
  // 获取 LLM 历史格式（自动剥离 system_note）
  async getLLMHistory(sessionId: string): Promise<ChatMessage[]>;
  
  // 查找会话
  async findSessionByIndexId(indexId: string): Promise<SessionMeta | null>;
}
```

### 6.3 会话与记忆的关系

```
┌─────────────────────────────────────────────────────────────────┐
│                      对话生命周期                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   用户消息 ──▶ SessionStore.appendMessage() ──▶ JSONL 文件      │
│                     │                                            │
│                     │ Token 超过阈值                             │
│                     ▼                                            │
│              记忆整合 (LLM)                                       │
│                     │                                            │
│          ┌─────────┴─────────┐                                   │
│          ▼                   ▼                                   │
│   MEMORY.md 更新       HISTORY.md 追加                           │
│   (长期记忆)            (里程碑日志)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. 上下文构建

### 7.1 四层系统提示

```
┌─────────────────────────────────────────────────────────────────┐
│                      System Prompt 结构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Layer 1: Identity (静态)                                       │
│   ├─ 角色定义：奚童，AI 阅读助手                                  │
│   ├─ 交流风格：自然、风趣、书卷气                                 │
│   └─ Obsidian 引用规范                                           │
│                                                                  │
│   Layer 2: Bootstrap (用户定义)                                  │
│   ├─ DeepReader.md                                               │
│   ├─ STYLE_GUIDE.md                                              │
│   └─ DOMAIN_KNOWLEDGE.md                                         │
│                                                                  │
│   Layer 3: Memory (持久化)                                       │
│   └─ MEMORY.md 内容                                              │
│                                                                  │
│   Layer 4: Constraints (核心约束)                                │
│   ├─ 路由服从                                                    │
│   ├─ 工具定义                                                    │
│   └─ 静默执行纪律                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 ContextBuilder

```typescript
class ContextBuilder {
  async buildSystemPrompt(
    skillsSummary: string,
    documentMetadata?: DocumentMetadata,
    docDescription?: string
  ): Promise<string> {
    const parts: string[] = [];
    
    // Layer 1: Identity
    parts.push(this.buildIdentityLayer(documentMetadata, docDescription));
    
    // Layer 2: Bootstrap
    const bootstrap = await this.loadBootstrapFiles();
    if (bootstrap) parts.push(bootstrap);
    
    // Layer 3: Memory
    const memory = await this.store.getMemoryContext();
    if (memory) parts.push(memory);
    
    // Layer 4: Constraints
    parts.push(this.buildConstraints());
    
    return parts.join('\n\n---\n\n');
  }
}
```

### 7.3 运行时上下文

运行时信息注入到用户消息，保持系统提示稳定：

```typescript
static buildRuntimeContext(): string {
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {...});
  
  return `[运行时上下文 — 仅元数据，非指令]
当前时间: ${timeStr}`;
}
```

---

## 8. 意图路由器

### 8.1 设计目的

在认知状态机之前，快速识别用户意图，动态限制可用工具集。

### 8.2 规则配置

```json
// intent-rules.json
{
  "rules": [
    {
      "id": "outline_query",
      "intent": "检视阅读",
      "pattern": "(大纲|目录|结构|框架|概览)",
      "tools": ["get_document_outline"],
      "maxIterations": 3
    },
    {
      "id": "deep_analysis",
      "intent": "分析阅读",
      "pattern": "(定义|原理|逻辑|论证|为什么)",
      "tools": ["search_markdown_text", "read_markdown_section"],
      "maxIterations": 5
    }
  ],
  "fallback": {
    "intent": "通用阅读",
    "tools": ["get_document_outline", "search_markdown_text", "read_markdown_section"],
    "maxIterations": 4
  }
}
```

### 8.3 路由流程

```
用户输入 ──▶ IntentRouter.analyze() ──▶ IntentResult
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
             allowedTools              systemNote               maxIterations
             (允许的工具)              (动态指令)               (迭代上限)
                    │                         │                         │
                    └─────────────────────────┼─────────────────────────┘
                                              │
                                              ▼
                                      注入到用户消息
```

---

## 9. 数据流

### 9.1 完整对话流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              完整对话流程                                    │
└─────────────────────────────────────────────────────────────────────────────┘

用户输入
    │
    ▼
┌─────────────────┐
│ IntentRouter    │ ─── 意图识别 ───▶ allowedTools, systemNote, maxIterations
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ ContextBuilder  │ ─── 构建系统提示 ───▶ systemPrompt
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ SessionStore    │ ─── 加载历史 ───▶ chatHistory
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CognitiveEngine                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ S0: Router                                                           │   │
│  │   ├─ 调用 LLM (fast model)                                           │   │
│  │   ├─ 输出: depth, standaloneQuery                                    │   │
│  │   └─ 无工具                                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼ depth=1/2/3                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ S1: Inspectional                                                     │   │
│  │   ├─ 调用 LLM (fast model)                                           │   │
│  │   ├─ 工具: get_document_outline                                      │   │
│  │   └─ 输出: scopeNodeIds, tocSummary                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼ depth=2/3                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ S2: Analytical                                                       │   │
│  │   ├─ 调用 LLM (main model)                                           │   │
│  │   ├─ 工具: search_markdown_text, read_markdown_section               │   │
│  │   ├─ 拦截器: scopeNodeIds 物理锁定                                    │   │
│  │   └─ 输出: rawResults, analysisResult                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ S4: Formatter                                                        │   │
│  │   ├─ 调用 LLM (main model)                                           │   │
│  │   ├─ 无工具                                                          │   │
│  │   ├─ 流式输出 ───▶ onContent 回调                                    │   │
│  │   └─ 输出: 格式化的 Obsidian 笔记                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│ SessionStore    │ ─── 保存消息 ───▶ JSONL 文件
└─────────────────┘
    │
    ▼
输出到用户
```

### 9.2 工具调用流程

```
LLM 返回 tool_calls
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        工具执行流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   tool_calls ──▶ ToolInterceptor ──▶ 修改后的参数               │
│                       │                                          │
│                       ▼                                          │
│               ┌─────────────────┐                                │
│               │ ToolRegistry    │                                │
│               │   .get(name)    │                                │
│               └─────────────────┘                                │
│                       │                                          │
│                       ▼                                          │
│               ┌─────────────────┐                                │
│               │ ToolExecutor    │                                │
│               │   .execute()    │                                │
│               └─────────────────┘                                │
│                       │                                          │
│                       ▼                                          │
│               工具结果 (JSON string)                              │
│                       │                                          │
│                       ▼                                          │
│               压缩 (MAX_TOOL_RESULT_LENGTH)                       │
│                       │                                          │
│                       ▼                                          │
│               添加到消息历史 (role: 'tool')                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. 调试日志系统

### 10.1 概述

调试日志系统记录完整的 Agent 执行过程，帮助开发者理解和调试 Agent 行为。

**核心功能**：
- 意图路由决策追踪
- 认知状态机流转记录
- LLM 交互详情（请求/响应/Token）
- 工具调用与拦截器行为
- 会话统计与摘要

### 10.2 日志输出结构

```
debug-logs/
└── 2026-03-19_14-30-00/           # 会话目录（时间戳）
    ├── 00-summary.md              # 总览摘要
    ├── 01-router.md               # S0 路由状态详情
    ├── 02-inspectional.md         # S1 检视状态详情
    ├── 03-analytical.md           # S2 分析状态详情
    ├── 04-formatter.md            # S4 格式化状态详情
    └── session.json               # 完整 JSON 数据
```

### 10.3 核心类型

```typescript
// 会话日志
interface AgentSessionLog {
  sessionId: string;
  startTime: string;
  endTime?: string;
  userQuery: string;
  bookName: string;
  indexId: string;
  intentRouting?: IntentRoutingLog;
  stateExecutions: StateExecutionLog[];
  stats: SessionStats;
  files: string[];
}

// 状态执行日志
interface StateExecutionLog {
  stateName: string;
  iteration: number;
  startTime: string;
  duration: number;
  input: StateInputLog;
  output: StateOutputLog;
  llmInteractions: LLMInteractionLog[];
  toolCalls: ToolCallLog[];
  stats: StateStats;
}

// LLM 交互日志
interface LLMInteractionLog {
  index: number;
  duration: number;
  request: LLMRequestDetail;
  response: LLMResponseDetail;
}

// 工具调用日志
interface ToolCallLog {
  callId: string;
  toolName: string;
  duration: number;
  originalArgs: Record<string, unknown>;
  interceptedArgs?: Record<string, unknown>;
  interceptorNote?: string;
  status: 'success' | 'error';
  result?: string;
  error?: string;
}
```

### 10.4 使用方式

```typescript
import { initDebugLogger, getDebugLogger } from './debug';

// 初始化（在插件加载时）
initDebugLogger(app, { enabled: true, logDir: 'debug-logs' });

// 获取日志实例
const logger = getDebugLogger();

// 会话生命周期
await logger.startSession(userQuery, bookName, indexId);
// ... Agent 执行 ...
await logger.endSession();

// 意图路由
logger.logIntentRouting({
  detectedIntents: ['search', 'analyze'],
  allowedTools: ['search_markdown_text'],
  maxIterations: 5,
  duration: 10,
});

// 状态执行
logger.startStateExecution('Analytical', { query, availableTools });
// ... 状态执行 ...
logger.endStateExecution({ scopeNodeIds, finishReason: 'stop' });

// LLM 交互
logger.startLLMInteraction({ model, modelType, systemPrompt, userMessage });
// ... LLM 调用 ...
logger.endLLMInteraction({ finishReason, content, inputTokens, outputTokens });

// 工具调用
logger.logToolCall({
  callId,
  toolName,
  originalArgs,
  interceptedArgs,
  interceptorNote,
  status,
  result,
  duration,
});
```

### 10.5 控制台输出示例

```
[DebugLogger] 📁 开始调试会话: debug-logs/2026-03-19T14-30-00
[DebugLogger] ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[DebugLogger] ┃ 🔄 状态 1: Router
[DebugLogger] ┃    输入: 什么是MECE？
[DebugLogger] ┃    工具: get_document_outline
[DebugLogger]    🤖 LLM 调用 #1 (fast)
[DebugLogger]    🤖 LLM 响应: stop | 0.5s | 120+45 tokens
[DebugLogger] ┃ ✅ 完成: 0.5s
[DebugLogger] ┃    深度: 2
[DebugLogger] ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[DebugLogger] ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[DebugLogger] ┃ 🔄 状态 2: Analytical
[DebugLogger] ┃    输入: MECE的定义是什么？
[DebugLogger] ┃    工具: search_markdown_text, read_markdown_section
[DebugLogger] ┃    范围: node_c4, node_c5
[DebugLogger]    🤖 LLM 调用 #1 (main)
[DebugLogger]    🤖 LLM 响应: tool_calls | 1.2s | 250+80 tokens
[DebugLogger]       工具请求: search_markdown_text
[DebugLogger]    🔧 ✅ search_markdown_text (0.1s) [success] 3 hits | 拦截: scopeNodeIds 注入
[DebugLogger]    🤖 LLM 调用 #2 (main)
[DebugLogger]    🤖 LLM 响应: stop | 0.8s | 500+200 tokens
[DebugLogger] ┃ ✅ 完成: 2.1s
[DebugLogger] ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[DebugLogger] 📝 写入: 00-summary.md
[DebugLogger] 📝 写入: session.json
[DebugLogger] 📝 写入: 01-router.md
[DebugLogger] 📝 写入: 02-analytical.md
[DebugLogger] ✅ 调试会话结束: debug-logs/2026-03-19T14-30-00
```

### 10.6 摘要文件格式

```markdown
# 🤖 Agent 执行日志

> **会话 ID**: 2026-03-19T14-30-00
> **时间**: 2026/3/19 14:30:00
> **书籍**: 麦肯锡方法
> **问题**: 什么是MECE？

---

## 📊 状态流转

```
用户输入
   │
   ▼
🔍 Router (0.5s)
   ▼
🔬 Analytical (2.1s)
   │
   ▼
💬 输出回复
```

---

## 🎯 意图路由

| 字段 | 值 |
|------|-----|
| 检测意图 | search, analyze |
| 允许工具 | search_markdown_text, read_markdown_section |
| 最大迭代 | 5 |

---

## 📈 统计

| 指标 | 值 |
|------|-----|
| 总耗时 | 2.6s |
| 状态数 | 2 |
| LLM 调用 | 3 次 (2.5s) |
| 工具调用 | 1 次 (0.1s) |
| Token 使用 | 870 + 325 = 1195 |

### 🛠️ 工具调用分布

| 工具 | 调用次数 | 总耗时 |
|------|----------|--------|
| search_markdown_text | 1 | 0.1s |

---

## 📁 详细日志

- [01-router.md](./01-router.md)
- [02-analytical.md](./02-analytical.md)
```

### 10.7 设计原则

1. **零侵入**：日志代码不影响正常执行流程
2. **可开关**：通过 `DEBUG_LOG_ENABLED` 常量控制
3. **结构化**：同时输出 Markdown（人类可读）和 JSON（机器可解析）
4. **完整追踪**：记录从意图路由到最终输出的完整链路
5. **拦截可见**：明确记录工具拦截器的行为

---

## 11. 关键设计决策

### 11.1 为什么用状态机而非 ReAct？

| 维度 | ReAct 循环 | 认知状态机 |
|------|-----------|-----------|
| **可预测性** | 不确定，可能无限循环 | 确定性流转，最多 5 个状态 |
| **方法论对齐** | 无明确对应 | 每个状态对应阅读阶段 |
| **工具隔离** | 所有工具可见 | 每个状态只能访问特定工具 |
| **调试难度** | 高（需追踪多轮循环） | 低（状态边界清晰） |

### 11.2 为什么本地工具优先？

| 维度 | 后端工具 | 本地工具 |
|------|----------|----------|
| **延迟** | 网络请求 ~500ms | 本地读取 ~10ms |
| **依赖** | 需要后端服务 | 零外部依赖 |
| **离线** | 不可用 | 完全可用 |
| **数据隐私** | 数据传输到后端 | 数据留在本地 |

### 11.3 为什么需要范围锁定？

**问题**：LLM 可能"越界"搜索，访问与问题无关的章节。

**解决方案**：Scope Interceptor 物理拦截工具调用，注入 `scopeNodeIds` 参数。

```typescript
// S1 锁定范围
ctx.scopeNodeIds = ['0004', '0005'];

// S2 执行时，拦截器自动注入
const interceptor = createScopeInterceptor(ctx.scopeNodeIds);
// search_markdown_text 被调用时，自动添加 scopeNodeIds 参数
```

### 11.4 为什么需要记忆压缩？

**问题**：MEMORY.md 无限增长会导致：
- Token 消耗增加
- 系统提示过长
- LLM 注意力分散

**解决方案**：
- 阈值检测：超过 8000 字符触发压缩
- LLM 压缩：激进合并、删除临时状态
- 保持结构：用户画像/阅读偏好/兴趣主题

### 11.5 为什么用 JSONL 而非 JSON？

| 维度 | JSON | JSONL |
|------|------|-------|
| **追加写入** | 需要重写整个文件 | 只追加一行 |
| **读取效率** | 需要解析整个文件 | 可逐行解析 |
| **并发安全** | 需要锁机制 | 天然支持追加 |
| **损坏恢复** | 整个文件不可用 | 只丢失最后一行 |

---

## 附录

### A. 文件结构

```
frontend/src/agent/
├── index.ts                    # FrontendAgent 入口
├── types.ts                    # 核心类型定义
├── agent-loop.ts               # Agent 执行循环
├── llm-client.ts               # LLM API 客户端
├── cognitive-engine/           # 认知状态机
│   ├── index.ts
│   ├── engine.ts               # 主编排器
│   ├── types.ts
│   ├── context.ts              # SharedContext 实现
│   ├── states/                 # 状态节点
│   │   ├── router.ts           # S0
│   │   ├── inspectional.ts     # S1
│   │   ├── analytical.ts       # S2
│   │   ├── syntopical.ts       # S3 (deferred)
│   │   └── formatter.ts        # S4
│   ├── prompts/                # 状态提示词
│   │   ├── router-prompt.ts
│   │   ├── inspectional-prompt.ts
│   │   ├── analytical-prompt.ts
│   │   └── formatter-prompt.ts
│   └── interceptor/            # 工具拦截器
│       └── scope-interceptor.ts
├── tools/                      # 工具系统
│   ├── index.ts                # 注册表
│   ├── types.ts
│   ├── local/                  # 本地工具
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   ├── get-outline.ts
│   │   ├── search-text.ts
│   │   └── read-section.ts
│   ├── search-doc.ts           # 后端搜索
│   ├── search-read-books.ts    # 跨书搜索
│   ├── write-note.ts
│   ├── memory.ts
│   ├── canvas.ts
│   └── ...
├── context/                    # 上下文构建
│   ├── index.ts
│   ├── builder.ts
│   └── loader.ts
├── memory/                     # 记忆系统
│   ├── index.ts
│   ├── store.ts
│   ├── types.ts
│   └── consolidator.ts
├── session/                    # 会话管理
│   ├── index.ts
│   ├── store.ts
│   └── types.ts
├── router/                     # 意图路由
│   ├── index.ts
│   ├── intent-router.ts
│   └── types.ts
└── ui/                         # UI 适配器
    ├── humanized-adapter.ts
    └── humanized-types.ts
```

### B. 关键常量

```typescript
// Token 限制
const MAX_TOKENS = 4000;              // 章节读取上限
const MAX_CONTEXT_TOKENS = 20000;     // 消息历史上限
const MAX_TOOL_RESULT_LENGTH = 4000;  // 工具结果上限

// 记忆限制
const MAX_MEMORY_CHARS = 8000;        // MEMORY.md 上限
const MAX_MEMORY_LINES = 200;
const MAX_HISTORY_ENTRIES = 200;      // HISTORY.md 条目上限

// 会话限制
const MAX_CACHE_SIZE = 10;            // 会话缓存大小
const MAX_LLM_MESSAGES = 50;          // LLM 历史消息上限

// 迭代限制
const DEFAULT_MAX_ITERATIONS = 4;     // 默认迭代上限
```

### C. 错误处理

```typescript
// 状态错误
class StateParseError extends Error { ... }
class StateTimeoutError extends Error { ... }
class StateExecutionError extends Error { ... }

// 工具错误状态
type ToolErrorStatus = 
  | 'ERROR_NO_APP_CONTEXT'
  | 'ERROR_INVALID_PARAMS'
  | 'ERROR_NOT_FOUND'
  | 'ERROR_TOO_BROAD'
  | 'ERROR_MULTIPLE_MATCHES'
  | 'ERROR_FILE_READ_FAILED';
```

---

**文档维护者**: DeepReader Team  
**最后审核**: 2026-03-19