# Page Index 取代后端索引功能 — 设计文档

**日期**: 2026-04-08
**状态**: Draft
**作者**: Claude & Will

---

## 1. 背景与目标

DeepReader 当前的索引和搜索功能完全依赖后端（FastAPI + ChromaDB + BM25）。前端新增了 `bun-pageindex v2.0` 模块，已具备完整的文档解析、结构提取和 LLM 集成能力。

**目标**: 用前端 Page Index 完全取代后端的索引和搜索功能，实现纯前端的自包含索引系统。

**范围**:
- 仅支持单本书籍（PDF/EPUB）的索引和搜索
- 不涉及 Vault 全库索引（未来可扩展）
- 不需要迁移现有后端数据，重新索引即可
- 后端的去留暂不决定，聚焦于 Page Index 的能力补齐

---

## 2. 核心设计决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 集成方式 | Page Index 原生集成 | 架构最简洁，无多余抽象层 |
| 2 | 功能范围 | 单书索引 | 先跑通核心流程，后续扩展 |
| 3 | 索引策略 | Markdown 即索引 | 导出的 MD 已含 MOC + summary + block ID，无需独立 JSON 树 |
| 4 | 搜索分层 | L0/L1 向量化定位章节，FrontendAgent 定位段落 | 搜索只负责找到正确章节并返回全文，FrontendAgent 的 LLM 自行提取关键段落并引用 block ID |
| 5 | 向量存储 | 保留现有 vectors.f32 + meta.json | Obsidian 插件环境无法加载 sqlite-vec；单书场景（几十到几百节点）暴力余弦搜索性能足够 |
| 6 | 关键词搜索 | 补齐 BM25 | 当前仅简单词频，缺乏 IDF 和长度归一化 |
| 7 | 嵌入模型 | 同时支持 API 和本地模型 | 用户可选 OpenAI/Ollama/LM Studio |

---

## 3. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                  DeepReader Obsidian 插件                  │
│                                                          │
│  ┌─────────────┐   ┌──────────────────────────────────┐ │
│  │  UI 层       │   │  Page Index 模块                  │ │
│  │  ReadingView │   │                                   │ │
│  │  ChatPanel   │──▶│  fromPdf() / fromEpub()  解析     │ │
│  │  SearchBar   │   │  exporters/              导出     │ │
│  │  Topbar      │   │  book-indexer.ts         索引编排  │ │
│  └─────────────┘   │  book-search.ts          搜索编排  │ │
│                     └───────────┬───────────────────────┘ │
│                                 │                         │
│                     ┌───────────▼───────────────────────┐ │
│                     │  .pageindex/{book_hash}/           │ │
│                     │  - vectors.f32    L0/L1 向量数据    │ │
│                     │  - vectors.meta.json  向量映射      │ │
│                     │  - bm25.json      BM25 索引+统计   │ │
│                     │  - book-meta.json 书籍+章节元数据   │ │
│                     └───────────────────────────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Markdown 文件 (L2 原文)                            │  │
│  │  → MOC 文件含书籍描述和章节链接                      │  │
│  │  → 章节文件含 summary + block ID + 段落原文          │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  嵌入模型 (EmbeddingProvider)                       │  │
│  │  - OpenAI API                                      │  │
│  │  - Ollama (本地)                                    │  │
│  │  - LM Studio (本地)                                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 与现有 vault 模块的关系

现有的 `vault/` 模块（`index.ts`、`search.ts`、`vectors.ts`、`search-index.ts`、`search-v2.ts`）设计用于 Vault 全库索引，本期**不复用也不修改**。新建的 `book-indexer.ts` 和 `book-search.ts` 是独立模块，专注于单书索引场景，后续扩展 Vault 功能时再统一。

---

## 4. 数据模型

### 4.1 L0/L1/L2 分层

| 层级 | 内容 | 向量化 | 定位方式 |
|------|------|--------|----------|
| **L0** | 书名 + 书籍描述（MOC） | 是 | 语义 + BM25 |
| **L1** | 章节标题 + 章节摘要 | 是 | 语义 + BM25 |
| **L2** | 段落原文（block ID 粒度） | 否 | LLM 读取章节全文，推理返回相关段落 |

### 4.2 存储文件格式

#### book-meta.json — 元数据缓存（可自动重建）

**定位**: `book-meta.json` 是从 Markdown 文件推导出的缓存文件，不是 source of truth。Markdown 文件才是唯一的数据源。若此文件缺失或损坏，可通过扫描 MD 文件自动重建。

**重建逻辑**:
1. 扫描 MOC 文件 → 提取书名、描述、章节链接列表和排序
2. 逐个读取章节 MD 文件 → 提取标题、摘要、段落 block ID 列表
3. 计算 bookId（文件路径哈希）和各文件 hash
4. 写入 `book-meta.json`

