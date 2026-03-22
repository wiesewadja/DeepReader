---
name: DeepReader-dr-services
description: Use when working with the services module of DeepReader — 管理 Obsidian 插件的前端服务层，包括上下文管理、摘录保存、Markdown 导出、阅读模式、阅读入口和 Excalidraw 集成
---

# DeepReader Services Module

## 模块概述

Services 模块是 DeepReader Obsidian 插件的前端服务层，负责管理与 Obsidian 的交互、文档处理、阅读体验和可视化功能。该模块包含 6 个核心服务类，每个服务都专注于特定的功能领域，通过依赖注入 Obsidian `App` 实例来访问 Vault API。

### 模块位置
`/Users/lizhao/workspace/DeepReader/frontend/src/services/`

### 核心服务清单

| 服务 | 文件 | 职责 |
|------|------|------|
| ContextManager | context-manager.ts | 管理对话上下文中的已加载文档 |
| ExcerptService | excerpt-service.ts | 保存 AI 回复内容为 Obsidian 笔记摘录 |
| MarkdownExporter | markdown-exporter.ts | 将 PDF/EPUB 索引导出为 Markdown 文件 |
| ReadingModeService | reading-mode-service.ts | 管理章节文件的沉浸式阅读体验 |
| ReadingPortalService | reading-portal.ts | 管理阅读入口文档和书籍笔记 |
| ExcalidrawService | excalidraw-service.ts | Canvas 到 Excalidraw 的转换与可视化 |

---

## 1. 模块目的与能力

### ContextManager（上下文管理器）

**目的**：管理已加载到对话上下文的 Obsidian 文档，支持"章节辅助阅读"功能。

**核心能力**：
- 加载当前活跃文档到上下文
- 通过路径加载指定文档
- 限制上下文大小（默认 50000 字符）
- 追踪文档加载来源（current/mention/wikilink）
- 生成合并后的上下文内容供后端使用

**公共 API**：
```typescript
class ContextManager {
  constructor(options: ContextManagerOptions)
  loadCurrentDocument(): Promise<LoadedDocument | null>
  loadByPath(path: string, source?: 'current' | 'mention' | 'wikilink'): Promise<LoadedDocument | null>
  removeDocument(path: string): void
  clearAll(): void
  getLoadedDocuments(): Map<string, LoadedDocument>
  getLoadedDocumentsArray(): LoadedDocument[]
  getTotalCharCount(): number
  hasDocuments(): boolean
  hasDocument(path: string): boolean
  getCombinedContext(): string
  getStats(): ContextStats
}
```

### ExcerptService（摘录服务）

**目的**：将 AI 回复内容或阅读选中的文本保存为格式化的 Obsidian 笔记摘录。

**核心能力**：
- 按书籍和日期组织摘录文件
- 使用 Obsidian callout 美化摘录格式
- 支持用户笔记作为标题
- 自动创建目录结构

**公共 API**：
```typescript
class ExcerptService {
  constructor(app: App)
  saveExcerpt(content: ExcerptContent, metadata: ExcerptMetadata, options?: ExcerptOptions): Promise<string | null>
  getExcerptPath(sourcePdf: string): string
  getDefaultExcerptPath(): Promise<string>
}
```

### MarkdownExporter（Markdown 导出器）

**目的**：将 PDF/EPUB 索引结构导出为 Obsidian 可用的 Markdown 文件，支持分片、图片下载和 block_id 映射。

**核心能力**：
- 导出索引节点为 Markdown 文件
- 按字符数自动切分长章节（目标 4000，最大 6000 字符）
- 下载 EPUB 内嵌图片到 Vault
- 生成书籍主 note 文件（含 Base 代码块章节列表）
- 处理物理页码标记转换为标题

**公共 API**：
```typescript
// 主导出函数
async function exportIndexToMarkdown(
  app: App,
  pdfName: string,
  nodes: NodeData[],
  indexId: string,
  outputFolder?: string,
  author?: string
): Promise<ExportResult>
```

### ReadingModeService（阅读模式服务）

**目的**：为 DeepReader 导出的章节文件提供沉浸式阅读体验，包括章节导航和文本选择工具栏。

**核心能力**：
- 自动检测章节文件（检查 frontmatter 中的 pdf_name 和 node_id）
- 切换到阅读视图
- 章节间导航（上一章/下一章）
- 选中文本工具栏（引用/摘录/高亮）
- 自动/手动启用阅读模式

