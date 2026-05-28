# 书籍索引系统

> DeepReader 的核心子系统：将 PDF/EPUB 文档解析为结构化树形索引，构建多层级向量和关键词搜索索引，导出为 Obsidian Markdown 笔记。

---

## 架构概览

```
PDF / EPUB 文件
      │
      ▼
┌─────────────────────────────────────────────────┐
│  book-indexer.indexBook()   主编排管线            │
│                                                   │
│  Step 1  文档解析 (PageIndex)                     │
│          ├─ PDF: MinerU 云 API                    │
│          │   ├─ 书签快路径（免 LLM）                │
│          │   ├─ LLM TOC 路径                      │
│          │   └─ OCR 兜底                          │
│          └─ EPUB: AdmZip + Turndown               │
│                                                   │
│  Step 2  Markdown 导出                            │
│          → DeepReader/{书名}/章节.md + MOC.md     │
│                                                   │
│  Step 3  元数据构建                                │
│          → tree.json + book-meta.json             │
│                                                   │
│  Step 4  三级向量化 (可选)                         │
│          L0 书籍 → L1 章节 → L2 段落               │
│          → vectors.jsonl + chunks.jsonl            │
│                                                   │
│  Step 5  BM25 索引                                │
│          → bm25.json                              │
│                                                   │
│  Step 6  命题卡片 (已禁用，token 成本过高)          │
│          → propositions.json + prop-vectors.jsonl │
└─────────────────────────────────────────────────┘
```

---

## Book ID 生成

`book-indexer.ts: generateBookId()`

```
SHA-256(前 64KB 内容 + 文件大小) → 取前 8 字符
```

基于内容的稳定 ID —— 文件路径变化（移动、重命名）不影响已有索引。旧版基于路径哈希的 ID 通过 `migrateBookIndexes()` 自动迁移。

---

## 主索引管线：indexBook()

`book-indexer.ts: indexBook()` 是主编排函数，完整流程如下：

### Step 0: 文件验证

- 检查文件是否存在（不存在则抛出 `FILE_NOT_FOUND`）
- `generateBookId()` 生成内容哈希 ID
- 创建 `.pageindex/{bookId}/` 目录
- 写入 `.indexing.json` 状态文件（支持中断后 UI 恢复）

### Step 1: 文档解析 (5%–70%)

```
PageIndex.fromPdf(filePath)   或   PageIndex.fromEpub(filePath)
                ↓
        parseResult: { docName, docDescription, structure: TreeNode[] }
```

详见下方 PDF 解析和 EPUB 解析章节。

### Step 1.5: 封面保存

- **EPUB**: 提取内嵌封面图片（支持 EPUB 3.0 `properties="cover-image"` 和 EPUB 2.0 `<meta name="cover">`）
- **PDF**: 渲染首页为 PNG
- **无封面**: 生成文字 SVG 封面
- 保存到 `DeepReader/covers/{exportName}.{ext}`

### Step 1.6: 下载图片（仅 PDF）

- 下载 MinerU CDN 上的图片到 `DeepReader/{exportName}/images/`

### Step 2: Markdown 导出 (70%–80%)

- **PDF**: `exportPdfToObsidian()` → 每个叶节点生成一个 `.md` 文件
- **EPUB**: `exportToObsidian()` → 章节直接映射 `.md` 文件
- 返回 `nodeFileMap: Record<nodeId, fileName>`

详见下方 Markdown 导出章节。

### Step 3: 元数据构建 (82%–85%)

- `buildBookMeta()` → `book-meta.json`
- 写入 `tree.json`（合并层级结构 + nodeFileMap + 文本/摘要）

### Step 4: 三级向量化 (87%–92%)（可选）

- `vectorizeAllLevels()` → `vectors.jsonl` + `chunks.jsonl`
- 需要配置 embedding 角色（provider + apiKey），未配置则跳过
- 失败则降级为纯 BM25，索引继续完成

详见下方三级向量化章节。

### Step 5: BM25 索引构建 (94%–97%)

