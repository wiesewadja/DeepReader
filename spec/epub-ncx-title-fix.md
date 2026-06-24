# EPUB NCX 标题修复方案

## 问题描述

EPUB 导出的 Markdown 文件名混乱，未使用 NCX TOC 中的正确章节标题。

**示例**（反脆弱 EPUB）：
- 错误：`01 - 反脆弱——从无序中受益[美] 纳西姆·尼古拉斯·塔勒布 著雨珂 译中信出版社.md`
- 正确：`01 - 反脆弱.md`

**根因分析**：

`parseEpub()` 函数有两个路径：
1. **NCX 策略路径**（930-965 行）：当 `splitStrategy === "ncxAnchors"` 时，使用 NCX 标题
2. **默认路径**（966-1098 行）：每个 spine item 一个章节，标题从 HTML 提取

问题：默认路径没有使用 NCX TOC 中的标题，而是依赖：
1. 优先 `<h1>-<h6>` 标签
2. 否则用 markdown 第一行

但很多 EPUB（如反脆弱）使用 `<blockquote>` + `<span>` 而非标准标题标签，导致提取到书名页、版权页等内容作为标题。

## 修复方案

### 方案 A：在默认路径中使用 NCX 标题（推荐）

**修改文件**：`src/pageindex/parsers/epub.ts`

**修改逻辑**：

1. 在 `parseEpub()` 开始时，无论是否使用 NCX 策略，都加载 NCX TOC
2. 构建 `href → title` 映射表
3. 在默认路径中，优先使用 NCX 标题，如果没有则回退到 HTML 提取

**代码改动**：

```typescript
// 在 parseEpub() 函数开头（约 708 行后）
// 加载 NCX TOC，构建 href → title 映射
const ncxEntries = parseNcxToc(zip, basePath);
const ncxTitleMap = new Map<string, string>();
for (const entry of ncxEntries) {
  const [file] = entry.src.split("#");
  const fullPath = path.join(basePath, file).replace(/\\/g, "/");
  // 只保留第一个标题（主标题）
  if (!ncxTitleMap.has(fullPath) && entry.text) {
    ncxTitleMap.set(fullPath, entry.text);
  }
}

// 在默认路径中（约 1035-1061 行）
// 修改标题提取逻辑
let chapterTitle: string;

// 1. 优先使用 NCX 标题
const ncxTitle = ncxTitleMap.get(href);
if (ncxTitle) {
  chapterTitle = cleanTitle(ncxTitle);
} else {
  // 2. 回退到 HTML 提取逻辑
  const headingLevelMatches = html.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);
  // ... 现有逻辑 ...
}
```

### 方案 B：增强策略推断（可选优化）

在 `inferStrategyFromZip()` 中，当检测到 HTML 没有 `<h1>-<h6>` 标签时，强制设置 `titleSource = "ncxText"`。

**修改文件**：`src/pageindex/parsers/epub-structure-sampler.ts`

**修改逻辑**：

```typescript
// 在 inferStrategyFromZip() 函数中（约 280-290 行）
let titleSource: EpubParsingStrategy["titleSource"];
if (
  headingDetection === "ncxOnly" ||  // HTML 没有标题标签
  htmlStructure === "bulkPdf" ||
  ncxCount > spineIds.length * 2
) {
  titleSource = "ncxText";  // 强制使用 NCX 标题
} else {
  titleSource = "hTag";
}
```

### 方案 C：过滤噪音页面（补充优化）

在默认路径中，跳过明显是书名页、版权页的章节。

**修改文件**：`src/pageindex/parsers/epub.ts`

**修改逻辑**：

```typescript
// 在默认路径中，提取标题后（约 1063 行前）
// 跳过噪音页面
const noiseKeywords = ["书名页", "版权页", "扉页", "目录",
  "版权信息", "图书在版编目", "CIP", "献给"];
if (noiseKeywords.some(kw => chapterTitle.includes(kw))) {
  order++;
  continue;
}
```

## 实施计划

1. **Phase 1**：实现方案 A（核心修复）
   - 修改 `parseEpub()` 加载 NCX TOC
   - 修改默认路径使用 NCX 标题
   - 添加噪音页面过滤

2. **Phase 2**：验证修复
   - 使用反脆弱 EPUB 测试
   - 验证文件名是否正确
   - 验证内容是否完整

3. **Phase 3**：优化（可选）
   - 实现方案 B（增强策略推断）
   - 添加更多噪音关键词

## 测试用例

1. **反脆弱 EPUB**：
   - 期望：文件名使用 NCX 标题（如 `01 - 反脆弱.md`）
   - 验证：MOC 中的章节标题正确

2. **其他 EPUB**：
   - 测试有标准 `<h1>-<h6>` 标签的 EPUB
   - 测试有 NCX TOC 但无标题标签的 EPUB
   - 测试无 NCX TOC 的 EPUB

## 风险评估

- **低风险**：修改仅影响 EPUB 解析逻辑
- **向后兼容**：对于已有标准标题标签的 EPUB，逻辑不变
- **依赖关系**：无新增依赖

## 预期效果

修复后，EPUB 导出的 Markdown 文件名将使用 NCX TOC 中的正确标题，与图片中的目录结构一致。
