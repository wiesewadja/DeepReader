# Spec: MinerU PDF 解析迁移

## Objective

将 DeepReader 的 PDF 解析引擎从本地 `pdf-parse` 切换为 MinerU 云 API，消除 10.7MB 的 `pdf-parse` 打包体积，获得更好的解析质量（表格/公式/OCR/多栏布局），同时保持 `parsePdf` 对外接口不变。

**用户故事**:
- 作为 DeepReader 用户，打开 PDF 后插件自动调用 MinerU 解析，获得比本地 pdf-parse 更准确的结构化 Markdown
- 小文件（≤20 页 / ≤10MB）零门槛使用 Agent 轻量 API
- 大文件用户可配置 Token 使用精准 API
- 无网络时提示用户联网

**成功标准**:
- `npm run build` 后 `bin/main.js` 体积减少 ≥10MB（pdf-parse 不再打包）
- 现有 `parsePdf(input)` 签名不变，调用方无需修改
- 插件设置页有"PDF 解析"Tab，含 Token 配置
- 端到端测试覆盖 Agent API 和精准 API 路径

## Tech Stack

| 层 | 技术 |
|---|---|
| 语言 | TypeScript 5.x |
| HTTP | `fetch`（Obsidian Electron 内置） |
| 构建 | esbuild 0.19.x（`pdf-parse` 移出 bundle） |
| 持久化 | Obsidian `Plugin.loadData()/saveData()` |

## Commands

```
Build:      npm run build
Dev:        npm run dev (watch)
Test:       npm run test:run
E2E:        npm run test:e2e
Deploy:     npm run deploy
Lint:       npx tsc -noEmit -skipLibCheck
```

## 架构设计

### 双模式决策流程

```
parsePdf(input)
  │
  ├─ 读取文件为 Buffer → 获取文件大小
  │
  ├─ ≤10MB?
  │   └─ YES → Agent 轻量 API (免 Token)
  │       ├─ POST /api/v1/agent/parse/file → { task_id, file_url }
  │       ├─ PUT file → OSS (file_url)
  │       └─ 轮询 GET /api/v1/agent/parse/{task_id}
  │           ├─ state=pending/running → 继续轮询
  │           ├─ state=done → 返回 { markdown_url }
  │           ├─ state=failed → 抛出错误
  │           └─ 超时 (300s) → 抛出 TimeoutError
  │
  └─ NO → 精准 API (需 Token)
      ├─ Token 为空? → 抛出 "文件过大, 请在设置中配置 MinerU Token"
      ├─ POST /api/v4/file-urls/batch → { batch_id, file_urls[] }
      ├─ PUT file → OSS
      └─ 轮询 GET /api/v4/extract-results/batch/{batch_id}
          ├─ state=running → 继续轮询
          ├─ state=done → 返回 { full_zip_url }
          ├─ 下载 ZIP → 提取 full.md
          └─ 超时 (600s) → 抛出 TimeoutError
```

### MinerU Markdown 输出 → PdfInfo 映射

MinerU 返回的 Markdown 包含 `<!-- Page N -->` 标记和 `#` 标题层级。

```
📄 MinerU Markdown 示例
─────────────────────────────────────────
# 第一章 引言                              ← h1
<!-- Page 1 -->                           ← 分页标记

这是第一段文字，包含**粗体**和公式 $E=mc^2$。
                                          ← MinerU 会保留 Markdown 格式

| 列1 | 列2 |                            ← MinerU 已输出 Markdown 表格
|-----|-----|
| A   | B   |

<!-- Page 2 -->
第二章开始的内容...

## 1.1 背景                            ← h2（也是大纲条目）

正文...
─────────────────────────────────────────
```

| PdfInfo 字段 | 类型 | 来源 | 变更说明 |
|---|---|---|---|
| `title` | `string` | 文件名 / MD 第一个 `#` 标题 | 优先使用文件名，无变化 |
| `numPages` | `number` | MD 中 `<!-- Page N -->` 最大编号 | 从 pdf.js 改为正则匹配 `<!-- Page (\d+) -->` |
| `pages[]` | `PdfPage[]` | 按 `<!-- Page N -->` 分割 | 逐页文本质量大幅提升（表格/公式/正确排序） |
| `pages[].text` | `string` | 该页所有文本（不含 MD 标记） | ⚠️ 保留 Markdown 语法（表格/粗体/公式） |
| `pages[].tokenCount` | `number` | `countTokens(text)` | 无变化 |
| `outline` | `PdfOutlineItem[]` | **从 Markdown 标题推导** | ⚠️ 不再是 PDF 原生书签，见下文"大纲推导" |
| `coverPng` | `Buffer` | **移除** | MinerU 不返回封面图 |
| `author` | `string` | **移除** | MinerU 不返回元数据 |

