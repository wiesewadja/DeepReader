# L4 — 节点层

> 7 个 LangGraph 节点逐一拆解（S0 Router 已合并到 S1 Inspectional）
>
> S1 Inspectional (含 S0 Router) / S2-Pre / S2 Analytical / S3 Syntopical / Advisor / Visualizer / S4 Formatter

---

## 0. 节点总表

| 节点 | 触发条件 | 模型 | 工具 | 输出 | 降级 |
|------|---------|------|------|------|------|
| S1 Inspectional (含 S0 Router) | routeFromStart → INSPECTIONAL | fast (1次) | — | depth / rewrittenQuery / allowedTools / scopeNodeIds / tocSummary / betterQuestion / structuralAnalysis / suggestedKeywords | info缺失→depth=2空scope；LLM失败→fallback；tree失败→全局搜索 |
| S2-Pre | routeAfterInspectional → PRE_SEARCH | main (0\~1次) | search_book (RRF 5 词) | validatedScopeNodeIds / preSearchBlock / earlyStopContent | 全部 catch → pass-through |
| S2 Analytical | routeAfterPreSearch → ANALYTICAL | main (3-6次) | search_book + read_book_section | analysisResult / toolResultsSnapshot | safeAnalytical 兜底 |
| S3 Syntopical | routeAfterInspectional → SYNTOPICAL | main (1-2次) | 跨书搜索 (内部实现) | analysisResult | safeNode 兜底 |
| Advisor | routeFromStart → ADVISOR | main (3-4次) | weread_* + search_journal | analysisResult | safeNode 兜底 |
| Visualizer | edges.ts 三个路由点检测到可视化意图 | main (1次) | — | analysisResult 追加 embed | safeNode 兜底，返回原 analysisResult |
| S4 Formatter | 几乎所有路径 → FORMATTER | main (1次流式 + HITL refine 1次) | — | formattedOutput | safeFormatter fallbackAction='abort' |

---

## 1. S1 Inspectional（合并了 S0 Router 功能）

**文件**：`src/agent/graph/nodes/inspectional.ts`

> ⚠️ **架构变更说明**：原先独立的 S0 Router 节点（`src/agent/graph/nodes/router.ts`）已合并到
> inspectional 节点。纯 TS 的条件边 `routeFromStart`（`edges.ts`）取代了原先的 "START → ROUTER
> → routeByDepth → INSPECTIONAL" 路径。详情见下方「职责」与「关键步骤」。

### 职责
**统一的路由 + 检视阅读节点**。一次 `fastModel` 调用同时完成：

- depth 分类（0/1/2/3）
- 查询重写（rewrittenQuery）
- 范围选择（scopeNodeIds）
- 结构分析（structuralAnalysis）
- 可视化意图（shouldVisualize）

前方还有**纯 TS 预处理**（问候短路、纠错检测、延续性检测、IntentRouter），
和**后处理**（BM25 存在性验证、Scope hard-guard）。

### 状态读写
- **读**：`messages`、`allowedTools`（历史继承）、`pdfName`、`bookId`、`config.configurable.chatHistory`、`toolContext.*`
- **写**：`depth`、`rewrittenQuery`、`allowedTools`、`scopeNodeIds`、`tocSummary`、`betterQuestion`、`structuralAnalysis`、`suggestedKeywords`、`shouldVisualize`、`correctionDetected`

### LLM 调用
- `fastModel.invoke([sys, user])` × 1（非流式）

### Prompt 入口
- `src/agent/graph/prompts/inspectional-prompt.ts` — `buildInspectionalSystemPrompt` / `buildInspectionalUserMessage`

### 关键步骤

**纯 TS 预处理（无 LLM）：**
1. **问候短路**：短问候/谢谢直接返回 CASUAL
2. **纠错检测**（`detectCorrection`）：检测用户是否在纠错 → 强制 depth=2
3. **延续性检测**（`inheritDepthOnContinuity`）：短回复 + 长历史 + 上次是深度对话 → 升级 depth 0→2
4. **IntentRouter 正则分析**：从查询中提取意图 → 允许的工具集
5. **历史 tools 继承**：无新意图时继承上一轮的 `allowedTools`

