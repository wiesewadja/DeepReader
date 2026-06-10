# 工具执行模型（Tools Execution Model）
> DeepReader Agent 的"工具调用 + 循环控制 + 结果压缩"机制——LangGraph ReAct 子图与
> Plan-Execute-Replan 子图共享 `tool-execution.ts` 工具调用基础设施。
>
> 配套阅读：[系统鸟瞰.md 第 4 节 工具集](../architecture/系统鸟瞰.md#tools)、
> [意图路由系统.md](../architecture/意图路由系统.md)（动态 allowedTools 限制）、
> [书籍搜索系统.md](../architecture/书籍搜索系统.md)（工具的检索实现）、
> [早停决策原理与问题.md](../architecture/早停决策原理与问题.md)（plan-execute 与早停的关系）。
---
## 目录
1. [设计意图：让 LLM "以受控方式调工具"](#why)
2. [三层工具集分类（local / weRead / memory）](#layers)
3. [工具定义：definitions/ 与 local/ 双目录](#definitions)
4. [共享基础设施：tool-execution.ts](#tool-execution)
5. [ReAct 子图：循环 + loop 检测](#react)
6. [Plan-Execute-Replan 子图：2 轮规划 + 并行执行](#plan-execute)
7. [压缩与 block_id 提取](#compression)
8. [关键源文件](#files)
9. [已知限制](#limits)
---
## Why
LangChain 工具的"原始"调用模型是：
```
LLM 决定调什么工具 → 工具返回结果 → LLM 决定下一步 → 循环
```
DeepReader 不能直接用 LangChain 默认模型——三个问题：
1. **没有上限**——LLM 可能无限循环（token 成本失控）
2. **没有 loop 检测**——LLM 可能反复搜同一关键词
3. **没有压缩**——长工具结果塞满 context window
`tool-execution.ts` + `react-loop.ts` + `plan-execute.ts` 解决这三个问题。
---
## Layers
`src/agent/tools/` 下分 3 个子目录：
| 目录 | 职责 | 文件数 | 示例 |
|---|---|---|---|
| **`local/`** | 读本地索引（不依赖外部 API） | 4 | `search-text.ts` / `read-section.ts` |
| **`definitions/`** | 通用工具定义（LangChain 工具 schema） | 8 | `search-book.ts` / `write-note.ts` / `weread-tools.ts` |
| **`context/`** | 工具上下文注入（book / vault / weread） | 6 | `book.ts` / `vault.ts` / `weread.ts` |
### local/ vs definitions/ 区别
- **`local/`** = 工具**实现**（函数体），**强依赖** vault（移动端兼容）
- **`definitions/`** = 工具**schema**（name / description / zod schema），**弱依赖**
`definitions/*` 里的大多数工具**最终委托**到 `local/*`——`definitions` 是 LangChain 工具协议适配层，`local` 是真正的逻辑实现。
### context/ 的作用
工具调用时需要"上下文"——当前是哪本书、vault 路径、plugin 实例。`context/*` 模块封装这些环境信息，**避免工具实现里到处传参数**：
```typescript
// context/book.ts
export function getCurrentBookContext(plugin: DeepPDFSettings, ...): BookContext {
  return { bookId, pdfName, currentNodeId, scopeNodeIds };
}
```
工具实现里直接 `getCurrentBookContext()` 即可，**不传 5 个参数**。
---
**位置**：`src/agent/tools/definitions/`
### 8 个工具 schema 文件
| 文件 | 工具名 | 用途 | 实现位置 |
|---|---|---|---|
## Definitions
| `read-section.ts` | `read_markdown_section` | 按标题深入读章节 | `local/read-section.ts` |
| `search-journal.ts` | `search_journal` | 用户日记/笔记检索 | `local/search-journal.ts` |
| `search-read-books.ts` | `search_read_books` | 跨书 RAG 检索 | `search-read-books.ts` |
| `write-note.ts` | `write_note` | 写笔记到 vault | `write-note.ts` |
| `memory.ts` | `add_memory` / `search_memory` | 长期记忆读写 | `memory.ts` |
| `profile.ts` | `get_user_profile` / `update_user_profile` | 用户画像 | `profile.ts` |
| `weread-tools.ts` | `weread_*` (5 个) | 微信读书 API | `src/weread/api/client.ts` |
### 工具定义模式
**位置**：`src/agent/tools/definitions/search-book.ts`
```typescript
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
const SearchBookInputSchema = z.object({
  query: z.string().describe('搜索关键词'),
  maxResults: z.number().default(10).describe('最大结果数'),
});
export const searchBookTool = tool(
  async (args, config) => {
    return await searchMarkdownText(args, config);
  },
  {
    name: 'search_markdown_text',
    description: '在当前书的索引中全文搜索关键词...',
    schema: SearchBookInputSchema,
  }
);
```
**关键设计**：
- **zod schema** —— 输入类型约束 + LLM 自动知道每个参数含义
- **`name` 是 stable ID** —— `search_markdown_text` 不会改（IntentRouter + LLM 调用的契约）
- **description 是 LLM 决策依据** —— 写得好 LLM 选得对，写得差 LLM 选错
---
**位置**：`src/agent/graph/subgraphs/tool-execution.ts`（200 行）
### 3 大功能
| 函数 | 职责 |
|---|---|
## Tool Execution
| `extractBlockIdsFromResult` | 从工具结果提取 `^block_id` 锚点 |
| `compressMessagesForLLM` | 多条消息整体压缩，保留最近 N 条全量 |
| `executeToolBatch` | 并行执行多个工具 + 收集结果 |
| `executeSingleToolCall` | 单个工具执行 + 异常捕获 |
### ReactLoopConfig
```typescript
interface ReactLoopConfig {
  tools: StructuredToolInterface[];     // 工具集（已由 IntentRouter 过滤）
  model: ChatOpenAI;                    // LLM
  maxIterations: number;                // 迭代上限（来自 IntentRouter）
  maxToolCalls: number;                 // 工具调用总数上限
  forcedConclusionContext?: {            // 强制结束时的 book 上下文
    pdfName?: string;
    scopeNodeIds?: string[];
  };
  toolInterceptor?: (toolName, args) => args;  // 工具参数拦截器
  signal?: AbortSignal;                  // 取消 / 超时
  onProgress?: (message: string) => void;      // UI 通知
}
```
**关键设计**：
- **`toolInterceptor`** —— 路由层可在工具调用前**改写 args**（如自动注入 `scope_node_ids`）
- **`signal`** —— 用户取消/超时直接 abort，**不卡死**
- **`onProgress`** —— UI 可监听（"计划中..." / "执行工具 2/5" 等）
---
## ReAct
**位置**：`src/agent/graph/subgraphs/react-loop.ts`（349 行）
### State 定义
```typescript
const ReactAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  iterationCount: Annotation<number>({ ... default: () => 0 }),
  toolCallCount: Annotation<number>({ ... default: () => 0 }),
  queriesAsked: Annotation<Record<string, string[]>>({ ... default: () => ({}) }),  // ← loop 检测
  toolResults: Annotation<ToolResultRecord[]>({ ... default: () => [] }),
  _maxIterations: Annotation<number>({ default: () => 8 }),  // 默认 8
  _maxToolCalls: Annotation<number>({ default: () => 5 }),     // 默认 5
});
```
**关键字段**：
- **`queriesAsked`** —— **记录已问过的查询**，loop 检测用（同一查询不重复调）
- **`_maxIterations: 8`** —— 硬上限（IntentRouter 算的值会覆盖）
### Loop 检测
```typescript
function extractQueryKey(toolName, args): string | null {
  // 提取"语义查询键"——相同查询被识别
  if (toolName === 'search_markdown_text') {
    return `search:${args.query}`;
  }
  // ... 其他工具的 key 提取
}
```
**算法**：
- 每条工具调用 → 提取 `queryKey`
- `queriesAsked[queryKey] = [...existing, newQueryHash]`
- 下次调同一查询 → `loop_detected` finishReason
### 4 种 finishReason
```typescript
type FinishReason =
  | 'stop'              // LLM 主动停止（生成 final answer）
  | 'max_iterations'    // 达到 maxIterations
  | 'max_tool_calls'    // 达到 maxToolCalls
  | 'loop_detected';    // 重复查询
```
**为什么 4 种**：S4 formatter 节点要"软强制"让 LLM 收尾（不一定要 stop），不同 finishReason 触发不同 system prompt 追加。
---
## Plan-Execute
**位置**：`src/agent/graph/subgraphs/plan-execute.ts`（130 行）
### 设计
```typescript
/**
 * Plan-Execute-Replan: iterative planning with bounded rounds.
 *
 * Round 1: Plan → Execute in parallel
 * Round 2 (optional): Replan based on results → Execute again
 * Final: Synthesize all gathered information
 *
 * Total: 2-3 LLM calls (vs ReAct's 4-6).
 */
```
**对比 ReAct**：
- ReAct：1 个 LLM 决定下一步 → 1 个工具 → 循环（每步 1 次 LLM 调用）
- Plan-Execute：1 个 LLM 列计划 → N 个工具并行 → 1 个 LLM 总结（**节省 LLM 调用**）
### 流程
```
Round 1: Plan(1 LLM) → 决定调哪些工具
       Execute(parallel) → 并行执行所有工具
       Replan? → 如果 Round 1 结果不全，进入 Round 2
Round 2: Replan(1 LLM, sees Round 1 results) → 决定补充哪些工具
       Execute(parallel) → 并行执行补充工具
Final:   Synthesize(1 LLM) → 输出最终答案
```
**默认 maxPlanRounds = 2**（`Math.max(1, Math.min(maxToolCalls, 2))`）—— 至少 1 轮，最多 2 轮。
### 何时选 Plan-Execute 而不是 ReAct？
**位置**：S2 Analytical 节点的 `runPlanExecute` vs `reactLoop` 选择
```typescript
// 经验性启发式 [INFERENCE]
if (用户问题需要"批量检索"——如"对比两本书")
  → runPlanExecute (一次列多个查询，并行)
else
  → reactLoop (按需逐步调)
```
**Plan-Execute 优势**：
- LLM 调用少（2-3 vs 4-6）
- 并行执行快（多工具一次调完）
**Plan-Execute 劣势**：
- 第一轮没看到工具结果 → 计划可能错
- 重新规划能力有限（最多 2 轮）
---
## Compression
**位置**：`tool-execution.ts:55-77`
### 单条截断
```typescript
const MAX_TOOL_RESULT_LENGTH = 2000;  // 来自 agent-constants.ts
function compressToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) return result;
  const truncated = result.slice(0, MAX_TOOL_RESULT_LENGTH);
  const omitted = result.length - MAX_TOOL_RESULT_LENGTH;
  return `${truncated}\n\n... [已省略 ${omitted} 字符]`;
}
```
**为什么 2000 字符**：
- LLM 上下文窗口有限（典型 8k-128k）
- 单条工具结果 2000 字 = 约 500 token
- 6 条工具 = 3000 token，**留 5k+ 给其他内容**
### 多条整体压缩
```typescript
const MAX_FULL_TOOL_MESSAGES = 3;  // 保留最近 3 条全量
function compressMessagesForLLM(messages: BaseMessage[]): BaseMessage[] {
  // 找到最近 3 条 tool 消息
  // 之前的 tool 消息 → 用 compressToolResult 截断
}
```
**策略**：**最近的全保留 + 历史的截断**——LLM 通常引用最近结果，历史的只要"在 prompt 里能看到过"即可。
### block_id 提取
```typescript
function extractBlockIdsFromResult(result: string): string[] {
  const ids: string[] = [];
  // 匹配 `^xxx` 锚点
  for (const match of result.matchAll(/\^([\w-]+)/g)) {
    if (!/^calibre-pb-\d+$/.test(match[1])) {  // 排除 calibre 假 ID
      ids.push(match[1]);
    }
  }
  return ids;
}
```
**为什么**：
- LLM 输出里 `[[file#^block|alias]]` 的 `^block` 来自工具结果
- **`verifyAndCleanContent`** 需要对照工具结果验证 LLM 没编造
- **`calibre-pb-*` 排除**——EPUB 导出时分页符（不是真 block_id）
---
## 关键源文件 (files)
| 文件 | 职责 |
|---|---|
| `src/agent/tools/index.ts` | 公开 API 入口 |
| `src/agent/tools/types.ts` | 工具类型定义 |
| `src/agent/tools/local/search-text.ts` | `search_markdown_text` 工具实现（325 行） |
| `src/agent/tools/local/read-section.ts` | `read_markdown_section` 工具实现（321 行） |
| `src/agent/tools/local/utils.ts` | 工具通用工具函数 |
| `src/agent/tools/local/types.ts` | local 工具类型 |
| `src/agent/tools/definitions/*.ts` | 8 个工具 schema 文件（zod + tool()） |
| `src/agent/tools/context/book.ts` | 书籍上下文注入 |
| `src/agent/tools/context/vault.ts` | vault 上下文注入 |
| `src/agent/tools/context/weread.ts` | WeRead 上下文注入 |
| `src/agent/tools/memory.ts` | 记忆工具实现 |
| `src/agent/tools/profile.ts` | 用户画像工具实现 |
| `src/agent/tools/search-read-books.ts` | 跨书 RAG 工具实现 |
| `src/agent/tools/write-note.ts` | write_note 工具实现 |
| `src/agent/graph/subgraphs/react-loop.ts` | ReAct 子图（349 行，loop 检测 + 4 finishReasons） |
| `src/agent/graph/subgraphs/plan-execute.ts` | Plan-Execute-Replan 子图（130 行，2 轮规划） |
| `src/agent/graph/subgraphs/tool-execution.ts` | 共享工具执行 + 压缩 + block_id 提取（200 行） |
| `src/agent/config/agent-constants.ts` | `MAX_TOOL_RESULT_LENGTH` / `MAX_FULL_TOOL_MESSAGES` 常量 |
| `tests/unit/agent/tools/local/*.test.ts` | 工具实现单测 |
| `tests/unit/agent/graph/react-loop.test.ts` | ReAct 循环单测 |
---
## 已知限制 (limits)
### 通用
- **压缩是无损可逆的截断**——只丢尾部，**不抽象总结**（LLM 看到的尾部 = 实际工具返回的尾部）
- **block_id 提取用 regex**——不解析 Markdown AST，可能误识别
- **calibre-pb-* 排除是硬编码正则**——如果未来换导出工具可能需要更新
### ReAct
- **queriesAsked 内存 Map**——重启 Obsidian 后清零，**loop 检测不能跨重启**
- **loop 检测只看"完全相同查询"**——改一个字就过（"X" vs "X 的含义"）
- **`maxIterations: 8` 硬编码**——IntentRouter 设置的值会覆盖，但**默认 8 偏多**
### Plan-Execute
- **maxPlanRounds 上限 2**——跨书对比等复杂任务可能不够
- **Replan 看不到 Round 2 之后的历史**——再补一轮的 Replan 实际是 Round 2
- **不区分"工具调用成功但结果空"**——空结果也消耗 1 轮
### 工具定义
- **description 写得不规范**——LLM 选错工具的常见原因（`search-book.ts` 描述含糊）
- **zod schema 不支持 union type**——复杂参数需要拆成多个工具
- **工具的"输入示例" 缺失**——LLM 看不到正确用法的 few-shot
---
| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/tools/*` 23 文件 2120 行 + `src/agent/graph/subgraphs/*` 3 文件 679 行的架构视角文档。3 层工具分类 + ReAct/Plan-Execute 双循环 + 压缩 + 9 条已知限制 |