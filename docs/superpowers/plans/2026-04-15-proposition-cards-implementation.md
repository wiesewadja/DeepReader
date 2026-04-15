# Proposition Cards Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add atomic fact-level index layer (proposition cards) to PageIndex for finer retrieval granularity.

**Architecture:** Extract cards per chapter using small model with Few-Shot prompt (based on *How to Read a Book* analytical reading rules). Store in propositions.json + prop_vectors.f32. Parallel retrieval with BM25/Vector, fused results returned to LLM.

**Tech Stack:** TypeScript, Node.js, OpenAI-compatible API (siliconflow), Float32 vector storage

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/pageindex/book-types.ts` | PropositionCard type definition |
| `src/pageindex/proposition-indexer.ts` | Card extraction, validation, vectorization, storage |
| `src/pageindex/proposition-search.ts` | Card retrieval, parallel fusion with BM25 |
| `src/pageindex/book-indexer.ts` | Integrate proposition extraction into index flow |
| `src/pageindex/book-search-v2.ts` | Integrate proposition search into search flow |
| `src/pageindex/__tests__/proposition-indexer.test.ts` | Unit tests for extraction |
| `src/pageindex/__tests__/proposition-search.test.ts` | Unit tests for retrieval |

---

## Chunk 1: Type Definitions

### Task 1: Add PropositionCard Types

**Files:**
- Modify: `src/pageindex/book-types.ts`

- [ ] **Step 1: Add CardType and PropositionCard types**

```typescript
// Add after BookSectionResult interface (around line 240)

export type CardType = 
  | '问题' 
  | '概念' 
  | '主旨' 
  | '论述' 
  | '结论' 
  | '人物' 
  | '情节' 
  | '象征';

export interface PropositionCard {
  id: string;
  type: CardType;
  answer: string;
  context: string;
  tags: string[];
  sourceNodeId: string;
}

export interface PropositionsData {
  version: number;
  bookId: string;
  totalCards: number;
  cards: PropositionCard[];
  generatedAt: string;
  model: string;
}

export interface PropositionIndexOptions {
  bookId: string;
  vaultPath: string;
  treeData: TreeData;
  embedding?: EmbeddingOptions;
  llm: {
    model: string;
    apiKey: string;
    baseUrl: string;
  };
  cardsPer500Words?: number;
  minCards?: number;
  maxCards?: number;
  onProgress?: (progress: { percent: number; message: string }) => void;
}

export interface PropositionIndexResult {
  bookId: string;
  totalCards: number;
  indexDir: string;
}

export interface PropositionMatch {
  card: PropositionCard;
  score: number;
}
```

- [ ] **Step 2: Extend BookMeta interface**

```typescript
// Modify BookMeta interface (around line 127), add propositions field