**LLM 阶段：**
6. 加载 `.pageindex/{bookId}/tree.json` + 格式化目录树
7. 拼 prompt（注入目录、docDescription、currentNodeId、历史摘要）
8. 调 `fastModel`，解析 JSON 输出（同时得到 depth / rewrittenQuery / scopeNodeIds / structuralAnalysis / visualize 等）
9. **跨书升级**（`upgradeToSyntopical`）：有书单 + depth=2 时升级到 SYNTOPICAL
10. **IntentRouter on rewritten query**：二次分类补漏

**后处理：**
11. **BM25 存在性验证**（`verifyExistence`）：检查书中是否真有相关内容，防幻觉
12. **Scope hard-guard**（`enforceScopeHardGuard`）：确保当前章+引用的章节不被 LLM 排除

### 降级策略
- 配置缺失 → `depth=2`，原 query，rawIntent tools，scopeNodeIds=[]
- LLM 抛错 / JSON 解析失败 → 同上 fallback
- tree 加载失败 → `tocSummary='无法获取目录结构，使用全局搜索'`
- ANTI_HALLUCINATION BM25 命中 → 改写 query 为"未提及"引导，depth=0

### 已知问题
- `ANTI_HALLUCINATION_SCORE_THRESHOLD = 0.3` 是 magic number
- `CONTINUITY_THRESHOLD = 5` 字符数硬编码
- `intentRouter.analyze` 调了两次（raw + rewritten），与 L1 的调用重复
- `mergeTools` 用 Set 转数组，**原顺序丢失**
- `TREE_STRUCTURE_MAX_TEXT_LENGTH` / `TREE_STRUCTURE_MAX_DEPTH` 截断可能丢深层节点
- 不传 `withStructuredOutput` 走 JSON 解析，**模型偶发 markdown 包裹**会导致 `extractJSON` 失败

---

## 2. S2-Pre (analytical-pre-search)

**文件**：`src/agent/graph/nodes/analytical-pre-search.ts`

### 职责
校验 S1 的 scopeNodeIds、并联 RRF 检索 5 个关键词、加权打分决定"早停"或"注入"。

### 状态读写
- **读**：`scopeNodeIds`、`pdfName`、`tocSummary`、`rewrittenQuery`、`betterQuestion`、`suggestedKeywords`、`pluginSettings`（embedding/reranker/threshold）
- **写**：`validatedScopeNodeIds`、`nodeFileMap`、`preSearchBlock`、`earlyStopContent`（='done' 触发早停）、`analysisResult`（早停时填充）、`toolResultsSnapshot`、`prevSearchedBlockIds`

### LLM 调用
- `mainModel.invoke([sys, user])` × 0\~1（仅当 wScore + 实质性分数过阈值时 1 次直接答）

### Prompt 入口
- `src/agent/graph/prompts/pre-search-prompt.ts` — `buildEarlyStopPrompt`
- `src/agent/graph/prompts/analytical-prompt.ts` — `buildFullAnalyticalContext`，`skipUserMessage: true`

### 关键步骤
1. `validateScopeNodeIds()` 过滤无效 ID
2. RRF 多关键词并行检索（topK 动态 5/10/15）
3. 加权打分（权重 0.6/0.3/0.1、当前章节加分 0.2、SUBSTANTIVE_THRESHOLD=30）
4. 早停判断（`getEarlyStopThreshold(settings) ≥ 0.6`）
5. 早停 → 调 mainModel 生成直接答案（写入 `analysisResult`）
6. 不早停 → 把高分 hits 拼成 `preSearchBlock` 注入到 analytical 上下文

### 降级策略
- `mainModel`/`toolContext` 缺失 → `emptyPreSearchResult(rawScopeNodeIds)`（空 validated、空 preSearchBlock）
- `suggestedKeywords` 为空 → 同上
- 关键词搜索某条失败 → 该条返回 []，其余继续
- 预检索结果 < 2 条 → 跳过注入
- 总 catch → `emptyPreSearchResult(validatedScopeNodeIds)`，不阻塞
- 早停时 `verifyAndCleanContent` 异常不会外泄（try 内已 wrap）

