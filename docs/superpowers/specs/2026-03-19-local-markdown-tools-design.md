
# 本地 Markdown 探索工具设计

> 替代后端依赖的 `get_toc` / `search_doc`，实现零外部依赖的本地化智能阅读

## 1. 背景与动机

### 问题
- 当前 `get_toc` 和 `search_doc` 依赖后端 API
- 本地 Markdown 文件已包含完整的书籍结构（大纲、摘要、正文）
- 后端依赖增加了系统复杂度和响应延迟

### 解决方案
设计 3 个本地 Markdown 探索工具，让 Agent 像使用 CLI 一样主动探索书籍内容：
- **消除黑盒**：Agent 主动驾驶，知道自己读到哪
- **上下文完整**：按 Markdown 结构读取，不被截断
- **零外部依赖**：完全基于 Obsidian API

---

## 2. 核心设计决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 数据范围 | 单本书 | 符合"分析阅读"专注模式，后续可扩展 |
| 搜索算法 | 纯文本 AND + 显式正则 | 标定摩擦力，逼迫 Agent 优化搜索策略 |
| 读取范围 | 含子级 + 超限截断 | 保证语义完整性，防止 Token 爆炸 |
| 工具关系 | 完全替换旧工具 | 简化架构，减少维护负担 |

---

## 2.1 术语定义

| 术语 | 定义 | 示例 |
|------|------|------|
| `node_id` | Frontmatter 中的章节标识 | `0006` |
| `block_id` | Markdown 行内块引用 | `^ch2-p1` |
| `section` | 章节路径 | `"第一篇 > 第一章 > MECE"` |
| `level` | 标题级别 | `0` = H1, `1` = H2 |
| **段落** | 以 `\n\n` 分割的文本块，可包含多个 block | - |

**关系**：一个 `node`（章节）可包含多个 `block`（行级引用）

---

## 3. 工具详细设计

### 3.1 `get_document_outline` - 获取文档大纲

**对标**：Linux `tree` / `ls`

**LLM 工具描述**：
```
【检视阅读】获取当前书籍的目录大纲。用于了解书籍整体结构、定位章节。
- 无参数：返回完整层级树
- max_depth: 限制层级深度（如 max_depth=2 只显示到 H2）
```

**入参**：
```typescript
interface GetOutlineArgs {
  // 可选：只获取指定层级以上的大纲（1=H1, 2=H2...）
  max_depth?: number;
}
```

**出参**：
```typescript
interface OutlineResult {
  status: "SUCCESS";
  book_title: string;
  outline: OutlineNode[];
}

interface OutlineNode {
  heading: string;        // 如 "## 第一篇 阅读的层次"
  line: number;           // 行号
  summary?: string;       // 章节摘要（从 frontmatter 提取）
  block_id?: string;      // 块引用 ID
  children?: OutlineNode[];
}
```

**数据来源**：
- 遍历 `DeepReader/{bookName}/*.md` 文件
- 从每个文件的 frontmatter 提取 `summary`、`node_id`、`section`、`level`
- 按 `section` 路径重建层级树

---

### 3.2 `search_markdown_text` - 带空间感知的文本搜索

**对标**：增强版 Linux `grep`

**LLM 工具描述**：
```
【检视阅读】在当前书籍中搜索文本。用于定位关键词出现的章节位置。
- keywords: 关键词数组（AND 逻辑，必须同时出现在同一段落）
- use_regex: 是否启用正则表达式（默认 false，搜索失败时可开启）

【摩擦力】如果命中超过 10 处，返回 ERROR_TOO_BROAD，请换更精准的词。
```

**入参**：
```typescript
interface SearchArgs {
  // 关键词数组（AND 逻辑，必须同时出现在同一段落）
  keywords: string[];

  // 是否启用正则表达式（默认 false）
  use_regex?: boolean;
}
```

**出参**：
```typescript
interface SearchResult {
  status: "SUCCESS" | "ERROR_NOT_FOUND" | "ERROR_TOO_BROAD" | "ERROR_FILE_READ_FAILED";
  hits?: SearchHit[];
  total_hits?: number;
  message?: string;  // 错误时提供提示
  suggestions?: string[];  // ERROR_NOT_FOUND 时的近似词建议
}

interface SearchHit {
  location: {
    heading: string;      // 当前标题
    path: string[];       // ["第二章", "MECE 原则"]
    file_path: string;    // 完整文件路径
  };
  line_number: number;
  snippet: string;        // 匹配上下文（约 100 字）
  block_id: string;
}
```

**搜索算法**：
1. **阶段一（默认）**：纯文本 AND 匹配
   - 多个关键词必须同时出现在同一段落
   - 使用 `indexOf` 快速扫描
