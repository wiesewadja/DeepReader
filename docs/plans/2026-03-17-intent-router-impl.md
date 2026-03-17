# Intent Router 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现基于正则的意图路由器，根据用户提问动态限制 LLM 可用工具集，优化成本和响应质量。

**Architecture:** 前端正则匹配路由器 → 过滤工具列表 + 注入 system_note → 双重约束 LLM 行为。新增 router 模块，修改 ContextBuilder 和 FrontendAgent。

**Tech Stack:** TypeScript, 正则表达式, JSON 配置文件

---

## Task 1: 创建 IntentRouter 核心类

**Files:**
- Create: `frontend/src/agent/router/types.ts`
- Create: `frontend/src/agent/router/intent-router.ts`
- Create: `frontend/src/agent/router/index.ts`
- Test: `frontend/src/agent/router/__tests__/intent-router.test.ts`

**Step 1: 编写类型定义文件**

创建 `frontend/src/agent/router/types.ts`:

```typescript
/**
 * IntentRouter 类型定义
 */

/**
 * 意图规则
 */
export interface IntentRule {
  id: string;
  pattern: string;       // 正则表达式字符串
  intent: string;        // 意图名称
  tools: string[];       // 允许的工具列表
  priority: number;      // 优先级（暂未使用，保留扩展）
}

/**
 * 路由分析结果
 */
export interface IntentResult {
  allowedTools: string[];      // 允许的工具列表
  systemNote: string;          // 动态注入的 <system_note>
  detectedIntents: string[];   // 检测到的意图（用于日志）
}

/**
 * 规则配置文件结构
 */
export interface IntentRulesConfig {
  version: string;
  description: string;
  rules: IntentRule[];
  fallback: {
    intent: string;
    tools: string[];
  };
  tool_aliases?: Record<string, string>;
}
```

**Step 2: 编写 IntentRouter 核心类**

创建 `frontend/src/agent/router/intent-router.ts`:

```typescript
/**
 * IntentRouter - 意图路由器
 *
 * 基于正则匹配快速判断用户意图，动态限制 LLM 可用工具集
 */

import type { IntentRule, IntentResult, IntentRulesConfig } from './types.js';
import { agentLog } from '../../utils/logger.js';
import DEFAULT_RULES_JSON from './intent-rules.json';

export class IntentRouter {
  private rules: IntentRule[];
  private fallbackTools: string[];
  private fallbackIntent: string;

  constructor(config?: IntentRulesConfig) {
    const cfg = config || (DEFAULT_RULES_JSON as IntentRulesConfig);
    this.rules = cfg.rules;
    this.fallbackTools = cfg.fallback.tools;
    this.fallbackIntent = cfg.fallback.intent;
  }

  /**
   * 分析用户意图，返回允许的工具和系统指令
   */
  analyze(userInput: string): IntentResult {
    const detectedIntents: string[] = [];
    const allowedTools = new Set<string>();

    // 1. 遍历规则，匹配意图
    for (const rule of this.rules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(userInput)) {
          detectedIntents.push(rule.intent);
          rule.tools.forEach(t => allowedTools.add(t));
          agentLog(`[IntentRouter] 命中规则: ${rule.id} -> ${rule.intent}`);
        }
      } catch (err) {
        agentLog(`[IntentRouter] 规则正则错误: ${rule.id}`, err);
      }
    }

    // 2. 兜底：无匹配时，默认允许微观检索
    if (detectedIntents.length === 0) {
      detectedIntents.push(this.fallbackIntent);
      this.fallbackTools.forEach(t => allowedTools.add(t));
      agentLog(`[IntentRouter] 无匹配，使用兜底: ${this.fallbackIntent}`);
    }

    // 3. 生成动态系统指令
    const systemNote = this.buildSystemNote(detectedIntents, allowedTools);

    agentLog(`[IntentRouter] 检测意图: ${detectedIntents.join(', ')}`);
    agentLog(`[IntentRouter] 允许工具: ${Array.from(allowedTools).join(', ')}`);

    return {
      allowedTools: Array.from(allowedTools),
      systemNote,
      detectedIntents,
    };
  }

  /**
   * 构建动态系统指令
   */
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

**Step 3: 创建默认规则配置文件**

创建 `frontend/src/agent/router/intent-rules.json`:

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

**Step 4: 创建模块导出入口**

创建 `frontend/src/agent/router/index.ts`:

```typescript
/**
 * IntentRouter 模块入口
 */