**公共 API**：
```typescript
class ReadingModeService {
  constructor(app: App, callbacks?: ReadingModeCallbacks)
  setCallbacks(callbacks: ReadingModeCallbacks): void
  setAutoEnable(value: boolean): void
  getAutoEnable(): boolean
  isChapterFile(file: TFile): boolean
  activate(file: TFile): void
  deactivate(): void
  start(): void
  stop(): void
  getCurrentFile(): TFile | null
  getCurrentIndexId(): string | null
  getChapterNavigation(): ChapterNavigation | null
  navigateToPrev(): Promise<boolean>
  navigateToNext(): Promise<boolean>
  markExcerpt(range: Range): void
}
```

### ReadingPortalService（阅读入口服务）

**目的**：管理 DeepReader 阅读入口文档和书籍笔记，追踪阅读进度和元数据。

**核心能力**：
- 创建/打开阅读入口文档（📚 阅读入口.md）
- 创建书籍笔记文件（含 frontmatter 元数据）
- 下载书籍封面到本地
- 同步所有索引到书籍笔记
- 更新阅读进度
- 书单/标签过滤

**公共 API**：
```typescript
class ReadingPortalService {
  constructor(app: App, client: DeepPDFClient)
  downloadBookCover(indexId: string, pdfName: string): Promise<string | null>
  syncAllIndexes(): Promise<number>
  openReadingPortal(): Promise<void>
  ensureBookNote(indexId: string, bookName: string, totalPages: number): Promise<string>
  updateBookProgress(bookName: string, progress: ReadingProgress): Promise<void>
  updateBookCover(bookName: string, coverLink: string): Promise<void>
  getAllBooksMetadata(): Promise<Map<string, { booklists: string[]; tags: string[] }>>
  getBookMetadata(bookName: string): Promise<{ author?: string; booklists: string[]; tags: string[] } | null>
  filterIndexIdsByMetadata(options: { booklists?: string[]; tags?: string[] }): Promise<string[]>
  getAllBooklists(): Promise<string[]>
  getAllTags(): Promise<string[]>
}
```

### ExcalidrawService（Excalidraw 集成服务）

**目的**：提供 Canvas 数据到 Excalidraw 的转换功能，支持思维导图和知识图谱的创建。

**核心能力**：
- 检查 Excalidraw 插件可用性和版本
- Canvas 数据转换为 Excalidraw 文件
- 从 Canvas 文件读取并转换
- 快速创建思维导图（放射状布局）
- 创建知识图谱（网格布局）
- 从概念关系数据创建可视化

**公共 API**：
```typescript
class ExcalidrawService {
  constructor(options: ExcalidrawServiceOptions)
  getAPI(): ExcalidrawAutomate | null
  checkAvailability(): boolean
  convertCanvasToExcalidraw(canvasData: CanvasData, filename: string, folder?: string): Promise<CanvasToExcalidrawResult>
  convertFromCanvasFile(canvasPath: string, outputPath?: string): Promise<CanvasToExcalidrawResult>
  createMindmap(topic: string, branches: Array<{ label: string; children?: string[] }>, filename: string): Promise<CanvasToExcalidrawResult>
  createKnowledgeGraph(nodes: Array<{...}>, edges: Array<{...}>, filename: string): Promise<CanvasToExcalidrawResult>
  createFromConceptData(data: { topic: string; concepts: Array<{...}>; relations: Array<{...}> }, filename: string): Promise<CanvasToExcalidrawResult>
}
```

---

## 2. 核心设计逻辑

### 为什么采用服务类模式？

**设计决策**：每个服务都是独立的类，通过构造函数接收 Obsidian `App` 实例。

**原因**：
1. **依赖注入**：Obsidian 插件的 API（vault、workspace、metadataCache 等）都通过 `App` 实例访问，注入模式便于测试和复用
2. **状态隔离**：服务可以维护自己的内部状态（如 `ContextManager.loadedDocs`），而不污染全局
3. **生命周期管理**：服务可以在插件启动时初始化，在插件卸载时清理（如 `ReadingModeService.start()/stop()`）

### 为什么 MarkdownExporter 使用函数而非类？

**设计决策**：`exportIndexToMarkdown` 是独立函数，而非类方法。