2. **阶段二（显式开启）**：正则表达式
   - Agent 主动设置 `use_regex: true`
   - 支持复杂模式匹配

**摩擦力机制**：
- 命中超过 10 处时返回 `ERROR_TOO_BROAD`
- 强迫 Agent 换更精准的词或使用正则
- `ERROR_NOT_FOUND` 时返回 `suggestions`（基于编辑距离的近似词）

---

### 3.3 `read_markdown_section` - 按标题读取完整章节

**对标**：智能版 Linux `cat` / `less`

**LLM 工具描述**：
```
【分析阅读】读取指定章节的完整内容。用于精读某个小节。
- heading: 标题名称（包含匹配，如 "MECE" 可匹配 "### MECE 原则"）
- block_id: 块引用 ID（如 "^ch2-p1"，自动定位到包含该块的章节）
二选一，优先 heading。
```

**入参**：
```typescript
interface ReadSectionArgs {
  // 标题名称（包含匹配，支持空格/符号容错）
  heading?: string;

  // 或通过 block_id 定位（自动定位到包含该 block 的章节）
  block_id?: string;
}
```

**出参（正常）**：
```typescript
interface ReadResultSuccess {
  status: "SUCCESS_FULL_SECTION";
  heading: string;
  word_count: number;
  token_estimate: number;  // Token 估算（中文 ≈ 字数/2）
  content: string;         // 完整 Markdown 文本（含所有子级）
  sibling_sections?: {     // 相邻章节（用于跨章节上下文）
    prev?: { heading: string; block_id: string };
    next?: { heading: string; block_id: string };
  };
}
```

**出参（超限截断）**：
```typescript
interface ReadResultTooLarge {
  status: "WARNING_SECTION_TOO_LARGE";
  message: string;
  word_count: number;
  token_estimate: number;
  overview_text: string;   // 当前层级直属正文（前 800 字）
  sub_headings: {
    heading: string;
    line: number;
    block_id?: string;
  }[];
}
```

**出参（错误）**：
```typescript
interface ReadResultError {
  status: "ERROR_NOT_FOUND" | "ERROR_INVALID_PARAMS" | "ERROR_MULTIPLE_MATCHES" |
          "ERROR_FILE_READ_FAILED" | "ERROR_INVALID_FRONTMATTER" | "ERROR_NO_APP_CONTEXT";
  message: string;
  candidates?: string[];  // ERROR_MULTIPLE_MATCHES 时的候选列表
}
```

**防爆阀机制**：
- Token 上限：**4000 tokens**（约 6000 中文字）
- 超限时返回截断内容 + 子标题地图
- 逼迫 Agent 渐进式展开（Progressive Disclosure）

**heading 匹配规则**：
1. 优先精确匹配
2. 失败后尝试包含匹配（去除空格、标点差异）
3. 命中多个时返回 `ERROR_MULTIPLE_MATCHES` + 候选列表

---