- `buildBM25IndexFromParseResult()` → `bm25.json`

详见下方 BM25 索引章节。

### Step 6: 命题卡片提取 (97%)（已禁用）

- `indexPropositions()` → `propositions.json` + `prop-vectors.jsonl`
- **当前被硬编码禁用**：`library-view.ts` 中 `PROPOSITION_ENABLED = false`
- 原因：token 成本过高，待优化后重新启用
- 解除禁用后还需要用户配置 proposition 角色（默认 xiaomi/mimo-v2.5）

### Step 8: 完成 (100%)

- 删除 `.indexing.json` 临时状态文件
- 返回 `BookIndexResult { bookId, title, fileType, chaptersCount, indexDir }`

---

## PDF 解析

`pageindex.ts: fromPdf()`

PDF 有三条解析路径，按优先级自动选择：

```
输入文件
  │
  ├─ ① MinerU 云 API 解析（主路径）
  │   parsePdf() → MineruClient.parse()
  │   → pages[], pdfName, outline(TreeNode[])
  │   │
  │   ├─ outline 高质量？（≥5 条目 + ≥60% 页面覆盖）
  │   │   YES → processPdfWithOutline()  [免 LLM 快路径]
  │   │
  │   └─ outline 不高质量
  │       → processPdfPages()  [LLM TOC 路径]
  │         失败且有 outline → 回退 processPdfWithOutline()
  │
  ├─ ② OCR 兜底（MinerU 失败 或 强制 OCR 模式）
  │   parsePdfWithOcr() → pdftocairo 转图片 → GLM-OCR 识别
  │   → pages[] (纯文本)
  │
  └─ 返回 PageIndexResult
```

### processPdfPages() 内部流程

这是 PDF 解析的核心，包含 6 个阶段：

**阶段 1 — detecting_toc**: TOC 检测
- `checkToc(pages)` 扫描前几页寻找目录页
- 返回 `TocCheckResult { tocContent, tocPageList, pageIndexGivenInToc }`

**阶段 2 — parsing_structure**: 结构提取（三路分发）

| 条件 | 函数 | 说明 |
|------|------|------|
| 无 TOC | `processNoToc()` | LLM 从内容直接生成结构 |
| TOC 无页码 | `processTocNoPageNumbers()` | LLM 补充页码 |
| TOC 有页码 | `processTocWithPageNumbers()` | LLM 提取物理页码映射 |

如果 PDF 有内嵌书签（outline），会用书签修正 LLM 提取的页码。

**阶段 3 — verifying_pages**: TOC 验证
- `verifyToc()` 检测每个 TOC 条目的标题是否实际出现在对应页面
- 计算准确率，低于 60% 触发降级重试：

```
有页码 TOC → 无页码 TOC → 从内容生成 → 书签回退
```

- 准确率 ≥ 60% 时 `fixIncorrectToc()` 修正错误条目（最多重试 2 次）

**阶段 4**: 树构建
- `buildTree()` 将 TocItem[] 转为 TreeNode[] 嵌套树
- `addNodeText()` 为每个节点填充文本内容
- `processLargeNodesRecursively()` 递归拆分超大叶节点（token 数超限的节点会被 LLM 再次拆分）

**阶段 5 — generating_summaries**: 摘要生成
- `generateSummariesForStructure()` 为每个节点生成摘要
- 每 8 个节点一批并行调用 LLM

**阶段 6 — generating_description**: 文档描述
- `generateDocDescription()` 生成整本书的一句话描述

### 进度回调

每个阶段通过 `onProgress` 回调报告进度：

| stage | 中文提示 |
|-------|---------|
| `detecting_toc` | 检测目录中 |
| `parsing_structure` | 解析文档结构中 |
| `verifying_pages` | 验证页码映射中 |
| `generating_summaries` | 生成章节摘要中 |
| `generating_description` | 生成文档描述中 |
| `complete` | 完成 |

---

## EPUB 解析

`pageindex.ts: fromEpub()` → `parsers/epub.ts: parseEpub()`