export interface BookMeta {
  // ... existing fields ...
  propositions?: {
    enabled: boolean;
    totalCards: number;
    model: string;
    generatedAt: string;
  };
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/pageindex/book-types.ts
git commit -m "feat(pageindex): add PropositionCard types"
```

---

## Chunk 2: Proposition Indexer Core

### Task 2: Create proposition-indexer.ts

**Files:**
- Create: `src/pageindex/proposition-indexer.ts`

- [ ] **Step 1: Create file with imports and constants**

```typescript
/**
 * Proposition Indexer - Extract atomic fact cards per chapter
 */

import * as path from "path";
import * as fs from "fs/promises";
import { chatGPT } from "./llm/client.js";
import {
  initVectorStore,
  generateEmbedding,
  appendVector,
} from "./vault/vectors.js";
import type { 
  PropositionCard, 
  PropositionsData, 
  PropositionIndexOptions,
  PropositionIndexResult,
  CardType,
} from "./book-types.js";
import type { TreeData, TreeNode } from "./book-types.js";
import type { EmbeddingOptions } from "./vault/types.js";
import { log as piLog } from "./core/logger.js";

const DEFAULT_CARDS_PER_500 = 1;
const DEFAULT_MIN_CARDS = 3;
const DEFAULT_MAX_CARDS = 15;
```

- [ ] **Step 2: Add Few-Shot prompt template**

```typescript
export function buildExtractionPrompt(
  chapterText: string,
  targetCards: number
): string {
  const chapterLength = chapterText.length;
  
  return `
你正在用《如何阅读一本书》的分析阅读方法提取知识点卡片。

## 卡片类型定义：

| 类型 | 提取什么 | 示例 |
|------|---------|------|
| 问题 | 作者要解决的问题 | "贾宝玉的命运将如何？" |
| 概念 | 核心概念定义 | "判词：预言人物命运的诗句" |
| 主旨 | 作者的核心观点 | "判词预示主要人物命运" |
| 论述 | 论证逻辑结构 | "用谐音双关暗示人物结局" |
| 结论 | 作者得出的解答 | "玉带林中挂指林黛玉" |
| 人物 | 人物特征/命运/关系 | "薛宝钗：金簪雪里埋" |
| 情节 | 关键事件/转折点 | "宝玉梦游太虚幻境" |
| 象征 | 隐喻/意象/象征义 | "玉带=玉黛，谐音双关" |

## Few-Shot 示例：

### 示例1：学术类书籍

输入章节：
"亚里士多德在《尼各马可伦理学》中提出，美德是一种习惯。他认为，美德不是天生的，
而是通过反复实践获得的。一个人要成为勇敢的人，必须反复做勇敢的事。
美德处于两个极端之间：勇敢处于怯懦和鲁莽之间。这种中道原则是亚里士多德伦理学的核心。"

输出：
{
  "cards": [
    {
      "type": "概念",
      "answer": "美德是一种习惯，通过反复实践获得",
      "context": "美德不是天生的，而是通过反复实践获得的",
      "tags": ["美德", "习惯", "亚里士多德", "伦理学", "实践"]
    },
    {
      "type": "主旨",
      "answer": "美德处于两个极端之间的中道",
      "context": "美德处于两个极端之间：勇敢处于怯懦和鲁莽之间",
      "tags": ["中道原则", "美德", "极端", "勇敢"]
    },
    {
      "type": "论述",
      "answer": "勇敢=怯懦与鲁莽的中道，举例说明中道原则",
      "context": "勇敢处于怯懦和鲁莽之间",
      "tags": ["论述", "勇敢", "怯懦", "鲁莽", "中道"]
    },
    {
      "type": "结论",
      "answer": "中道原则是亚里士多德伦理学的核心",
      "context": "这种中道原则是亚里士多德伦理学的核心",
      "tags": ["中道原则", "亚里士多德", "伦理学", "核心结论"]
    }
  ]
}

### 示例2：文学类书籍

输入章节：
"宝玉看了不解，遂掷下这个，去开那个。后面又画着一堆雪，雪下一股金簪。
也有四句言词，道是：可叹停机德，堪怜咏絮才。玉带林中挂，金簪雪里埋。
宝玉看了仍不解，便又掷了，再去开那一副..."

输出：
{
  "cards": [
    {
      "type": "问题",
      "answer": "贾宝玉的命运将如何？判词预示了什么？",
      "context": "宝玉看了不解，遂掷下这个，去开那个",
      "tags": ["贾宝玉", "命运", "判词", "不解"]
    },
    {
      "type": "概念",
      "answer": "判词：预言人物命运的诗句",
      "context": "也有四句言词，道是",
      "tags": ["判词", "概念", "预言", "诗句"]
    },
    {
      "type": "主旨",
      "answer": "判词预示黛玉和宝钗的命运",
      "context": "可叹停机德，堪怜咏絮才。玉带林中挂，金簪雪里埋",
      "tags": ["判词", "命运预示", "林黛玉", "薛宝钗"]
    },
    {
      "type": "象征",
      "answer": "玉带林中挂=林黛玉（玉带谐音玉黛）",
      "context": "玉带林中挂",
      "tags": ["林黛玉", "玉带", "谐音", "象征", "双关"]
    },
    {
      "type": "人物",
      "answer": "薛宝钗：金簪雪里埋，暗示婚姻冰冷结局",
      "context": "金簪雪里埋",
      "tags": ["薛宝钗", "金簪", "命运", "结局"]
    }
  ]
}

### 示例3：实用类书籍

输入章节：
"MECE原则是咨询行业的基本方法论。MECE意为"相互独立，完全穷尽"。
在分析问题时，要确保各个分类之间没有重叠（相互独立），同时所有可能情况都被覆盖（完全穷尽）。
例如，分析客户时可以按"新客户/老客户"分类，这既不重叠又覆盖了所有客户类型。"

输出：
{
  "cards": [
    {
      "type": "概念",
      "answer": "MECE：相互独立，完全穷尽",
      "context": "MECE意为相互独立，完全穷尽",
      "tags": ["MECE", "概念", "相互独立", "完全穷尽", "方法论"]
    },
    {
      "type": "主旨",
      "answer": "MECE是咨询行业的基本方法论",
      "context": "MECE原则是咨询行业的基本方法论",
      "tags": ["MECE", "咨询", "方法论", "核心原则"]
    },
    {
      "type": "论述",
      "answer": "分类不重叠+覆盖所有情况=MECE",
      "context": "各个分类之间没有重叠，同时所有可能情况都被覆盖",
      "tags": ["论述", "分类", "重叠", "覆盖"]
    },
    {
      "type": "结论",
      "answer": "新客户/老客户是MECE分类示例",
      "context": "分析客户时可以按新客户/老客户分类",
      "tags": ["MECE", "示例", "客户分类", "应用"]
    }
  ]
}

---

## 当前任务：

从以下章节文本中提取 ${targetCards} 张原子事实卡片。

要求：
- 卡片数量：${targetCards} 张（允许 ±2 偏差）
- 根据内容自动选择合适的类型组合
- 文学作品侧重：人物/情节/象征
- 学术作品侧重：问题/概念/主旨/论述/结论
- 实用作品侧重：概念/主旨/结论

格式要求：
- answer：简洁（≤50字），独立可理解
- context：精准摘录原文（≤200字）
- tags：多角度标注（实体名、别名、相关概念、隐喻关键词）

输出格式（纯JSON，无markdown包裹）：
{
  "cards": [
    {
      "type": "类型名",
      "answer": "...",
      "context": "...",
      "tags": ["..."]
    }
  ]
}

章节文本（${chapterLength}字）：
${chapterText}
`;
}
```

- [ ] **Step 3: Add calculateTargetCards function**

```typescript
export function calculateTargetCards(
  chapterLength: number,
  cardsPer500: number = DEFAULT_CARDS_PER_500,
  minCards: number = DEFAULT_MIN_CARDS,
  maxCards: number = DEFAULT_MAX_CARDS
): number {
  const base = Math.floor(chapterLength / 500) * cardsPer500;
  return Math.max(minCards, Math.min(maxCards, base));
}
```

- [ ] **Step 4: Add parseCards function**

```typescript
export function parseCards(
  response: string,
  sourceNodeId: string
): PropositionCard[] {
  // Strip markdown code blocks if present
  let jsonStr = response.trim();
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr) as { cards: Array<{
      type: string;
      answer: string;
      context: string;
      tags: string[];
    }> };

