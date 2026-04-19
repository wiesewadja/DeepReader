# Chunk-Level Vectorization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chapter-summary vectorization with paragraph-level chunked vectorization (300-500 char windows) and adapt the search pipeline.

**Architecture:** New `chunker.ts` handles paragraph splitting and merging. `VectorRecord` and `cosineSearchJsonl` gain L2 support with filtering. `book-indexer.ts` generates L0+L1+L2 vectors + `chunks.jsonl`. `book-search-v2.ts` uses L2 vector results directly, removing lazy paragraph embedding.

**Tech Stack:** TypeScript, Vitest, existing embedding API (generateEmbeddings)

**Spec:** `docs/superpowers/specs/2026-04-19-chunk-level-vectorization-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/pageindex/chunker.ts` (NEW) | `splitByBlockIds` + `mergeToChunks` + `classifyType` |
| `src/pageindex/vault/types.ts` | `VectorRecord` (add chunkId, blockIds, type, L2) + `ChunkTextRecord` |
| `src/pageindex/vault/vectors.ts` | `cosineSearchJsonl` (filter, return chunkId/blockIds) + `readChunkTexts` |
| `src/pageindex/book-indexer.ts` | `vectorizeAllLevels` (L0+L1+L2) + write `chunks.jsonl` |
| `src/pageindex/book-search-v2.ts` | `asyncVectorSearch` returns chunkHits, Stage 8 simplified, delete lazy functions |
| `src/pageindex/book-types.ts` | book-meta version 3 (no interface changes needed) |
| `src/pageindex/__tests__/chunker.test.ts` (NEW) | Chunk splitting/merging tests |
| `src/pageindex/__tests__/vector-storage.test.ts` | Updated for new VectorRecord |

---

## Chunk 1: Chunker Module (no dependencies, pure logic)

### Task 1: Create chunker.ts with splitByBlockIds + mergeToChunks