### 已知问题
- magic number 一堆：权重 0.6/0.3/0.1、当前章节加分 0.2、SUBSTANTIVE_THRESHOLD=30、关键词最多 5、topK 动态 5/10/15
- `seenBlockIds` 去重**只覆盖前 3 条 hits**，`preResults` 后续条目不去重
- 当前章节用 `nodeId.replace(/^0+/, '')` 拼前缀匹配 markdownFiles，**零填充截断后碰撞概率不为零**
- `validateScopeNodeIds` 在 try 内，**失败时"用所有 IDs"** —— 可能放过幻觉
- 早停路径里 `toolResultsSnapshot` 写的是 `preSearch` 名称（不是真实工具名），下游 verifyAndCleanContent 仍能跑但语义略偏

---

## 3. S2 Analytical

**文件**：`src/agent/graph/nodes/analytical.ts`

### 职责
PlanExecute ReAct 循环（首选 L5 子图），可注入 S2-Pre 的 preSearchBlock，深度分析 + HITL。

### 状态读写
- **读**：`validatedScopeNodeIds`、`preSearchBlock`、`pdfName`、`tocSummary`、`rewrittenQuery`、`betterQuestion`、`scopeNodeIds`、`nodeFileMap`、`prevSearchedBlockIds`
- **写**：`analysisResult`、`toolResultsSnapshot`（最多 `maxToolCalls` 条）

### LLM 调用
- `mainModel.invoke(...)` × 多次（Plan-Execute 循环：maxIterations=6, maxToolCalls=3；HITL 反馈后 4/3）

### Prompt 入口
- `src/agent/graph/prompts/analytical-prompt.ts` — `buildFullAnalyticalContext`

### 关键步骤
1. 构造 prompt（注入 scope、tocSummary、历史）
2. 调 `runPlanExecute`（L5 子图）
3. 工具白名单：`['search_book', 'read_book_section']`
4. `createScopeInterceptor` 自动注入 `scope_node_ids` 到 `search_book`
5. `verifyAndCleanContent` 后处理
6. `enableHumanReview=true` 时 `interrupt()` 等待用户审查
7. 用户拒绝 → 用更小配置（4/3）再跑一次 `runPlanExecute` 精修

### 降级策略
- `mainModel`/`toolContext` 缺失 → 空 `analysisResult`
- 整个异常由 `safeNode` 外层兜底（`fallbackAction='skip_to_formatter'`）

### 已知问题
- `maxIterations=6 / maxToolCalls=3` 硬编码，**无配置**
- HITL 分支：`approved=false` 但 feedback 为空时**静默不 refine**（沉默失败点）
- 第二次 PlanExecute 没传新的 `runName`/回调名，LangSmith trace 难区分
- 工具裁剪 `s2ToolNames` 是写死白名单，新增工具需改本文件

---

## 4. S3 Syntopical

**文件**：`src/agent/graph/nodes/syntopical.ts`

### 职责
跨书向量+命题搜索 → LLM 综合（共识词汇/议题/立场）→ wiki 自检 → 可选 HITL。

### 状态读写
- **读**：`rewrittenQuery`、`sharedContext.toolContext.crossBook.booklistBookIds/indexedBooks`、`pluginSettings`
- **写**：`analysisResult`、`toolResultsSnapshot`（限 `SYNTOPICAL_SNAPSHOT_LIMIT=20`）

### LLM 调用
- `mainModel.invoke(...)` × 1（无工具调用，纯生成）；HITL 反馈时再 1 次

### Prompt 入口
- `src/agent/graph/prompts/syntopical-prompt.ts`