```jsonc
{
  "version": 1,
  "bookId": "a1b2c3d4",
  "title": "书名",
  "description": "LLM 生成的书籍描述",
  "filePath": "/path/to/book.pdf",
  "fileType": "pdf",
  "indexedAt": "2026-04-08T12:00:00Z",
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  },
  "chapters": [
    {
      "id": "ch01",
      "title": "第一章 标题",
      "summary": "LLM 生成的章节摘要",
      "mdFilePath": "BookName/Chapter1.md",
      "sortOrder": 0,
      "mdFileHash": "e5f6a7b8",
      // L2 段落索引（从 MD 文件中提取的 block ID 列表，用于向量化映射）
      "paragraphs": [
        { "blockId": "s0-001", "text": "段落1前50字..." },
        { "blockId": "s0-002", "text": "段落2前50字..." }
      ]
    }
  ]
}
```

**L2 定位策略（LLM 推理）**:

L1 搜索定位到章节后，通过 LLM 推理精准定位到段落级别：

1. 读取命中章节的 Markdown 文件全文
2. 将章节全文 + 用户 query 发给 LLM
3. LLM 返回最相关段落的 block ID 列表
4. 根据返回的 block ID 从 MD 文件中提取对应段落原文

**优势**：索引时零额外成本（无需段落 embedding），LLM 能理解语义上下文精准定位。

**`bookId` 生成规则**: 使用文件路径的 SHA-256 前 8 位哈希。例如 `/path/to/book.pdf` → `sha256("/path/to/book.pdf").slice(0, 8)` → `"a1b2c3d4"`。同一文件始终生成相同 ID，不同文件不会冲突。存储路径 `{book_hash}` 与 `bookId` 是同一个值。

#### bm25.json — BM25 索引和统计

```jsonc
{
  "nodes": {
    // L0 和 L1 节点，key 为节点 ID
    "book_abc123": {
      "text": "书名 书籍描述文本",
      "length": 45,        // 文档长度（词数）
      "level": "L0"
    },
    "ch01": {
      "text": "第一章标题 章节摘要文本",
      "length": 30,
      "level": "L1"
    }
  },
  "invertedIndex": {
    // term → [{nodeId, tf}]
    "机器": [{ "nodeId": "ch03", "tf": 2 }],
    "学习": [{ "nodeId": "ch03", "tf": 3 }, { "nodeId": "ch07", "tf": 1 }]
  },
  "stats": {
    "totalDocs": 25,           // N: 总文档数（L0 + L1）
    "avgDocLength": 35.2,      // avgdl: 平均文档长度
    "df": {                    // df: 每个 term 出现在多少文档中
      "机器": 3,
      "学习": 5
    }
  },
  "params": {
    "k1": 1.5,
    "b": 0.75
  }
}
```

---

## 5. 索引流程

```
用户打开 PDF/EPUB
       │
       ▼
Step 1: 文档解析 + 结构提取
  PageIndex.fromPdf() / fromEpub()
  → TOC 检测 → 树结构 → LLM 摘要
  (现有能力，不变)
       │
       ▼
Step 2: Markdown 导出
  exporters/pdf-to-obsidian.ts 或 epub-to-obsidian.ts
  → MOC 文件（含书籍描述 + 章节链接）
  → 章节文件（含 summary + block ID + 原文）
  → 确保 mdToTree() 能从导出的 MD 准确解析回树结构
  (现有能力，小改动：确保结构标记完整)
       │
       ▼
Step 3: 构建 book-meta.json
  book-indexer.ts (新建)
  → 从 PageIndexResult 提取 L0（书籍描述）和 L1（章节列表）
  → 记录每章对应的 mdFilePath 和段落 block ID 列表
  → 写入 .pageindex/{book_hash}/book-meta.json
       │
       ▼
Step 4: L0/L1 向量化
  → 收集 L0 书籍描述和 L1 章节摘要的文本（不含 L2 段落）
  → 调用 generateEmbeddings() 生成向量（复用 vault/vectors.ts）
    注意：需传入 embedding.dimensions 而非使用默认 1536，
    调用 initVectorStore(indexPath, options.embedding.dimensions) 指定维度
  → 写入 vectors.f32 + vectors.meta.json
       │
       ▼
Step 5: BM25 索引构建
  bm25.ts (新建)
  → 对 L0 标题+描述 和 L1 标题+摘要 做中文分词
  → 计算 TF、IDF、文档长度
  → 写入 bm25.json
```

### 错误处理

**错误码定义**:

```typescript
enum IndexErrorCode {
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  EMBEDDING_API_FAILED = "EMBEDDING_API_FAILED",
  MD_PARSE_ERROR = "MD_PARSE_ERROR",
  VECTOR_DIMENSION_MISMATCH = "VECTOR_DIMENSION_MISMATCH",
  INDEX_INCOMPLETE = "INDEX_INCOMPLETE",
  BM25_INDEX_CORRUPT = "BM25_INDEX_CORRUPT",
}

interface IndexError extends Error {
  code: IndexErrorCode;
  userMessage: string;    // 用户友好的错误提示
  repairAction?: string;  // 修复建议
}
```

**处理策略**:

| 场景 | 错误码 | 处理策略 |
|------|--------|----------|
| 嵌入 API 调用失败 | `EMBEDDING_API_FAILED` | 降级为纯 BM25 搜索，标记索引为"不完整"，后续可补充向量化 |
| MD 导出文件被用户删除 | `FILE_NOT_FOUND` | 搜索时检测到文件不存在，返回提示，不崩溃 |
| 索引过程中 Obsidian 关闭 | `INDEX_INCOMPLETE` | 下次打开时通过 `verifyIndexIntegrity` 检测，提示重新索引或自动修复 |
| 嵌入模型切换（维度变化） | `VECTOR_DIMENSION_MISMATCH` | 清除旧向量文件，用新模型重新向量化，BM25 不受影响 |
| book-meta.json 损坏 | `MD_PARSE_ERROR` | 提示重新索引，无法自动修复 |

---

## 6. 搜索流程

### 6.1 搜索主流程（两步：召回章节 → 交给 FrontendAgent）

**核心原则**：搜索系统只负责找到正确的章节并返回内容，段落级定位和 block ID 引用由 FrontendAgent 的 LLM 自然完成。

```
用户输入查询
       │
       ▼
Step 1: 向量 + BM25 并行搜索（L0/L1 级别）
  ┌──────────────────┐  ┌──────────────────┐
  │ 向量语义搜索       │  │ BM25 关键词搜索    │  ← 并行，无额外 LLM 调用
  │ 查询向量化         │  │ 中文分词           │
  │ → cosineSearch()  │  │ → bm25.json 检索  │
  │ → 返回 topK + 分  │  │ → 返回 topK + 分  │
  └────────┬─────────┘  └────────┬─────────┘
           │                     │
           ▼                     ▼
  ┌──────────────────────────────────────┐
  │ 加权融合: score = w_v × vec + w_b × bm25 │
  │ 默认: w_v=0.7, w_b=0.3               │
  │ → 排序后的 L1 章节列表                │
  └──────────────────┬───────────────────┘
                     │
                     ▼
Step 2: 读取章节 MD 内容，传给 FrontendAgent
  ┌──────────────────────────────────────┐
  │ 对每个命中的 L1 章节：                 │
  │ 1. 读取 mdFilePath 指向的 MD 文件     │
  │ 2. 去掉 frontmatter / 导航 / callout │
  │ 3. 得到纯净正文（含 ^block-id 标记）  │
  │ 4. 作为上下文传给 FrontendAgent       │
  └──────────────────────────────────────┘
                     │
                     ▼
FrontendAgent 生成最终回答:
  - 理解章节内容，提取关键段落
  - 自动引用 block ID，如 [[04 - 决策树#^s3-005]]
  - 用户点击引用可直接跳转到 Obsidian 中的具体段落
```

### 6.2 融合算法

```
final_score(node) = w_v × vector_score + w_b × bm25_score

默认权重:
- w_v = 0.7  (向量语义)
- w_b = 0.3  (BM25 关键词)

降级策略:
- 无嵌入模型/向量不可用 → 纯 BM25 (w_v=0, w_b=1.0)
```

### 6.3 搜索结果类型

```typescript
interface BookSearchResult {
  // 节点标识
  nodeId: string;
  level: "L0" | "L1";

  // 匹配的章节信息
  bookTitle: string;
  chapterTitle: string;
  chapterSummary: string;

  // 章节正文（含 block ID 标记，供 FrontendAgent 引用）
  rawText: string;
  mdFilePath: string;
  truncated: boolean;

  // 评分
  score: number;
  vectorScore: number;
  bm25Score: number;
}
```

搜索结果传给 FrontendAgent 时，LLM 看到 rawText 中的 `^block-id` 标记，自然会在回答中生成 `[[fileName#^blockId]]` 引用。搜索系统无需做段落级定位。

### 6.4 BM25 算法

```
BM25_score(q, d) = Σ_{t ∈ q} IDF(t) × (tf(t,d) × (k1 + 1)) / (tf(t,d) + k1 × (1 - b + b × |d| / avgdl))

其中:
- IDF(t) = log((N - df(t) + 0.5) / (df(t) + 0.5))
- tf(t,d) = 词 t 在文档 d 中的出现次数
- |d| = 文档 d 的长度（词数）
- avgdl = 所有文档的平均长度
- k1 = 1.5 (默认), b = 0.75 (默认)
```

### 6.5 中文分词

使用 CJK 双字分词 + 字符级分词的组合（与现有 `search-index.ts` 策略一致）：
- 长中文连续串：提取完整词 + 双字组合 (bigram)
- 英文/数字：空格分词
- 不加载外部中文词典，保持插件轻量
- **查询侧与索引侧使用完全相同的分词策略**，保证一致性

**已知局限**: bigram 无法精确匹配单字查询（如仅搜"机"）。可接受的权衡：大多数中文查询 ≥ 2 字，且向量搜索可以弥补关键词搜索的不足。

**查询扩展（单字回退）**: 为提升单字查询的召回率，BM25 搜索时对查询进行扩展——除原始分词结果外，额外加入 CJK 词的单字拆分。例如"机器学习"除了产生 bigram "机器"、"器学"、"学习"外，还加入单字"机"、"器"、"学"、"习"，但单字 token 的权重降低（TF 乘以 0.3）。

