# 意图路由与成本控制设计

> 基于《如何阅读一本书》的智能 RAG 方案 - 前端实现

## 概述

本设计实现一个基于正则的意图路由器，在用户提问时快速判断意图类型，动态限制 LLM 可用的工具集，同时通过 Prompt Caching 优化成本。

## 架构总览

```
用户提问
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  IntentRouter (新增)                                     │
│  - 读取 intent-rules.json 配置                           │
│  - 正则匹配判断意图类型                                   │
│  - 返回 { allowedTools, systemNote }                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  ContextBuilder (修改)                                   │
│  - buildIdentityLayer(): 注入 doc_description           │
│  - buildMessages(): 注入 <system_note>                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  FrontendAgent.chat() (修改)                             │
│  - 调用 IntentRouter 获取 allowedTools                   │
│  - 过滤 toolDefinitions，只传允许的工具给 LLM            │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  LLM 调用（工具受限 + 系统指令约束）
```

## 模块设计

### 1. IntentRouter 核心类

**文件：** `frontend/src/agent/router/intent-router.ts`

```typescript
interface IntentResult {
  allowedTools: string[];      // 允许的工具列表
  systemNote: string;          // 动态注入的 <system_note>
  detectedIntents: string[];   // 检测到的意图（用于日志）
}

interface IntentRule {
  id: string;
  pattern: string;             // 正则表达式
  intent: string;              // 意图名称
  tools: string[];             // 允许的工具
  priority: number;            // 优先级
}

export class IntentRouter {
  private rules: IntentRule[];

  constructor(rules?: IntentRule[]) {
    this.rules = rules || DEFAULT_RULES;
  }

  /**
   * 分析用户意图，返回允许的工具和系统指令
   */
  analyze(userInput: string): IntentResult {
    const detectedIntents: string[] = [];
    const allowedTools = new Set<string>();

    // 1. 遍历规则，匹配意图
    for (const rule of this.rules) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(userInput)) {
        detectedIntents.push(rule.intent);
        rule.tools.forEach(t => allowedTools.add(t));
      }
    }

    // 2. 兜底：无匹配时，默认允许微观检索
    if (detectedIntents.length === 0) {
      detectedIntents.push("分析阅读-微观检索");
      allowedTools.add("search_doc");
    }

    // 3. 生成动态系统指令
    const systemNote = this.buildSystemNote(detectedIntents, allowedTools);

    return {
      allowedTools: Array.from(allowedTools),
      systemNote,
      detectedIntents,
    };
  }

  private buildSystemNote(intents: string[], tools: Set<string>): string {
    return `<system_note>
【Router 强制路由】
系统已判定用户意图包含：${intents.join('、')}。
你当前仅被允许使用以下工具：[${Array.from(tools).join(', ')}]。
严禁使用其他未列出的工具。
</system_note>`;
  }
}
```

### 2. 意图规则配置

**文件：** `frontend/src/agent/router/intent-rules.json`

```json
{
  "version": "1.0",
  "description": "基于《如何阅读一本书》的意图路由规则",

  "rules": [
    {
      "id": "macro_overview",
      "pattern": "总结|大纲|概括|全书|核心观点|讲了什么|总体结构|主旨|脉络|框架|读后感|核心思想|思维导图|脑图",
      "intent": "检视阅读",
      "tools": ["get_toc"],
      "priority": 1
    },
    {
      "id": "locate_chapter",
      "pattern": "第[0-9一二三四五六七八九十百]+[章|节|部分|页]|引言|结语|附录|前言",
      "intent": "分析阅读-定位",
      "tools": ["get_toc", "get_chapter", "analyze_chapter"],
      "priority": 2
    },
    {
      "id": "syntopical",
      "pattern": "对比|结合|另一本|异同|其他书|不同文献|主题阅读|联系起来|比较",
      "intent": "主题阅读",
      "tools": ["search_read_books"],
      "priority": 1
    },
    {
      "id": "action_output",
      "pattern": "画一个|画张|做个图|制作.*图表|总结成表格|做.*卡片|闪卡|写.*笔记|思维导图",
      "intent": "动作输出",
      "tools": ["excalidraw", "write_note", "canvas"],
      "priority": 3
    }
  ],

  "fallback": {
    "intent": "分析阅读-微观检索",
    "tools": ["search_doc"]
  },

  "tool_aliases": {
    "toc": "get_toc",
    "chapter": "get_chapter",
    "search": "search_doc"
  }
}
```

### 3. ContextBuilder 修改

**文件：** `frontend/src/agent/context/builder.ts`

```typescript
// 1. buildSystemPrompt 新增 docDescription 参数
async buildSystemPrompt(
  skillsSummary: string,
  documentMetadata?: DocumentMetadata,
  docDescription?: string,  // 新增：全书摘要
): Promise<string> {
  const parts: string[] = [];

  // Layer 1: Identity（注入 docDescription）
  parts.push(this.buildIdentityLayer(documentMetadata, docDescription));

  // ... 其他层保持不变
}

// 2. buildIdentityLayer 注入全书摘要
private buildIdentityLayer(
  metadata?: DocumentMetadata,
  docDescription?: string
): string {
  // ... 现有的人设代码 ...

  // 在"当前阅读"部分后添加全书摘要
  if (docDescription) {
    identityLayer += `\n\n## 全书摘要\n${docDescription}`;
  }

  return identityLayer;
}

