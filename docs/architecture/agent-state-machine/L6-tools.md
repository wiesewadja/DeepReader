# L6 — 工具层

> 13 个工具的定义、注册、错误处理
>
> 状态机节点不直接调外部 API/IO，而是通过工具抽象。L6 是"工具的实现"。

---

## 1. 现状

### 1.1 角色定位

L6 是状态机与外部世界（Vault、文件、网络 API）的桥梁：

| 职责 | 说明 |
|------|------|
| **工具定义** | 13 个工具的 name/description/Schema |
| **实现** | 实际执行逻辑（搜索/读取/写入/搜索历史等） |
| **注册** | 通过 `createLangChainTools(ctx)` 工厂模式 |
| **错误处理** | 工具级 try/catch，子图层兜底 |
| **条件注册** | 依赖配置（journalDir、wereadApiKey）才注册的工具有 |

### 1.2 工具清单

| 工具名 | 类别 | 描述 | Schema 关键字段 | 实现位置 |
|--------|------|------|------------------|----------|
| `search_book` | search | 多查询并行 + RRF 融合检索书中段落（BM25+Vector+Proposition+标注 9 阶段） | `keywords: string[]`, `scope_node_ids?: string[]` | definition: `definitions/search-book.ts`；实现: `local/search-text.ts`（`searchBookTool`） |
| `read_book_section` | read | 读章节内容（4 种定位：批量 `node_ids` / 单 `node_id` / `block_id` / `heading` 模糊） | `node_ids?: string[]`, `node_id?: string`, `block_id?: string`, `heading?: string` | definition: `definitions/read-section.ts`；实现: `local/read-section.ts`（`readBookSectionTool`） |
| `write_note` | write | 写入/追加笔记到 Vault（带 `aicreate` frontmatter 安全标记） | `path: string`, `content: string`, `mode?: 'create'\|'overwrite'\|'append'` | definition: `definitions/write-note.ts`；实现: 顶层 `write-note.ts`（`writeNoteTool`） |
| `save_memory` | memory | 保存信息到长期记忆（追加 HISTORY.md + 更新 MEMORY.md） | `history_entry: string`, `memory_update?: string` | definition: `definitions/memory.ts`；实现: 顶层 `memory.ts`（`saveMemoryTool`） |
| `search_memory` | memory | 搜索 MEMORY.md + HISTORY.md | `query: string` | definition: `definitions/memory.ts`；实现: 顶层 `memory.ts`（`searchMemoryTool`） |
| `update_profile` | profile | 更新 DeepReader.md 画像字段（按 section/field 定位） | `section: enum`, `field: string`, `value: string`, `mode?: 'append'\|'replace'` | definition: `definitions/profile.ts`；实现: 顶层 `profile.ts`（`updateProfileTool`） |
| `search_read_books` | cross-book | 跨书搜索 BOOK_NOTES_DIR 已读书库的章节 | `query: string`, `top_k?: number` | definition: `definitions/search-read-books.ts`；实现: 顶层 `search-read-books.ts`（`searchReadBooksTool`） |
| `search_journal` | journal | 搜索用户个人笔记（依赖 `visual.journalDir`） | `query: string`, `topK?: number` | 仅 definition: `definitions/search-journal.ts`（内联 `JournalSearchService.search`） |
| `weread_search` | weread | 搜索微信读书书籍库 | `keyword: string`, `scope?: number`, `count?: number` | 仅 definition: `definitions/weread-tools.ts` |
| `weread_recommend` | weread | 个性化推荐 | `count?: number` | 同上 |
| `weread_readdata` | weread | 阅读时长/天数/偏好统计 | `mode?: 'weekly'\|'monthly'\|'annually'\|'overall'` | 同上 |
| `weread_book_info` | weread | 书籍详情 | `bookId: string` | 同上 |
| `weread_notebooks` | weread | 笔记概览 | `count?: number` | 同上 |

### 1.3 ToolContext 全景

```typescript
interface ToolContext {
  vault: VaultContext;            // { app: App; plugin: DeepReaderPluginInterface }
  book: BookContext;              // { indexId, pdfName, markdownFiles, localCache?, currentNodeId, ... }
  crossBook?: CrossBookContext;   // { booklistBookIds, crossBookMode, bookshelfSummary, indexedBooks }
  weread?: WereadContext;         // { wereadClient? }
  visual?: VisualContext;         // { infographicConfig?, journalDir? }

  // 图节点专用（向后兼容）
  useLLMTreeSearch?: boolean;
  scopeNodeIds?: string[];
  quotes?: QuoteItem[];
  ttsConfig?: { apiKey, baseUrl, model?, provider? };
  llmConfig?: { apiKey, baseUrl, model? };
  mode?: EngineMode;
  proactiveTrigger?: string;
  highlightContext?: string[];
}
```