    return parsed.cards.map((card, index) => ({
      id: `card_${sourceNodeId}_${index + 1}`,
      type: card.type as CardType,
      answer: card.answer,
      context: card.context,
      tags: card.tags,
      sourceNodeId,
    }));
  } catch (error) {
    piLog(`[proposition-indexer] Failed to parse cards: ${error}`);
    return [];
  }
}
```

- [ ] **Step 5: Add extractCardsFromChapter function**

```typescript
export async function extractCardsFromChapter(
  chapterText: string,
  sourceNodeId: string,
  llm: { model: string; apiKey: string; baseUrl: string },
  options?: {
    cardsPer500?: number;
    minCards?: number;
    maxCards?: number;
  }
): Promise<PropositionCard[]> {
  const targetCards = calculateTargetCards(
    chapterText.length,
    options?.cardsPer500,
    options?.minCards,
    options?.maxCards
  );

  const prompt = buildExtractionPrompt(chapterText, targetCards);

  try {
    const response = await chatGPT({
      model: llm.model,
      prompt,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      temperature: 0.3,
    });

    const cards = parseCards(response, sourceNodeId);

    // Validate card count (allow ±2 deviation)
    if (cards.length < targetCards - 2) {
      piLog(`[proposition-indexer] Warning: cards insufficient (${cards.length} < ${targetCards})`);
    }

    return cards;
  } catch (error) {
    piLog(`[proposition-indexer] Extraction failed: ${error}`);
    return [];
  }
}
```

- [ ] **Step 6: Add indexPropositions main function**

```typescript
export async function indexPropositions(
  options: PropositionIndexOptions
): Promise<PropositionIndexResult> {
  const {
    bookId,
    vaultPath,
    treeData,
    embedding,
    llm,
    cardsPer500Words,
    minCards,
    maxCards,
    onProgress,
  } = options;

  const indexDir = path.join(vaultPath, ".pageindex", bookId);
  const allCards: PropositionCard[] = [];

  // Collect all chapters from tree
  const chapters = collectChapters(treeData);

  onProgress?.({ percent: 0, message: "开始提取命题卡片" });

  // Extract cards per chapter
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    
    // Read chapter content
    const chapterPath = path.join(vaultPath, "DeepReader", treeData.exportName || treeData.title, chapter.fileName + ".md");
    let chapterText = "";
    
    try {
      chapterText = await readChapterContent(chapterPath);
    } catch (error) {
      piLog(`[proposition-indexer] Failed to read chapter: ${chapter.fileName}`);
      continue;
    }

    if (chapterText.length < 200) {
      piLog(`[proposition-indexer] Chapter too short, skipping: ${chapter.fileName}`);
      continue;
    }

    onProgress?.({
      percent: Math.round((i / chapters.length) * 80),
      message: `提取章节 ${i + 1}/${chapters.length}: ${chapter.title}`,
    });

    const cards = await extractCardsFromChapter(
      chapterText,
      chapter.nodeId,
      llm,
      { cardsPer500: cardsPer500Words, minCards, maxCards }
    );

    allCards.push(...cards);
  }

  onProgress?.({ percent: 80, message: "卡片提取完成，开始向量化" });

  // Vectorize cards if embedding provided
  if (embedding && allCards.length > 0) {
    await vectorizeCards(allCards, indexDir, embedding);
  }

  onProgress?.({ percent: 95, message: "存储卡片数据" });

  // Save propositions.json
  const propositionsData: PropositionsData = {
    version: 1,
    bookId,
    totalCards: allCards.length,
    cards: allCards,
    generatedAt: new Date().toISOString(),
    model: llm.model,
  };

  await fs.writeFile(
    path.join(indexDir, "propositions.json"),
    JSON.stringify(propositionsData, null, 2),
    "utf-8"
  );

  onProgress?.({ percent: 100, message: "命题卡片索引完成" });

  return {
    bookId,
    totalCards: allCards.length,
    indexDir,
  };
}
```

- [ ] **Step 7: Add helper functions**

```typescript
function collectChapters(treeData: TreeData): Array<{ nodeId: string; title: string; fileName: string }> {
  const chapters: Array<{ nodeId: string; title: string; fileName: string }> = [];
  const nodeFileMap = treeData.nodeFileMap || {};

  for (const root of treeData.structure || []) {
    // Root node
    if (root.nodeId && nodeFileMap[root.nodeId]) {
      chapters.push({
        nodeId: root.nodeId,
        title: root.title,
        fileName: nodeFileMap[root.nodeId],
      });
    }

    // Child nodes
    if (root.nodes) {
      for (const child of root.nodes) {
        if (child.nodeId && nodeFileMap[child.nodeId]) {
          chapters.push({
            nodeId: child.nodeId,
            title: child.title,
            fileName: nodeFileMap[child.nodeId],
          });
        }
      }
    }
  }

  return chapters;
}

