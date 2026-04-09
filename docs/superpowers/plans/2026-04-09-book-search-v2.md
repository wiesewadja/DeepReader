# Book Search v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the book search pipeline from a broken 1-node BM25 index to an 8-stage hybrid pipeline with paragraph-level precision, and restructure Agent tools from 3 to 2.

**Architecture:** Single data source (`.pageindex/{bookId}/`), 8-stage search pipeline (BM25 → vector → scope → fusion → tree search → rerank → block-level match), tools renamed to `search_book` / `read_book_section`, `get_document_outline` removed.

**Tech Stack:** TypeScript, BM25 (existing), OpenAI/Ollama embeddings (existing), Float32 vector store (existing), Obsidian Plugin API

**Spec:** `docs/superpowers/specs/2026-04-09-book-search-v2-design.md`

---

## File Structure

### New files
- `src/pageindex/book-search-v2.ts` — 8-stage search pipeline + paragraph vector cache

### Modified files
- `src/pageindex/book-types.ts` — Add V2 types (BookSearchOptionsV2, BookSearchResultV2, MatchedBlock, BookSectionResult)
- `src/pageindex/book-indexer.ts` — Fix BM25 bug, move tree.json, simplify book-meta v2, fix vectorize
- `src/pageindex/book-search.ts` — Mark deprecated
- `src/pageindex/exporters/pdf-to-obsidian.ts` — tree.json location + frontmatter simplification
- `src/pageindex/exporters/epub-to-obsidian.ts` — nodeId unification + tree.json location + frontmatter simplification
- `src/agent/tools/local/search-text.ts` — Rename to search_book, call searchBookV2
- `src/agent/tools/local/read-section.ts` — Rename to read_book_section, tree.json lookup
- `src/agent/tools/local/types.ts` — LocalToolCache redefined
- `src/agent/tools/local/utils.ts` — Load tree.json instead of frontmatter scan
- `src/agent/tools/index.ts` — Tool registration update
- `src/agent/cognitive-engine/states/inspectional.ts` — Direct tree.json read
- `src/agent/cognitive-engine/states/analytical.ts` — Tool list update
- `src/agent/cognitive-engine/interceptor/scope-interceptor.ts` — Tool name update
- `src/agent/cognitive-engine/states/run-state-loop.ts` — MAX_TOOL_RESULT_LENGTH 4000→8000
- `src/agent/cognitive-engine/prompts/analytical-prompt.ts` — Tool name update + remove use_regex

### Deleted files
- `src/agent/tools/local/get-outline.ts`

---

## Chunk 1: Index Layer Fixes

### Task 1: Add V2 types to book-types.ts

**Files:**
- Modify: `src/pageindex/book-types.ts`

- [ ] **Step 1: Add new types after existing types**

```typescript
/** Book Search v2 输入 */
export interface BookSearchOptionsV2 {
  filePath: string;
  query: string;
  topK?: number;                    // 默认 5
  embedding?: EmbeddingOptions;     // 向量配置（可选）
  scopeNodeIds?: string[];          // S1 圈定的章节范围（可选）
  reranker?: any;                   // 重排配置（可选）
  treeSearch?: boolean;             // 是否启用 LLM 树搜索
  llmClient?: any;                  // LLM 客户端（树搜索需要）
  maxContentLength?: number;        // 每个结果最大内容长度，默认 8000
}

/** 匹配片段（聚焦到 block_id 级别） */
export interface MatchedBlock {
  blockId: string;                  // 最近的 block_id
  content: string;                  // 片段内容（含 ^block_id 标记，~500 字）
}

/** Book Search v2 输出（聚焦到段落级） */
export interface BookSearchResultV2 {
  nodeId: string;
  title: string;
  hierarchyPath: string[];          // 层级路径 ["第1章", "概述"]
  matchedBlocks: MatchedBlock[];    // 该 node 内匹配的段落片段
  score: number;
  bm25Score: number;
  vectorScore: number;
}

/** Book Section 读取结果（read_book_section 返回，含完整内容） */
export interface BookSectionResult {
  nodeId: string;
  title: string;
  content: string;                  // 完整内容（^block_id 内联在段落末尾）
  wordCount: number;
  truncated: boolean;               // 是否超过 8000 字截断
  truncatedAt?: number;
}
```

Need to import `EmbeddingOptions` from `../vault/types.js`.

- [ ] **Step 2: Build to verify**