### 大纲推导算法（核心变更）

PDF 书签（outline）在 PageIndex 中用于**两个关键路径**，切换到 MinerU 后需要构建"伪大纲(pseudo-outline)"从 Markdown 标题推导：

```typescript
/**
 * 从 MinerU Markdown 中提取标题层级作为伪大纲
 *
 * ⚠️ 限制：
 * - 页号是"在 Markdown 中出现的顺序页号"，而非 PDF 内部页码
 * - 对于有封面/前言/目录页的 PDF，页号可能与 PDF 实际页码偏移
 * - 无标题的页面（如图版页）不会出现在大纲中
 *
 * 示例输入：
 *   <!-- Page 1 -->
 *   # 第一章             → pageNumber=1, title="第一章", level=h1
 *   正文...
 *   <!-- Page 3 -->     ← Page 2 可能是空白/图片页，无标题
 *   ## 1.1 背景         → pageNumber=3, title="1.1 背景", level=h2
 */
function extractOutlineFromMarkdown(md: string): PdfOutlineItem[] {
  const lines = md.split('\n');
  const root: PdfOutlineItem[] = [];
  const stack: { level: number; item: PdfOutlineItem }[] = [];

  let currentPage = 1;

  for (const line of lines) {
    // 跟踪页号
    const pageMatch = line.match(/<!--\s*Page\s+(\d+)\s*-->/i);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1]);
      continue;
    }

    // 匹配标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (!headingMatch) continue;

    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();
    if (!title) continue;

    const item: PdfOutlineItem = { title, pageNumber: currentPage };

    // 根据标题级别构建树
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(item);
    } else {
      const parent = stack[stack.length - 1].item;
      parent.children = parent.children || [];
      parent.children.push(item);
    }
    stack.push({ level, item });
  }

  return root;
}
```

### ⚠️ 大纲变更对 PageIndex 管道的影响

大纲在整个 PageIndex 流程中起**两个关键作用**，切换到伪大纲后需要重新评估：

#### 路径 A：`processPdfWithOutline()` — 跳过 LLM，直接用大纲建树

```typescript
// pageindex.ts:293 — 当前逻辑
if (savedOutline && savedOutline.length > 0 && isOutlineHighQuality(savedOutline, pdfInfo.numPages)) {
  // PDF 原生书签质量高 → 完全跳过 LLM 结构解析
  return await this.processPdfWithOutline(pages, savedOutline, pdfName);
}
```

**变更后**：
- 伪大纲的 `pageNumber` 是"出现的顺序页"，不是 PDF 内部页码
- `isOutlineHighQuality()` 检查的是页号跨度覆盖 ≥ 60% —— 伪大纲的页号来自 `<!-- Page N -->` 标记，天然覆盖所有有标题的页
- ⚠️ **但伪大纲的页号与 PDF 实际页码之间可能存在偏移**（封面/目录页前的空白页不会被计算）
- **结论**：伪大纲适合**简单文档**（无封面/目录偏移），复杂文档应走 LLM 路径

**建议策略**：
```typescript
// 只在文档较短 (< 50 页) 且伪大纲条目 > 5 时才尝试走 outline 路径
// 否则强制走 LLM 路径以获得更好的结构准确性
if (savedOutline && savedOutline.length > 5 && pdfInfo.numPages < 50) {
  // 尝试 outline 路径
} else {
  // 走 LLM 路径（默认）
}
```

#### 路径 B：`processPdfPages()` 中的 outline hint — 校正 LLM 页号

```typescript
// pageindex.ts:390-405 — 当前逻辑
if (outline && outline.length > 0) {
  const bookmarkMap = flattenOutlineToMap(outline);
  for (const item of tocItems) {
    const bookmarkPage = findBookmarkMatch(item.title, bookmarkMap);
    if (bookmarkPage !== null && item.physicalIndex !== bookmarkPage) {
      item.physicalIndex = bookmarkPage;  // 用书签校正 LLM 的页号猜测
    }
  }
}
```