async function readChapterContent(mdPath: string): Promise<string> {
  const content = await fs.readFile(mdPath, "utf-8");

  // Remove frontmatter
  let cleaned = content.replace(/^---[\s\S]*?---\n/, "");

  // Remove navigation markers (wiki links)
  cleaned = cleaned.replace(/\[\[.*?\]\]/g, "");

  // Remove callout blocks
  cleaned = cleaned.replace(/> \[!.*?\][^\n]*\n(> .*\n)*/g, "");

  // Remove Obsidian comment markers
  cleaned = cleaned.replace(/%%.*?%%/g, "");

  // Remove block ID markers
  cleaned = cleaned.replace(/\^[a-zA-Z0-9_-]+/g, "");

  return cleaned.trim();
}

async function vectorizeCards(
  cards: PropositionCard[],
  indexDir: string,
  embedding: EmbeddingOptions
): Promise<void> {
  // Vector content: answer + context + tags
  const texts = cards.map(c => `${c.answer}\n${c.context}\n${c.tags.join(" ")}`);

  // Auto-detect dimensions
  let dimensions = embedding.dimensions;
  if (!dimensions) {
    const testEmbedding = await generateEmbedding("test", embedding);
    dimensions = testEmbedding.length;
    piLog(`[proposition-indexer] Auto-detected dimensions: ${dimensions}`);
  }

  const store = await initVectorStore(indexDir, dimensions);
  
  // Use separate file for proposition vectors
  const propVectorPath = path.join(indexDir, "prop_vectors.f32");
  const propMetaPath = path.join(indexDir, "prop_vectors.meta.json");
  
  // Generate embeddings in batch
  const batchSize = 50;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await generateEmbeddings(batch, embedding);
    
    for (let j = 0; j < vectors.length; j++) {
      const cardIndex = i + j;
      store.meta.slots[cards[cardIndex].id] = { slotIndex: cardIndex, deleted: false };
    }
  }

  store.meta.count = cards.length;
  store.meta.model = embedding.model || "text-embedding-3-small";

  // Write vectors file (reuse same format as vectors.f32)
  const header = buildPropVectorHeader(dimensions, cards.length);
  const vectorData = new Float32Array(cards.length * dimensions);
  
  // Fetch all vectors
  const allVectors = await generateEmbeddings(texts, embedding);
  for (let i = 0; i < allVectors.length; i++) {
    vectorData.set(allVectors[i], i * dimensions);
  }

  const fileHandle = await fs.open(propVectorPath, "w");
  await fileHandle.write(Buffer.from(header));
  await fileHandle.write(Buffer.from(vectorData.buffer));
  await fileHandle.close();

  await fs.writeFile(propMetaPath, JSON.stringify(store.meta, null, 2), "utf-8");
}