### 关键步骤
1. 跨书搜索 `booklistBookIds` 限 5 本（`SYNTOPICAL_MAX_BOOKS=5`），每本 Top-K=5
2. 提取共识词汇/议题/立场
3. 调 mainModel 综合（写入 `analysisResult`）
4. `verifyAndCleanContent`（仅在有 toolResults 时）
5. 可选 HITL

### 降级策略
- 0 本书 → "Vault 中没有已索引书籍…"
- 1 本书 → "无法进行多书籍主题阅读…"
- `mainModel` 缺失 → 空 analysisResult
- `safeNode` 兜底

### 已知问题
- 0/1 本书路径**跳过了 `verifyAndCleanContent`**（分析内容里如有幻觉链接不会被清理）
- `getVaultPath` 桌面端 vs 移动端分支，**移动端为空会走 `app` 分支**，行为可能未在所有路径回归
- `extractToolResults` 把每个 matchedBlock 当一条 toolResult，**SYNTOPICAL_SNAPSHOT_LIMIT 截断会丢前 N 条**
- LLM `response.content` 非 string 时降级用 `JSON.stringify`，**会泄露原始 tool_calls JSON 文本到 analysisResult**

---

## 5. Advisor（无书模式）

**文件**：`src/agent/graph/nodes/advisor.ts`

### 职责
无书模式下用 weread_* + search_journal 工具做阅读顾问 ReAct。

### 状态读写
- **读**：`rewrittenQuery`、`memoryContext`、`userProfileSummary`、`crossBook.bookshelfSummary`、`visual.journalDir`
- **写**：`analysisResult`、`toolResultsSnapshot`

### LLM 调用
- `mainModel.invoke(...)` × 多次（ReAct，maxIterations=4, maxToolCalls=3）

### Prompt 入口
- `ADVISOR_SYSTEM_PROMPT`（**内嵌字符串**，不在 prompts/ 目录）

### 关键步骤
1. 构造 system prompt（嵌入文件里）
2. 注入 userProfileSummary / memoryContext / bookshelfSummary（**带 .slice 截断 magic number**）
3. 调 ReAct 循环
4. 工具白名单：`advisorToolNames`（weread_* + search_journal）

### 降级策略
- `mainModel`/`toolContext` 缺失 → 空 analysisResult
- `safeNode` 兜底

### 已知问题
- system prompt 整段硬编码在文件里，**没走 prompts/ 目录**，IDE 跳转/复用差
- `userProfileSummary.slice(0, 1500)` / `memoryContext.slice(0, 1500)` / `bookshelfSummary.slice(0, 2000)` 截断 magic number
- **没 HITL 中断**（与 S2/S3/S4 不一致）
- 工具白名单 `advisorToolNames` 写死，未来加新 weread 工具需改这里
- `bookshelfSection` 嵌进 user message 而非 system prompt，可能影响 tool routing 一致性

---

## 6. Visualizer（统一图表生成）

**文件**：`src/agent/graph/nodes/visualizer.ts`

### 职责
检测到可视化意图时，调用 `diagram-helper.generateDiagram()` 生成 Excalidraw 图形，将 embed 追加到分析结果中。

### 状态读写
- **读**：`analysisResult`、`structuralAnalysis`、`rewrittenQuery`、`pdfName`
- **写**：`analysisResult`（追加 `![[Excalidraw/xxx.excalidraw]]`）

### LLM 调用
- `mainModel.invoke([sys, user])` x 1（通过 `diagram-helper.generateDiagram` 间接调用）

### Prompt 入口
- `src/agent/graph/utils/diagram-helper.ts` — `DIAGRAM_SYSTEM_PROMPT`（内嵌 Excalidraw 图形生成指令）

### 关键步骤
1. 检查 `mainModel` 和 `toolContext` 可用性
2. 合并 `analysisResult` + `structuralAnalysis` 作为输入内容
3. 调用 `generateDiagram(query, content, model, toolContext)` — 内部调 LLM 生成元素 JSON + 调 excalidraw 工具写入文件
4. 成功时追加 embed 到 `analysisResult`；失败时返回原始 `analysisResult`