// 3. buildMessages 新增 systemNote 参数
static buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  currentMessage: string,
  runtimeContext?: string,
  systemNote?: string,  // 新增：Router 生成的动态指令
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  // 用户消息：systemNote + runtimeContext + 实际问题
  let userContent = '';
  if (systemNote) userContent += systemNote + '\n\n';
  if (runtimeContext) userContent += runtimeContext + '\n\n';
  userContent += currentMessage;

  messages.push({ role: 'user', content: userContent });
  return messages;
}
```

### 4. FrontendAgent.chat() 修改

**文件：** `frontend/src/agent/index.ts`

```typescript
async chat(
  userMessage: string,
  options?: ChatOptions
): Promise<void> {
  // 1. 意图路由
  const intentResult = this.intentRouter.analyze(userMessage);
  agentLog('[Router] 检测意图:', intentResult.detectedIntents);
  agentLog('[Router] 允许工具:', intentResult.allowedTools);

  // 2. 过滤工具定义（只传允许的工具给 LLM）
  const filteredToolDefs = this.filterToolDefinitions(
    this.toolDefinitions,
    intentResult.allowedTools
  );

  // 3. 构建系统提示（注入 docDescription）
  const docDescription = this.context?.docDescription;
  const systemPrompt = await this.contextBuilder.buildSystemPrompt(
    skillsSummary,
    documentMetadata,
    docDescription
  );

  // 4. 构建消息列表（注入 systemNote）
  const runtimeContext = ContextBuilder.buildRuntimeContext(metadata);
  const messages = ContextBuilder.buildMessages(
    systemPrompt,
    history,
    userMessage,
    runtimeContext,
    intentResult.systemNote
  );

  // 5. 调用 LLM（使用过滤后的工具）
  await runAgentLoop({
    messages,
    toolDefinitions: filteredToolDefs,
    // ... 其他选项
  });
}

private filterToolDefinitions(
  allTools: ToolDefinition[],
  allowed: string[]
): ToolDefinition[] {
  return allTools.filter(tool => allowed.includes(tool.function.name));
}
```

### 5. 消息清理（Memory GC）

**文件：** `frontend/src/agent/agent-loop.ts`

```typescript
/**
 * 清理 ReAct 循环产生的中间消息
 * 只保留 User 和 Assistant 的最终对话
 */
function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    // 只保留 user 和 assistant 角色
    if (msg.role === 'user' || msg.role === 'assistant') {
      const cleaned: ChatMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.name) cleaned.name = msg.name;
      result.push(cleaned);
    }
    // 丢弃 role='tool' 的消息
  }

  return result;
}

// 在 runAgentLoop 返回前调用
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  // ... 现有循环逻辑 ...

  // 循环结束时清理消息
  const compactedMessages = compactMessages(allMessages);

  return {
    finalContent,
    messages: compactedMessages,
  };
}
```

## 文件结构

```
frontend/src/agent/
├── router/                          # 新增目录
│   ├── index.ts                     # 导出入口
│   ├── intent-router.ts             # IntentRouter 核心类
│   ├── intent-rules.json            # 规则配置文件
│   └── types.ts                     # 类型定义
│
├── context/
│   └── builder.ts                   # 修改：注入 docDescription + systemNote
│
├── agent-loop.ts                    # 修改：新增 compactMessages() + 末尾调用
│
└── index.ts                         # 修改：chat() 集成 IntentRouter
```

## 修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `router/*.ts` | 新增 | 意图路由模块 |
| `router/intent-rules.json` | 新增 | 规则配置 |
| `context/builder.ts` | 修改 | 注入摘要和动态指令 |
| `agent-loop.ts` | 修改 | 新增 `compactMessages()` 函数 |
| `index.ts` | 修改 | 集成路由器，过滤工具列表 |

## 测试用例

### 测试 A："画一个全书的思维导图"

- **命中：** `macro_overview` (全书) + `action_output` (思维导图)
- **分配工具：** `['get_toc', 'excalidraw']`
- **效果：** LLM 直接拉大纲，然后画图，不会全文搜索

### 测试 B："帮我总结一下第3章"

- **命中：** `locate_chapter` (第3章)
- **分配工具：** `['get_toc', 'get_chapter', 'analyze_chapter']`
- **效果：** LLM 拿到第3章原文，不是全书摘要

### 测试 C："什么是'第一天的答案'？"

- **命中：** 无（兜底）
- **分配工具：** `['search_doc']`
- **效果：** LLM 用向量检索精确匹配

### 测试 D："对比《金字塔原理》和这本书关于结构化思维的异同"

- **命中：** `syntopical` (对比)
- **分配工具：** `['search_read_books']`
- **效果：** LLM 跨书检索

## 后端依赖

本设计依赖后端返回的 `index_info.doc_description` 字段：

```json
{
  "status": "success",
  "results": [...],
  "index_info": {
    "pdf_name": "麦肯锡结构化战略思维",
    "doc_description": "【商业思维类】本书系统阐述了麦肯锡公司广泛应用的结构化战略思维方法..."
  }
}
```

## 设计决策记录

1. **意图路由位置**：选择在 `ContextBuilder` 中实现，职责清晰
2. **工具限制方式**：双重保险（过滤工具列表 + 注入 `<system_note>`）
3. **全书摘要位置**：放入 System Prompt 静态部分，最大化缓存命中
4. **规则维护方式**：JSON 配置文件，支持热更新
5. **消息清理位置**：`agent-loop.ts` 内部函数，循环结束时调用
