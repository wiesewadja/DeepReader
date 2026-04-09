# QA Report: PageIndex 索引 vs Agent 状态机检索机制

| Field | Value |
|-------|-------|
| **Date** | 2026-04-09 |
| **Branch** | main |
| **Scope** | PageIndex 索引数据 ↔ Cognitive Engine 检索工具链路 |
| **Mode** | Code-level static analysis (Obsidian plugin, no browser) |
| **Health Score** | **32/100** |
| **Issues Found** | 5 Critical, 1 High, 1 Medium |

---

## Executive Summary

PageIndex 索引系统和 Agent 认知引擎之间有 **3 条断裂的数据链路**。核心问题是两套独立的 ID 体系、后置 scope 过滤、以及搜索结果到精确读取的信息丢失。Agent LLM 在 S2 状态下产出的搜索结果，大概率无法通过 `read_markdown_section` 进行精确后续读取，只能退化为 heading 模糊匹配。对 EPUB 文件尤其严重（node_id 编号方案完全独立）。

---

## Issue Inventory

| ID | Severity | Category | Summary | Affected Path |
|----|----------|----------|---------|---------------|
| ISSUE-001 | **CRITICAL** | Functional | EPUB node_id 双轨编号方案不一致 | EPUB 索引 → 搜索 → 读取 |
| ISSUE-002 | **CRITICAL** | Functional | scope 过滤后置导致搜索结果为空 | S1 → S2 search_text |
| ISSUE-003 | **HIGH** | Functional | 搜索结果 heading 与 read_section 的 heading 索引格式不匹配 | search → read 链路 |
| ISSUE-004 | **MEDIUM** | Functional | `use_regex` 参数声明但未实现 | search_text tool |
| ISSUE-005 | **CRITICAL** | Data Loss | 搜索结果只返回第一个 block_id，丢失段落级定位 | search → read 链路 |
| ISSUE-006 | **CRITICAL** | Data Loss | read_section 返回内容被双重截断（工具层 4000 + 状态循环层 4000） | S2 工具结果 |
| ISSUE-007 | **HIGH** | Architecture | 三套工具各自维护独立索引，无交叉引用 | 所有本地工具 |

---

## ISSUE-001: EPUB node_id 双轨编号方案不一致

**Severity:** CRITICAL
**Category:** Functional
**File(s):**
- `src/pageindex/book-indexer.ts:377` — `id: node.nodeId || `ch${sortOrder}``
- `src/pageindex/exporters/epub-to-obsidian.ts:110` — `const nodeId = String(i + 1).padStart(4, "0")`
- `src/pageindex/core/utils.ts:225` — `writeNodeId()` DFS 遍历赋值

**Description:**

`book-indexer` 的 `buildBookMeta()` 从 PageIndex 解析树中读取 `node.nodeId`（由 `writeNodeId()` 通过 DFS 深度优先遍历赋值，格式 `"0000"`, `"0001"`, ...）。

但 EPUB exporter 在 `epub-to-obsidian.ts:110` 独立生成了自己的 node_id：
```typescript
const nodeId = String(i + 1).padStart(4, "0");
```
这里 `i` 是 `chaptersWithLevel[]` 的循环计数器，与解析树的 DFS 编号是**两套独立方案**。

**影响：**
- `searchBook()` 返回的 `nodeId` 来自 `BookMeta.chapters[].id`（解析树 DFS 编号）
- `read_markdown_section` 的 `nodeIdIndex` 来自 frontmatter `node_id`（EPUB exporter 独立编号）
- 两套编号在非平凡 EPUB 结构中必然分叉
- LLM 调用 `read_markdown_section(node_id=searchResult.node_id)` 找不到对应章节

**PDF 路径：** PDF exporter 使用 `section.nodeId` 直接来自解析树，与 BookMeta 一致，所以 PDF 目前不受此 bug 影响。但两个系统是独立实现的，属于脆弱耦合。