**变更后**：
- 伪大纲的 `title` 和 `pageNumber` 来自 MD 标题 → **标题匹配精度高**
- 但 `pageNumber` 可能因封面/目录偏移而不精确
- **结论**：仍然有价值。标题匹配能校正 LLM 的明显错误（如把第一章放在第 5 页），但不应该完全信任伪大纲的页号

**建议策略**：
```typescript
// 使用伪大纲时，只在校正幅度合理时采纳（不跨过 ±3 页阈值的不动）
// 保留那段逻辑，但给 findBookmarkMatch 加 confidence 过滤
```

#### 对 LLM TOC 检测的影响（正面）

```
页面文本质量提升 → TOC 检测更准确 → 结构解析更准确
                                    ↓
                较少的 verify-fix 循环 → 更快的索引速度
                                    ↓
                较少触发 fallback 策略 → 更好的最终质量
```

`checkToc(pages)` 和 `processTocWithPageNumbers` 等 LLM 调用都基于页面文本工作。MinerU 提供**表格、公式、正确阅读顺序**的 Markdown 文本，直接提升 LLM 对文档结构的理解，这是最关键的收益。

### 完整数据流（集成视图）

```
用户打开 PDF
    │
    ▼
parsePdf(input)                              ← pdf.ts
    │
    ├─ 文件 > 10MB AND 有 Token?
    │   └─ MineruClient.parseViaPrecision()   ← mineru-api.ts
    │       ├─ POST /api/v4/file-urls/batch
    │       ├─ PUT file → OSS
    │       └─ 轮询 → ZIP → 提取 full.md
    │
    └─ 文件 ≤ 10MB?
        └─ MineruClient.parseViaAgent()       ← mineru-api.ts
            ├─ POST /api/v1/agent/parse/file
            ├─ PUT file → OSS
            └─ 轮询 → markdown_url → 下载 full.md
    │
    ▼
markdownToPdfInfo(markdown)                  ← pdf.ts 新函数
    ├─ 解析 <!-- Page N --> → 分割 pages[]
    ├─ 解析 # 标题 → 构建伪大纲 outline[]
    └─ 返回 { title, numPages, pages, outline }
         coverPng = undefined   ← 不再提供
         author = undefined     ← 不再提供
    │
    ▼
pageindex.ts:fromPdf()
    │
    ├── [A] 有 outline AND isOutlineHighQuality?
    │   └── YES → processPdfWithOutline()     ← 无 LLM
    │       ├─ outlineToTocItems(outline)
    │       ├─ checkTitleAppearanceInStartConcurrent → pages[].text
    │       ├─ buildTree()
    │       └─ addNodeText() → pages[].text
    │
    ├── [B] NO → processPdfPages()            ← LLM 路径（默认）
    │   ├─ checkToc()  → pages[].text         ← LLM: 检测 TOC
    │   ├─ processNoToc / ...  → pages[].text  ← LLM: 解析结构
    │   ├─ (optional) outline hint correction ← 伪大纲校正
    │   ├─ verifyToc + fixIncorrectToc → pages[].text ← LLM
    │   ├─ buildTree()
    │   ├─ addNodeText() → pages[].text
    │   └─ processLargeNodesRecursively → pages[].text ← LLM
    │
    └── [C] OCR 路径
        └─ parsePdfWithOcr() → 走 GLM-OCR（不受本方案影响）
    │
    ▼
PageIndexResult
    ├─ docName, structure (TreeNode[])
    ├─ coverPng = undefined    ← 书库封面降级为 SVG
    └─ author = undefined      ← 不再提供
```

### 影响分析：每步数据依赖与变更评估

以下逐行追踪每个 `PdfInfo` 字段在 PageIndex 各步骤中的使用方式，及切换到 MinerU 后的影响：