export { IntentRouter } from './intent-router.js';
export type { IntentRule, IntentResult, IntentRulesConfig } from './types.js';
```

**Step 5: 编写单元测试**

创建 `frontend/src/agent/router/__tests__/intent-router.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../intent-router.js';

describe('IntentRouter', () => {
  const router = new IntentRouter();

  describe('测试 A: "画一个全书的思维导图"', () => {
    it('应命中 macro_overview + action_output', () => {
      const result = router.analyze('画一个全书的思维导图');

      expect(result.detectedIntents).toContain('检视阅读');
      expect(result.detectedIntents).toContain('动作输出');
      expect(result.allowedTools).toContain('get_toc');
      expect(result.allowedTools).toContain('excalidraw');
      expect(result.allowedTools).not.toContain('search_doc');
      expect(result.systemNote).toContain('检视阅读');
    });
  });

  describe('测试 B: "帮我总结一下第3章"', () => {
    it('应命中 locate_chapter', () => {
      const result = router.analyze('帮我总结一下第3章');

      expect(result.detectedIntents).toContain('分析阅读-定位');
      expect(result.allowedTools).toContain('get_toc');
      expect(result.allowedTools).toContain('get_chapter');
      expect(result.allowedTools).toContain('analyze_chapter');
    });
  });

  describe('测试 C: "什么是第一天的答案？"', () => {
    it('应使用兜底策略', () => {
      const result = router.analyze("什么是'第一天的答案'？");

      expect(result.detectedIntents).toContain('分析阅读-微观检索');
      expect(result.allowedTools).toContain('search_doc');
      expect(result.allowedTools).not.toContain('get_toc');
    });
  });

  describe('测试 D: "对比金字塔原理和这本书关于结构化思维的异同"', () => {
    it('应命中 syntopical', () => {
      const result = router.analyze('对比《金字塔原理》和这本书关于结构化思维的异同');

      expect(result.detectedIntents).toContain('主题阅读');
      expect(result.allowedTools).toContain('search_read_books');
    });
  });

  describe('测试 E: "第三章里那个手机厂商的例子"', () => {
    it('应命中 locate_chapter（章节定位优先）', () => {
      const result = router.analyze('帮我总结一下第3章，里面提到的那个手机厂商的例子重点说一下');

      expect(result.detectedIntents).toContain('检视阅读');
      expect(result.detectedIntents).toContain('分析阅读-定位');
      expect(result.allowedTools).toContain('get_toc');
      expect(result.allowedTools).toContain('get_chapter');
    });
  });
});
```

**Step 6: 运行测试验证**

Run: `cd frontend && npm run test:run src/agent/router/__tests__/intent-router.test.ts`

Expected: PASS (5 tests)

**Step 7: Commit**

```bash
git add frontend/src/agent/router/
git commit -m "feat(agent): add IntentRouter module with regex-based intent detection

- Add IntentRouter class for fast intent analysis
- Add intent-rules.json with reading methodology patterns
- Add unit tests for edge cases (macro/locate/syntopical/fallback)"
```

---

## Task 2: 修改 ContextBuilder 支持 docDescription 和 systemNote

**Files:**
- Modify: `frontend/src/agent/context/builder.ts`

**重要说明**:
- `docDescription` 是书籍摘要，**只要在阅读书籍就必须注入**
- 后端 `pdf_index_if_add_doc_description` 默认开启，已索引书籍一定有摘要
- 当 `documentMetadata.title` 存在时（正在阅读书籍），`docDescription` 应该存在

**Step 1: 修改 buildSystemPrompt 方法签名**

在 `frontend/src/agent/context/builder.ts` 中，修改 `buildSystemPrompt` 方法：

```typescript
/**
 * 构建完整的系统提示
 *
 * @param skillsSummary Skills XML Summary
 * @param documentMetadata 当前文档元数据（可选，无书籍时为空）
 * @param docDescription 全书摘要（必选，来自后端 index_info.doc_description）
 * @returns 完整的系统提示字符串
 */