**Files:**
- Create: `src/pageindex/chunker.ts`
- Test: `src/pageindex/__tests__/chunker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pageindex/__tests__/chunker.test.ts
import { describe, it, expect } from "vitest";
import { splitByBlockIds, mergeToChunks, classifyType } from "../chunker.js";

describe("splitByBlockIds", () => {
  it("should split content by ^blockId markers", () => {
    const content = "First paragraph. ^p000\n\nSecond paragraph. ^p001\n\nThird. ^p002";
    const result = splitByBlockIds(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ blockId: "p000", text: "First paragraph." });
    expect(result[1]).toEqual({ blockId: "p001", text: "Second paragraph." });
    expect(result[2]).toEqual({ blockId: "p002", text: "Third." });
  });

  it("should handle content with no blockIds", () => {
    const result = splitByBlockIds("No block ids here");
    expect(result).toHaveLength(1);
    expect(result[0].blockId).toBe("");
    expect(result[0].text).toBe("No block ids here");
  });

  it("should handle empty content", () => {
    const result = splitByBlockIds("");
    expect(result).toHaveLength(0);
  });

  it("should strip ^ prefix from blockId", () => {
    const content = "Hello ^p000";
    const result = splitByBlockIds(content);
    expect(result[0].blockId).toBe("p000");  // no ^ prefix
  });
});

describe("mergeToChunks", () => {
  it("should merge short paragraphs into target window", () => {
    const paragraphs = [
      { blockId: "p000", text: "Short one." },        // 10 chars
      { blockId: "p001", text: "Short two." },        // 10 chars
      { blockId: "p002", text: "A".repeat(300) },     // 300 chars - triggers boundary
      { blockId: "p003", text: "Next chunk." },
    ];
    const chunks = mergeToChunks(paragraphs, "0005");
    // First chunk: p000 + p001 + p002 (merged until >= 300)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].chunkId).toBe("0005_p000");
    expect(chunks[0].blockIds).toEqual(["p000", "p001", "p002"]);
    expect(chunks[0].text.length).toBeGreaterThanOrEqual(300);
  });

  it("should split long paragraphs > 800 chars at sentence boundary", () => {
    const longText = "A".repeat(400) + "。" + "B".repeat(500);
    const paragraphs = [{ blockId: "p000", text: longText }];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBe(2);
    expect(chunks[0].text.length).toBeLessThanOrEqual(800);
  });

  it("should force split at 800 chars if no sentence boundary", () => {
    const longText = "A".repeat(1000);  // no sentence boundary
    const paragraphs = [{ blockId: "p000", text: longText }];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks.length).toBe(2);
    expect(chunks[0].text.length).toBeLessThanOrEqual(800);
  });

  it("should return empty for empty paragraphs", () => {
    expect(mergeToChunks([], "0005")).toEqual([]);
  });

  it("should handle single short paragraph", () => {
    const paragraphs = [{ blockId: "p000", text: "Just one." }];
    const chunks = mergeToChunks(paragraphs, "0005");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkId).toBe("0005_p000");
    expect(chunks[0].blockIds).toEqual(["p000"]);
  });
});

describe("classifyType", () => {
  it("should classify heading", () => {
    expect(classifyType("## Overview")).toBe("heading");
  });

  it("should classify quote", () => {
    expect(classifyType("> This is a quote")).toBe("quote");
  });

  it("should classify list", () => {
    expect(classifyType("- Item one")).toBe("list");
  });

  it("should classify body as default", () => {
    expect(classifyType("Regular text here")).toBe("body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pageindex/__tests__/chunker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/pageindex/chunker.ts
/**
 * Chunker — splits markdown content into semantic chunks for vectorization.
 * Merges paragraphs to target window size (300-500 chars).
 */

export interface Paragraph {
  blockId: string;   // without ^ prefix
  text: string;
}

export interface Chunk {
  chunkId: string;     // {nodeId}_{firstBlockId}
  blockIds: string[];
  text: string;
  type: "heading" | "body" | "list" | "quote";
}

const TARGET_SIZE = 300;
const MAX_SIZE = 800;

/**
 * Split markdown content by ^blockId markers.
 * Strips ^ prefix from blockIds.
 */
export function splitByBlockIds(content: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const regex = /\^([\w-]+)/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const text = content.slice(lastEnd, match.index).trim();
    if (text) {
      paragraphs.push({ blockId: match[1], text });
    }
    lastEnd = match.index + match[0].length;
  }

  const remaining = content.slice(lastEnd).trim();
  if (remaining) {
    paragraphs.push({ blockId: "", text: remaining });
  }

  return paragraphs;
}

/**
 * Classify a text chunk by its leading characters.
 */
export function classifyType(text: string): "heading" | "body" | "list" | "quote" {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("#")) return "heading";
  if (trimmed.startsWith(">")) return "quote";
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) return "list";
  return "body";
}

/**
 * Split a long text at the best boundary within maxSize.
 */
function splitLongText(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    // Try sentence boundary (。？！)
    let cutPos = -1;
    for (let i = maxSize; i > maxSize * 0.5; i--) {
      if ("。？！".includes(remaining[i])) {
        cutPos = i + 1;
        break;
      }
    }
    // Fallback: comma/semicolon
    if (cutPos === -1) {
      for (let i = maxSize; i > maxSize * 0.5; i--) {
        if ("，；、,;".includes(remaining[i])) {
          cutPos = i + 1;
          break;
        }
      }
    }
    // Final fallback: force cut
    if (cutPos === -1) cutPos = maxSize;

    parts.push(remaining.slice(0, cutPos).trim());
    remaining = remaining.slice(cutPos).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

/**
 * Merge paragraphs into chunks targeting 300-500 chars.
 * Long paragraphs (>800) are split at sentence boundaries.
 */
export function mergeToChunks(paragraphs: Paragraph[], nodeId: string): Chunk[] {
  const chunks: Chunk[] = [];
  let currentTexts: string[] = [];
  let currentBlockIds: string[] = [];
  let currentLength = 0;

  function flush(): void {
    if (currentTexts.length === 0) return;
    const text = currentTexts.join(" ");
    const firstBlockId = currentBlockIds[0] || `auto${chunks.length}`;
    chunks.push({
      chunkId: `${nodeId}_${firstBlockId}`,
      blockIds: [...currentBlockIds],
      text,
      type: classifyType(currentTexts[0]),
    });
    currentTexts = [];
    currentBlockIds = [];
    currentLength = 0;
  }

  for (const para of paragraphs) {
    // Handle long paragraphs by splitting
    if (para.text.length > MAX_SIZE) {
      flush();
      const parts = splitLongText(para.text, MAX_SIZE);
      for (let i = 0; i < parts.length; i++) {
        const suffix = i === 0 ? "" : `_${i}`;
        chunks.push({
          chunkId: `${nodeId}_${para.blockId}${suffix}`,
          blockIds: [para.blockId],
          text: parts[i],
          type: classifyType(parts[i]),
        });
      }
      continue;
    }

    currentTexts.push(para.text);
    if (para.blockId) currentBlockIds.push(para.blockId);
    currentLength += para.text.length;

    if (currentLength >= TARGET_SIZE) {
      flush();
    }
  }

  flush(); // remaining
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pageindex/__tests__/chunker.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/chunker.ts src/pageindex/__tests__/chunker.test.ts
git commit -m "feat: add chunker module for paragraph splitting and merging"
```