### 降级策略
- `mainModel`/`toolContext` 缺失 → 返回原 `analysisResult`
- 无分析内容 → 返回原 `analysisResult`
- `generateDiagram` 失败 → 返回原 `analysisResult`（静默降级）
- `safeNode` 兜底

### 路由触发点
- `routeAfterInspectional`：depth=1 + 有意图 + S1 无错误 → VISUALIZER
- `routeAfterPreSearch`：S2 早停 + 有意图 → VISUALIZER
- `routeAfterAnalysis`：S2/S3 完成 + 有意图 → VISUALIZER

### 意图检测
```typescript
const DIAGRAM_INTENT_RE =
  /思维导图|脑图|流程图|概念图|画.{0,6}图|可视化展示|可视化|导图|示意图|infographic|图表|知识图谱/;
```
同时检查原始用户消息和改写查询（防止 Router LLM 剥离关键词）。

### 视觉优化（excalidraw-geometry.ts）
- **edgeIntersection()** — 箭头与形状边缘交点计算（矩形/椭圆/菱形）
- **Z-index 排序** — shapes(0) < arrows(1) < text(2)
- **calculateViewport()** — 自适应视口
- **detectTextOverlaps()** — 独立文本碰撞检测

### embed 保护
S4 Formatter 用 `%%EMBED_N%%` 占位符保护 `![[Excalidraw/xxx.excalidraw]]` 不被 wiki link 后处理误删。

### 已知限制
- LLM 坐标质量不稳定，结构性连接线可能穿过文字
- Obsidian Excalidraw 插件可能不尊重 scrollX/scrollY/zoom
- Proactive/Socratic 模式不经过 VISUALIZER（by design）

---

## 7. S4 Formatter（最复杂）

**文件**：`src/agent/graph/nodes/formatter.ts`（最大节点，~600 行）

### 职责
把 S2/S3 的 `analysisResult` 转换成"奚童语气"，**核心是 wiki-link 6 道后处理管线**。

### 状态读写
- **读**：`analysisResult`、`structuralAnalysis`、`rewrittenQuery`、`pdfName`、`proactiveTrigger`、`depth`、`tocSummary`、`betterQuestion`、`scopeNodeIds`、`toolResultsSnapshot`、`highlightContext`、`crossBookMode`、`nodeFileMap`、`sharedContext.*`
- **写**：`formattedOutput`

### LLM 调用
- `mainModel.stream(...)` × 1（流式）；HITL 反馈时再 1 次

### Prompt 入口
- `src/agent/graph/prompts/formatter-prompt.ts` — `buildFormatterSystemPrompt` / `buildFormatterUserMessage`
- `src/agent/graph/prompts/proactive-formatter-prompt.ts` — proactive/socratic 模式

### 关键步骤（6 道后处理管线，按实际执行顺序）

1. **`streamToContent(content, ...)`** — `model.stream()` 流式聚合，chunk 提取兼容 string/array/null
2. **`validateLinkPairs(content)`** — T3.2 修复流式截断留下的单边 `[[` 或 `]]` 残片（**必须在 verifyAndCleanContent 之前**，否则坏数据污染白名单构建）
3. **`verifyAndCleanContent(content, toolResults)`** — 安全网，移除 `[[...#^ghostid...]]` 形式的幽灵 block_id（仅当 `toolResults.length > 0`）
4. **HITL `interrupt()`** — `enableHumanReview=true` 时，`approved=false` 触发 refine 流；refine 完**再跑一次** `verifyAndCleanContent`（**不带 linkPair 修复**？见下）
5. **`cleanOutput(content, effectivePdfName, crossBookMode)`** — 链式：`stripThinkTags` → `fixupEmptyBlockIds`（`[[p#^|alias]]→[[p|alias]]`、`[[p#^]]→[[p]]`）→ `fixupWikiLinks`（补全书名前缀，crossBookMode 时跳过）
6. **`validateWikiLinks(cleaned, {app, bookName, expectedBookName, vaultPath, toolResults})`** — 基于 `vault.exists` 真实校验（仅当 `vaultApp` 存在），输出 `correctedContent`
7. **`stripFabricatedLinks(formatted, inputTextsForValidation, vaultBlockIds)`** — 兜底：calibre-pb 降级 + 白名单外编造链接回退为别名文本 + 不存在的 block_id 降级为标题链接
8. **`appendErrorHints(nodeErrors)`** — 把 `nodeErrors[*].recoverable` 的提示以 `> [!hint]` 追加