Run: `npm run build 2>&1 | head -20`

### Task 2: Fix BM25 index building bug in book-indexer.ts

**Files:**
- Modify: `src/pageindex/book-indexer.ts:448-468`

- [ ] **Step 1: Fix `buildBM25IndexFromParseResult` to iterate all structure elements**

Current code only processes `structure[0]`. Fix: iterate entire `structure` array with recursive leaf collection.

```typescript
function buildBM25IndexFromParseResult(parseResult: any): BM25Data {
  const nodes: Array<{ id: string; text: string; level: "L0" | "L1" }> = [];

  for (const rootNode of parseResult.structure || []) {
    // Each top-level element as L0
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
      level: "L0",
    });

    // Recursively collect all child nodes as L1
    collectLeafNodes(rootNode, nodes);
  }

  return buildBM25Index(nodes);
}

function collectLeafNodes(
  node: any,
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): void {
  if (!node.nodes || node.nodes.length === 0) return;

  for (const child of node.nodes) {
    nodes.push({
      id: child.nodeId || `L1-${nodes.length}`,
      text: `${child.title}\n${child.summary || ""}\n${child.text || ""}`,
      level: "L1",
    });
    collectLeafNodes(child, nodes);
  }
}
```

- [ ] **Step 2: Fix `vectorizeL0L1Nodes` with same pattern**

Apply the same iteration fix to `vectorizeL0L1Nodes`.

- [ ] **Step 3: Fix `buildBookMeta` with same pattern**

Apply the same iteration fix to `buildBookMeta`.

- [ ] **Step 4: Build to verify**

Run: `npm run build 2>&1 | head -20`

### Task 3: Simplify book-meta.json to v2

**Files:**
- Modify: `src/pageindex/book-indexer.ts` — `buildBookMeta` function

- [ ] **Step 1: Simplify buildBookMeta to not include chapters[]**

Remove `chapters[]` from BookMeta output. Change version to 2. Keep: version, bookId, title, description, filePath, fileType, indexedAt, embedding.

### Task 4: Simplify frontmatter in exporters

**Files:**
- Modify: `src/pageindex/exporters/pdf-to-obsidian.ts:230-244`
- Modify: `src/pageindex/exporters/epub-to-obsidian.ts`

- [ ] **Step 1: In pdf-to-obsidian.ts, remove index fields from frontmatter**

Remove: `indexed`, `section_index`, `token_count`, `created`, `node_id`, `summary`, `source_file`.
Keep: `title`, `source`, `type`, `tags`, `page_range`.

- [ ] **Step 2: In epub-to-obsidian.ts, remove index fields from frontmatter**

Same removal pattern as PDF.

### Task 5: EPUB nodeId unification

**Files:**
- Modify: `src/pageindex/exporters/epub-to-obsidian.ts:110`

- [ ] **Step 1: Use parse tree nodeId instead of independent counter**

```typescript
// Old: const nodeId = String(i + 1).padStart(4, "0");
// New:
const nodeId = chapterNode.nodeId || String(i + 1).padStart(4, "0");
```

Also fix `buildEpubTree` to use the same nodeId scheme (currently uses `"node-000"` format independently).

### Task 6: Move tree.json to .pageindex/

**Files:**
- Modify: `src/pageindex/exporters/pdf-to-obsidian.ts:307`
- Modify: `src/pageindex/exporters/epub-to-obsidian.ts`
- Modify: `src/pageindex/book-indexer.ts`

- [ ] **Step 1: In pdf-to-obsidian.ts, accept indexDir parameter and write tree.json there**

- [ ] **Step 2: In epub-to-obsidian.ts, same change**

- [ ] **Step 3: In book-indexer.ts, pass indexDir to exporters**

### Task 7: Build and verify Chunk 1

- [ ] **Step 1: Full build**

Run: `npm run build`

---

## Chunk 2: Search Pipeline

### Task 8: Create book-search-v2.ts

**Files:**
- Create: `src/pageindex/book-search-v2.ts`

This is the core file implementing the 8-stage pipeline. Key functions:

