# 提示词模块组合（Prompt Modules）

> DeepReader 8 个核心 LLM 提示词的组合方式——**XML 标签结构 + 分层上下文注入 + 共享 `AnalyticalPromptContext` 接口**。
>
> 配套阅读：[system-overview.md 第 3 节 状态机](../architecture/system-overview.md#state-machine)、
> [intent-router.md](../architecture/intent-router.md)（dynamic allowedTools）、
> [book-search.md](../architecture/book-search.md)（检索结果注入 prompt）、
> [early-stop-decision.md](../architecture/early-stop-decision.md)（早停 prompt 缺失 betterQuestion）。

---

## 目录

1. [设计意图：8 个节点 × 不同 prompt](#why)
2. [XML 标签结构：4 大块](#xml)
3. [8 个 prompt 文件总览](#overview)
4. [共享上下文：`AnalyticalPromptContext` 接口](#context)
5. [动态上下文注入](#dynamic)
6. [关键源文件](#files)
7. [已知限制](#limitations-inference)

---

## 设计意图 (why)

## XML

- **每个节点**都重复 `<role>你是奚童</role>` + `<rules>...</rules>` —— 修改时**容易漏掉某节点**
- **上下文因节点而异** —— Router 不需要 tocSummary，Formatter 不需要 allowedTools
- **不同节点需要不同详细度** —— Router 要"快"，Formatter 要"准"

**Prompt 模块组合**解决：
- **XML 结构**让 LLM 注意力分层（每个 tag 是一个独立语义块）
- **共享 context 接口**让节点代码**类型一致**
- **集中文件**让修改只需**改一处**（所有 prompt 在 `src/agent/graph/prompts/` 目录）

---

## XML (xml)

**约定**（所有 prompt 共用）：

- `<role>` —— 角色定义：你是谁
- `<task>` —— 任务：做什么
- `<context>` —— 动态上下文：当前书 / 用户 / 历史
- `<rules>` —— 规则：怎么答
- `<intent_types>` —— (仅 Router) 意图分类参考
- `<output_rules>` —— 输出格式约束：JSON / wiki 链接

### 4 块组成（典型 analytical prompt）

```typescript
export function buildAnalyticalSystemPrompt(ctx) {
  return `<role>你是一个深度阅读助手...</role>

<book_context>
  书名：${ctx.pdfName}
  目录摘要：${ctx.tocSummary}
  章节锁定：${ctx.scopeNodeIds.join(', ')}
</book_context>

<user_profile>
  ${ctx.userProfileSummary}
</user_profile>

<recent_history>
  ${ctx.recentHistorySummaries}
</recent_history>

<rules>
  1. 必须基于原文回答
  2. wiki 链接格式：[[file#^block|alias]]
  3. 不知道就明说
</rules>`;
}
```

**关键**：
- **静态**（role / rules）—— 写死字符串
- **动态**（book_context / user_profile / recent_history）—— ctx 注入
- **关注分层**——LLM 知道每块在做什么

---

## Overview

| 文件 | 节点 | 行数 | 核心职责 |
|---|---|---|---|
| `inspectional-prompt.ts` | S1 Inspectional (含原 S0 Router) | ~322 | 意图分类 + depth 判断 + query 重写 + 选 scope + betterQuestion |
| `inspectional-prompt.ts`（同上） | — | — | 加载结构 + 选 scope + betterQuestion（已合并） |
| `pre-search-prompt.ts` | S2-Pre | 31 | 早停直接出答案的 prompt |
| `analytical-prompt.ts` | S2 Analytical | 231 | ReAct 工具循环主对话 prompt |
| `syntopical-prompt.ts` | S3 Syntopical | 106 | 跨书对比融合 prompt |
| `socratic-prompt.ts` | Socratic | 14 | 苏格拉底引导（极简） |
| `formatter-prompt.ts` | S4 Formatter | 154 | 答案格式化 + wiki 链接输出 |
| `proactive-formatter-prompt.ts` | Proactive 注入 | 110 | Proactive 触发的引导消息 |

### 1. inspectional-prompt.ts (S1，含原 S0 Router)

> 原先独立的 `router-prompt.ts`（意图分类 + depth 判断 + query 重写）已合并到此文件。

**输入**：userMessage + tocSummary + recentHistory + bookId + currentNodeId
**输出**：JSON `{ depth, rewritten_query, allowed_tools, intent_type, better_question, scope_node_ids, structural_analysis, suggested_keywords }`

**关键设计**：
- **强制 JSON 输出**（"必须且只能输出合法 JSON，不要包含任何 Markdown 代码块修饰符"）
- **A-F 6 种 intent type**（闲聊/验证/概览/分析/长文本验证/跨书）
- **深度决策树**：`拿不准 1 还是 2 时，一律判 2`（保守）
- **scope 锁定**根据 toc 摘要 + 当前章节选 N 个 nodeId
- **betterQuestion** = "基于结构的提问重写"——核心创新

### 2. pre-search-prompt.ts (S2-Pre 早停)

**输入**：systemPrompt + blockLines + userQuery + betterQuestion + structuralAnalysis
**输出**：直接给 LLM 的早停 prompt

**关键设计**：
- **已知 bug**（详见 [early-stop-decision.md Bug 2](../architecture/early-stop-decision.md)）：**早停路径会丢失 betterQuestion + structuralAnalysis**——已在黄金测试集锁定
- **修复**：`buildEarlyStopPrompt(ctx)` 接受 `betterQuestion` + `structuralAnalysis` 参数

### 3. analytical-prompt.ts (S2 主对话)

**输入**：AnalyticalPromptContext（11 字段）
**输出**：user message（带历史 / 检索结果 / scope / 工具上下文）

**最复杂的 prompt**：因为 S2 是 ReAct 主循环入口，注入**所有上下文**。

```typescript
export const PROMPT_S2_ANALYTICAL_TEMPLATE = buildAnalyticalPrompt({});
```

**注意**：默认模板是**无 ctx 模板**——节点调用时用 `buildAnalyticalUserMessage(ctx)` 动态拼。

### 4. syntopical-prompt.ts (S3)

**输入**：多本书的 topK 检索结果
**输出**：跨书融合的总结

**关键设计**：
- **多 book 标识**：`书A: ... 书B: ...`
- **比较维度引导**（"作者立场 / 论据 / 结论" 三维）
- **JSON 输出**

### 5. socratic-prompt.ts（极简 14 行）

**只**有一段提示词 + 工具调用列表——苏格拉底引导极简，不分块。

### 6. formatter-prompt.ts (S4)

**输入**：analysisResult + structural_analysis + bookName
**输出**：用户最终看到的答案（带 wiki 链接）

**10 条核心规则**：
1. 回答优先（不因风格稀释信息量）
2. 无迎合（不为了符合用户改回答）
3. 读书笔记风格（自然、像朋友）
4. 保留 wiki 链接（不可修改路径/block_id）
5. 禁止编造链接
6. 直接回应（不寒暄）
7. 无幻觉
8. 隐藏机器属性（不说"搜索""token"）
9. 阅读引导（一两句话引出）
10. **诚实拒答**（明确"未提及"时不绕开）

### 7. proactive-formatter-prompt.ts

**输入**：触发器类型 + 章节 + 高亮数
**输出**：苏格拉底式提问消息（注入到聊天输入框）

**独特设计**：不调 LangGraph 工具，**直接生成提示语**让用户主动决定是否发起对话。

---

## 共享上下文 (context)

**位置**：`src/agent/graph/prompts/analytical-prompt.ts:8-13`

```typescript
export interface AnalyticalPromptContext {
  scopeNodeIds: string[];
  tocSummary: string;
  pdfName?: string;
  currentNodeId?: string;
  userProfileSummary?: string;
  markdownFiles?: string[];
  nodeFileMap?: Record<string, string>;
  standaloneQuery: string;
  betterQuestion?: string;
  recentHistorySummaries?: string;
  prevSearchedBlockIds?: string[];
  skipUserMessage?: boolean;
}
```

**11 字段**，每个 prompt 调用方**按需填**。

### 哪些字段必填？

| 字段 | Inspectional (含 Router) | Pre-Search | Analytical | Syntopical | Formatter |
|---|---|---|---|---|---|
| `standaloneQuery` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tocSummary` | ✓ | - | ✓ | - | - |
| `scopeNodeIds` | - | ✓ | ✓ | - | - |
| `pdfName` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `userProfileSummary` | - | - | ✓ | - | ✓ |
| `markdownFiles` | - | - | ✓ | - | - |
| `betterQuestion` | - | ✓ | ✓ | - | - |
| `recentHistorySummaries` | ✓ | - | ✓ | ✓ | ✓ |
| `prevSearchedBlockIds` | - | - | ✓ | - | - |

**为什么 `pdfName` 几乎必填**——所有 wiki 链接需要书名作为前缀。

---

## Dynamic

### 注入点：3 个主要源

```
ctx.prompt 构造
  ├─ 静态块（role / rules）—— 写死
  ├─ 动态块 1：book_context
  │   ├─ pdfName / tocSummary / scopeNodeIds
  │   └─ 来源：S1 Inspectional 输出
  │
  ├─ 动态块 2：user_profile
  │   ├─ userProfileSummary
  │   └─ 来源：ProfileBuilder top-3 摘要
  │
  └─ 动态块 3：recent_history
      ├─ recentHistorySummaries
      └─ 来源：SessionStore 摘要
```

### 注入顺序

**先静态后动态**——LLM 看到 prompt 时先看到**角色定义**（"我是谁"），再看**当前任务**（"做什么"），最后**具体上下文**（"当前数据"）。

**为什么这样**：
- LLM 注意力分配**前强后弱**——重要信息放前面
- 角色 + 规则是稳定的"宪法"——应该最先看
- 上下文是"今天的议事"——放后面

### 拼装实现

**位置**：`src/agent/graph/prompts/analytical-prompt.ts`

```typescript
export function buildAnalyticalUserMessage(ctx: AnalyticalPromptContext): string {
  const historyBlock = formatHistoryBlock(ctx.recentHistorySummaries);
  const prevBlock = ctx.prevSearchedBlockIds?.length
    ? `<previously_searched>${ctx.prevSearchedBlockIds.join(', ')}</previously_searched>\n`
    : '';

  return `${historyBlock}${prevBlock}<original_query>${ctx.standaloneQuery}</original_query>
${ctx.betterQuestion ? `<refined_query>${ctx.betterQuestion}</refined_query>` : ''}
在限定范围内分析，提取关键内容并附带 block_id。`;
}
```

**注意**：
- **`historyBlock` + `prevBlock`** —— 拼在 user message 开头（不是 system）
- **`<original_query>` / `<refined_query>`** —— 双 query 区分原查询和 S1 重写后
- **`<previously_searched>`** —— 避免 S2 ReAct 循环重复搜

---

## 跨节点共享模式

### 1. 都用 XML 标签

`buildXxxPrompt` 函数返回字符串时，**必含 `<role>` 起始**——保证 LLM 第一眼看到"我是谁"。

### 2. 都用 [ANTI_HALLUCINATION] 前缀

**位置**：`inspectional-prompt.ts`（含原 S0 Router prompt）

```typescript
B. 存在性验证 — "书中有没有提到X" → depth=0
   将 standalone_query 前缀加上 "[ANTI_HALLUCINATION]" 标记。
```

**机制**：S0 Router（现合并到 Inspectional）检测到"是否提到 X" 类问题时，给 query 加前缀 → S2 注入 prompt 时看到该标记 → 触发 LLM 诚实的反幻觉响应。

### 3. 都不直接说"你是 LLM"

**位置**：formatter-prompt.ts 规则 7

```
7. 隐藏机器属性：不讲"搜索""工具""token"等技术词汇
```

**风格统一**：所有节点 prompt 都强调"读书笔记风格" + "像老朋友"。

---

## Files

### 运行时文件（当前 graph nodes 使用）

| 文件 | 职责 |
|---|---|
| `src/agent/graph/prompts/inspectional-prompt.ts` | S1 Inspectional prompt（含原 S0 Router，~322 行） |
| `src/agent/graph/prompts/pre-search-prompt.ts` | S2-Pre 早停 prompt（31 行） |
| `src/agent/graph/prompts/analytical-prompt.ts` | S2 Analytical prompt（231 行，含共享 context 接口） |
| `src/agent/graph/prompts/syntopical-prompt.ts` | S3 Syntopical prompt（106 行） |
| `src/agent/graph/prompts/socratic-prompt.ts` | 苏格拉底极简 prompt（14 行） |
| `src/agent/graph/prompts/formatter-prompt.ts` | S4 Formatter prompt（154 行，10 条规则） |
| `src/agent/graph/prompts/proactive-formatter-prompt.ts` | Proactive 引导 prompt（110 行） |
| `src/agent/graph/utils/history-summarizer.ts` | 历史摘要 + 格式化（103 行） |
| `tests/unit/agent/graph/prompts/*.test.ts` | 8 个 prompt 构造单测 |

### 模块化注册表（新架构，Phase 1）

| 文件 | 职责 |
|---|---|
| `src/agent/prompts/types.ts` | 类型定义（PromptModule, RouterBuildContext 等） |
| `src/agent/prompts/registry.ts` | 注册表实现 + i18n locale 管理 |
| `src/agent/prompts/version.ts` | 版本管理器（changelog 追踪） |
| `src/agent/prompts/index.ts` | 统一导出 + `registerAllPrompts()` 批量注册 |
| `src/agent/prompts/i18n.ts` | 向后兼容 shim（委托给 registry） |
| `src/agent/prompts/core/inspectional.ts` | S1 Inspectional 模块化定义（含原 S0 Router） |
| `src/agent/prompts/core/pre-search.ts` | S2-Pre 早停模块化定义 |
| `src/agent/prompts/core/analytical.ts` | S2 Analytical 模块化定义 |
| `src/agent/prompts/core/syntopical.ts` | S3 Syntopical 模块化定义 |
| `src/agent/prompts/core/socratic.ts` | Socratic 模块化定义 |
| `src/agent/prompts/core/formatter.ts` | S4 Formatter 模块化定义 |
| `src/agent/prompts/core/proactive.ts` | Proactive 模块化定义 |
| `src/agent/prompts/auxiliary/advisor.ts` | 阅读顾问模块化定义 |
| `tests/unit/agent/prompts/*.test.ts` | 13 个测试文件，63 个用例 |

---

## Limitations [INFERENCE]

### 通用

- **无 prompt 模板变量系统** —— 字符串拼接 + 模板字面量，**没用 handlebars / mustache**
- **无 i18n** —— 提示词写死中文
- **无 A/B 测试框架** —— 同一节点可能想对比"指令型 vs 提问型" prompt 效果
- **无版本控制** —— prompt 改了 git diff 难回滚
- **prompt 长度不统一** —— analytical 231 行 vs socratic 14 行

### 上下文注入

- **没有 token 预算管理** —— 4 块全量注入，**超长上下文时 token 超限**
- **没有 prompt 缓存** —— 同样 `tocSummary` 每次都重算
- **dynamic 块拼接顺序硬编码** —— 想换顺序得改源码
- **`markdownFiles` 注入可能爆炸** —— 大书的 .md 文件列表可能上千

### 各 prompt 专属

#### router

- **JSON 解析失败** → 节点崩（LangGraph 默认抛错）
- **没有 few-shot 示例** —— 6 种 intent 难理解
- **A-F 6 种分类**对长输入可能混淆

#### analytical

- **11 字段 context**——漏一个字段可能让 LLM 输出错
- **没有"系统级"注入**——所有上下文都是用户级
- **工具调用参数 schema**——靠工具定义自己，**没在 prompt 里强调**

#### formatter

- **10 条规则**写死——LLM 难全部遵守
- **"读书笔记风格"模糊**——什么是"像朋友"？**没有示例**
- **wiki 链接规则严格**——任何编造都被禁止，**但 LLM 仍可能偷偷加**

#### pre-search

- **丢失 betterQuestion / structuralAnalysis**（已知 bug）—— 黄金集 case 1 / 2 锁定
- **块截断到 200 字**——长段落截断位置**不可控**

#### syntopical

- **多书结果可能冲突**——`formatSynthesis` 没说怎么处理"作者 A 说 X / 作者 B 说反 X"
- **3 维比较（立场/论据/结论）**——可能漏掉其他维度

#### socratic

- **极简 14 行**——**可能不够**（"问题设计需要多轮思考"）

#### proactive-formatter

- **触发后用户必须主动**——"引导消息注入到输入框" 是否好，**没 A/B**

---

## 统一提示词管理系统

> 2026-06-16 / 2026-06-17：基于模块化注册表的提示词管理系统，消除 side-effect 注册，统一 Excalidraw prompt。

### 设计目标

| 目标 | 实现 |
|------|------|
| 消除 side-effect 注册 | 所有 prompt 文件末尾的 `import ...` 自注册 → 统一走 `registerAllPrompts()` |
| 单注册入口 | `main.ts:onload()` 调用一次 `registerAllPrompts()` 完成全部初始化 |
| 版本控制 | 每个模块语义化版本号 + `PromptVersionManager` + changelog |
| i18n | PromptModule 内嵌 `locales.zh` / `locales.en`，`PromptRegistry` 统一管理 locale |
| 可测试性 | 每个模块独立单元测试，测试无需加载插件 |

### 架构概览

```
src/agent/prompts/
├── types.ts                    # PromptModule / PromptLocale / PromptRegistry 类型
├── registry.ts                 # PromptRegistryImpl：注册、查询、locale、filter
├── version.ts                  # PromptVersionManager：版本追踪 + changelog
├── index.ts                    # 统一导出 + registerAllPrompts() 批量注册
├── i18n.ts                     # (deprecated) 向后兼容 shim，委托给 registry
├── core/                       # 核心 7 个 Agent 提示词
│   ├── inspectional.ts         # S1 Inspectional（含原 S0 Router, id: inspectional.s1）
│   ├── pre-search.ts           # S2-Pre（id: pre-search.s2-pre）
│   ├── analytical.ts           # S2 Analytical（id: analytical.s2）
│   ├── syntopical.ts           # S3 Syntopical（id: syntopical.s3）
│   ├── socratic.ts             # Socratic（id: socratic）
│   ├── formatter.ts            # S4 Formatter（id: formatter.s4）
│   └── proactive.ts            # Proactive（id: proactive）
├── auxiliary/                  # 辅助提示词
│   ├── advisor.ts              # 阅读顾问（id: advisor）
│   ├── diagram.ts              # Excalidraw 图形生成（id: diagram.excalidraw）
│   ├── memory.ts               # 对话整合 + 记忆压缩（id: memory.*）
│   ├── profile-builder.ts      # 用户画像提取 + 综合（id: profile.*）
│   └── tts.ts                  # TTS 口语化/语音/播报（id: tts.*）
└── utils/                      # prompt 构造工具函数
    ├── index.ts                # barrel export
    ├── early-stop.ts           # buildEarlyStopPrompt()
    ├── tree-formatter.ts       # formatTreeStructure()
    ├── scoped-chapters.ts      # buildScopedChaptersBlock()
    ├── analytical-helpers.ts   # buildFullAnalyticalContext()
    ├── inspectional-helpers.ts # buildInspectionalSystemPrompt/UserMessage()
    ├── formatter-helpers.ts    # buildFormatterSystemPrompt/UserMessage()
    ├── proactive-helpers.ts    # buildProactiveSystemPrompt/UserMessage()
    ├── socratic-helpers.ts     # buildSocraticDialoguePrompt/UserMessage()
    └── syntopical-helpers.ts   # buildSyntopicalUserMessage()
```

### PromptModule 定义

```typescript
interface PromptModule {
  id: string;                    // 唯一标识，如 'inspectional.s1'
  version: string;               // 语义化版本，如 '1.0.0'
  name: string;                  // 显示名称
  description?: string;          // 简短描述
  metadata: {                    // 元数据
    node?: string;               // 对应 LangGraph 节点名
    category: 'core' | 'auxiliary' | 'evaluation';
    tokenEstimate?: number;      // 估算 token 数
    tags?: string[];             // 搜索/分类用
  };
  locales: {                     // 多语言
    zh: PromptLocale;
    en?: PromptLocale;
  };
  // 可选动态构建函数
  buildSystemPrompt?: (ctx: Record<string, unknown>) => string;
  buildUserMessage?: (ctx: Record<string, unknown>) => string;
}
```

### 注册流程

```
main.ts:onload()
  └→ registerAllPrompts()         (index.ts)
       ├→ promptRegistry.register(mod)   — 注册到注册表
       └→ promptVersionManager.register(mod) — 记录版本 + changelog
```

关键变化：
- **以前**：每个 prompt 文件末尾有 `import { promptRegistry } from './registry.js'; promptRegistry.register(...)` 自注册
- **现在**：`index.ts` 导入所有模块 → `registerAllPrompts()` 统一注册 → `main.ts` 调用一次

### 使用方式

```typescript
import { registerAllPrompts, promptRegistry } from './prompts/index.js';

// 批量注册
registerAllPrompts();

// 获取提示词
const inspectionalPrompt = promptRegistry.get('inspectional.s1');
inspectionalPrompt.systemPrompt  // 当前 locale 的 systemPrompt

// i18n
promptRegistry.setLocale('en');
const englishPrompt = promptRegistry.get('inspectional.s1');
const zhPrompt = promptRegistry.get('inspectional.s1', 'zh'); // 强制中文

// 查询
const coreModules = promptRegistry.list({ category: 'core' });
const diagramRelated = promptRegistry.list({ tags: ['diagram'] });
```

### i18n 管理

locale 状态由 `PromptRegistryImpl` 统一管理（单一状态源），而非分散在各文件中：

```typescript
promptRegistry.setLocale('en');
promptRegistry.getLocale();  // → 'en'
```

> ⚠️ `promptI18n` (`i18n.ts`) 已废弃，新代码直接使用 `promptRegistry.setLocale()`。

### Excalidraw Prompt 统一

main 分支独立创建了 `excalidraw-prompts.ts`（105 行裸字符串），与 prompt-management 的 `auxiliary/diagram.ts`（`PromptModule`）重复并分化。已通过以下方式统一：

1. **`diagram.ts`**: version 1.0.0→1.1.0，zh `systemPrompt` 升级为 `SHARED_DIAGRAM_PROMPT` 的进化版（设计哲学、节点规模层级、semanticColor 色板、形状语义映射、连接规则）
2. **`excalidraw-prompts.ts`**: 从裸字符串改为 3 行 shim，re-export `diagramPrompt.locales.zh.systemPrompt`
3. **消费者**: `diagram-helper.ts` 和 `excalidraw.ts` 导入路径不变

数据流：
```
auxiliary/diagram.ts (PromptModule, 已注册, 唯一源)
       │ re-export .locales.zh.systemPrompt
       ▼
excalidraw-prompts.ts (shim)
       │
       ├──→ diagram-helper.ts          (generateDiagram / progressive)
       └──→ tools/definitions/excalidraw.ts  (LangChain tool description)
```

### 版本控制

每个模块有语义化版本号。变更通过 `PromptVersionManager` 追踪：

```typescript
promptVersionManager.getVersion('inspectional.s1');    // → '1.0.0'
promptVersionManager.getChangelog('inspectional.s1');
// → [{ version: '1.0.0', date: '2026-06-16', changes: ['初始版本'] }]
```

### 测试覆盖

| 层级 | 范围 | 数量 |
|------|------|------|
| 注册表 | registry CRUD + filter + locale + 覆盖警告 | 13 用例 (registry.test.ts) |
| 类型 | PromptModule 结构校验 | 6 用例 (types.test.ts) |
| i18n shim | 废弃 shim 的委托验证 | 4 用例 (i18n.test.ts) |
| 版本管理 | 注册 + changelog + 版本比较 + 不重复注册 | 4 用例 (version.test.ts) |
| 核心模块 (×8) | id/version/locales 存在性 + 内容关键片段 | 5 用例/模块 |
| 辅助模块 (×5) | 同上 | 6-13 用例/模块 |
| 总计 | 13 测试文件 | 63+ 用例 |

### 演进里程碑

| 阶段 | 日期 | 变化 |
|------|------|------|
| Phase 0 | 2026-06-10 前 | 各 prompt 文件独立，side-effect import 注册，无统一管理 |
| Phase 1 | 2026-06-16 | PromptModule 类型 + PromptRegistry + version 管理器；`registerAllPrompts()` 入 main.ts |
| Phase 2 | 2026-06-17 | utils 拆分；消除 side-effect 注册；Excalidraw prompt 统一（解决 main 分支冲突） |

---

| 日期 | 变更 |
|---|---|
| 2026-06-17 | 补充辅助模块列表、Excalidraw 统一方案、注册流程、演进里程碑、测试覆盖统计 |
| 2026-06-16 | 新增统一提示词管理系统章节 |
| 2026-06-10 | 初版：XML 标签结构 + AnalyticalPromptContext 共享接口 + 8 节点 prompt 总览 + 跨节点共享模式 + 19 条已知限制 |