| # | PageIndex 步骤 | 使用 | pdf-parse 行为 | MinerU 行为 | 影响 | 说明 |
|---|---|---|---|---|---|---|
| 1 | `fromPdf()` L248 `cachedPdfInfo.pages` | `pages[].text` 前5页检测扫描件 | 纯文本，扫描页为空 | **Markdown 文本**，但扫描页同样空 | **无变化** | 自动检测扫描 PDF 的阈值逻辑不变 |
| 2 | `fromPdf()` L281 `pdfInfo.title` | 文档标题 | 元数据 + 文件名 + 首行启发式 | 文件名（MinerU 不返回标题元数据） | **轻微降级** | 但仍优于回退方案 |
| 3 | `fromPdf()` L286 `pdfInfo.coverPng` | → `_pendingCoverPng` → `book-indexer.ts` 275f | PDF.js 渲染首页为 PNG | `undefined` | ⚠️ **移除** | 见下方详细分析 |
| 4 | `fromPdf()` L289 `pdfInfo.outline` | 路径 A (skip LLM) 或 路径 B (hint) | PDF 原生书签（精确内部页码） | 伪大纲（从 # 标题推导，页号来自 `<!-- Page N -->`） | **中等降级** | 见下方详细分析 |
| 5 | `fromPdf()` L290 `pdfInfo.author` | → `PageIndexResult.author` | PDF 元数据提取 | `undefined` | **移除** | 读者信息中不再显示作者 |
| 6 | `processPdfPages()` 中各 LLM 调用: `checkToc`, `processNoToc`, `verifyToc`, `fixIncorrectToc`, `checkTitleAppearanceInStartConcurrent`, `addNodeText` | 全部基于 `pages[].text` | pdf-parse: 纯文本, 丢失表格/公式, 阅读顺序可能有误 | MinerU: **结构化 Markdown**（`|` 表格、`$` 公式、正确阅读顺序） | **大幅提升** | 这是最关键的收益 |
| 7 | `processPdfWithOutline()` L606 `checkTitleAppearanceInStartConcurrent` | `pages[].text` | 纯文本 | 结构化 Markdown | **提升** | |
| 8 | `processPdfWithOutline()` L613 `addNodeText` | `pages[].text` | 纯文本 | 结构化 Markdown | **提升** | 节点内容包含表格/公式 |
| 9 | `processLargeNodesRecursively()` L584 `processNoToc(subPages)` | `pages[].text` 子集 | 纯文本 | 结构化 Markdown | **提升** | |
| 10 | `book-indexer.ts` L245 `parseResult.coverPng` | 封面存储 | 有封面 | 无封面 → 触发 `generateTextCover()` SVG 降级 | **降级** | 书库不显示 PDF 封面缩略图 |
| 11 | `book-indexer.ts` L268+ 全部 Markdown 导出 | `structure[].text`（来自 pages[].text） | 纯文本 | 结构化 Markdown 含表格/公式 | **大幅提升** | 导出到 Obsidian 的内容更丰富 |

### 影响可视化

```
影响热力图（红色=负面，绿色=正面）
═══════════════════════════════════════════

步骤依赖 pages[].text:
┌─────────────────────────────────────────────┐
│ checkToc()                          🟢🟢🟢  │
│ processNoToc()                      🟢🟢🟢  │
│ processTocNoPageNumbers()           🟢🟢🟢  │
│ processTocWithPageNumbers()         🟢🟢🟢  │
│ verifyToc()                         🟢🟢🟢  │
│ fixIncorrectToc()                   🟢🟢🟢  │
│ checkTitleAppearanceInStart()       🟢🟢    │
│ addNodeText()                       🟢🟢🟢  │
│ processLargeNodesRecursively()      🟢🟢    │
│ processPdfWithOutline(标题匹配)      🟢      │
└─────────────────────────────────────────────┘

步骤依赖 outline/bookmarks:
┌─────────────────────────────────────────────┐
│ isOutlineHighQuality() → skip LLM   🟡🔻   │
│ outline hint 校正页号               🟡🔻   │
│ processPdfWithOutline() fallback    🟡🔻   │
└─────────────────────────────────────────────┘

步骤依赖 coverPng / author:
┌─────────────────────────────────────────────┐
│ book-indexer 封面存储               🔴❌   │
│ PageIndexResult.author              🔴❌   │
└─────────────────────────────────────────────┘
```

**核心结论**：
- 所有依赖文本质量的 LLM 步骤 → 🟢 **大幅受益**
- 依赖 PDF 内部书签的步骤 → 🟡 **可接受降级**，仍可从 heading 推导
- 依赖 PDF.js canvas 渲染的步骤 → 🔴 **移除**，有 SVG 降级覆盖
用户打开 PDF
    │
    ▼