---

## Chunk 2: Type Definitions + Vector I/O (depends on Chunk 1)

### Task 2: Update VectorRecord and add ChunkTextRecord

**Files:**
- Modify: `src/pageindex/vault/types.ts:81-86`
- Modify: `src/pageindex/__tests__/vector-storage.test.ts`

- [ ] **Step 1: Update VectorRecord interface**

In `src/pageindex/vault/types.ts`, replace lines 81-86:

```typescript
export interface VectorRecord {
  chunkId: string;
  nodeId: string;
  blockIds: string[];
  type: "summary" | "heading" | "body" | "list" | "quote";
  level: "L0" | "L1" | "L2";
  vector: number[];
}
```

Add after VectorRecord:

```typescript
export interface ChunkTextRecord {
  chunkId: string;
  nodeId: string;
  blockIds: string[];
  text: string;
  type: "summary" | "heading" | "body" | "list" | "quote";
}
```

- [ ] **Step 2: Fix existing vector-storage test**

In `src/pageindex/__tests__/vector-storage.test.ts`, update test VectorRecord data:

```typescript
// Update record1 and record2 to match new VectorRecord shape
const record1: VectorRecord = {
  chunkId: "0001_summary",
  nodeId: "0001",
  blockIds: [],
  type: "summary",
  level: "L1",
  vector: [0.1, 0.2, 0.3],
};
const record2: VectorRecord = {
  chunkId: "0002_summary",
  nodeId: "0002",
  blockIds: [],
  type: "summary",
  level: "L1",
  vector: [0.4, 0.5, 0.6],
};
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/pageindex/__tests__/vector-storage.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pageindex/vault/types.ts src/pageindex/__tests__/vector-storage.test.ts
git commit -m "feat: update VectorRecord with chunkId/blockIds/type, add ChunkTextRecord"
```

### Task 3: Update cosineSearchJsonl with filter + new return type

**Files:**
- Modify: `src/pageindex/vault/vectors.ts:52-68`
- Modify: `src/pageindex/vault/index.ts:196-208` (VectorRecord construction)
- Modify: `src/pageindex/vault/search-v2.ts:114` (cosineSearchJsonl return type)
- Modify: `src/pageindex/vault/search.ts:41-42` (cosineSearchJsonl return type)
- Modify: `src/pageindex/book-search.ts:82-84` (cosineSearchJsonl return type)
- Add: `readChunkTexts` + `writeChunkTexts` functions in `vectors.ts`

- [ ] **Step 1: Update cosineSearchJsonl**

Replace lines 52-68 in `src/pageindex/vault/vectors.ts`:

```typescript
export async function cosineSearchJsonl(
  filePath: string,
  queryVector: number[],
  topK: number,
  filter?: { level?: string }
): Promise<Array<{ chunkId: string; nodeId: string; blockIds: string[]; score: number }>> {
  const records = await readVectorJsonl(filePath);
  const query = new Float32Array(queryVector);
  const scores: Array<{ chunkId: string; nodeId: string; blockIds: string[]; score: number }> = [];

  for (const record of records) {
    if (filter?.level && record.level !== filter.level) continue;
    const vector = new Float32Array(record.vector);
    const score = cosineSimilarity(query, vector);
    scores.push({
      chunkId: record.chunkId,
      nodeId: record.nodeId,
      blockIds: record.blockIds,
      score,
    });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

Add `readChunkTexts` + `writeChunkTexts` after `cosineSearchJsonl`:

```typescript
export async function writeChunkTexts(
  filePath: string,
  records: ChunkTextRecord[]
): Promise<void> {
  const lines = records.map((r) => JSON.stringify(r));
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

export async function readChunkTexts(
  filePath: string
): Promise<ChunkTextRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChunkTextRecord);
  } catch {
    return [];
  }
}
```

Import `ChunkTextRecord` at the top of the file.

- [ ] **Step 2: Update vault/index.ts buildOrUpdateVectors**

In `src/pageindex/vault/index.ts`, lines 196-208 construct old `VectorRecord` (with `title` field). Update to new format:

```typescript
existingMap.set(nodeId, {
  chunkId: nodeId,         // vault-level uses nodeId as chunkId
  nodeId,
  blockIds: [],
  type: "summary",
  level: "L1",
  vector: vectors[i],
});
```

- [ ] **Step 3: Update vault/search-v2.ts**

In `src/pageindex/vault/search-v2.ts:114`, `cosineSearchJsonl` now returns `{ chunkId, nodeId, blockIds, score }` instead of `{ nodeId, title, score }`. Update the consumer code:

```typescript
// Before: vr.nodeId used as both file reference and display
// After: vr.nodeId still works for lookup, vr.title removed
const vectorResults = await cosineSearchJsonl(jsonlPath, queryVector, topK);

for (const vr of vectorResults) {
  const meta = readNoteMeta(vaultPath, vr.nodeId);
  // ... rest unchanged, vr.nodeId still the file path
}
```

- [ ] **Step 4: Update vault/search.ts**

In `src/pageindex/vault/search.ts:41-42`, update the cosineSearchJsonl result destructuring:

```typescript
// Before: results.map(r => ({ nodeId: r.nodeId, score: r.score }))
// After: same destructuring works — nodeId still present
const results = await cosineSearchJsonl(jsonlPath, queryVector, recallK);
vectorResults = results.map((r) => ({ nodeId: r.nodeId, score: r.score }));
```

- [ ] **Step 5: Update book-search.ts**

In `src/pageindex/book-search.ts:82-84`, update the cosineSearchJsonl result handling:

```typescript
// Before: result.nodeId
// After: result.nodeId still present, same usage
const vectorResults = await cosineSearchJsonl(jsonlPath, queryVector, topK * 3);
for (const result of vectorResults) {
  vectorScores.set(result.nodeId, result.score);
}
```

No change needed — `result.nodeId` is still available.

- [ ] **Step 6: Update vector-storage test**

Update `src/pageindex/__tests__/vector-storage.test.ts` for new return shape:

```typescript
it("cosineSearchJsonl should return chunkId and support level filter", async () => {
  await writeVectorJsonl(filePath, [record1, record2]);
  const results = await cosineSearchJsonl(filePath, [0.4, 0.5, 0.6], 10);
  expect(results[0].chunkId).toBe("0002_summary");
  expect(results[0].nodeId).toBe("0002");
  expect(results[0].blockIds).toEqual([]);
});