EPUB 的章节结构来自 OPF spine/manifest，不需要 TOC 检测和验证：

```
EPUB 文件 (ZIP)
  │
  ├─ AdmZip 解压
  ├─ META-INF/container.xml → 定位 OPF 文件
  ├─ 解析 OPF:
  │   ├─ 元数据: title, creator
  │   ├─ manifest map: id → href
  │   ├─ spine: 阅读顺序
  │   └─ 封面图片提取
  │
  ├─ 按阅读顺序遍历章节:
  │   ├─ 读取 HTML 内容
  │   ├─ extractTextFromHTMLWithBlocks()
  │   │   └─ Turndown HTML → Markdown + block ID 生成
  │   └─ 章节标题提取 (h1 > h2 > ...)
  │
  ├─ 跳过纯图片/封面页
  └─ 返回 EpubInfo { title, author, chapters[], coverImage }
```

### Block ID 生成

`epub.ts: createTurndownServiceWithBlocks()`

EPUB 解析器为每个段落生成 block ID，用于精确定位：

- **优先使用原始 HTML `id`**（替换 `_` 为 `-`）
- **否则生成** `p{chapterIndex}-{counter}` 格式
- 同时维护 `blockMap: Map<anchorId, blockId>` 和 `blocks: string[]`

### HTML → Markdown 转换规则

| HTML 元素 | Markdown 输出 | 说明 |
|-----------|--------------|------|
| `<img>` | `![alt](src)` | 保留图片引用 |
| `<a href="...#fn">` | `[^N]` | 脚注链接 |
| `<a href="chapter#anchor">` | `[[file#^anchor\|text]]` | Obsidian 双链 |
| `<p>` | 段落 + `^blockId` | 自动生成 block ID |
| `<li>` | 列表项 + `^blockId` | 自动生成 block ID |
| `<ruby>` | `{base\|ruby}` | CJK 注音 |

### 潜在标题检测

`isPotentialHeading()` 检测可能是 h3 标题的段落：
- 短文本（≤60 字符）
- 无句末标点（。！？等）
- 排除图片、表格、已存在 heading

### 标题清洗

`cleanEpubTitle()` 移除电子书网站添加的营销后缀（如 z-lib、【xx】等）。

---

## Markdown 导出

### PDF 导出

`exporters/pdf-to-obsidian.ts: exportPdfToObsidian()`

```
TreeNode[] (解析结果)
  │
  ├─ 父节点 → summary callout + 子节点链接列表
  ├─ 叶节点 → 全文 + ^blockId 标记 + 导航链接
  │
  │   每个 TreeNode → 一个 .md 文件
  │   block ID 格式: s{sectionIndex}-{counter}
  │
  ├─ MOC 文件 → YAML frontmatter + 目录树 + 作者/来源
  │
  └─ 返回 nodeFileMap: Record<nodeId, fileName.md>
```

### EPUB 导出

`exporters/epub-to-obsidian.ts: exportToObsidian()`

- 章节层级计算：篇(0) / 章(0-1) / 节(2)
- 图片提取：保留原始目录名（images/media/assets）
- 内容清洗：修复异常星号格式
- 内部链接修复：`[[originalBase#anchor]]` → `[[newFileName#^blockId]]`
- 构建层级树 `buildEpubTree`

### EPUB 适配器

`exporters/adapter.ts` 处理大章节：
- 按 token 限制拆分为多个虚拟章节
- 可选 LLM 为每个虚拟章节生成摘要

---

## 三级向量化

`book-indexer.ts: vectorizeAllLevels()`

```
L0  书籍级     bookTitle + "\n" + bookSummary              → 1 条向量
L1  章节摘要级  chapterTitle + "\n" + chapterSummary         → N 条向量
L2  段落块级    章节文件 → splitByBlockIds → mergeToChunks   → N 条向量
```

### L2 段落分块

`chunker.ts`