子上下文（`VaultContext` / `BookContext` / `CrossBookContext` / `WereadContext` / `VisualContext`）定义在 `tools/context/`。

**`BookContext.localCache`**：是 `LocalToolCache`（含 `treeData` + `nodeTitleMap`），由 `getOrBuildLocalCache` 从 `.pageindex/{bookId}/tree.json` 加载并缓存。

**`DeepReaderPluginInterface`**（`vault.ts`）暴露 `settings/saveSettings/manifest/pluginId/profileBuilder/readingModeService/getFrontendAgent`。

### 1.4 工具注册流程

**统一入口**：`createLangChainTools(ctx)`（`tools/index.ts:44`）

```typescript
export function createLangChainTools(ctx: ToolContext): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [
    createSearchBookTool(ctx),     // base
    createReadBookSectionTool(ctx),// base
    createWriteNoteTool(ctx),      // base
    createSaveMemoryTool(ctx),     // base
    createSearchMemoryTool(ctx),   // base
    createUpdateProfileTool(ctx),  // base
    createSearchReadBooksTool(ctx),// base
  ];

  // 条件注册
  if (ctx.visual?.journalDir) {
    tools.push(createSearchJournalTool(ctx));
  }
  if (ctx.vault?.plugin?.settings?.wereadApiKey) {
    tools.push(
      createWereadSearchTool(ctx),
      createWereadRecommendTool(ctx),
      createWereadReadDataTool(ctx),
      createWereadBookInfoTool(ctx),
      createWereadNotebooksTool(ctx),
    );
  }

  return tools;
}
```

**基础 7 个工具** 无条件注册。**条件注册**：
- `search_journal`：仅当 `ctx.visual?.journalDir` 存在
- 5 个 WeRead 工具：仅当 `ctx.vault?.plugin?.settings?.wereadApiKey` 存在

### 1.5 工具实现模式

每个工具都实现 `ToolExecutor` 接口（`definitions/types.ts:9`）：

```typescript
interface ToolExecutor<TArgs = any, TOutput = string> {
  definition: ToolDefinition;
  execute(args: TArgs, ctx: ToolContext): Promise<TOutput>;
}
```

**工厂模式**：
```typescript
type ToolFactory = (ctx: ToolContext) => StructuredToolInterface;
```

**LangChain 注册形式**：每个工具都通过 `tool(fn, { name, description, schema })` 包装成 `DynamicStructuredTool`（来自 `@langchain/core/tools`）。

**绑定到模型**：`model.bindTools(tools)`（`plan-execute.ts:56`）

**两种工具形态并存**：
- v1 老式 `ToolDefinition`（自建 JSON Schema） + `execute()` 形态
- v2 LangChain `tool()` 包装形态

多数工具同时提供两种导出（单例 + 工厂），便于不同调用场景。

### 1.6 错误处理分级

| 处理方式 | 工具/位置 | 行为 |
|----------|-----------|------|
| 完全 try/catch，返回 JSON 错误对象 | `search_book`, `read_book_section` | `{ status: 'ERROR_xxx', message: '...' }` |
| try/catch，返回字符串错误 | `save_memory`, `search_memory`, `update_profile`, `write_note`, `search_read_books` | `Error: xxx` |
| try/catch，返回带 status JSON | `search_journal`, WeRead 5 工具 | `JSON.stringify({ status: 'ERROR', message })` |
| **子图层兜底** | `executeSingleToolCall` | 工具 throw 时转 `Error: <msg>` ToolMessage |
| **未配置 API Key 早返回** | WeRead 工具 | 静默跳过 / 返回配置错误 |
| **空操作** | `search_journal` 未配置 | `{ status: 'SKIP', message: '未配置笔记目录' }` |
| **辅助静默** | `search-text.ts:258` | 单关键词失败 `catch { return [] }` |

**关键观察**：**没有任何工具直接 throw**——所有异常都被 try/catch 转字符串/JSON 返回。这是 LLM 循环的"防中断"机制。

### 1.7 search_book 实现细节

`local/search-text.ts` 是最复杂的工具实现（200+ 行），涉及：
- **9 阶段检索**（推测，未完整读）：
  1. 关键词分词
  2. BM25 召回
  3. 向量召回
  4. 命题（proposition）召回
  5. 标注（annotation）召回
  6. RRF 融合
  7. 重排
  8. 章节定位
  9. 摘要生成