### `inputTextsForValidation` 收集（决定 `stripFabricatedLinks` 白名单）
- `effectiveAR`（清洗后 analysisResult，**含 XML 残留清洗结果**）
- `structuralAnalysis`
- `coveredScope`（`buildScopedChaptersBlock`，含 `file_name: "..."`）
- `tocSummary`（提取 `'title'(nodeId)` 形式）

### 降级策略
- `mainModel` 缺失 → 直接返回 `analysisResult`（不调 LLM）
- proactive/socratic/casual/normal 四种 mode 分支，分别用不同 prompt
- `validateWikiLinks` 异常 → 静默使用 `cleanOutput` 结果（不阻塞 S4）
- `langsmithTracer.createRun` 异常 → 静默吞掉
- `safeNode` 兜底（`fallbackAction='abort'` —— **唯一会让图直接中止的节点**）

### 已知问题
- **顺序依赖脆弱**：`validateLinkPairs` 必须在 `verifyAndCleanContent` 之前（HITL refine 路径**没有**再跑 linkPair 修复——小不一致）
- **HITL 路径重复校验但没修复流式残片**：refine 流出的内容仍可能带单边 `[[`
- `bookName` 与 `expectedBookName` 传了同一个 `pdfName`，看起来是冗余（取决于 `validateWikiLinks` 实现）
- XML 残留清洗走单一正则 `<function>...</function>` + `<parameter>...</parameter>`，**未覆盖其他 LLM 工具调用 XML 模式**
- `fixupWikiLinks` 用 `[^/\]]+` 判断"无前缀"，遇到包含斜杠的合法跨书链接不会被改；但**包含 `]` 或 `[` 的别名**会破坏正则
- `fixupEmptyBlockIds` 在 `crossBookMode=true` 时仍执行（`cleanOutput` 第三个参数只控 `fixupWikiLinks`），**可能误删合法锚**
- `stripFabricatedLinks` 的 `valid` 宽松匹配（`stripNum` 去编号前缀 + `endsWith` 双向）容易误判——如"A"和"B-A"会互相命中
- `streamToContent` 抛错时包装成 `Error("LLM 流式请求失败: ${msg}")`，但内容为空时仍 `onContent?.('')` 可能让 UI 显示空闪
- `langsmithTracer` 上报只覆盖 `wiki_link_verification` 一处（`Formatter` 内），其他节点靠 LangChain 自动 trace
- `crossBookMode` 时 `effectivePdfName = ''`，`fixupWikiLinks` 直接 return；但 `validateWikiLinks` 仍传空 bookName，是否预期需看 `validateWikiLinks` 实现
- `nodeErrors` 写进 `formattedOutput` 末尾（`> [!hint]`），**对 casual/proactive/socratic 模式未生效**——只在 normal 路径追加
- depth=CASUAL 路径里 `isReadingAdvisor = !pdfName` 走另一套 system prompt 拼法，但 `pdfName` 为空时不会跑 fixupWikiLinks（crossBookMode 也为 false）——这是一个边界路径
- `proactive` 模式返回前**只跑 `cleanOutput`**，**没跑 linkPair / verify / validateWikiLinks / stripFabricatedLinks**，引导问题里若模型幻觉链接不会被清理

---

## 9. safeNode 通用行为

`src/agent/graph/utils/safe-node.ts`：

```typescript
function safeNode(name, node, fallback) {
  return async (state, config) => {
    try {
      return await node(state, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nodeError = {
        message,
        recoverable: name !== 'formatter',  // ⚠️ formatter 不可恢复
        fallbackAction: FALLBACK_ACTIONS[name] || 'skip_to_formatter',
      };
      return {
        ...fallback(state, err),
        nodeErrors: { ...state.nodeErrors, [name]: nodeError },
      };
    }
  };
}
```