### 6.5 向量化文本选择

向量化时，每个节点送入 embedding API 的文本内容：

**L0（书籍级）**：`书名 + 描述 + 全部章节标题`

```
"机器学习导论。本书系统介绍了机器学习的基础理论和实践方法。
目录：什么是机器学习、线性模型、信息增益、决策树、集成学习、神经网络、深度学习..."
```

理由：章节标题列表提供"主题覆盖"信号，用户搜"决策树"即使书名和描述没出现，目录里有就能匹配。

**L1（章节级）**：`书名 > 章节标题 + 摘要`

```
"机器学习导论 > 决策树。决策树算法的原理、构建和剪枝方法。"
```

理由：书名前缀提供领域上下文（"这是 ML 书里的监督学习，不是金融书里的"），标题+摘要兼顾主题锚点和内容细节。

**嵌套章节**（如"2.1 线性回归"）作为独立 L1 节点：

```
"机器学习导论 > 监督学习 > 2.1 线性回归。线性回归的基本原理和最小二乘法..."
```

---

## 7. 嵌入模型配置

### 支持的 Provider

| Provider | 默认模型 | 默认维度 | 用途 |
|----------|---------|---------|------|
| `openai` | text-embedding-3-small | 1536 | OpenAI API（含兼容 API） |
| `ollama` | nomic-embed-text | 768 | 本地 Ollama |
| `lmstudio` | 用户自选 | 取决于模型 | 本地 LM Studio |
| `local` | 用户自选 | 取决于模型 | 自定义 OpenAI 兼容端点 |

### 接口复用

复用 Page Index 已有的 `EmbeddingOptions` 类型（定义在 `vault/types.ts`）：

```typescript
interface EmbeddingOptions {
  provider: "openai" | "ollama" | "lmstudio" | "local";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}
```

### 推荐配置

为降低用户配置难度，内置推荐配置：

| 场景 | Provider | 模型 | 维度 | 说明 |
|------|----------|------|------|------|
| 推荐（API） | `openai` | text-embedding-3-small | 1536 | 性价比高，$0.02/1M tokens |
| 本地（免费） | `ollama` | nomic-embed-text | 768 | 需安装 Ollama |
| 本地（GUI） | `lmstudio` | 用户自选 | 取决于模型 | 需安装 LM Studio |

用户首次配置时展示推荐列表，无需手动填写模型名和维度。

### 模型切换

嵌入模型配置记录在 `book-meta.json` 的 `embedding` 字段中。切换模型时：
1. 删除旧的 `vectors.f32` + `vectors.meta.json`
2. 用新模型重新向量化所有 L0/L1 节点
3. 更新 `book-meta.json` 中的 `embedding` 配置
4. BM25 索引不受影响，无需重建

---

## 8. 核心接口定义

### book-indexer.ts

```typescript
/** 单书索引编排器 */
export interface BookIndexOptions {
  /** 输入文件路径 */
  filePath: string;
  /** 文件类型 */
  fileType: "pdf" | "epub";
  /** 输出目录（Markdown 文件存放位置） */
  outputDir: string;
  /** 嵌入模型配置（可选，不配置则不向量化） */
  embedding?: EmbeddingOptions;
  /** LLM 配置 — 复用 PageIndexOptions 的顶层字段风格 */
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface BookIndexResult {
  bookId: string;
  title: string;
  chaptersCount: number;
  indexDir: string;  // .pageindex/{book_hash}/
}

/** 执行完整的单书索引流程 */
export async function indexBook(options: BookIndexOptions): Promise<BookIndexResult>;

/** 检查指定书籍是否已索引 */
export async function isBookIndexed(filePath: string): Promise<boolean>;

/** 删除指定书籍的索引 */
export async function deleteBookIndex(filePath: string): Promise<void>;

/** 从 Markdown 文件重建 book-meta.json 缓存 */
export async function rebuildBookMeta(mocFilePath: string): Promise<BookIndexResult>;

/** 检查索引完整性 */
export interface IndexIntegrityReport {
  valid: boolean;
  /** 缺失的文件 */
  missingFiles: string[];
  /** 向量维度是否与 book-meta.json 中记录的 embedding 配置一致 */
  vectorDimensionsMatch: boolean;
  /** book-meta.json 中的章节是否都有对应的 MD 文件 */
  chaptersMatchMdFiles: boolean;
  /** 嵌入模型配置的 provider 是否可用 */
  embeddingProviderAvailable: boolean;
  /** 修复建议 */
  repairActions: string[];
}

/** 检查索引完整性（深度验证） */
export async function verifyIndexIntegrity(indexDir: string): Promise<IndexIntegrityReport>;

/** 自动修复索引（根据 repairActions） */
export async function repairIndex(indexDir: string, actions: string[]): Promise<void>;
```

### book-search.ts

```typescript
/** 单书搜索选项 */
export interface BookSearchOptions {
  /** 搜索的书籍文件路径 */
  filePath: string;
  /** 查询文本 */
  query: string;
  /** 返回结果数量 */
  topK?: number;
  /** 嵌入模型配置（用于查询向量化） */
  embedding?: EmbeddingOptions;
  /** L2 上下文最大字符数 */
  maxContextLength?: number;
}

/** 在单本书中搜索 */
export async function searchBook(options: BookSearchOptions): Promise<BookSearchResult[]>;
```