1. `splitByBlockIds()` — 按 `^blockId` 标记拆分段落
2. `classifyType()` — 分类段落：heading / body / list / quote
3. `mergeToChunks()` — 合并为 300–800 字符的 chunk
   - 目标大小 300 字符，最大 800 字符
   - 超长段落按句号/逗号/分号断句拆分
   - chunkId 格式: `{nodeId}_{firstBlockId}`

### Embedding 生成

`vault/vectors.ts: generateEmbeddings()`

- 支持 provider: openai, ollama, lmstudio
- 批量嵌入，默认 batchSize=32
- BGE 模型截断到 400 字符，其他模型 8000 字符
- 空文本替换为占位符

### 存储格式

- `vectors.jsonl` — 每行一条：`{chunkId, nodeId, blockIds, type, level, vector}`
- `chunks.jsonl` — 每行一条：`{chunkId, nodeId, blockIds, text, type}`

---

## BM25 索引

`bm25.ts`

### 分词策略

`tokenize()` 对不同文本采用不同策略：

| 文本类型 | 策略 |
|---------|------|
| CJK 文本 | unigrams + bigrams + 完整词组（保留重复以支持词频） |
| 英文/数字 | 空格分词 + 小写化 |

### 索引构建

`buildBM25Index()` 构建的数据结构：

```
BM25Data {
  nodes:       { [nodeId]: { text, length, level } }
  invertedIndex: { [token]: [{ nodeId, tf }] }
  stats:       { totalDocs, avgDocLength, df: { [token]: count } }
  params:      { k1: 1.5, b: 0.75 }
}
```

### 搜索

`searchBM25(query, index, topK)`:

- 查询分词后去除 CJK 停用词（的/了/是等 40+ 个）并去重
- 评分公式：`IDF × (tf × (k1+1)) / (tf + k1 × (1 - b + b × docLen/avgDocLen))`
- IDF 下限夹紧为 0（避免高频词负分）

---

## 搜索管道

`book-search-v2.ts: searchBookV2()` — 8 阶段混合搜索

### Stage 1: 动态召回数 K

```
query < 5 字符  → K=50
5 ≤ query ≤ 15  → K=30
query > 15 字符  → K=15
```

有 scopeNodeIds 过滤时 K 放大 5 倍。

### Stage 2 + 3 + 3.5: 并行三路召回

| 信号 | 来源 | 说明 |
|------|------|------|
| BM25 | `bm25.json` | 关键词精确匹配 |
| 向量 | `vectors.jsonl` | 语义相似度（L2 段落级，无结果回退 L1） |
| 命题卡片 | `prop-vectors.jsonl` | 原子事实卡片匹配 |

### Stage 4: Scope 过滤

- 若指定 `scopeNodeIds`，过滤候选集合
- 过滤后为空则回退到未过滤集合（避免零召回）

### Stage 5: 分数融合 + 层级加权

**自适应权重：**

| 条件 | 向量权重 | BM25 权重 | 命题权重 |
|------|---------|----------|---------|
| 有向量 + 有命题 | 0.5 | 0.25 | 0.25 |
| 有向量 + 无命题 | 0.7 | 0.3 | — |
| 无向量 | — | 1.0 | — |

各信号 Min-Max 归一化后加权求和。

**层级加权：**

| 层级 | 权重 |
|------|------|
| depth=0 (书级) | 1.0 |
| 有子节点 (章级) | 0.9 |
| 叶节点 (节级) | 0.7 |

### Stage 7: Cross-encoder 重排序（可选）

- 读取 top-20 候选的 Markdown 原文（前 1500 字符）
- 调用 rerank API
- 融合：`finalScore = 0.7 × rerankScore + 0.3 × fusedScore`

### Stage 8: 匹配块定位

按优先级选择 matchedBlocks：
1. 命题卡片（最多 3 张）
2. 向量搜索的 chunkHits（最多 3 个）
3. 回退：以 nodeId 引用作为空块

### 缓存

`tree.json` 和 `bm25.json` 的读取结果缓存 1 分钟，避免多关键词重复搜索时的磁盘 I/O。

---

## 索引文件格式