## 4. 数据流设计

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent (S2 分析阅读舱)                    │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│get_document_    │ │search_markdown_ │ │read_markdown_   │
│    outline      │ │     text        │ │    section      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  DeepReader/{bookName}/*.md   │
              │  (Obsidian Vault API)         │
              └───────────────────────────────┘
```

---

## 5. 典型工作流示例

**用户提问**：「作者在讲 MECE 原则时，提到了哪些前置条件？」

```
1. Agent: search_markdown_text({ keywords: ["MECE前置条件"] })
   → ERROR_NOT_FOUND

2. Agent: search_markdown_text({ keywords: ["MECE"] })
   → SUCCESS: 3 hits，核心在 "## 第二章 > ### MECE 的应用"

3. Agent: read_markdown_section({ heading: "### MECE 的应用" })
   → SUCCESS_FULL_SECTION: 600 字完整内容

4. Agent: 阅读完毕，提取答案，向用户输出
```

---

## 6. 实现要点

### 6.1 ToolContext 映射

```typescript
// 新工具从 context 获取必要数据
const bookName = context.pdfName;  // 复用现有字段（如 "如何阅读一本书"）
const app = context.app;           // 必须，否则抛出 ERROR_NO_APP_CONTEXT

if (!app) {
  return { status: "ERROR_NO_APP_CONTEXT", message: "缺少 Obsidian App 实例" };
}
```

### 6.2 文件扫描与缓存

**问题**：每次搜索全量扫描 100+ 文件有性能问题

**解决方案**：在 `ToolContext` 中添加缓存层

```typescript
// 扩展 ToolContext
interface LocalToolCache {
  // 文件列表缓存（首次调用时填充）
  chapterFiles?: TFile[];

  // block_id → 文件路径 映射（首次调用时构建）
  blockIdIndex?: Map<string, string>;

  // 标题 → 文件路径 映射
  headingIndex?: Map<string, string>;
}

// 首次调用时构建索引
function buildCache(app: App, bookName: string): LocalToolCache {
  const files = app.vault.getMarkdownFiles()
    .filter(f => f.path.startsWith(`DeepReader/${bookName}/`));

  const blockIdIndex = new Map<string, string>();
  const headingIndex = new Map<string, string>();

  for (const file of files) {
    // 从 frontmatter 提取 node_id 映射
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.node_id) {
      headingIndex.set(cache.frontmatter.node_id, file.path);
    }
    // 从正文提取 block_id 映射
    const content = app.vault.cachedRead(file);
    const blockMatches = content.matchAll(/\^[\w-]+/g);
    for (const match of blockMatches) {
      blockIdIndex.set(match[0], file.path);
    }
  }

  return { chapterFiles: files, blockIdIndex, headingIndex };
}
```

### 6.3 Frontmatter 字段提取

| 字段 | 用途 | 示例 |
|------|------|------|
| `summary` | 章节摘要 | "本章探讨了..." |
| `node_id` | 章节标识 | `0006` |
| `section` | 层级路径 | `"第一篇 > 第一章"` |
| `level` | 标题级别 | `0`=H1, `1`=H2 |
| `page_range` | 页码范围 | `"5-6"` |
| `part` | 分块信息 | `"1/3"` |

### 6.4 段落分割与搜索

**段落定义**：以 `\n\n`（双换行）分割的文本块

```typescript
// 一个段落可能包含多个 block 引用
const paragraphs = content.split(/\n\n+/);

// AND 匹配：所有关键词必须同时出现在同一段落
function matchParagraph(para: string, keywords: string[]): boolean {
  return keywords.every(kw => para.includes(kw));
}
```

### 6.5 block_id 定位逻辑

```typescript
// 从 block_id 反向定位章节
function locateSectionByBlockId(
  blockId: string,
  blockIdIndex: Map<string, string>
): { filePath: string; heading: string } | null {
  const filePath = blockIdIndex.get(blockId);
  if (!filePath) return null;

  // 解析文件路径提取章节信息
  // 如 "DeepReader/如何阅读一本书/04-第一章 阅读的活力与艺术.md"
  const fileName = filePath.split('/').pop() || '';
  const heading = fileName.replace(/^\d+-/, '').replace('.md', '');

  return { filePath, heading };
}
```

### 6.6 标题树构建
- 从 `section` 字段解析层级路径（如 `"第一篇 > 第一章 > MECE"`）
- 使用 `level` 字段确定标题级别
- 按 `part` 排序同一章节的分块文件

---

## 7. 迁移计划

### 7.1 删除的文件
- `frontend/src/agent/tools/get-toc.ts`
- `frontend/src/agent/tools/search-doc.ts`

### 7.2 新增的文件
- `frontend/src/agent/tools/local/get-outline.ts`
- `frontend/src/agent/tools/local/search-text.ts`
- `frontend/src/agent/tools/local/read-section.ts`
- `frontend/src/agent/tools/local/utils.ts` (共享工具函数)
- `frontend/src/agent/tools/local/index.ts` (统一导出)

### 7.3 修改的文件

**`frontend/src/agent/tools/index.ts`**
- 移除旧工具的导入和注册
- 注册新的 3 个本地工具

**`frontend/src/views/sidebar-view.ts`**
- 移除 `currentMarkdownFiles` 的后端获取逻辑（不再调用 `getIndexStatus`）
- 保留 `currentMarkdownFiles` 变量，但改为从本地扫描填充
- 确保 `ToolContext` 传入 `app` 实例

**`frontend/src/agent/context/builder.ts`**
- 更新 `buildConstraints()` 中的工具说明文案

### 7.4 迁移风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 返回格式不兼容 | Agent 行为变化 | 新工具设计时保持类似结构 |
| 本地文件不存在 | 搜索失败 | 降级提示用户先导出章节 |
| Token 消耗增加 | 大章节读取成本高 | 防爆阀机制限制 |

### 7.5 测试要点

1. **大纲获取**：验证多层级书籍的树结构正确性
2. **搜索精度**：验证 AND 逻辑和正则模式
3. **章节读取**：验证截断逻辑和子标题返回
4. **错误处理**：验证各种 ERROR 状态

---

## 8. 后续扩展

- [ ] 多书范围搜索（扩展 `book_names` 参数）
- [ ] 搜索历史缓存（提升重复查询性能）
- [ ] UI 展示 Agent 思考过程（调用链可视化）