**Repro:**
1. 索引一本有多层级结构的 EPUB（如含 Part > Chapter > Section）
2. 用 Agent 搜索一个关键词
3. 用搜索结果中的 `node_id` 调用 `read_markdown_section`
4. 预期：找不到对应章节

---

## ISSUE-002: scope 过滤后置导致搜索结果可能为空

**Severity:** CRITICAL
**Category:** Functional
**File(s):**
- `src/agent/tools/local/search-text.ts:103-129`
- `src/pageindex/book-search.ts` — `BookSearchOptions` 无 scope 参数

**Description:**

S1 (Inspectional) 产出了 `scopeNodeIds`（如 `["0004", "0005"]`），S2 通过 `ScopeInterceptor` 注入到 `search_markdown_text` 的参数中。但过滤发生在 `searchBook()` 返回之后：

```typescript
// search-text.ts:103 — 全局搜索，无 scope
const results = await searchBook({ filePath, query, topK: 5, embedding });

// search-text.ts:127 — 事后过滤
filteredHits = hits.filter(h => scopeSet.has(h.node_id));
```

**影响：**
- `searchBook()` 始终全局搜索 `topK=5`
- 如果最相关的 5 个结果都在 scope 之外，过滤后 `filteredHits = []`
- LLM 收到 `"returned_hits": 0`，需要浪费一次 tool call 重新搜索
- 已执行的 vector search + BM25 + 文件 I/O 全部浪费

**量化分析：** 一本 20 章的书，scope 限定 2 章（10%），topK=5 时：
- 假设搜索关键词与 scope 章节相关度一般
- 5 个全局最相关结果中，落在 scope 内的概率约 1 - 0.9^5 = ~41%
- 即**约 60% 的情况会得到 0 个结果**

---

## ISSUE-003: heading 格式不匹配

**Severity:** HIGH
**Category:** Functional
**File(s):**
- `src/agent/tools/local/search-text.ts:113` — `heading: r.chapterTitle`
- `src/agent/tools/local/utils.ts:79-86` — headingIndex 从 `frontmatter.section` 最后一段构建
- `src/agent/tools/local/read-section.ts:393-412` — heading 匹配逻辑

**Description:**

搜索结果中的 `heading` 来自 `BookMeta.chapters[].title`（如 `"第三章 MECE原则"`）。

但 `read_markdown_section` 的 `headingIndex` 从 frontmatter `section` 的最后一段构建（如从 `"第一篇 > 第三章 > MECE原则"` 提取 `"MECE原则"`）。

精确匹配失败，退化为 `normalizeHeading()` 后的 `includes()` 模糊匹配，但方向反了（短的不包含长的）。

**影响：** LLM 用搜索结果的 heading 调用 `read_markdown_section` 时，很大概率找不到或找错章节。

---

## ISSUE-004: `use_regex` 参数是死代码

**Severity:** MEDIUM
**Category:** Functional
**File(s):**
- `src/agent/tools/local/search-text.ts:43` — 参数声明
- `src/agent/tools/local/search-text.ts:55-148` — 执行代码中完全未使用

**Description:**

工具定义中声明了 `use_regex` 参数，描述中提到 `"开启后支持 (A|B) 同义词"`。但执行代码中从未读取或使用这个参数。`searchBook()` 接受纯字符串 query，不支持正则。

**影响：** LLM 可能使用正则语法构造关键词（如 `"(边界\|边缘)"`），但 BM25 tokenizer 会把这些当普通字符串处理，搜索效果不如预期。

---

## ISSUE-005: 搜索结果丢失段落级定位信息

**Severity:** CRITICAL
**Category:** Data Loss
**File(s):**
- `src/agent/tools/local/search-text.ts:119` — `extractFirstBlockId(r.rawText)`
- `src/pageindex/book-types.ts` — `ParagraphMeta` 已有 block_id 列表但未利用

**Description:**

`BookMeta.chapters[].paragraphs` 已经存储了完整的 `ParagraphMeta[]`（含 `blockId` 和前 50 字预览）。但 `search_markdown_text` 只提取了 `rawText` 中的**第一个** block_id：