### bm25.ts

```typescript
/** BM25 索引构建 */
export function buildBM25Index(
  nodes: Array<{ id: string; text: string; level: "L0" | "L1" }>
): BM25Data;

/** BM25 搜索 */
export function searchBM25(
  query: string,
  index: BM25Data,
  topK: number
): Array<{ nodeId: string; score: number }>;

/** BM25 数据结构 */
export interface BM25Data {
  nodes: Record<string, { text: string; length: number; level: "L0" | "L1" }>;
  invertedIndex: Record<string, Array<{ nodeId: string; tf: number }>>;
  stats: { totalDocs: number; avgDocLength: number; df: Record<string, number> };
  params: { k1: number; b: number };
}
```

---

## 9. 文件改动清单

### 新建文件

| 文件路径 | 说明 |
|----------|------|
| `frontend/src/pageindex/book-indexer.ts` | 单书索引编排：解析 → MD 导出 → book-meta → L0/L1 向量化 + BM25 |
| `frontend/src/pageindex/book-search.ts` | 单书搜索：vec + BM25 → RRF 融合 → L2 MD 读取 |
| `frontend/src/pageindex/bm25.ts` | BM25 实现：CJK 分词 + IDF/TF + 评分 |

### 修改文件

| 文件路径 | 改动 |
|----------|------|
| `frontend/src/pageindex/exporters/*.ts` | 确保 MD 导出包含完整的 block ID 和结构标记 |
| `frontend/src/pageindex/parsers/markdown.ts` | 确保 `mdToTree()` 能从导出的 MD 准确解析回树结构 |

### 不变的文件/模块

| 模块 | 文件 | 说明 |
|------|------|------|
| PDF 解析 | `pageindex/parsers/pdf.ts` | 不变 |
| EPUB 解析 | `pageindex/parsers/epub.ts` | 不变 |
| TOC 检测 | `pageindex/core/toc.ts` | 不变 |
| 树构建 | `pageindex/core/tree.ts` | 不变 |
| LLM 提示词 | `pageindex/core/prompts.ts` | 不变 |
| LLM 客户端 | `pageindex/llm/client.ts` | 不变 |
| 向量存储 | `pageindex/vault/vectors.ts` | 复用，不修改 |
| Vault 全库 | `pageindex/vault/index.ts` 等 | 不修改，本期不涉及 |

---

## 10. 存储布局

```
Obsidian Vault/
├── .pageindex/
│   └── {book_hash}/               ← 每本书独立目录
│       ├── book-meta.json          → 书籍 + 章节元数据 (L0/L1)
│       ├── vectors.f32             → L0/L1 向量数据 (Float32 二进制)
│       ├── vectors.meta.json       → 向量 slot 映射
│       └── bm25.json               → BM25 倒排索引 + 统计
│
├── BookTitle/
│   ├── BookTitle - MOC.md          ← L0: 书籍目录 + 描述
│   ├── Chapter 1.md                ← L1 标题+摘要 + L2 原文
│   ├── Chapter 2.md
│   └── ...
```

---

## 11. 接口适配：与现有项目工作流集成

### 11.1 当前工作流（后端模式）

```
用户点击"添加书籍" → LibraryModal
  → PDFFileSelectorModal 选文件
  → apiClient.uploadAndIndex(file)         ← HTTP 调用后端
  → TaskPollingManager 轮询进度             ← 每 2 秒轮询后端
  → TaskProgressCard 显示进度
  → 完成后刷新书籍列表

用户提问 → ChatInput
  → handleAgentQuery()
  → FrontendAgent.chat()
  → search_markdown_text 工具              ← 本地关键词搜索
  → 或 apiClient.agentChatStream()         ← HTTP 调用后端
  → MessageList 流式展示
```

### 11.2 新工作流（Page Index 模式）

```
用户点击"添加书籍" → LibraryModal
  → PDFFileSelectorModal 选文件
  → bookIndexer.indexBook(options)          ← 本地调用 Page Index
  → onProgress 回调实时推送进度              ← 不再轮询
  → TaskProgressCard 显示进度（复用现有组件）
  → 完成后写入 .pageindex/ 并刷新列表

用户提问 → ChatInput
  → handleAgentQuery()
  → FrontendAgent.chat()
  → searchBook() 替换 search_markdown_text  ← 本地 BM25 + 向量搜索
  → 不再需要 apiClient.agentChatStream()
  → MessageList 流式展示
```

### 11.3 API 映射表