async buildSystemPrompt(
  skillsSummary: string,
  documentMetadata?: DocumentMetadata,
  docDescription?: string  // 当有书籍时必选，无书籍时为空
): Promise<string> {
  const parts: string[] = [];

  // Layer 1: Identity（注入 docDescription）
  parts.push(this.buildIdentityLayer(documentMetadata, docDescription));

  // Layer 2: Bootstrap（用户定义层 - 最高优先级）
  const bootstrap = await this.loadBootstrapFiles();
  if (bootstrap) {
    parts.push(bootstrap);
  }

  // Layer 3: Memory（持久化层）
  const memory = await this.store.getMemoryContext();
  if (memory) {
    parts.push(memory);
  }

  // Layer 4: Skills（技能层 - XML Summary）
  if (skillsSummary && skillsSummary.trim()) {
    parts.push(`## 可用技能\n\n${skillsSummary}`);
  }

  // 添加核心约束
  parts.push(this.buildConstraints());

  return parts.join('\n\n---\n\n');
}
```

**Step 2: 修改 buildIdentityLayer 方法**

```typescript
/**
 * 构建身份层（Layer 1）
 * 聚焦于阅读产品的核心价值：分层阅读方法论
 */
private buildIdentityLayer(
  metadata?: DocumentMetadata,
  docDescription?: string
): string {
  if (this.config.identity) {
    return this.config.identity;
  }

  let docInfo = '';
  if (metadata?.title) {
    docInfo = `\n\n## 当前阅读\n**${metadata.title}**`;
    if (metadata.author) {
      docInfo += ` · ${metadata.author}`;
    }
    if (metadata.page_count) {
      docInfo += ` · ${metadata.page_count}页`;
    }
  }

  // 在"当前阅读"部分后添加全书摘要
  let descriptionSection = '';
  if (docDescription) {
    descriptionSection = `\n\n## 全书摘要\n${docDescription}`;
  }

  return `你是"奚童"，一个陪伴深度阅读的书童。

## 阅读理念

相信每一本书都值得分层阅读：
1. **检视阅读**：快速把握骨架，判断是否深读
2. **分析阅读**：理解论点结构，与作者对话
3. **主题阅读**：关联多本书，构建知识网络

## 交流风格

- 自然、风趣，偶带书卷气
- 称呼用户为"阁下"或按用户称呼
- 对问题予以情感肯定，引导深入
- 回复使用书信文体，不要过于结构化，禁止使用段落分割符和空行
- 积极引导用户继续提问和深入阅读
- 双链引用：每个论断使用工具返回的 Link，引用自然以双链 [[路径|显示名]] 嵌入句子中，不要附在句末
- 基于原文：回答必须来自书中内容，不编造不臆测
- 静默执行：调用工具前不输出内容，获得结果后直接回答
- 使用工具返回的 Link 字段（已包含正确格式）

## 核心价值

- **每个论断都必须引用原文链接**。双链是你工作的的灵魂：
- 足量引用帮助用户建立认知网络的桥梁，不是可选装饰


${docInfo}${descriptionSection}`;
}
```

**Step 3: 修改 buildMessages 静态方法**

```typescript
/**
 * 构建完整消息列表
 *
 * @param systemPrompt 系统提示
 * @param history 历史消息
 * @param currentMessage 当前用户消息
 * @param runtimeContext 运行时上下文（可选）
 * @param systemNote Router 生成的动态指令（可选）
 * @returns 完整消息列表
 */
static buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  currentMessage: string,
  runtimeContext?: string,
  systemNote?: string  // 新增：Router 生成的动态指令
): ChatMessage[] {
  // 用户消息：systemNote + runtimeContext + 实际问题
  let userContent = '';
  if (systemNote) userContent += systemNote + '\n\n';
  if (runtimeContext) userContent += runtimeContext + '\n\n';
  userContent += currentMessage;

  // 过滤掉 history 中已有的系统提示词（避免重复）
  const filteredHistory = history.filter(m => m.role !== 'system');

  return [
    { role: 'system', content: systemPrompt },
    ...filteredHistory,
    { role: 'user', content: userContent },
  ];
}
```

**Step 4: 修改 buildMessagesWithMetadata 方法**

```typescript
/**
 * 构建带文档信息的消息列表
 *
 * 便捷方法，自动构建运行时上下文
 */