import { generateEmbeddings } from "./vault/vectors.js";
import { open } from "node:fs/promises";

function buildPropVectorHeader(dimensions: number, count: number): ArrayBuffer {
  const HEADER_SIZE = 24;
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  const encoder = new TextEncoder();
  const magicBytes = encoder.encode("BPI_VEC");
  new Uint8Array(buffer, 0, 8).set(magicBytes);

  view.setUint32(8, 1, true);      // version
  view.setUint32(12, dimensions, true);
  view.setUint32(16, count, true);
  view.setUint32(20, 0, true);     // deletedCount

  return buffer;
}
```

- [ ] **Step 8: Verify file compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/pageindex/proposition-indexer.ts
git commit -m "feat(pageindex): add proposition-indexer with Few-Shot prompt"
```

---

## Chunk 3: Proposition Search

### Task 3: Create proposition-search.ts

**Files:**
- Create: `src/pageindex/proposition-search.ts`

- [ ] **Step 1: Create file with imports**

```typescript
/**
 * Proposition Search - Retrieve atomic fact cards
 */

import * as path from "path";
import * as fs from "fs/promises";
import { open } from "node:fs/promises";
import { generateEmbedding, cosineSearch } from "./vault/vectors.js";
import type {
  PropositionCard,
  PropositionsData,
  PropositionMatch,
} from "./book-types.js";
import type { EmbeddingOptions } from "./vault/types.js";
import { loadVectorStore } from "./vault/vectors.js";
import { cosineSimilarity } from "./core/utils.js";

const PROP_VECTOR_HEADER_SIZE = 24;
```

- [ ] **Step 2: Add loadPropositions function**