**原因**：
1. **无状态操作**：导出是一次性操作，不需要维护中间状态
2. **辅助函数复用**：`parseParagraphsFromText`、`splitParagraphsBySize` 等辅助函数可以独立测试
3. **简化调用**：调用方无需实例化，直接调用函数即可

### 上下文大小限制的设计

**设计决策**：`ContextManager` 默认限制上下文为 50000 字符。

**原因**：
1. **后端限制**：AI 模型的上下文窗口有限，需要控制发送的内容量
2. **用户体验**：过多文档会导致响应变慢和成本增加
3. **可配置性**：通过 `maxContextChars` 参数允许用户调整

### Markdown 分片策略

**设计决策**：长章节按目标 4000、最大 6000 字符切分，保持段落完整性。

**原因**：
1. **段落边界**：不切断段落，保持语义完整性
2. **双阈值**：目标值用于正常切分，最大值防止边界情况
3. **block_id 映射**：每个分片都维护 block_id 到文件路径的映射，支持精确引用

### 阅读模式的自动启用机制

**设计决策**：`ReadingModeService` 默认自动启用，但可通过 `setAutoEnable(false)` 关闭。

**原因**：
1. **默认最佳体验**：大多数用户希望打开章节文件时自动进入阅读模式
2. **灵活性**：高级用户可能需要编辑章节文件，允许关闭自动启用
3. **检测逻辑**：通过 frontmatter 中的 `pdf_name` 和 `node_id` 准确识别章节文件

---

## 3. 核心数据结构

### LoadedDocument（已加载文档）
**定义位置**：`context-manager.ts:12-25`

```typescript
interface LoadedDocument {
  path: string;          // 文件路径
  name: string;          // 显示名称
  content: string;       // 文件内容
  charCount: number;     // 字符数
  source: 'current' | 'mention' | 'wikilink';  // 加载方式
  loadedAt: Date;        // 加载时间
}
```

### ExcerptContent / ExcerptMetadata（摘录内容与元数据）
**定义位置**：`types/excerpt.ts:8-53`

```typescript
interface ExcerptContent {
  text: string;              // 摘录文本内容
  rawMarkdown?: string;      // 原始 Markdown（可选）
}

interface ExcerptMetadata {
  sourcePdf: string;         // 来源 PDF/EPUB 文件名
  page?: number;             // 页码（PDF）
  question?: string;         // 用户的问题
  createdAt: string;         // 创建时间
  userNote?: string;         // 用户笔记
  backlink?: string;         // 双向链接
  conversationId?: string;   // 对话 ID
  messageId?: string;        // 消息 ID
  chapterPath?: string;      // 章节文件路径
  chapterName?: string;      // 章节名称
  sourceType?: 'reading' | 'chat';  // 摘录来源类型
}
```

### NodeData（节点数据）
**定义位置**：`markdown-exporter.ts:13-23`

```typescript
interface NodeData {
  node_id: string;           // 节点唯一标识
  node_name: string;         // 节点名称
  section: string;           // 章节标题
  page_range: string;        // 页码范围
  start_index: number | string;  // 起始索引
  end_index: number | string;    // 结束索引
  level: number;             // 层级
  text: string;              // 文本内容
  summary?: string;          // 章节摘要
}
```

### ExportResult（导出结果）
**定义位置**：`markdown-exporter.ts:28-34`

```typescript
interface ExportResult {
  success: boolean;
  filesCreated: number;
  fileMapping: Record<string, string>;  // node_id -> 主文件路径
  blockMapping: Record<string, Record<string, string>>;  // node_id -> {block_id -> file_path}
  error?: string;
}
```

### ChapterNavigation（章节导航）
**定义位置**：`reading-mode-service.ts:19-25`

```typescript
interface ChapterNavigation {
  prev: TFile | null;        // 上一章文件
  next: TFile | null;        // 下一章文件
  current: TFile;            // 当前文件
  total: number;             // 总章节数
  currentIndex: number;      // 当前索引（1-based）
}
```

### ReadingModeCallbacks（阅读模式回调）
**定义位置**：`reading-mode-service.ts:11-17`

```typescript
interface ReadingModeCallbacks {
  onQuote: (text: string) => void;
  onExcerpt: (text: string, range: Range) => void;
  onSaveHighlight?: (text: string, color: HighlightColorId) => Promise<void>;
  onRemoveHighlight?: (text: string) => Promise<void>;
  onBookDetected?: (indexId: string, bookName: string) => void;
}
```