parsePdf(input)                              ← pdf.ts
    │
    ├─ 文件 > 10MB AND 有 Token?
    │   └─ MineruClient.parseViaPrecision()   ← mineru-api.ts
    │       ├─ POST /api/v4/file-urls/batch
    │       ├─ PUT file → OSS
    │       └─ 轮询 → ZIP → 提取 full.md
    │
    └─ 文件 ≤ 10MB?
        └─ MineruClient.parseViaAgent()       ← mineru-api.ts
            ├─ POST /api/v1/agent/parse/file
            ├─ PUT file → OSS
            └─ 轮询 → markdown_url → 下载 full.md
    │
    ▼
markdownToPdfInfo(markdown)                  ← pdf.ts 新函数
    ├─ 解析 <!-- Page N --> → 分割 pages[]
    ├─ 解析 # 标题 → 构建伪大纲 outline[]
    └─ 返回 { title, numPages, pages, outline }
    │
    ▼
pageindex.ts:fromPdf()                       ← pageindex.ts
    │
    ├─ 有 outline AND isOutlineHighQuality?
    │   └─ YES → processPdfWithOutline()
    │       ├─ outlineToTocItems(outline)
    │       ├─ checkTitleAppearanceInStartConcurrent
    │       ├─ buildTree()   ← 无 LLM 调用
    │       └─ addNodeText()
    │
    └─ NO → processPdfPages()
        ├─ checkToc(pages)  ← LLM: 得益于 MinerU 文本质量更准确
        ├─ processNoToc / processTocNoPageNumbers / processTocWithPageNumbers
        ├─ (optional) outline hint correction ← 伪大纲仍可提供
        ├─ verifyToc + fixIncorrectToc
        └─ buildTree() + addNodeText()
    │
    ▼
PageIndexResult
    ├─ docName, structure (TreeNode[])
    ├─ coverPng = undefined    ← 不再提供
    └─ author = undefined      ← 不再提供
```

## Project Structure

```
src/
├── services/
│   └── mineru-api.ts              ← NEW: MinerU API 客户端 (~200 行)
│       ├── class MineruClient
│       │   ├── parseViaAgent()    ← Agent 轻量 API 全流程
│       │   ├── parseViaPrecision() ← 精准 API 全流程
│       │   ├── requestUploadUrl()
│       │   ├── uploadFile()
│       │   ├── pollResult()
│       │   └── downloadMarkdown()
│       └── types
│           ├── MineruTaskState
│           └── MineruError
│
├── pageindex/
│   └── parsers/
│       ├── pdf.ts                  ← REWRITE: 从 528 行减至 ~350 行
│       │   ├─ 保留: parsePdf() 签名不变
│       │   ├─ 保留: 所有工具函数 (getTextOfPages 等)
│       │   ├─ 保留: PdfInfo / PdfPage / PdfOutlineItem 类型
│       │   ├─ 新增: markdownToPdfInfo() ← MinerU MD → PdfInfo
│       │   ├─ 新增: extractOutlineFromMarkdown() ← 标题推导大纲
│       │   ├─ 移除: render_page()          ← pdf.js 逻辑
│       │   ├─ 移除: resolveOutlineToPages() ← pdf.js 逻辑
│       │   ├─ 移除: renderPageToPng()      ← canvas 渲染
│       │   └─ 移除: import * as PDFParse   ← 不再依赖
│       │
│       ├── pdf-to-markdown.ts      ← DELETE: 已注释，废弃
│       └── index.ts                ← EDIT: 移除 pdf-to-markdown 注释行
│
├── pageindex/
│   ├── pageindex.ts                ← EDIT: 修改 outline 质量评估逻辑
│   │   └─ isOutlineHighQuality()   ← 调低对伪大纲的期望
│   │   └─ fromPdf()                ← coverPng/author 标记为 undefined
│   └── core/types.ts              ← EDIT (可选): coverPng 改为可选
│
├── config/
│   └── settings.ts                 ← EDIT: 添加 mineruApiKey 字段 + 默认值
│       └─ DeepPDFSettings.mineruApiKey: string
│
├── settings/
│   ├── sections/
│   │   └── pdf-parser-section.ts   ← NEW: PDF 解析设置 Tab (~80 行)
│   │       ├─ Token 输入框
│   │       └─ 测试连接按钮
│   └── setting-tab.ts              ← EDIT: 注册新 Tab + 导入
│
scripts/
└── deploy.js                       ← 无变化

tests/
├── unit/
│   └── mineru-api.test.ts          ← NEW: MineruClient 单元测试
│       ├─ markdownToPdfInfo()
│       └─ extractOutlineFromMarkdown()
│
└── specs/
    └── pdf-parsing.e2e.ts          ← REWRITE: 改为测试 MinerU 路径