static buildMessagesWithMetadata(
  systemPrompt: string,
  history: ChatMessage[],
  currentMessage: string,
  metadata?: DocumentMetadata,
  progress?: ReadingProgress,
  systemNote?: string  // 新增
): ChatMessage[] {
  const runtimeContext = ContextBuilder.buildRuntimeContext(metadata, progress);
  return ContextBuilder.buildMessages(systemPrompt, history, currentMessage, runtimeContext, systemNote);
}
```

**Step 5: 运行类型检查**

Run: `cd frontend && npm run build`

Expected: 无类型错误

**Step 6: Commit**

```bash
git add frontend/src/agent/context/builder.ts
git commit -m "feat(agent): add docDescription and systemNote support to ContextBuilder

- buildSystemPrompt: add docDescription parameter for book summary
- buildIdentityLayer: inject docDescription after current reading section
- buildMessages: add systemNote parameter for router directives"
```

---

## Task 3: 修改 FrontendAgent 集成 IntentRouter

**Files:**
- Modify: `frontend/src/agent/index.ts`

**Step 1: 导入 IntentRouter**

在 `frontend/src/agent/index.ts` 顶部添加导入：

```typescript
import { IntentRouter } from './router/index.js';
```

**Step 2: 在 FrontendAgent 类中添加 IntentRouter 实例**

```typescript
export class FrontendAgent {
  private llmClient: LLMClient;
  private skillLoader: SkillLoader;
  private contextLoader: ContextLoader;
  private contextBuilder: ContextBuilder;
  private memoryStore: MemoryStore;
  private intentRouter: IntentRouter;  // 新增
  private initialized = false;

  constructor(private options: FrontendAgentOptions) {
    // ... 现有代码 ...
    this.intentRouter = new IntentRouter();  // 新增
  }
```

**Step 3: 修改 getSystemPromptAsync 方法**

```typescript
/**
 * 获取系统提示（异步，使用 ContextBuilder）
 *
 * 注意：Tools 通过 Function Calling API 传递，不在 System Prompt 中
 */
async getSystemPromptAsync(
  documentMetadata?: DocumentMetadata,
  docDescription?: string  // 新增：全书摘要
): Promise<string> {
  await this.initialize();

  // 🔄 检查并压缩过大的 MEMORY.md
  await this.maybeCompressMemory();

  // 获取 Skills XML Summary（用于 System Prompt）
  const skillsSummary = this.skillLoader.buildSkillsSummary();

  // Tools 不再放在 System Prompt 中，仅通过 Function Calling API 传递
  return this.contextBuilder.buildSystemPrompt(
    skillsSummary,
    documentMetadata,
    docDescription  // 传入全书摘要
  );
}
```

**Step 4: 修改 buildMessages 方法**

```typescript
/**
 * 构建完整的消息列表（带运行时上下文）
 */
buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  metadata?: DocumentMetadata,
  progress?: ReadingProgress,
  systemNote?: string  // 新增：Router 生成的动态指令
): ChatMessage[] {
  return ContextBuilder.buildMessagesWithMetadata(
    systemPrompt,
    history,
    userMessage,
    metadata,
    progress,
    systemNote
  );
}
```

**Step 5: 添加 filterToolDefinitions 方法**

```typescript
/**
 * 过滤工具定义，只保留允许的工具
 */