**FALLBACK_ACTIONS**：
```typescript
{
  inspectional: 'global_search',
  pre_search:   'global_search',
  formatter:    'abort',           // ⚠️ 实际未读
  // 其它默认 'skip_to_formatter'
}
```

---

## 10. 优化探讨（节点级）

### 10.1 S1 Inspectional 合并后的 IntentRouter 调用

由于 S0 Router 的功能已合并到 inspectional 节点，原先的 "S0 Router 调两次" 问题现在
变为 "inspectional 内部调两次"（rawQuery 一次 + rewrittenQuery 一次），加上 L1 层也调一次，
合计三次调用点。见 L1 §3.1 — 三次调用点统一。

### 10.2 S1 scope 校验

**问题**：S1 写出的 `scopeNodeIds` 不一定属于当前书（如果 LLM 幻觉）。

**方案**：在 S1 写 state 时加 `validateScopeNodeIds` 二次过滤（`S2-Pre` 已经在做，但 S1→S2 之间的中间态没人管）。

### 10.3 S2-Pre 早停的 LLM 修正

**问题**：早停时 mainModel 只看 preSearchBlock 5 条结果，容易幻觉。

**方案**：早停时同时注入 tocSummary（已有但权重低）+ suggestedKeywords + currentChapter 强 hint。

### 10.4 S4 节点拆分

**问题**：`formatter.ts` 600 行，包含 LLM prompt 拼装 + 6 道后处理 + 错误降级 + LangSmith 上报。

**方案**：
- 拆 `FormatterStreamer`（流 + interrupt + 表情）
- 拆 `WikiLinkPostProcessor`（6 道关的 pipeline）
- 拆 `FormatterPromptBuilder`（4 种 mode 的 prompt 拼装）

**收益**：单测可独立写；后处理管线可在 S2 Analytical 输出时也跑（前置防御）。

### 10.5 S4 后处理管线提前到 S2 输出

**问题**：S2 Analytical 输出可能含 wiki 链接，S4 只在末尾兜底。

**方案**：在 S2 / S3 / Advisor 节点输出 analysisResult 时**先跑 wiki-link 校验**，再写 state。S4 只做"美化"。

**风险**：跨节点 schema 耦合。

### 10.6 Visualizer 节点（已实现）

VISUALIZER 已从占位升级为真实图表生成节点。详见上方第 7 节。

**配套阅读**：[excalidraw-visualization.md](../../features/excalidraw-visualization.md)

### 10.7 Advisor prompt 外置

**方案**：把 `ADVISOR_SYSTEM_PROMPT` 移到 `src/agent/graph/prompts/advisor-prompt.ts`，与其它节点对齐。

---

## 11. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/graph/nodes/inspectional.ts` | S1 Inspectional（含 S0 Router 功能） |
| `src/agent/graph/nodes/analytical-pre-search.ts` | S2-Pre |
| `src/agent/graph/nodes/analytical.ts` | S2 Analytical |
| `src/agent/graph/nodes/syntopical.ts` | S3 Syntopical |
| `src/agent/graph/nodes/advisor.ts` | Advisor |
| `src/agent/graph/nodes/visualizer.ts` | Visualizer（统一图表生成） |
| `src/agent/graph/nodes/formatter.ts` | S4 Formatter（最复杂） |
| `src/agent/graph/prompts/*.ts` | 6 个 prompt 文件（router-prompt.ts 已移除） |
| `src/agent/graph/utils/safe-node.ts` | safeNode 包装 |
| `src/agent/graph/utils/engine-helpers.ts` | `resolveMode` 等 |

## 12. 关联文档

- L2 LangGraph 状态机层 — 节点之间的边
- L5 子图层 — S2 Analytical 内部的 Plan-Execute / ReAct 循环
- L6 工具层 — S2 节点可用的工具子集
- L7 验证与输出处理层 — S4 的 6 道后处理管线