package.json                        ← EDIT: 移除 pdf-parse 依赖
esbuild.config.mjs                  ← EDIT: 移除 pdf-parse 相关 banner
```

### `src/services/mineru-api.ts` 设计

```typescript
// 核心导出
export class MineruClient {
  constructor(token?: string)

  // Agent 轻量 API — 文件上传
  async parseViaAgent(input: Buffer, fileName: string, options?: {
    pageRange?: string
    enableTable?: boolean
    isOcr?: boolean
  }): Promise<string>  // returns markdown text

  // 精准 API — 文件上传
  async parseViaPrecision(input: Buffer, fileName: string, options?: {
    modelVersion?: 'pipeline' | 'vlm'
    pageRange?: string
    enableTable?: boolean
    enableFormula?: boolean
    isOcr?: boolean
    language?: string
  }): Promise<string>  // returns markdown text

  // 快速预检：读取 PDF 页数（无需完整下载解析结果）
  // 改用文件大小 + 固定假设（大多数 PDF 约 30KB/page），或
  // 先提交 Agent API 看是否返回 -30003 错误
}
```

### `src/pageindex/parsers/pdf.ts` 重写要点

- 移除所有 `import * as PDFParse from "pdf-parse"`
- 移除 `render_page`, `resolveOutlineToPages`, `renderPageToPng` 等 pdf.js 遗留逻辑
- `parsePdf` 函数改为：
  1. 读取文件为 Buffer
  2. 创建 `MineruClient`（带 settings 中的 token）
  3. 根据文件大小决定使用 Agent API 还是 精准 API
  4. 轮询等待结果
  5. 解析 Markdown → `PdfInfo`
- 保留所有工具函数：`getTextOfPages`, `getAllText`, `getTokenCountForPages` 等
- `getPdfName` 不变

### 设置界面

新增"PDF 解析"Tab（`settings/sections/pdf-parser-section.ts`）：

```
┌─ PDF 解析 ──────────────────────────┐
│                                      │
│  MinerU Token                        │
│  ┌──────────────────────────────┐    │
│  │ token_xxxxxxxxxxxxxxxxxxxx   │    │
│  └──────────────────────────────┘    │
│  可选。用于解析超过 20 页/10MB 的 PDF。 │
│  申请: https://mineru.net             │
│                                      │
│  [测试连接]                           │
│                                      │
└──────────────────────────────────────┘
```

- Token 为空时，仅使用 Agent 轻量 API
- Token 非空时，大文件自动使用精准 API
- "测试连接"按钮：上传一个已知小 PDF 验证 Token 有效性

## 边界与限制

### 已知功能降级

| 功能 | 旧 (pdf-parse) | 新 (MinerU) | 影响范围 |
|---|---|---|---|
| PDF 书签大纲目录 | ✅ 精确提取内部页号 | **伪大纲**从 Markdown 标题推导（页号为出现顺序） | `processPdfWithOutline()` 路径触发减少，LLM 路径使用增多 |
| LLM 页号校正 | ✅ 书签页号精确校正 | 伪大纲页号可能偏移（封面/目录空白页），校正置信度降低 | 用于 `findBookmarkMatch`，仍能匹配标题名 |
| 封面图 | ✅ PDF.js canvas 渲染 | ❌ 不支持，降级到 `generateTextCover()` SVG 封面 | 书库封面从 PDF 首页缩略图变为文字 SVG |
| PDF 元数据 (Author) | ✅ 提取 | ❌ 不支持 | `PageIndexResult.author` 永远为 `undefined` |
| 页面级文本渲染 | ✅ PDF.js 逐页渲染 | ✅ Markdown 分页标记分割 | 阅读模式不受影响 |
| 扫描件 OCR | ❌ 不支持 | ✅ MinerU VLM 模型原生支持 OCR | **新能力** |
| 公式识别 | ❌ 纯文本 | ✅ LaTeX `$...$` 输出 | **新能力**，LLM 路径受益 |
| 表格识别 | ❌ 纯文本（行列错乱） | ✅ Markdown `\|` 表格 | **新能力**，LLM 路径受益 |
| 阅读顺序 | ⚠️ 坐标排序有误差 | ✅ MinerU VLM 理解语义顺序 | **大幅提升**，LLM 路径受益 |
| 包体积 | 15.4 MB (pdf-parse 占 10.7MB) | ~3-4 MB（仅自身代码 + langchain 等） | **大幅减小**，插件启动更快 |

**对最终用户的可感知变化**：
- **好的**：PDF 解析结果更准确（表格/公式/顺序），索引速度可能提升（verify-fix循环减少）
- **不好的**：书库中 PDF 封面变为文字图标（而非首页截图），不显示作者
- **可接受的**：首次打开 PDF 需要等待 MinerU 云解析（多 5-30s），有网络依赖性

### 隐私说明

PDF 文件内容会上传到 MinerU 服务器。在插件设置中增加隐私提示。

## Code Style

```typescript
// mineru-api.ts — 类封装，静态工厂
export class MineruClient {
  private agentBase = 'https://mineru.net/api/v1/agent';
  private precisionBase = 'https://mineru.net/api/v4';