### CanvasNode / CanvasEdge / CanvasData（Canvas 数据）
**定义位置**：`excalidraw-service.ts:23-50`

```typescript
interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number; y: number;
  width: number; height: number;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
  label?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  color?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
```

### CanvasToExcalidrawResult（转换结果）
**定义位置**：`types/excalidraw.d.ts:355-366`

```typescript
interface CanvasToExcalidrawResult {
  success: boolean;
  filePath?: string;    // 创建的 Excalidraw 文件路径
  error?: string;
  nodeCount?: number;   // 创建的节点数量
  edgeCount?: number;   // 创建的连接数量
}
```

---

## 4. 状态流

### ContextManager 状态流

```
用户操作 → loadCurrentDocument() / loadByPath()
    ↓
检查文档是否已加载 → 是 → 返回已缓存的文档
    ↓ 否
检查上下文大小限制 → 超限 → 显示 Notice，返回 null
    ↓ 未超限
读取文件内容 → 创建 LoadedDocument 对象
    ↓
存入 loadedDocs Map → 触发 onContextChange 回调
    ↓
返回 LoadedDocument
```

**关键状态变化**：
- `loadedDocs: Map<string, LoadedDocument>` — 核心状态
- `notifyChange()` — 触发 UI 更新

### MarkdownExporter 导出流程

```
exportIndexToMarkdown(app, pdfName, nodes, indexId, outputFolder, author)
    ↓
创建输出文件夹 → DeepReader/{书名}/
    ↓
收集所有节点中的图片引用
    ↓
下载 EPUB 图片到 Obsidian vault → DeepReader/images/{书名}/
    ↓
创建/更新书籍主 note 文件
    ↓
for each node:
    ├─ 替换图片链接为 Obsidian 格式
    ├─ 解析段落并按字符数切分
    └─ for each paragraphGroup:
        ├─ 生成 Markdown 内容（含 frontmatter）
        ├─ 创建/修改文件
        └─ 记录 block_id 映射
    ↓
返回 ExportResult
```

**关键中间状态**：
- `imageMapping: Record<string, string>` — 图片文件名到 Obsidian 路径的映射
- `fileMapping: Record<string, string>` — node_id 到主文件路径的映射
- `blockMapping: Record<string, Record<string, string>>` — block_id 精确定位

### ReadingModeService 生命周期

```
插件启动 → new ReadingModeService(app, callbacks)
    ↓
start() → 初始化 SelectionToolbar + ChapterNav
    ↓
注册 file-open 事件监听
    ↓
[用户打开文件] → file-open 事件触发
    ↓
isChapterFile(file) 检查
    ├─ 是章节文件 + autoEnable → activate(file)
    │   ├─ 切换到阅读视图
    │   ├─ 添加 CSS 类
    │   ├─ 更新章节导航
    │   └─ 触发 onBookDetected 回调
    └─ 不是章节文件 → deactivate()
    ↓
插件卸载 → stop() → 清理事件监听和 UI 组件
```

### ExcerptService 保存流程

```
saveExcerpt(content, metadata, options)
    ↓
确定目标文件路径 → getExcerptPath(metadata.sourcePdf)
    ↓
ensureExcerptFile() → 递归创建文件夹和文件
    ↓
formatExcerpt() → 生成 Obsidian callout 格式
    ↓
追加到目标文件 → vault.modify() 或 vault.create()
    ↓
返回文件路径
```

---

## 5. 常见修改场景

### 场景 1：增加上下文大小限制的可配置性

**目标**：让用户可以在设置中调整上下文大小限制。

**修改文件**：`context-manager.ts`

**关键位置**：
- 构造函数第 64 行：`this.maxContextChars = options.maxContextChars || 50000;`
- 第 121 行限制检查：`if (currentSize + content.length > this.maxContextChars)`

**修改步骤**：
1. 在插件设置中添加 `maxContextChars` 配置项
2. 在 `SidebarView` 创建 `ContextManager` 时传入用户配置值
3. （可选）添加实时统计显示，让用户了解当前使用量

### 场景 2：自定义摘录格式

**目标**：修改摘录的 callout 样式或添加新的元数据字段。

**修改文件**：`excerpt-service.ts`

**关键位置**：
- 第 143-197 行 `formatExcerpt()` 方法 — 格式化摘录内容
- 第 157-158 行 callout 类型选择