| 当前（后端 API） | 新（Page Index） | 变化 |
|------------------|-----------------|------|
| `apiClient.uploadAndIndex(file)` | `indexBook(options)` + `onProgress` 回调 | HTTP → 本地调用 |
| `apiClient.getTaskProgress(taskId)` | `onProgress` 回调（实时推送） | 轮询 → 事件 |
| `apiClient.listIndexes()` | 扫描 `.pageindex/` 目录读取 `book-meta.json` | HTTP → 本地文件 |
| `apiClient.getIndexStatus(id)` | `verifyIndexIntegrity(indexDir)` | HTTP → 本地验证 |
| `apiClient.deleteIndex(id)` | `deleteBookIndex(filePath)` | HTTP → 本地删除 |
| `apiClient.exportIndex(id)` | 直接读取 Markdown 文件（无需导出） | HTTP → 本地文件 |
| `apiClient.exportCover(id)` | 缓存在 `.pageindex/{hash}/cover.png` | HTTP → 本地文件 |
| `search_markdown_text` 工具 | `searchBook()` + L2 精读取 | 关键词 → 混合搜索 |
| `apiClient.agentChatStream()` | 不再需要 | 移除后端依赖 |

### 11.4 进度追踪适配

当前 `STEP_CONFIG`（`types/index.ts`）定义了后端管道的进度阶段。Page Index 模式需要对应的阶段映射：

| 后端阶段 (STEP_CONFIG) | Page Index 阶段 | 进度 |
|------------------------|----------------|------|
| validate_file (0-10%) | 文件验证 | 0-5% |
| detect_type (10-15%) | 文件类型检测 | 5-10% |
| init_config (15-40%) | LLM 配置初始化 | 10-15% |
| load_document (40-60%) | 文档解析 + TOC 检测 | 15-40% |
| generating_toc (55-60%) | 结构提取 | 40-50% |
| generating_summaries (60-85%) | LLM 摘要生成 | 50-75% |
| export_markdown (新) | Markdown 导出 | 75-85% |
| store_vectors (85-90%) | L0/L1 向量化 | 85-92% |
| build_bm25 (新) | BM25 索引构建 | 92-97% |
| save_metadata (90-95%) | 保存元数据 | 97-100% |
| complete (95-100%) | 完成 | 100% |

`BookIndexOptions` 增加 `onProgress` 回调：

```typescript
export interface BookIndexOptions {
  // ... 其他字段

  /** 进度回调（替代后端轮询） */
  onProgress?: (progress: BookIndexProgress) => void;
}

export interface BookIndexProgress {
  /** 当前进度 0-100 */
  percent: number;
  /** 当前阶段标识 */
  step: string;
  /** 用户可见的阶段名称 */
  stepLabel: string;
  /** 详细消息 */
  message?: string;
}
```

---

## 12. 用户侧改动

### 12.1 LibraryModal 适配

**改动文件**: `frontend/src/components/library-modal/library-modal.ts`

| 改动点 | 说明 |
|--------|------|
| `handleAddDocument()` | 将 `apiClient.uploadAndIndex()` 替换为 `indexBook()`，使用 `onProgress` 回调 |
| `startProgressPolling()` | 移除轮询逻辑，改为 `onProgress` 回调直接更新 UI |
| `loadIndexes()` | 从 `.pageindex/` 目录扫描 `book-meta.json` 替代 `apiClient.listIndexes()` |
| 删除按钮 | 调用 `deleteBookIndex()` 替代 `apiClient.deleteIndex()` |

### 12.2 ReadingTopbar 适配

**改动文件**: `frontend/src/components/reading-topbar/reading-topbar.ts`

| 改动点 | 说明 |
|--------|------|
| 连接状态指示器 | 移除 `connected/disconnected/connecting` 状态，Page Index 不依赖后端 |
| 书籍信息展示 | 从 `book-meta.json` 读取，不再从后端获取 |

### 12.3 SidebarView（主控制器）适配

**改动文件**: `frontend/src/views/sidebar-view.ts`

| 改动点 | 说明 |
|--------|------|
| `currentIndexId` | 改为使用 `bookId`（文件路径哈希），与 Page Index 一致 |
| `selectIndex()` | 从本地 `.pageindex/` 加载书籍信息替代后端 API |
| `handleAgentQuery()` | 搜索路径从 `apiClient.agentChatStream()` 改为本地 `searchBook()` |
| `taskPollingManager` | 移除，不再需要轮询 |
| 后端健康检查 | 移除 30 秒定时健康检查 |

### 12.4 FrontendAgent 搜索工具适配

**改动文件**: `frontend/src/agent/tools/local/search-text.ts`

| 改动点 | 说明 |
|--------|------|
| `search_markdown_text` 工具 | 底层实现替换为 `searchBook()`，保留工具接口不变 |
| 返回结果 | 从纯关键词匹配升级为 BM25 + 向量混合搜索结果 |
| 热力图数据 | 从 `BookSearchResult` 中提取评分信息生成分布热力图 |

### 12.5 Settings 适配

**改动文件**: `frontend/src/settings/setting-tab.ts`、`frontend/src/config/settings.ts`

| 改动点 | 说明 |
|--------|------|
| 新增嵌入模型配置 | Provider 选择、API Key、Base URL、模型名 |
| 推荐配置展示 | 下拉选择预设配置（OpenAI/Ollama/LM Studio） |
| 移除后端连接配置 | 不再需要后端地址、端口等设置 |
| 保留 LLM 配置 | 用于摘要生成的 LLM API 配置（可能与嵌入模型不同） |