  constructor(
    private token?: string,
    private options?: { timeout?: number; pollInterval?: number }
  ) {}

  /**
   * Agent 轻量 API：≤10MB，免 Token
   */
  async parseViaAgent(file: Buffer, fileName: string): Promise<string> {
    const { taskId, uploadUrl } = await this.post(`${this.agentBase}/parse/file`, {
      file_name: fileName,
      enable_table: true,
      enable_formula: true,
    });
    await this.putFile(uploadUrl, file);
    return this.pollMarkdown(taskId, this.agentBase);
  }

  /**
   * 精准 API：≤200MB/200页，需 Token
   */
  async parseViaPrecision(file: Buffer, fileName: string): Promise<string> {
    if (!this.token) throw new MineruError('MinerU Token not configured');
    const { batchId, fileUrls } = await this.post(`${this.precisionBase}/file-urls/batch`, {
      files: [{ name: fileName }],
      model_version: 'vlm',
    });
    await this.putFile(fileUrls[0], file);
    const zipUrl = await this.pollZipUrl(batchId);
    return this.downloadAndExtractMd(zipUrl);
  }

  private async pollMarkdown(taskId: string, base: string): Promise<string> {
    const start = Date.now();
    const timeout = this.options?.timeout ?? 300_000;
    while (Date.now() - start < timeout) {
      const { data } = await this.get(`${base}/parse/${taskId}`);
      if (data.state === 'done') {
        const resp = await fetch(data.markdown_url);
        return resp.text();
      }
      if (data.state === 'failed') {
        throw new MineruError(data.err_msg, data.err_code);
      }
      await sleep(this.options?.pollInterval ?? 3000);
    }
    throw new MineruError('Poll timeout');
  }
}

// pdf.ts — parsePdf 保持相同签名
export async function parsePdf(
  input: string | Buffer | ArrayBuffer
): Promise<PdfInfo> {
  const { buffer, fileName } = await normalizeInput(input);
  const token = loadMineruToken();
  const client = new MineruClient(token);

  let markdown: string;
  if (buffer.length <= 10 * 1024 * 1024) {
    markdown = await client.parseViaAgent(buffer, fileName);
  } else if (token) {
    markdown = await client.parseViaPrecision(buffer, fileName);
  } else {
    throw new Error(`File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). ` +
      'Configure MinerU Token in settings for large PDFs, or use a smaller file.');
  }

  return markdownToPdfInfo(markdown, fileName);
}

// markdownToPdfInfo — MinerU MD → PdfInfo
export function markdownToPdfInfo(md: string, fileName: string): PdfInfo {
  const pageRegex = /<!--\s*Page\s+(\d+)\s*-->/gi;
  // 按分页标记分割
  const parts = md.split(pageRegex);
  // parts = ["前导文本", "1", "第1页内容", "2", "第2页内容", ...]

  const pages: PdfPage[] = [];
  let lastPageNum = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const pageNum = parseInt(parts[i]);
    const content = (parts[i + 1] || '').trim();
    lastPageNum = pageNum;
    pages.push({
      text: content,
      tokenCount: countTokens(content),
    });
  }

  return {
    title: getPdfName(fileName),
    numPages: lastPageNum || pages.length,
    pages,
    outline: extractOutlineFromMarkdown(md),
    // coverPng: undefined,  — 不再提供
    // author: undefined,     — 不再提供
  };
}