1. `searchBookV2(options: BookSearchOptionsV2): Promise<BookSearchResultV2[]>` — main entry
2. `computeDynamicRecallK(query: string): number` — Stage 1
3. Uses existing `searchBM25` from bm25.ts — Stage 2
4. Uses existing `cosineSearch` from vault/vectors.ts — Stage 3
5. `filterByScope(results, scopeNodeIds)` — Stage 4
6. `fuseAndWeightScores(vectorScores, bm25Scores, hasVectors)` — Stage 5
7. `llmTreeSearch(query, structure, llmClient)` — Stage 6 (optional)
8. `crossEncoderRerank(query, results, reranker)` — Stage 7 (optional)
9. `locateMatchedBlocks(nodeId, query, queryTokens, tree, vaultPath, options)` — Stage 8
10. `loadParagraphVectors` / `saveParagraphVectors` — cache I/O
11. `scoreByVectorSimilarity` / `scoreByTokenDensity` — Stage 8 dual paths
12. `splitByBlockIds` — paragraph splitting
13. Helper: `findHierarchyPath`, `findNodeTitle`, `loadTreeJson`, `cosineSimilarity`

See spec section 2.1-2.5 for complete implementation details.

### Task 9: Build and verify Chunk 2

- [ ] **Step 1: Full build**

Run: `npm run build`

---

## Chunk 3: Agent Tool Restructuring

### Task 10: Update types.ts and utils.ts

**Files:**
- Modify: `src/agent/tools/local/types.ts`
- Modify: `src/agent/tools/local/utils.ts`

- [ ] **Step 1: Redefine LocalToolCache in types.ts**

```typescript
export interface LocalToolCache {
  /** tree.json 数据（从 .pageindex/{bookId}/tree.json 加载） */
  treeData?: any;  // TreeData type
  /** 从 tree.json structure 构建的 nodeId → title 映射 */
  nodeTitleMap?: Map<string, string>;
}
```

Remove: `chapterFiles`, `blockIdIndex`, `nodeIdIndex`, `headingIndex`.
Update `SearchHit` to use `matched_blocks` instead of `snippet`/`block_id`.

- [ ] **Step 2: Rewrite utils.ts**

Replace `buildLocalCache` to load tree.json from `.pageindex/{bookId}/tree.json`.
Remove `normalizeNodeId`, `extractChapterMetadata`.
Keep `normalizeHeading`, `estimateTokens`, `parseSectionPath`.

### Task 11: Rewrite search_book tool

**Files:**
- Modify: `src/agent/tools/local/search-text.ts`

- [ ] **Step 1: Rename tool to search_book, remove use_regex, call searchBookV2**

See spec section 3.2 for complete tool definition and executor code.

### Task 12: Rewrite read_book_section tool

**Files:**
- Modify: `src/agent/tools/local/read-section.ts`

- [ ] **Step 1: Rename tool to read_book_section, add batch node_ids, tree.json lookup**

See spec section 3.3 for complete tool definition and executor code.

### Task 13: Delete get-outline, update inspectional.ts

**Files:**
- Delete: `src/agent/tools/local/get-outline.ts`
- Modify: `src/agent/cognitive-engine/states/inspectional.ts`

- [ ] **Step 1: Delete get-outline.ts**

- [ ] **Step 2: In inspectional.ts, replace getOutline call with direct tree.json loading**

### Task 14: Update tool registry, interceptor, analytical state, run-state-loop, prompts

**Files:**
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/cognitive-engine/interceptor/scope-interceptor.ts`
- Modify: `src/agent/cognitive-engine/states/analytical.ts`
- Modify: `src/agent/cognitive-engine/states/run-state-loop.ts`
- Modify: `src/agent/cognitive-engine/prompts/analytical-prompt.ts`

- [ ] **Step 1: In tools/index.ts, remove get_document_outline registration, rename search/read**
- [ ] **Step 2: In scope-interceptor.ts, change 'search_markdown_text' to 'search_book'**
- [ ] **Step 3: In analytical.ts, change tools array to ['search_book', 'read_book_section']**
- [ ] **Step 4: In run-state-loop.ts, change MAX_TOOL_RESULT_LENGTH from 4000 to 8000**
- [ ] **Step 5: In analytical-prompt.ts, update tool names, remove use_regex hints**

### Task 15: Build and verify all

- [ ] **Step 1: Full build**

Run: `npm run build`

---

## Verification Checklist

1. `npm run build` passes with no errors
2. BM25 index building covers all L1 leaf nodes (not just structure[0])
3. search_book tool returns matched_blocks with block_id level precision
4. read_book_section tool uses tree.json for file lookup
5. get_document_outline no longer exists
6. Scope interceptor targets 'search_book'
7. MAX_TOOL_RESULT_LENGTH = 8000