- **多查询并行**：`Promise.all(keywords.map(searchSingle))`
- **RRF 融合**：k-Reciprocal Rank Fusion
- **scope 过滤**：受 `scope_node_ids` 限制

**错误处理**：单关键词失败 `catch { return [] }`，整体继续。

### 1.8 read_book_section 4 种定位

- **批量** `node_ids: string[]`：一次读多个章节（高效）
- **单** `node_id: string`：单个章节
- **`block_id: string`**：精确到段落（结合 `^` 前缀）
- **`heading: string`**：模糊匹配章节标题

工具内部根据参数选择定位方式。

### 1.9 write_note 安全标记

`write-note.ts` 写入时自动加 `aicreate` frontmatter 标记：

```yaml
---
aicreate: 2026-06-05 10:41
---
```

这是 DeepReader 的"安全标记"——用户可以在 Obsidian 中按 `aicreate` 字段过滤 AI 生成的笔记。

### 1.10 S2 工具白名单

S2 Analytical 节点只用子集：

```typescript
const s2ToolNames = ['search_book', 'read_book_section'];
const ctxTools = createLangChainTools(ctx);
const tools = ctxTools.filter(t => s2ToolNames.includes(t.name));
```

**屏蔽了** memory / profile / write_note / weread 等 9+ 工具。

---

## 2. 已知问题

### 2.1 工具错误格式不统一

**现象**：
- `search_book` / `read_book_section` 返回 `{ status: 'ERROR_xxx', message }`
- `memory` / `profile` 类返回 `Error: xxx` 字符串
- `search_journal` 返回 `JSON.stringify({ status, message })`

**后果**：
- LLM 看到三种格式，prompt 设计困难
- 后续 verifyAndCleanContent 无法区分错误类型
- Eval 跑分难以归类

**建议**：统一为 `JSON.stringify({ status: 'OK' | 'ERROR', code, message, data? })`。

### 2.2 工具的"硬编码白名单"

**现象**：
- S2: `s2ToolNames = ['search_book', 'read_book_section']`
- Advisor: `advisorToolNames = [...]`（写在 advisor.ts 里）
- Syntopical: 内部跨书搜索

**问题**：
- 3 个节点各自维护白名单
- 新增工具需要在 3 个地方同步
- 没有"工具可用性"配置文件

**建议**：`src/agent/config/tool-permissions.ts` 集中管理。

### 2.3 工具实现的两套形态

**现象**：v1 `ToolDefinition` + `execute()` 和 v2 LangChain `tool()` 包装并存。

**问题**：
- 维护成本
- 单测需要写两套
- 文档需要解释两套

**建议**：长期统一到 v2（LangChain tool 包装）。

### 2.4 search_book 9 阶段未文档化

**现象**：`search-text.ts` 涉及 9 阶段检索，但代码里没有注释解释每个阶段做什么。

**后果**：
- 后续优化困难
- 新人 onboarding 慢
- 性能调优无依据

**建议**：在文件顶部加 ARCHITECTURE.md 注释。

### 2.5 ToolContext 字段膨胀

**现象**：ToolContext 已经有 10+ 字段，且字段在 `tools/context/*.ts` 子文件里拆分布局。

**问题**：
- 修改 ToolContext 时需要在 4 个文件同步
- 字段语义边界模糊（如 `ttsConfig` 放在 ToolContext 里？）

**建议**：把 ToolContext 拆为：
- `CoreToolContext`（vault/book，工具都必需）
- `OptionalToolContext`（crossBook/weread/visual，按工具需求注入）
- `RuntimeMetadata`（ttsConfig/llmConfig/abortSignal，L1 才用）

### 2.6 工具的"无日志"

**现象**：工具内部几乎没有 logger 调用（推测，需要确认）。

**后果**：
- 工具失败时排错困难
- LangSmith trace 看不到工具内部细节

**建议**：工具级 trace span（与 LangSmith 集成）。

### 2.7 工具调用缺少超时控制

**现象**：`tool-execution.ts` 有 `TOOL_EXECUTION_TIMEOUT_MS=60000` 常量，但**没看到实际使用**（推测，需要确认）。

**后果**：
- 慢工具（如 weRead 跨网络）可能让 LLM 循环卡住
- Plan-Execute 的 60s 超时假设不可靠

**建议**：在 `executeSingleToolCall` 顶部加 `Promise.race` 超时。

### 2.8 search_journal 索引维护

**现象**：`search_journal` 依赖 `JournalSearchService.search`，索引目录由 `visual.journalDir` 决定。