it("cosineSearchJsonl should filter by level", async () => {
  const l0Record: VectorRecord = {
    chunkId: "BOOK", nodeId: "", blockIds: [], type: "summary", level: "L0",
    vector: [0.9, 0.9, 0.9],
  };
  await writeVectorJsonl(filePath, [l0Record, record1]);
  const results = await cosineSearchJsonl(filePath, [0.4, 0.5, 0.6], 10, { level: "L2" });
  expect(results).toHaveLength(0); // no L2 records
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/pageindex/__tests__/vector-storage.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/pageindex/vault/vectors.ts src/pageindex/vault/index.ts src/pageindex/vault/search-v2.ts src/pageindex/vault/search.ts src/pageindex/book-search.ts src/pageindex/__tests__/vector-storage.test.ts
git commit -m "feat: cosineSearchJsonl filter + readChunkTexts + update all VectorRecord callers"
```

---

## Chunk 3: Indexer — vectorizeAllLevels (depends on Chunk 1 + 2)

### Task 4: Replace vectorizeL0L1Nodes with vectorizeAllLevels

**Files:**
- Modify: `src/pageindex/book-indexer.ts:563-613`

- [ ] **Step 1: Replace vectorizeL0L1Nodes**

Replace the entire `vectorizeL0L1Nodes` function (lines 563-613) and `collectAllChapterNodes` (lines 669-687) with:

```typescript
// Intermediate type: text + metadata before embedding, then converted to VectorRecord
interface PendingChunk {
  chunkId: string;
  nodeId: string;
  blockIds: string[];
  type: "summary" | "heading" | "body" | "list" | "quote";
  level: "L0" | "L1" | "L2";
  text: string;
  vector?: number[];  // filled after embedding
}

async function vectorizeAllLevels(
  parseResult: any,
  indexDir: string,
  embedding: any,
  nodeFileMap: Record<string, string>,
  treeData: any,
  onProgress?: (msg: string) => void
): Promise<{ dimensions: number; nodeCount: number } | undefined> {
  const { generateEmbedding, generateEmbeddings, writeVectorJsonl, writeChunkTexts } =
    await import("./vault/vectors.js");
  const { splitByBlockIds, mergeToChunks } = await import("./chunker.js");
  const vectorPath = path.join(indexDir, "vectors.jsonl");
  const chunksPath = path.join(indexDir, "chunks.jsonl");

  // Auto-detect dimensions
  let dimensions = embedding.dimensions;
  if (!dimensions) {
    const testEmbedding = await generateEmbedding("test", embedding);
    dimensions = testEmbedding.length;
    piLog(`[vectorize] Auto-detected embedding dimensions: ${dimensions}`);
  }

  const allPending: PendingChunk[] = [];

  // L0: book summary
  const bookTitle = parseResult.title || "";
  const bookSummary = parseResult.docDescription || "";
  allPending.push({
    chunkId: "BOOK", nodeId: "", blockIds: [], type: "summary", level: "L0",
    text: `${bookTitle}\n${bookSummary}`,
  });

  // L1: chapter summaries
  for (const node of parseResult.structure || []) {
    collectAllChapterNodes(node, allPending);
  }

  // Generate embeddings for L0+L1
  const l0l1Texts = allPending.map(p => p.text);
  const l0l1Vectors = await generateEmbeddings(l0l1Texts, embedding);
  for (let i = 0; i < l0l1Vectors.length; i++) {
    allPending[i].vector = l0l1Vectors[i];
  }

  // L2: chunk paragraphs from .md files
  const vaultPath = path.dirname(path.dirname(indexDir));
  const exportName = treeData.exportName || treeData.title;
  let totalChunks = 0;

  for (const node of parseResult.structure || []) {
    const chapters = collectChaptersFlat(node);
    for (const ch of chapters) {
      const fileName = nodeFileMap[ch.nodeId];
      if (!fileName) continue;
      const mdPath = path.join(vaultPath, "DeepReader", exportName, fileName);
      try {
        const content = await fs.readFile(mdPath, "utf-8");
        const cleaned = cleanMdContent(content);
        const paragraphs = splitByBlockIds(cleaned);
        const chunks = mergeToChunks(paragraphs, ch.nodeId);

        for (const chunk of chunks) {
          allPending.push({
            chunkId: chunk.chunkId,
            nodeId: ch.nodeId,
            blockIds: chunk.blockIds,
            type: chunk.type,
            level: "L2",
            text: chunk.text,
          });
          totalChunks++;
        }
      } catch {
        piLog(`[vectorize] L2: failed to read ${mdPath}`);
      }
    }
  }

  onProgress?.(`向量化段落 0/${totalChunks}`);

  // Batch embed L2 texts
  const l2Pending = allPending.filter(p => p.level === "L2");
  if (l2Pending.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < l2Pending.length; i += batchSize) {
      const batch = l2Pending.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);
      const vectors = await generateEmbeddings(texts, embedding);
      for (let j = 0; j < vectors.length; j++) {
        // Find the corresponding entry in allPending by chunkId
        const pending = allPending.find(p => p.chunkId === batch[j].chunkId);
        if (pending) pending.vector = vectors[j];
      }
      onProgress?.(`向量化段落 ${Math.min(i + batchSize, totalChunks)}/${totalChunks}`);
    }
  }

  // Split into VectorRecord[] (with vector) and ChunkTextRecord[] (with text)
  const allVectorRecords: VectorRecord[] = allPending.map(p => ({
    chunkId: p.chunkId,
    nodeId: p.nodeId,
    blockIds: p.blockIds,
    type: p.type,
    level: p.level,
    vector: p.vector!,
  }));
  const allChunkTexts: ChunkTextRecord[] = allPending.map(p => ({
    chunkId: p.chunkId,
    nodeId: p.nodeId,
    blockIds: p.blockIds,
    text: p.text,
    type: p.type,
  }));

  await writeVectorJsonl(vectorPath, allVectorRecords);
  await writeChunkTexts(chunksPath, allChunkTexts);

  piLog(`[vectorize] Wrote ${allVectorRecords.length} vectors and ${allChunkTexts.length} chunk texts`);
  return { dimensions, nodeCount: allVectorRecords.length };
}
```

Add helper functions:

```typescript
function collectAllChapterNodes(node: any, pending: PendingChunk[]): void {
  if (node.nodeId && node.title) {
    pending.push({
      chunkId: `${node.nodeId}_summary`,
      nodeId: node.nodeId,
      blockIds: [],
      type: "summary",
      level: "L1",
      text: `${node.title}\n${node.summary || ""}`,
    });
  }
  for (const child of node.nodes || []) {
    collectAllChapterNodes(child, pending);
  }
}