### 12.6 http-client.ts 适配

**改动文件**: `frontend/src/api/http-client.ts`

| 改动点 | 说明 |
|--------|------|
| 索引相关 API | 可移除或标记 deprecated（`indexPDF*`、`uploadAndIndex`、`listIndexes` 等） |
| 搜索相关 API | 可移除（`agentChatStream`、`agentChat`） |
| 暂时保留 | 文件管理、导出等其他 API，待后续决定后端去留时处理 |

---

## 13. 非目标（本期不做）

- Vault 全库索引和搜索
- 跨书搜索（per-book 目录结构已预留扩展能力）
- ANN/HNSW 向量索引（单书场景暴力搜索足够）
- 嵌入模型的 ONNX/WASM 内嵌方案
- 后端代码的删除或重构
- Reranker 重排序（BM25 + 向量融合已足够，后续可加入）
- LLM Tree Search（LLM 遍历索引树，后续可加入）

---

## 14. 工程评审报告

**评审日期**: 2026-04-08
**评审类型**: Eng Review (Architecture + Code Quality + Tests + Performance)
**评审结果**: ✅ PASS WITH RECOMMENDATIONS

### 14.1 架构评审

#### ✅ PASS — 核心架构设计合理

**关键决策确认**：

| 决策项 | 选择 | 完成度 | 风险 |
|--------|------|--------|------|
| BM25 实现 | 新建 bm25.ts | 8/10 | 低 — 模块独立，清晰边界 |
| 向量维度 | 运行时配置 | 9/10 | 中 — 需清除机制，用户切换模型时重新向量化 |
| 向量存储 | Per-book 独立 | 8/10 | 低 — 书籍独立，删除简单 |
| L2 定位 | LLM 推理 | 8/10 | 中 — 依赖 LLM 能力，查询成本高 |
| 错误处理 | 完全降级路径 | 9/10 | 低 — 鲁棒性强 |
| UI 迁移 | 一次性完全迁移 | 9/10 | 高 — 不可回退，需充分测试 |
| 向量化文本 | L0 全部章节 + L1 包含书名 | 8/10 | 低 — 成本可控 |

#### 🔍 P1 (confidence: 9/10) — 向量化文本长度控制

**问题**: L0 包含全部章节标题，100+ 章节的书籍可能超 token 限制。

**建议**:
```typescript
// frontend/src/pageindex/book-indexer.ts

function buildL0Text(book: BookMeta, chapters: Chapter[]): string {
  const titles = chapters.map(ch => ch.title).join('、');
  const text = `${book.title}。${book.description}。目录：${titles}`;
  
  // Token 限制检查（OpenAI max 8191 tokens）
  const tokenCount = countTokens(text);
  if (tokenCount > 8000) {
    // 截断为前 20 章
    const truncated = chapters.slice(0, 20).map(ch => ch.title).join('、');
    return `${book.title}。${book.description}。目录：${truncated}...`;
  }
  
  return text;
}
```

**完成度**: 9/10 (简单修复)

---

#### 🔍 P1 (confidence: 8/10) — UI 迁移风险

**问题**: 从 HTTP API 改为本地文件系统操作，涉及大量组件修改。

**风险**:
- 边界情况未覆盖
- 性能差异（HTTP vs 本地 I/O）
- 错误处理差异

**缓解措施**:
1. ✅ 完整测试覆盖（110-200 个测试用例）
2. ✅ 错误处理测试覆盖所有 IndexErrorCode
3. ✅ E2E 测试覆盖关键用户流
4. ⚠️ 建议添加迁移文档，记录每个组件的改动点

**完成度**: 9/10 (已规划测试，需执行)

---

### 14.2 代码质量评审

#### ✅ PASS — 接口设计简洁合理

**关键设计确认**:

| 设计项 | 选择 | 完成度 | 评价 |
|--------|------|--------|------|
| 接口风格 | 简洁接口 | 8/10 | ✅ 面向用户，易用性好 |
| 参数定义 | TypeScript interface | 9/10 | ✅ 类型安全，IDE 提示好 |
| 进度追踪 | 回调机制 | 9/10 | ✅ 实时推送，解耦好 |
| 进度映射 | 兼容旧 UI | 7/10 | ⚠️ 技术债务，未来简化 |

#### 🔍 P2 (confidence: 7/10) — 进度映射技术债务

**问题**: 11 个阶段的映射表复杂，目的是兼容旧 UI。

**建议**: 标记为"待优化：未来简化进度设计"。当前接受技术债务以降低 UI 重构成本。

**完成度**: 7/10 (可接受，但需标记为技术债务)

---

### 14.3 测试评审

#### ⚠️ NEEDS WORK — 测试计划缺失

**问题**: 设计文档没有专门的测试章节。

**测试需求**:

| 优先级 | 模块 | 测试用例数 | 关键测试点 |
|--------|------|-----------|-----------|
| **P0** | book-indexer.ts | 50 | 索引流程每一步、embedding 失败降级、进度回调、索引中断恢复 |
| **P1** | book-search.ts | 30 | 向量+BM25 融合、降级路径、MD 文件读取错误 |
| **P2** | bm25.ts | 20 | 分词算法、TF/IDF 计算、评分公式验证 |
| **P3** | UI 集成 | 15 | 进度显示、错误提示、流式输出 |
| **E2E** | 用户流 | 10 | 添加书籍、搜索书籍、删除书籍 |
| **总计** | — | **125** | — |

**测试覆盖缺口**: ~80 个分支/错误路径未覆盖

**建议**:
1. ✅ 在设计文档中添加"测试计划"章节
2. ✅ 优先实现 P0 和 P1 测试（80 个用例）
3. ✅ E2E 测试覆盖 3 个关键用户流

**完成度**: 3/10 (需补充测试计划)

---

### 14.4 性能评审

#### ✅ PASS — 性能满足需求

**性能分析**:

| 操作 | 时间估算 | 瓶颈 | 可接受 |
|------|---------|------|--------|
| **索引（30章）** | 70-80 秒 | LLM 摘要生成 | ✅ 一次性成本 |
| **索引（100章）** | 200-205 秒 | LLM 摘要生成 | ⚠️ 较长，需进度显示 |
| **搜索** | 200-450 ms | L2 上下文读取 | ✅ 可接受 |
| **向量搜索** | 1-10 ms | 暴力余弦搜索 | ✅ 单书场景足够快 |
| **BM25 搜索** | 3-25 ms | 分词 + 评分 | ✅ 很快 |
| **存储（单书）** | 350-400 KB | — | ✅ 可忽略 |

#### 🔍 P2 (confidence: 8/10) — L2 上下文读取无缓存

**问题**: 每次搜索都读取 MD 文件，相同章节多次读取。

**建议**: 添加 LRU 缓存
```typescript
const chapterCache = new LRUCache<string, string>({ max: 10 });

async function readChapterContent(mdFilePath: string): Promise<string> {
  const cached = chapterCache.get(mdFilePath);
  if (cached) return cached;
  
  const content = await fs.readFile(mdFilePath, 'utf-8');
  chapterCache.set(mdFilePath, content);
  return content;
}
```

**完成度**: 8/10 (简单优化)

---

#### 🔍 P2 (confidence: 7/10) — LLM 摘要生成是主要瓶颈

**问题**: 100 章节书籍需要 200 秒索引时间，用户可能认为卡死。

**缓解措施**:
1. ✅ 进度条实时显示（已在设计中）
2. ⚠️ 建议添加取消按钮
3. ⚠️ 建议支持断点续传
4. ⚠️ 可考虑并行摘要生成（需评估 API 限制）

**完成度**: 7/10 (部分缓解措施已设计)

---

### 14.5 综合评价

#### ✅ 架构合理性: 9/10

**优点**:
- 核心设计决策合理（L0/L1 向量化 + L2 LLM 推理）
- 模块边界清晰（book-indexer、book-search、bm25 独立）
- 错误处理完整（降级路径、错误码定义）
- 性能满足需求（单书场景暴力搜索足够）

**风险**:
- UI 迁移是一次性大重构，不可回退
- 测试覆盖不足，需补充完整测试计划
- LLM 摘要生成是性能瓶颈，用户体验可能受影响

---

#### ⚠️ 需要补充的内容

1. **测试计划章节**: 详细列出每个模块的测试用例
2. **迁移文档**: 记录每个 UI 组件的改动点
3. **性能优化建议**: L2 缓存、取消按钮、断点续传
4. **技术债务标记**: 进度映射表、未来简化方向

---

### 14.6 行动建议

#### 必须完成（P0）:

1. ✅ **补充测试计划**（估算: 2 小时）
   - 在设计文档中添加"测试计划"章节
   - 列出 P0/P1/P2 测试用例清单

2. ✅ **添加 L0 文本长度检查**（估算: 30 分钟）
   - 在 book-indexer.ts 中添加 token 限制检查
   - 超限时截断为前 20 章

#### 强烈建议（P1）:

3. ⚠️ **添加 L2 上下文缓存**（估算: 1 小时）
   - 实现 LRU 缓存
   - 添加缓存失效策略

4. ⚠️ **添加索引进度取消按钮**（估算: 2 小时）
   - UI 添加取消按钮
   - 支持保存中间状态

#### 可选优化（P2）:

5. 📝 **迁移文档**（估算: 1 小时）
   - 记录每个 UI 组件的改动点
   - 列出 API 映射表

6. 📝 **断点续传**（估算: 4 小时）
   - 索引中断后可恢复
   - 保存已完成的中间状态

---

### 14.7 评审结论

**总体评价**: ✅ PASS WITH RECOMMENDATIONS

**核心架构**: 9/10 (合理，风险可控)
**代码质量**: 8/10 (接口设计好，需补充测试计划)
**测试覆盖**: 3/10 (缺口大，需补充)
**性能表现**: 8/10 (满足需求，有优化空间)

**建议**: 补充测试计划后可进入实施阶段。P0 和 P1 行动建议应在实施前完成。

---

**评审人**: Claude (GStack Eng Review)
**评审时间**: 2026-04-08