// extractOutlineFromMarkdown — 从标题推导伪大纲
export function extractOutlineFromMarkdown(md: string): PdfOutlineItem[] {
  // ...见上文"大纲推导算法"章节
}
```

命名: `camelCase` 函数/变量, `PascalCase` 类/类型, `_` 前缀表示私有。

## Testing Strategy

| 层级 | 覆盖内容 | 工具 |
|---|---|---|
| 单元测试 | `markdownToPdfInfo()` 解析正确性（页分割、标题提取、Token计数） | Vitest |
| 单元测试 | `extractOutlineFromMarkdown()` 多级标题 → 树结构 | Vitest |
| 单元测试 | `MineruClient` 请求 URL 构造、响应解析、错误处理 | Vitest (mock fetch) |
| E2E 测试 | Agent 轻量 API 全流程（上传已知小 PDF → 等待 → 验证 Markdown） | WebdriverIO |
| E2E 测试 | 精准 API 路径（需配置有效 Token，可选执行） | WebdriverIO |

**单元测试用例** (`tests/unit/mineru-api.test.ts`):

```typescript
describe('markdownToPdfInfo', () => {
  it('splits pages by <!-- Page N --> markers', () => {
    const md = `# Title\n\n<!-- Page 1 -->\nContent 1\n\n<!-- Page 2 -->\nContent 2`;
    const result = markdownToPdfInfo(md, 'test.pdf');
    expect(result.numPages).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].text).toContain('Content 1');
    expect(result.pages[1].text).toContain('Content 2');
  });

  it('extracts outline from headings with correct page numbers', () => {
    const md = `<!-- Page 1 -->\n# Ch1\n<!-- Page 3 -->\n## 1.1\n<!-- Page 5 -->\n# Ch2`;
    const result = markdownToPdfInfo(md, 'test.pdf');
    expect(result.outline).toHaveLength(2);
    expect(result.outline[0].title).toBe('Ch1');
    expect(result.outline[0].pageNumber).toBe(1);
    expect(result.outline[0].children).toHaveLength(1);
    expect(result.outline[0].children![0].pageNumber).toBe(3);
  });
});

describe('extractOutlineFromMarkdown', () => {
  it('builds nested tree from heading levels', () => { /* ... */ });
  it('handles documents with no headings', () => { /* ... */ });
});

describe('MineruClient', () => {
  it('constructs correct upload request', () => { /* ... */ });
  it('polls until done and returns markdown', () => { /* ... */ });
  it('throws on failed state with error message', () => { /* ... */ });
  it('throws on timeout', () => { /* ... */ });
});
```

**E2E 测试注意事项**:
- Agent API 免 Token，CI 中可直接运行
- 使用 test-vault 中的已知小 PDF（≤10MB，≤20页）
- 验证返回的 Markdown 包含预期的页面标记和标题结构
- 不要上传敏感文档

## Boundaries

- **Always**:
  - 统一通过 `src/services/mineru-api.ts` 调用 MinerU API
  - `parsePdf(input)` 签名保持兼容
  - 上传前检查文件大小，超限时给出明确错误提示

- **Ask first**:
  - 修改 `PdfInfo` 类型定义（降级字段改为可选）
  - 添加新的 MinerU API 参数
  - 修改轮询策略（超时/重试）
  - 涉及用户隐私的变更

- **Never**:
  - 将 MinerU Token 硬编码到源码
  - 在日志中打印 Token 或文件内容
  - 删除 pdf.ts 中的工具函数（`getTextOfPages` 等被多处使用）

## Open Questions

- [x] Agent 轻量 API 的 `uploading` 状态（文件从 OSS 下载到 MinerU 处理）需要额外等待吗？→ 文档说明：`waiting-file` → `pending` → `running` → `done`，轮询逻辑已覆盖
- [x] 精准 API 的 ZIP 包中 `full.md` 路径是否固定？→ 文档确认 "full.md为MarkDown解析结果"
- [ ] 并发上传是否会触发 IP 限频（429）？→ 需要加 retry + backoff 策略
- [ ] `page_range` 参数在 Agent API 中是否支持？→ 文档说支持 `from-to` 格式，但当前 `parsePdf` 总是解析全文，暂不需要
- [ ] MinerU Markdown 中的公式格式（$...$ vs $$...$$）与 DeepReader 的 Markdown 渲染是否兼容？
- [ ] `<!-- Page N -->` 标记在 MinerU 输出中是否**始终**存在？空页是否有标记？需要确认边界情况
- [ ] 伪大纲的页号偏移问题（封面/目录前空白页）在实际 PDF 中影响程度如何？需要实测验证