function collectChaptersFlat(node: any): Array<{ nodeId: string; title: string }> {
  const result: Array<{ nodeId: string; title: string }> = [];
  if (node.nodeId && node.title) result.push({ nodeId: node.nodeId, title: node.title });
  for (const child of node.nodes || []) result.push(...collectChaptersFlat(child));
  return result;
}

function cleanMdContent(content: string): string {
  let cleaned = content.replace(/^---[\s\S]*?---\n/, "");
  cleaned = cleaned.replace(/> \[!.*?\][^\n]*\n(> .*\n)*/g, "");
  return cleaned.trim();
}
```

- [ ] **Step 2: Update caller in indexBook()**

In `indexBook`, replace the call to `vectorizeL0L1Nodes` with `vectorizeAllLevels`, passing the additional `nodeFileMap`, `treeData`, and progress callback.

- [ ] **Step 3: Update progress percentages**

Adjust the `reportProgress` calls around the vectorization step to match the new allocation (L0+L1: 75-78%, L2: 78-90%).

- [ ] **Step 4: Clean up old paragraph-vectors directory**

At the start of `vectorizeAllLevels`, before writing new files, add cleanup:

```typescript
// Clean up old paragraph-vectors/ cache (replaced by L2 vectors + chunks.jsonl)
try {
  const oldParaDir = path.join(indexDir, "paragraph-vectors");
  await fs.rm(oldParaDir, { recursive: true, force: true });
} catch { /* ignore if not exists */ }
```

- [ ] **Step 5: Update book-meta version to 3**

In the `bookMeta` object, change `version: 2` to `version: 3`.

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/pageindex/book-indexer.ts
git commit -m "feat: vectorizeAllLevels with L0+L1+L2 + chunks.jsonl"
```

---

## Chunk 4: Search Pipeline Adaptation (depends on Chunk 2 + 3)

### Task 5: Update asyncVectorSearch to return chunkHits

**Files:**
- Modify: `src/pageindex/book-search-v2.ts:688-710`

- [ ] **Step 1: Define ChunkHit type and update asyncVectorSearch**

Replace `asyncVectorSearch` (lines 688-710):