每本书存储在 `.obsidian/plugins/deepreader/pageindex/{bookId}/`：

| 文件 | 格式 | 说明 |
|------|------|------|
| `tree.json` | JSON | 完整树结构 + nodeFileMap + docDescription |
| `book-meta.json` | JSON | 书籍元数据（version 3）：title, author, embedding 配置, propositions 信息 |
| `bm25.json` | JSON | BM25 倒排索引 |
| `vectors.jsonl` | JSONL | 向量数据（L0/L1/L2 三级） |
| `chunks.jsonl` | JSONL | 段落原文（与 vectors.jsonl 对应） |
| `propositions.json` | JSON | 命题卡片（已禁用） |
| `prop-vectors.jsonl` | JSONL | 卡片向量（已禁用） |
| `.indexing.json` | JSON | 索引进度临时文件（完成后删除） |

全局目录：

| 文件 | 说明 |
|------|------|
| `catalog.json` | 跨书籍全局索引：`{version, books: {bookId → CatalogBookEntry}}` |

导出目录 `DeepReader/{exportName}/`：

| 文件 | 说明 |
|------|------|
| `01 - 第一章.md` | 章节 Markdown 文件（含 block ID） |
| `MOC - {书名}.md` | 地图笔记（目录树 + 元信息） |
| `images/` | PDF 图片（来自 MinerU CDN） |

封面目录 `DeepReader/covers/`：

| 文件 | 说明 |
|------|------|
| `{exportName}.png/.jpg/.svg` | 封面图片 |

---

## 错误处理与降级策略

| 错误类型 | 处理方式 |
|---------|---------|
| 文件不存在 | 立即抛出 `IndexError(FILE_NOT_FOUND)` |
| MinerU API 失败 | 自动降级到 OCR 路径 |
| TOC 准确率 < 60% | 降级重试链：有页码 → 无页码 → 无 TOC → 书签回退 |
| 向量化失败 | 降级为纯 BM25，索引继续完成 |
| 命题提取失败 | 记录错误到 book-meta.json，索引继续完成 |
| 整体失败 | `try-finally` 确保 `.indexing.json` 被清理 |
| OCR API 错误 | 单页失败返回空字符串，不中断整体 |
| EPUB XML 注释不规范 | 主动清洗而非报错 |

---

## 关键源文件索引

| 文件 | 职责 |
|------|------|
| `src/pageindex/book-indexer.ts` | 主编排，8 步管线 |
| `src/pageindex/pageindex.ts` | PageIndex 核心类，解析入口 |
| `src/pageindex/node.ts` | Node.js/Electron 兼容导出 |
| `src/pageindex/core/tree.ts` | 树构建、摘要生成、TOC 验证与修复 |
| `src/pageindex/core/toc.ts` | TOC 检测、提取、页码映射 |
| `src/pageindex/parsers/pdf.ts` | PDF 解析入口（委托 MinerU） |
| `src/pageindex/parsers/epub.ts` | EPUB 解析（AdmZip + Turndown） |
| `src/pageindex/parsers/ocr.ts` | OCR 兜底（pdftocairo + GLM-OCR） |
| `src/pageindex/parsers/mineru.ts` | MinerU JSON 解析 + TOC 树构建 |
| `src/pageindex/parsers/markdown.ts` | Markdown 文档结构提取 |
| `src/pageindex/exporters/pdf-to-obsidian.ts` | PDF Markdown 导出 |
| `src/pageindex/exporters/epub-to-obsidian.ts` | EPUB Markdown 导出 |
| `src/pageindex/exporters/adapter.ts` | 大章节拆分适配器 |
| `src/pageindex/bm25.ts` | BM25 索引构建与搜索 |
| `src/pageindex/chunker.ts` | 段落分块器 |
| `src/pageindex/book-search-v2.ts` | 8 阶段混合搜索管道 |
| `src/pageindex/vault/vectors.ts` | 向量存储与搜索 |
| `src/pageindex/paths.ts` | 路径常量与工具函数 |