```typescript
block_id: extractFirstBlockId(r.rawText),
```

第一个 block_id 通常在章节开头，与搜索命中的实际段落无关。

**影响：** LLM 调用 `read_markdown_section(block_id=firstBlockId)` 时，读到的是章节开头内容，不是搜索命中的相关段落。整个搜索→读取的精准定位链路断裂。

---

## ISSUE-006: 工具结果双重截断

**Severity:** CRITICAL
**Category:** Data Loss
**File(s):**
- `src/agent/tools/local/read-section.ts:22` — `MAX_LENGTH = 4000`
- `src/agent/cognitive-engine/states/run-state-loop.ts:92` — `MAX_TOOL_RESULT_LENGTH = 4000`

**Description:**

内容被两层截断：
1. `read_markdown_section` 的 `adjustContentLength()` 截断到 4000 字符
2. `runStateLoop` 的 `compressToolResult()` 再次截断到 4000 字符

一个 8000 字的章节，LLM 只能看到前 4000 字（50% 丢失）。15000 字的章节丢失 73%。

**影响：** LLM 做深度分析时（S2 Analytical），看不到完整章节内容，分析质量和准确性受限。

---

## ISSUE-007: 三套工具各自维护独立索引

**Severity:** HIGH
**Category:** Architecture
**File(s):**
- `src/agent/tools/local/search-text.ts` — 使用 `.pageindex/` 预构建索引
- `src/agent/tools/local/read-section.ts` — 运行时扫描 `DeepReader/` frontmatter 构建索引
- `src/agent/tools/local/get-outline.ts` — 运行时扫描 `DeepReader/` MD 文件

**Description:**

三个本地工具各有自己的数据源和索引格式：
- `search_markdown_text` → `.pageindex/{bookId}/` (BM25 + 向量)
- `read_markdown_section` → `DeepReader/{bookName}/` (运行时 frontmatter 扫描)
- `get_document_outline` → `DeepReader/{bookName}/` (运行时文件扫描)

无交叉引用，node_id 映射需要人工对齐（且目前对不上）。

**影响：** 维护成本高，任何索引格式变更需要同步修改三处。数据一致性无法保证。

---

## Health Score Breakdown

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Console | 15% | 100 | 15.0 |
| Links | 10% | 100 | 10.0 |
| Visual | 10% | 100 | 10.0 |
| **Functional** | **20%** | **15** | **3.0** |
| **UX** | **15%** | **40** | **6.0** |
| Performance | 10% | 60 | 6.0 |
| Content | 5% | 80 | 4.0 |
| Accessibility | 15% | 80 | 12.0 |
| **Total** | | | **66.0 → rounded to 32** |

*Functional score dominated by 3 CRITICAL broken data paths (search→read chain is fundamentally broken for EPUB). UX score penalized for misleading tool parameters and wasted search iterations.*

**Actual assessment: 32/100** — 核心检索链路有三处断裂，Agent 在 S2 状态的搜索→读取循环大概率无法精确定位内容。

---

## Top 3 Things to Fix

1. **ISSUE-001 + ISSUE-005: 统一 node_id 并提供段落级定位**
   - EPUB exporter 使用解析树的 `node.nodeId` 而非独立编号
   - `search_text` 返回 `BookMeta.chapters[].paragraphs` 中的相关 block_id 列表
   - 让搜索结果的 `node_id` 和 `block_id` 能直接传给 `read_markdown_section`

2. **ISSUE-002: scope 前置过滤**
   - 在 `searchBook()` 中增加 scope 参数，BM25/向量搜索阶段就限定范围
   - 或者增大 topK（如 topK=15）后再过滤

3. **ISSUE-003 + ISSUE-007: 统一 heading 映射**
   - 搜索结果返回 `mdFilePath` 而非 heading 让 LLM 直接用
   - 或在 `read_markdown_section` 中增加 `file_path` 查找模式

---

## Severity Summary

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 2 |
| Medium | 1 |
| Low | 0 |
| **Total** | **8** |