```typescript
interface ChunkHit {
  chunkId: string;
  blockIds: string[];
  score: number;
}

async function asyncVectorSearch(
  indexDir: string,
  queryVector: number[],
  topK: number
): Promise<{
  scores: Map<string, number>;
  chunkHits: Map<string, ChunkHit[]>;
  vector: number[] | null;
}> {
  try {
    const vectorResults = await cosineSearchJsonl(
      path.join(indexDir, "vectors.jsonl"),
      queryVector,
      topK * 3,  // over-recall since multiple chunks map to same nodeId
      { level: "L2" }
    );

    // Fallback to L1 if no L2 results (old index format)
    let results = vectorResults;
    if (results.length === 0) {
      const l1Results = await cosineSearchJsonl(
        path.join(indexDir, "vectors.jsonl"),
        queryVector,
        topK,
        { level: "L1" }
      );
      results = l1Results.map(r => ({ ...r, blockIds: [] }));
    }

    const scores = new Map<string, number>();
    const chunkHits = new Map<string, ChunkHit[]>();

    for (const r of results) {
      const prev = scores.get(r.nodeId) || 0;
      scores.set(r.nodeId, Math.max(prev, r.score));

      if (r.blockIds.length > 0) {
        if (!chunkHits.has(r.nodeId)) chunkHits.set(r.nodeId, []);
        chunkHits.get(r.nodeId)!.push({
          chunkId: r.chunkId,
          blockIds: r.blockIds,
          score: r.score,
        });
      }
    }

    return { scores, chunkHits, vector: queryVector };
  } catch {
    return { scores: new Map(), chunkHits: new Map(), vector: null };
  }
}
```

- [ ] **Step 2: Update searchBookV2 to use chunkHits**

In `searchBookV2` (around line 134-142), update the destructure:

```typescript
const [bm25Results, vectorSearchResult, propSearchResult] = await Promise.all([...]);
// ...
const vectorScores = vectorSearchResult.scores;
const chunkHits = vectorSearchResult.chunkHits;  // NEW
const queryVector = vectorSearchResult.vector;
```

### Task 6: Simplify Stage 8 + delete lazy functions

**Files:**
- Modify: `src/pageindex/book-search-v2.ts:283-330`
- Delete: `locateMatchedBlocks` (lines 421-479)
- Delete: `scoreByVectorSimilarity` (lines 509-538)
- Delete: `scoreByTokenDensity` (lines 542-550)
- Delete: `countTokenHits` (lines 552-562)
- Delete: `loadParagraphVectors` (lines 599-638) — only called by scoreByVectorSimilarity
- Delete: `saveParagraphVectors` (lines 641-684) — only called by locateMatchedBlocks
- Delete: `expandToContext` (lines 566-595) — check if used elsewhere first
- Delete: `Paragraph` interface (lines 414-419) if no other users
- Delete: old `splitByBlockIds` (lines 483-505) — replaced by chunker.ts
- Delete: `import * as fsSync from "fs"` if no longer needed after above deletions

- [ ] **Step 1: Simplify Stage 8**

Replace Stage 8 block (lines 283-330):

```typescript
// ── Stage 8: Matched block location ────────────────────────────────────
const results: BookSearchResultV2[] = [];

// Load chunk texts for matchedBlocks content
let chunkTextMap = new Map<string, string>();
if (chunkHits.size > 0) {
  try {
    const { readChunkTexts } = await import("./vault/vectors.js");
    const chunkTexts = await readChunkTexts(path.join(indexDir, "chunks.jsonl"));
    chunkTextMap = new Map(chunkTexts.map(c => [c.chunkId, c.text]));
  } catch {
    piLog("[book-search-v2] Failed to load chunks.jsonl");
  }
}

for (const r of topResults) {
  const hierarchyPath = findHierarchyPath(r.nodeId, treeData.structure);
  const title = findNodeTitle(r.nodeId, treeData.structure) || r.nodeId;

  // Priority: proposition cards > vector chunk hits
  const matchedCards = propositionMatches.get(r.nodeId) || [];
  let matchedBlocks: MatchedBlock[];

  if (matchedCards.length > 0) {
    matchedBlocks = matchedCards.slice(0, 3).map((card: PropositionCard) => ({
      blockId: card.id,
      content: `${card.context} ^${card.id}\n\n【${card.type}】${card.answer}`,
    }));
  } else if (chunkHits.has(r.nodeId)) {
    const chunks = chunkHits.get(r.nodeId)!.slice(0, 3);
    matchedBlocks = chunks.map(c => ({
      blockId: c.blockIds[0] ? `^${c.blockIds[0]}` : "",
      content: chunkTextMap.get(c.chunkId) || "",
    }));
  } else {
    matchedBlocks = [];
  }

  results.push({
    nodeId: r.nodeId,
    title,
    fileName: (treeData.nodeFileMap?.[r.nodeId] || '').replace(/\.md$/i, ''),
    hierarchyPath,
    matchedBlocks,
    score: r.fusedScore,
    bm25Score: r.bm25Score,
    vectorScore: r.vectorScore,
  });
}

return results;
```