```typescript
export async function loadPropositions(
  indexDir: string
): Promise<PropositionsData | null> {
  const propPath = path.join(indexDir, "propositions.json");

  try {
    const content = await fs.readFile(propPath, "utf-8");
    return JSON.parse(content) as PropositionsData;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Add loadPropVectorStore function**

```typescript
export async function loadPropVectorStore(
  indexDir: string
): Promise<{ vectors: Float32Array; meta: { dimensions: number; slots: Record<string, { slotIndex: number; deleted: boolean }> } } | null> {
  const vectorPath = path.join(indexDir, "prop_vectors.f32");
  const metaPath = path.join(indexDir, "prop_vectors.meta.json");

  try {
    const metaContent = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaContent);

    const buffer = await fs.readFile(vectorPath);
    const vectors = new Float32Array(buffer.buffer, PROP_VECTOR_HEADER_SIZE);

    return { vectors, meta };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add searchPropositions function**

```typescript
export async function searchPropositions(
  query: string,
  bookId: string,
  vaultPath: string,
  embedding: EmbeddingOptions,
  topK: number = 5
): Promise<PropositionMatch[]> {
  const indexDir = path.join(vaultPath, ".pageindex", bookId);

  // Load propositions and vectors
  const propositions = await loadPropositions(indexDir);
  const vectorStore = await loadPropVectorStore(indexDir);

  if (!propositions || !vectorStore || propositions.totalCards === 0) {
    return [];
  }

  // Generate query embedding
  const queryVector = await generateEmbedding(query, embedding);
  const queryFloat32 = new Float32Array(queryVector);

  // Search
  const scores: Array<{ cardId: string; score: number }> = [];

  for (const [cardId, slot] of Object.entries(vectorStore.meta.slots)) {
    if (slot.deleted) continue;

    const offset = slot.slotIndex * vectorStore.meta.dimensions;
    const cardVector = vectorStore.vectors.subarray(
      offset,
      offset + vectorStore.meta.dimensions
    );

    const score = cosineSimilarity(queryFloat32, cardVector);
    scores.push({ cardId, score });
  }

  // Sort and take topK
  const topScores = scores.sort((a, b) => b.score - a.score).slice(0, topK);

  // Build matches
  return topScores.map(s => ({
    card: propositions.cards.find(c => c.id === s.cardId)!,
    score: s.score,
  }));
}
```

- [ ] **Step 5: Add parallel fusion function**

```typescript
export interface FusionResult {
  nodeId: string;
  title: string;
  fileName: string;
  matchedCards: PropositionMatch[];
  bm25Score: number;
  vectorScore: number;
  fusedScore: number;
}

export async function searchWithPropositions(
  query: string,
  bookId: string,
  vaultPath: string,
  embedding: EmbeddingOptions,
  topK: number = 5,
  fusionWeights?: { prop: number; bm25: number }
): Promise<FusionResult[]> {
  const weights = fusionWeights || { prop: 0.6, bm25: 0.4 };

  const indexDir = path.join(vaultPath, ".pageindex", bookId);

  // Parallel search
  const [propResults, bm25Results] = await Promise.all([
    searchPropositions(query, bookId, vaultPath, embedding, topK * 2),
    searchBM25Light(query, indexDir, topK * 2),
  ]);

  // Build node-level results
  const nodeMap = new Map<string, FusionResult>();

  // Process proposition results
  for (const match of propResults) {
    const nodeId = match.card.sourceNodeId;
    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, {
        nodeId,
        title: "",
        fileName: "",
        matchedCards: [],
        bm25Score: 0,
        vectorScore: 0,
        fusedScore: 0,
      });
    }
    const entry = nodeMap.get(nodeId)!;
    entry.matchedCards.push(match);
    entry.vectorScore = Math.max(entry.vectorScore, match.score);
  }

  // Process BM25 results
  for (const bm25 of bm25Results) {
    if (!nodeMap.has(bm25.nodeId)) {
      nodeMap.set(bm25.nodeId, {
        nodeId: bm25.nodeId,
        title: bm25.title,
        fileName: bm25.fileName,
        matchedCards: [],
        bm25Score: 0,
        vectorScore: 0,
        fusedScore: 0,
      });
    }
    const entry = nodeMap.get(bm25.nodeId)!;
    entry.bm25Score = Math.max(entry.bm25Score, bm25.score);
    if (!entry.title) entry.title = bm25.title;
    if (!entry.fileName) entry.fileName = bm25.fileName;
  }

  // Calculate fused scores
  for (const entry of nodeMap.values()) {
    entry.fusedScore = weights.prop * entry.vectorScore + weights.bm25 * entry.bm25Score;
  }

  // Sort and return
  return Array.from(nodeMap.values())
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);
}
```

- [ ] **Step 6: Add light BM25 search helper**

```typescript
import type { BM25Data } from "./book-types.js";
import { searchBM25 } from "./bm25.js";

async function searchBM25Light(
  query: string,
  indexDir: string,
  topK: number
): Promise<Array<{ nodeId: string; title: string; fileName: string; score: number }>> {
  const bm25Path = path.join(indexDir, "bm25.json");

  try {
    const content = await fs.readFile(bm25Path, "utf-8");
    const bm25Data = JSON.parse(content) as BM25Data;

    const results = searchBM25(query, bm25Data, topK);

    // Map nodeId to title/fileName (from tree.json)
    const treePath = path.join(indexDir, "tree.json");
    const treeContent = await fs.readFile(treePath, "utf-8");
    const treeData = JSON.parse(treeContent);
    const nodeFileMap = treeData.nodeFileMap || {};

    return results.map(r => ({
      nodeId: r.nodeId,
      title: "",
      fileName: nodeFileMap[r.nodeId] || "",
      score: r.score,
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 7: Add formatPropositionResults function**

```typescript
export function formatPropositionResults(results: PropositionMatch[]): string {
  if (results.length === 0) return "";

  return results.map(r => `
【${r.card.type}】${r.card.answer}
原文：${r.card.context}
关键词：${r.card.tags.join("、")}
`).join("\n---\n");
}
```

- [ ] **Step 8: Verify file compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/pageindex/proposition-search.ts
git commit -m "feat(pageindex): add proposition search with parallel fusion"
```

---

## Chunk 4: Integration with Book Indexer

### Task 4: Integrate proposition extraction into indexBook

**Files:**
- Modify: `src/pageindex/book-indexer.ts`

- [ ] **Step 1: Add import**

```typescript
// Add at top of imports section
import { indexPropositions } from "./proposition-indexer.js";
import type { PropositionIndexOptions } from "./book-types.js";
```

- [ ] **Step 2: Extend BookIndexOptions**

```typescript
// Add to BookIndexOptions interface (around line 6)
export interface BookIndexOptions {
  // ... existing fields ...
  
  /** Proposition cards config (optional) */
  propositions?: {
    enabled: boolean;
    model: string;
    apiKey: string;
    baseUrl: string;
    cardsPer500Words?: number;
  };
}
```

- [ ] **Step 3: Add proposition extraction step in indexBook function**

```typescript
// Add after BM25 index building (around line 384), before final cleanup

// Step 7: Proposition cards extraction (optional)
if (options.propositions?.enabled && options.propositions.apiKey) {
  reportProgress({
    percent: 97,
    step: "extract_propositions",
    stepLabel: "提取命题卡片",
  });

  try {
    // Load tree.json for chapter structure
    const treePath = path.join(indexDir, "tree.json");
    const treeContent = await fs.readFile(treePath, "utf-8");
    const treeData = JSON.parse(treeContent);

    const propResult = await indexPropositions({
      bookId,
      vaultPath: options.outputDir,
      treeData,
      embedding: options.embedding,
      llm: {
        model: options.propositions.model,
        apiKey: options.propositions.apiKey,
        baseUrl: options.propositions.baseUrl,
      },
      cardsPer500Words: options.propositions.cardsPer500Words,
      onProgress: (p) => {
        reportProgress({
          percent: 97 + Math.round(p.percent * 0.02),
          step: "extract_propositions",
          stepLabel: p.message,
        });
      },
    });

    // Update book-meta with proposition info
    bookMeta.propositions = {
      enabled: true,
      totalCards: propResult.totalCards,
      model: options.propositions.model,
      generatedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(indexDir, "book-meta.json"),
      JSON.stringify(bookMeta, null, 2)
    );

    piLog(`[book-indexer] Proposition cards: ${propResult.totalCards}`);
  } catch (error) {
    console.warn("[book-indexer] Proposition extraction failed:", error);
    // Continue without propositions
  }
}
```

- [ ] **Step 4: Verify file compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/book-indexer.ts src/pageindex/book-types.ts
git commit -m "feat(pageindex): integrate proposition extraction into indexBook"
```

---

## Chunk 5: Unit Tests

### Task 5: Add tests for proposition-indexer

**Files:**
- Create: `src/pageindex/__tests__/proposition-indexer.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  calculateTargetCards,
  buildExtractionPrompt,
  parseCards,
} from "../proposition-indexer.js";