**问题**：
- 索引何时构建？自动还是手动？
- 用户改笔记后索引过期策略？

**建议**：在 `definitions/search-journal.ts` 顶部加"索引生命周期"文档。

---

## 3. 优化探讨

### 3.1 工具错误统一格式

```typescript
// 统一返回
return JSON.stringify({
  status: 'OK' | 'ERROR',
  code: 'TIMEOUT' | 'NOT_FOUND' | 'INVALID_ARGS' | ...,
  message: '...',
  data?: T,
});
```

**收益**：
- LLM 可以 prompt 引导区分错误
- Eval 跑分可按 code 归类
- 子图层可以基于 code 决定是否重试

### 3.2 工具白名单配置化

```typescript
// src/agent/config/tool-permissions.ts
export const TOOL_PERMISSIONS = {
  s2: ['search_book', 'read_book_section'] as const,
  s3: ['cross_book_search', 'cross_book_read'] as const,
  advisor: ['weread_search', 'weread_recommend', 'weread_readdata', 'weread_book_info', 'weread_notebooks', 'search_journal'] as const,
};

export function getToolsForNode(nodeName: string, ctx: ToolContext): StructuredToolInterface[] {
  const all = createLangChainTools(ctx);
  const allowed = TOOL_PERMISSIONS[nodeName] || [];
  return all.filter(t => allowed.includes(t.name));
}
```

### 3.3 ToolContext 重构

**新结构**：
```typescript
interface CoreToolContext {
  vault: VaultContext;
  book: BookContext;
}

interface RuntimeContext {
  abortSignal?: AbortSignal;
  ttsConfig?: VoiceConfig;
  llmConfig?: VoiceConfig;
  mode?: EngineMode;
  proactiveTrigger?: string;
  highlightContext?: string[];
}

type ToolContext = CoreToolContext & {
  crossBook?: CrossBookContext;
  weread?: WereadContext;
  visual?: VisualContext;
} & RuntimeContext;
```

**收益**：
- 必需 vs 可选边界清晰
- 工具可以只声明自己需要的字段（依赖注入更精细）

### 3.4 工具的 trace span

```typescript
// executeSingleToolCall 顶部
const span = traceCtx?.withSpan(`tool:${toolName}`, { input: args });
try {
  const result = await tool.invoke(args, runnableConfig);
  span?.end({ output: result });
  return result;
} catch (err) {
  span?.end({ level: 'ERROR', metadata: { error: String(err) } });
  throw err;
}
```

**收益**：LangSmith trace 能直接看到工具内部。

### 3.5 工具级超时

```typescript
export async function executeSingleToolCall(
  tc, tools, interceptor, runnableConfig, signal,
): Promise<SingleToolResult> {
  const timeout = new Promise<ToolMessage>((_, reject) => {
    setTimeout(() => reject(new Error(`Tool ${tc.name} timeout after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)), TOOL_EXECUTION_TIMEOUT_MS);
  });

  // ...
  const result = await Promise.race([tool.invoke(args, runnableConfig), timeout]);
}
```

### 3.6 search_book 阶段化优化

**问题**：9 阶段全跑一遍，对简单查询浪费。

**方案**：早期终止（如 BM25 top-3 已高置信度，跳过向量召回）。

**实现**：把 search-text.ts 重构为 pipeline，每阶段可短路。

### 3.7 write_note 的安全标记升级

**当前**：写 `aicreate` frontmatter。

**建议**：
- 加 `aicreate:tool` 字段（区分 search_book / read_book_section 引用）
- 加 `aicreate:confidence` 字段（让用户决定是否信任）
- 与"撤回"功能配合（用户右键 → 撤回 AI 内容）

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/tools/index.ts` | `createLangChainTools()` 工厂 |
| `src/agent/tools/types.ts` | ToolContext 接口 |
| `src/agent/tools/definitions/*.ts` | 9 个工具的 v2 包装 |
| `src/agent/tools/local/*.ts` | search_book / read_book_section 实现 |
| `src/agent/tools/context/*.ts` | 子上下文（VaultContext / BookContext 等） |
| `src/agent/tools/{memory,profile,write-note,search-read-books}.ts` | 顶层工具（v1 形态） |
| `src/agent/graph/subgraphs/tool-execution.ts` | 工具执行共享层 |

## 5. 关联文档

- L4 节点层 — 各节点的工具白名单
- L5 子图层 — 工具调用的子循环
- L8 基础设施层 — ToolContext 来源
- ADR-006 双模型路由 — 与工具集关系