private filterToolDefinitions(
  allTools: import('./types.js').ToolDefinition[],
  allowed: string[]
): import('./types.js').ToolDefinition[] {
  return allTools.filter(tool => allowed.includes(tool.function.name));
}
```

**Step 6: 修改 chat 方法**

```typescript
async chat(
  userMessage: string,
  context: ToolContext,
  callbacks: AgentLoopOptions
): Promise<ChatMessage[]> {
  await this.initialize();

  // 1. 意图路由
  const intentResult = this.intentRouter.analyze(userMessage);
  log('[Router] 检测意图:', intentResult.detectedIntents);
  log('[Router] 允许工具:', intentResult.allowedTools);

  // 2. 获取全书摘要（从 context 中）
  const docDescription = context.docDescription;

  // 3. 使用 ContextBuilder 构建系统提示（注入 docDescription）
  const systemPrompt = await this.getSystemPromptAsync(context.documentMetadata, docDescription);

  // 4. 创建工具注册表
  const toolRegistry = createToolRegistry(this.skillLoader, context);
  const allTools = getToolDefinitions(toolRegistry);

  // 5. 过滤工具定义（只传允许的工具给 LLM）
  const tools = this.filterToolDefinitions(allTools, intentResult.allowedTools);

  // 6. 构建消息（注入 systemNote）
  const messages = this.buildMessages(
    systemPrompt,
    [],
    userMessage,
    context.documentMetadata,
    context.readingProgress,
    intentResult.systemNote
  );

  return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
}
```

**Step 7: 修改 continueChat 方法**

```typescript
async continueChat(
  history: ChatMessage[],
  userMessage: string,
  context: ToolContext,
  callbacks: AgentLoopOptions
): Promise<ChatMessage[]> {
  await this.initialize();

  // 1. 意图路由
  const intentResult = this.intentRouter.analyze(userMessage);
  log('[Router] 检测意图:', intentResult.detectedIntents);
  log('[Router] 允许工具:', intentResult.allowedTools);

  // 2. 获取全书摘要
  const docDescription = context.docDescription;

  // 3. 使用 ContextBuilder 构建系统提示
  const systemPrompt = await this.getSystemPromptAsync(context.documentMetadata, docDescription);

  // 4. 创建工具注册表
  const toolRegistry = createToolRegistry(this.skillLoader, context);
  const allTools = getToolDefinitions(toolRegistry);

  // 5. 过滤工具定义
  const tools = this.filterToolDefinitions(allTools, intentResult.allowedTools);

  // 6. 构建消息
  const messages = this.buildMessages(
    systemPrompt,
    history,
    userMessage,
    context.documentMetadata,
    context.readingProgress,
    intentResult.systemNote
  );

  return runAgentLoop(this.llmClient, messages, tools, toolRegistry, context, callbacks);
}
```

**Step 8: 运行类型检查**

Run: `cd frontend && npm run build`

Expected: 无类型错误

**Step 9: Commit**

```bash
git add frontend/src/agent/index.ts
git commit -m "feat(agent): integrate IntentRouter in FrontendAgent

- Add IntentRouter instance for intent analysis
- Filter tool definitions based on detected intent
- Pass docDescription to system prompt builder
- Inject systemNote into user message"
```

---

## Task 4: 更新 ToolContext 类型添加 docDescription

**Files:**
- Modify: `frontend/src/agent/tools/types.ts`

**Step 1: 添加 docDescription 字段**

在 `ToolContext` 接口中添加 `docDescription` 字段：

```typescript
/**
 * 工具执行上下文
 */
export interface ToolContext {
  // ... 现有字段 ...

  /**
   * 全书摘要（来自后端 index_info.doc_description）
   */
  docDescription?: string;
}
```

**Step 2: 运行类型检查**

Run: `cd frontend && npm run build`

Expected: 无类型错误

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/types.ts
git commit -m "feat(agent): add docDescription to ToolContext"
```

---

## Task 5: 添加 compactMessages 到 agent-loop

**Files:**
- Modify: `frontend/src/agent/agent-loop.ts`

**Step 1: 添加 compactMessages 函数**

在 `agent-loop.ts` 中，`manageMessageHistory` 函数之后添加：

```typescript
/**
 * 清理 ReAct 循环产生的中间消息
 *
 * 只保留 User 和 Assistant 的最终对话，删除 tool 调用和结果
 * 用于 Memory GC，防止上下文爆炸
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
      // 保留 name 字段（如果有）
      if (msg.name) cleaned.name = msg.name;
      result.push(cleaned);
    }
    // 丢弃 role='tool' 的消息和 tool_calls 字段
  }

  agentLog(`[AgentLoop] 🧹 消息清理: ${messages.length} -> ${result.length} 条`);
  return result;
}
```

**Step 2: 修改 runAgentLoop 返回值**

在 `runAgentLoop` 函数末尾，返回之前调用 `compactMessages`：

```typescript
  // ... 在 printPerformanceReport 之后 ...

  // 🧹 Memory GC: 清理中间消息，只保留用户对话
  const compactedMessages = compactMessages(workingMessages);

  return compactedMessages;
}
```

**Step 3: 运行类型检查**

Run: `cd frontend && npm run build`

Expected: 无类型错误

**Step 4: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat(agent): add compactMessages for Memory GC