- [ ] **Step 2: Delete locateMatchedBlocks, scoreByVectorSimilarity, scoreByTokenDensity, countTokenHits**

Remove these functions and the old `splitByBlockIds` from book-search-v2.ts. Remove the `Paragraph` interface. Keep `expandToContext` only if still referenced.

- [ ] **Step 3: Update book-search-v2 test**

In `src/pageindex/__tests__/book-search-v2.test.ts`:
- Remove imports and tests for `splitByBlockIds`, `scoreByTokenDensity`, `countTokenHits`
- These are now tested in `chunker.test.ts`

- [ ] **Step 4: Run full test suite**

Run: `npm run test:run`
Expected: No new failures related to deleted functions

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/book-search-v2.ts src/pageindex/__tests__/book-search-v2.test.ts
git commit -m "feat: search pipeline uses L2 chunk vectors, remove lazy paragraph embedding"
```

---

## Chunk 5: Integration + Cleanup (depends on all above)

### Task 7: Update remaining callers of old VectorRecord

**Files:**
- Check all files importing `VectorRecord` or using old `cosineSearchJsonl` return type
- Files to check: `src/pageindex/book-search.ts`, `src/pageindex/vault/search.ts`, `src/pageindex/vault/compiler.ts`, `src/pageindex/vault/index.ts`

- [ ] **Step 1: Search for old VectorRecord usage**

Run: `grep -rn "VectorRecord\|cosineSearchJsonl" src/pageindex/ --include="*.ts" --exclude-dir=__tests__`

For each file found, update to use new `chunkId`-based interface. Key changes:
- Any code reading `record.nodeId` as chapter-level ID still works (L0/L1 have nodeId too)
- Any code reading `record.title` needs to change (field removed, use `chunkId` or load from chunks.jsonl)

- [ ] **Step 2: Fix book-search.ts L0 check**

In `src/pageindex/book-search.ts:122`, the `BOOK` nodeId check is already correct from previous fix.

- [ ] **Step 3: Fix vault/search.ts and vault/compiler.ts**

These files use `VectorRecord` for the vault-level index. Update record construction to include new fields.

- [ ] **Step 4: Build and verify**

Run: `npm run build && npm run test:run`
Expected: Build succeeds, no new test failures

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/book-search.ts src/pageindex/vault/search.ts src/pageindex/vault/search-v2.ts src/pageindex/book-types.ts
git commit -m "fix: update all VectorRecord callers for new chunk-based format"
```

### Task 8: Deploy and integration test

- [ ] **Step 1: Deploy to test-vault**

Run: `npm run deploy`

- [ ] **Step 2: Re-index a book in Obsidian**

In Obsidian: open Library → re-index "如何阅读一本书"

- [ ] **Step 3: Verify index output**

Check `.pageindex/{bookId}/`:
- `vectors.jsonl` should have L0, L1, L2 records with chunkId/blockIds
- `chunks.jsonl` should exist with text records
- `book-meta.json` should have `version: 3`

- [ ] **Step 4: Test search**

Use the search feature to query "检视阅读的步骤" and verify:
- Vector recall returns L2 chunk results
- matchedBlocks show paragraph-level content (not empty)
- No console errors about missing paragraph-vectors/

- [ ] **Step 5: Final commit**

```bash
git commit --allow-empty -m "chore: chunk-level vectorization integration verified"
```