**修改步骤**：
1. 修改 `calloutTypes` 数组来改变可选样式
2. 在 `formatExcerpt()` 中添加新的元数据字段（如 `tags`、`importance`）
3. 更新 `ExcerptMetadata` 类型定义（`types/excerpt.ts`）

### 场景 3：支持新的导出格式

**目标**：在 Markdown 导出时支持额外的格式化选项（如不同的 frontmatter 结构）。

**修改文件**：`markdown-exporter.ts`

**关键位置**：
- 第 195-273 行 `createMarkdownContent()` 函数 — 生成 Markdown 内容
- 第 206-239 行 frontmatter 构建

**修改步骤**：
1. 添加新的配置参数到 `exportIndexToMarkdown` 函数签名
2. 修改 `createMarkdownContent()` 中的 frontmatter 构建逻辑
3. （可选）添加新的辅助函数处理特殊格式需求

### 场景 4：扩展阅读模式的章节检测逻辑

**目标**：支持其他类型的文件作为"章节文件"（如来自其他插件的文件）。

**修改文件**：`reading-mode-service.ts`

**关键位置**：
- 第 95-116 行 `isChapterFile()` 方法

**修改步骤**：
1. 修改检测条件（如放宽路径限制，添加其他 frontmatter 字段检查）
2. 确保新检测逻辑与 `notifyBookDetected()` 中的元数据提取兼容
3. 更新相关测试

### 场景 5：添加新的 Excalidraw 可视化类型

**目标**：支持新的图形类型（如流程图、时间线）。

**修改文件**：`excalidraw-service.ts`

**关键位置**：
- 第 370-472 行 `createMindmap()` — 参考实现
- 第 506-576 行 `createKnowledgeGraph()` — 参考实现

**修改步骤**：
1. 添加新的公共方法（如 `createFlowchart()` 或 `createTimeline()`）
2. 实现布局算法（可参考 `calculateGridLayout()` 的模式）
3. 使用 `ea.addText()`、`ea.connectObjects()` 等 API 构建图形
4. 返回 `CanvasToExcalidrawResult` 结构

### 场景 6：修改书籍笔记的默认结构

**目标**：更改自动生成的书籍笔记文件内容。

**修改文件**：`reading-portal.ts`

**关键位置**：
- 第 223-267 行 `generateBookNoteContent()` 方法

**修改步骤**：
1. 修改 frontmatter 字段（添加/删除/重命名）
2. 修改正文模板（如添加新的章节、更改格式）
3. 确保 `updateBookProgress()` 中的字段更新与新结构兼容

---

## 6. 依赖关系

### 外部依赖

| 依赖 | 用途 |
|------|------|
| `obsidian` | Obsidian 插件 API（App, TFile, Notice 等）|
| `../api/http-client` | DeepPDF 后端 API 客户端 |
| `../utils/logger` | 日志工具 |
| `../types/excerpt` | 摘录相关类型 |
| `../types/excalidraw.d` | Excalidraw API 类型 |
| `../components/reading-mode/*` | 阅读模式 UI 组件 |

### 服务间依赖

```
ReadingPortalService ──依赖──> DeepPDFClient (API 客户端)
         │
         └── 被依赖 ──> SidebarView

ReadingModeService ──依赖──> SelectionToolbar
         │              ChapterNav
         │
         └── 被依赖 ──> main.ts (插件主类)

ExcerptService ──被依赖──> ExcerptModal

ExcalidrawService ──被依赖──> canvas.ts (Agent Tool)
                          main.ts (命令)

ContextManager ──被依赖──> SidebarView

MarkdownExporter ──被依赖──> 导出命令/API 调用
```

---

## 7. 文件索引

| 文件 | 行数 | 主要导出 |
|------|------|----------|
| `context-manager.ts` | 229 | `ContextManager`, `LoadedDocument`, `ContextManagerOptions`, `ContextStats` |
| `excerpt-service.ts` | 215 | `ExcerptService` |
| `markdown-exporter.ts` | 635 | `exportIndexToMarkdown`, `NodeData`, `ExportResult` |
| `reading-mode-service.ts` | 368 | `ReadingModeService`, `ReadingModeCallbacks`, `ChapterNavigation` |
| `reading-portal.ts` | 496 | `ReadingPortalService` |
| `excalidraw-service.ts` | 715 | `ExcalidrawService`, `ExcalidrawServiceOptions` |