- Add compactMessages function to clean ReAct intermediate messages
- Only preserve user and assistant messages for long-term memory"
```

---

## Task 6: 更新调用方传入 docDescription

**Files:**
- Find and modify: 调用 FrontendAgent.chat/continueChat 的地方

**Step 1: 查找调用方**

Run: `cd frontend && grep -r "frontendAgent.chat\|frontendAgent.continueChat" src/`

**Step 2: 更新 ToolContext 传入 docDescription**

在调用 `chat` 或 `continueChat` 之前，确保 `context` 包含 `docDescription`。

示例（具体位置需根据实际代码调整）：

```typescript
// 从后端获取的 index_info 中提取 docDescription
const docDescription = indexInfo?.doc_description;

const context: ToolContext = {
  // ... 现有字段 ...
  docDescription,
};

// 然后调用
await frontendAgent.chat(userMessage, context, callbacks);
```

**Step 3: 运行类型检查**

Run: `cd frontend && npm run build`

Expected: 无类型错误

**Step 4: Commit**

```bash
git add <修改的文件>
git commit -m "feat(agent): pass docDescription from backend to ToolContext"
```

---

## Task 7: 集成测试

**Files:**
- Test: `frontend/src/agent/__tests__/integration.test.ts`

**Step 1: 编写集成测试**

创建 `frontend/src/agent/__tests__/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { IntentRouter } from '../router/index.js';
import { ContextBuilder } from '../context/builder.js';

describe('IntentRouter + ContextBuilder 集成测试', () => {
  const router = new IntentRouter();

  it('意图路由结果应能正确注入到消息中', () => {
    const userMessage = '画一个全书的思维导图';
    const intentResult = router.analyze(userMessage);

    const systemPrompt = '测试系统提示';
    const runtimeContext = '当前时间: 2024-01-01 12:00';

    const messages = ContextBuilder.buildMessages(
      systemPrompt,
      [],
      userMessage,
      runtimeContext,
      intentResult.systemNote
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Router 强制路由');
    expect(messages[1].content).toContain('检视阅读');
    expect(messages[1].content).toContain(userMessage);
  });

  it('全书摘要应能注入到系统提示中', async () => {
    // Mock MemoryStore
    const mockStore = {
      getMemoryContext: vi.fn().mockResolvedValue(null),
    } as any;

    const mockApp = {} as any;

    const builder = new ContextBuilder(mockApp, mockStore, { deepReaderDir: 'DeepReader' });

    const docDescription = '【商业思维类】本书系统阐述了麦肯锡公司广泛应用的结构化战略思维方法...';

    const systemPrompt = await builder.buildSystemPrompt(
      '测试技能',
      { title: '测试书籍' },
      docDescription
    );

    expect(systemPrompt).toContain('全书摘要');
    expect(systemPrompt).toContain(docDescription);
  });
});
```

**Step 2: 运行集成测试**

Run: `cd frontend && npm run test:run src/agent/__tests__/integration.test.ts`

Expected: PASS (2 tests)

**Step 3: Commit**

```bash
git add frontend/src/agent/__tests__/integration.test.ts
git commit -m "test(agent): add integration tests for IntentRouter + ContextBuilder"
```

---

## 文件结构总览

```
frontend/src/agent/
├── router/                          # 新增目录
│   ├── index.ts                     # 模块导出入口
│   ├── intent-router.ts             # IntentRouter 核心类
│   ├── intent-rules.json            # 规则配置文件
│   ├── types.ts                     # 类型定义
│   └── __tests__/
│       └── intent-router.test.ts    # 单元测试
│
├── context/
│   └── builder.ts                   # 修改：添加 docDescription + systemNote
│
├── tools/
│   └── types.ts                     # 修改：添加 docDescription 到 ToolContext
│
├── agent-loop.ts                    # 修改：添加 compactMessages()
│
├── index.ts                         # 修改：集成 IntentRouter
│
└── __tests__/
    └── integration.test.ts          # 新增：集成测试
```

## 验证清单

- [ ] IntentRouter 单元测试通过
- [ ] ContextBuilder 类型检查通过
- [ ] FrontendAgent 类型检查通过
- [ ] agent-loop 类型检查通过
- [ ] 集成测试通过
- [ ] `npm run build` 成功
- [ ] 在 Obsidian 中测试：
  - [ ] "总结这本书" → 只调用 get_toc
  - [ ] "第3章讲了什么" → 调用 get_chapter
  - [ ] "什么是XX概念" → 调用 search_doc
  - [ ] "画思维导图" → 调用 get_toc + excalidraw