describe("proposition-indexer", () => {
  describe("calculateTargetCards", () => {
    it("should return min cards for short chapters", () => {
      expect(calculateTargetCards(100)).toBe(3);
      expect(calculateTargetCards(300)).toBe(3);
    });

    it("should return proportional cards for medium chapters", () => {
      expect(calculateTargetCards(500)).toBe(1);
      expect(calculateTargetCards(1000)).toBe(2);
      expect(calculateTargetCards(2500)).toBe(5);
    });

    it("should cap at max cards for long chapters", () => {
      expect(calculateTargetCards(10000)).toBe(15);
      expect(calculateTargetCards(50000)).toBe(15);
    });

    it("should respect custom parameters", () => {
      expect(calculateTargetCards(1000, 2, 5, 20)).toBe(10);
      expect(calculateTargetCards(200, 1, 1, 5)).toBe(1);
    });
  });

  describe("buildExtractionPrompt", () => {
    it("should include target cards in prompt", () => {
      const prompt = buildExtractionPrompt("test chapter text", 5);
      expect(prompt).toContain("提取 5 张");
      expect(prompt).toContain("test chapter text");
    });

    it("should include Few-Shot examples", () => {
      const prompt = buildExtractionPrompt("test", 3);
      expect(prompt).toContain("示例1");
      expect(prompt).toContain("示例2");
      expect(prompt).toContain("示例3");
    });

    it("should include card type definitions", () => {
      const prompt = buildExtractionPrompt("test", 3);
      expect(prompt).toContain("问题");
      expect(prompt).toContain("概念");
      expect(prompt).toContain("主旨");
      expect(prompt).toContain("象征");
    });
  });

  describe("parseCards", () => {
    it("should parse valid JSON response", () => {
      const response = `{
        "cards": [
          {
            "type": "概念",
            "answer": "美德是一种习惯",
            "context": "美德不是天生的",
            "tags": ["美德", "习惯"]
          }
        ]
      }`;

      const cards = parseCards(response, "chapter_1");

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("概念");
      expect(cards[0].answer).toBe("美德是一种习惯");
      expect(cards[0].sourceNodeId).toBe("chapter_1");
    });

    it("should strip markdown code blocks", () => {
      const response = ````json
      {
        "cards": [
          {
            "type": "主旨",
            "answer": "测试答案",
            "context": "测试原文",
            "tags": ["测试"]
          }
        ]
      }
      ````;

      const cards = parseCards(response, "test");

      expect(cards).toHaveLength(1);
      expect(cards[0].type).toBe("主旨");
    });

    it("should return empty array for invalid JSON", () => {
      const response = "not valid json";
      const cards = parseCards(response, "test");
      expect(cards).toHaveLength(0);
    });

    it("should assign unique IDs", () => {
      const response = `{
        "cards": [
          { "type": "概念", "answer": "a", "context": "b", "tags": [] },
          { "type": "主旨", "answer": "c", "context": "d", "tags": [] }
        ]
      }`;

      const cards = parseCards(response, "chapter_5");

      expect(cards[0].id).toBe("card_chapter_5_1");
      expect(cards[1].id).toBe("card_chapter_5_2");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test:run src/pageindex/__tests__/proposition-indexer.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/__tests__/proposition-indexer.test.ts
git commit -m "test(pageindex): add proposition-indexer unit tests"
```

---

### Task 6: Add tests for proposition-search

**Files:**
- Create: `src/pageindex/__tests__/proposition-search.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from "vitest";
import { formatPropositionResults } from "../proposition-search.js";
import type { PropositionMatch, PropositionCard } from "../book-types.js";

describe("proposition-search", () => {
  describe("formatPropositionResults", () => {
    it("should format empty results", () => {
      expect(formatPropositionResults([])).toBe("");
    });

    it("should format single result", () => {
      const card: PropositionCard = {
        id: "card_1",
        type: "象征",
        answer: "玉带林中挂=林黛玉",
        context: "玉带林中挂",
        tags: ["林黛玉", "玉带", "谐音"],
        sourceNodeId: "chapter_5",
      };

      const result = formatPropositionResults([{ card, score: 0.9 }]);

      expect(result).toContain("【象征】");
      expect(result).toContain("玉带林中挂=林黛玉");
      expect(result).toContain("原文：玉带林中挂");
      expect(result).toContain("林黛玉、玉带、谐音");
    });

    it("should format multiple results with separator", () => {
      const cards: PropositionCard[] = [
        {
          id: "card_1",
          type: "象征",
          answer: "answer1",
          context: "context1",
          tags: ["tag1"],
          sourceNodeId: "node1",
        },
        {
          id: "card_2",
          type: "人物",
          answer: "answer2",
          context: "context2",
          tags: ["tag2"],
          sourceNodeId: "node2",
        },
      ];

      const result = formatPropositionResults(
        cards.map((c, i) => ({ card: c, score: 0.9 - i * 0.1 }))
      );

      expect(result).toContain("---");
      expect(result).toContain("【象征】");
      expect(result).toContain("【人物】");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test:run src/pageindex/__tests__/proposition-search.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/__tests__/proposition-search.test.ts
git commit -m "test(pageindex): add proposition-search unit tests"
```

---

## Chunk 6: Export from node.ts

### Task 7: Export proposition functions from node entry

**Files:**
- Modify: `src/pageindex/node.ts`

- [ ] **Step 1: Add exports**

```typescript
// Add to exports section
export {
  indexPropositions,
  calculateTargetCards,
  buildExtractionPrompt,
  parseCards,
  extractCardsFromChapter,
} from "./proposition-indexer.js";

export {
  searchPropositions,
  searchWithPropositions,
  loadPropositions,
  formatPropositionResults,
} from "./proposition-search.js";

export type {
  PropositionCard,
  PropositionsData,
  PropositionIndexOptions,
  PropositionIndexResult,
  PropositionMatch,
  CardType,
  FusionResult,
} from "./book-types.js";
```

- [ ] **Step 2: Verify file compiles**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/node.ts
git commit -m "feat(pageindex): export proposition functions from node entry"
```

---

## Summary

| Chunk | Tasks | Files Created | Files Modified |
|-------|-------|---------------|----------------|
| 1 | Type definitions | - | `book-types.ts` |
| 2 | Proposition indexer | `proposition-indexer.ts` | - |
| 3 | Proposition search | `proposition-search.ts` | - |
| 4 | Integration | - | `book-indexer.ts` |
| 5 | Unit tests | 2 test files | - |
| 6 | Export | - | `node.ts` |

**Total estimated time:** ~3-4 hours

---

## Post-Implementation Tasks

After completing the plan:

1. **Update CLAUDE.md** - Add proposition cards to architecture documentation
2. **Manual testing** - Test with real PDF/EPUB book
3. **Frontend integration** - Add proposition settings to plugin settings UI (separate plan)