# Highlight 与 Excerpt 服务

> 阅读体验核心交互——**Highlight**（用户高亮 + 块 ID 关联 + 5 色主题）
> + **Excerpt**（AI 回答导出为 Obsidian 笔记 + 目标文件路径生成）。
>
> 配套阅读：[系统鸟瞰.md 第 2 层 UI 层"ReadingMode Service"](../architecture/系统鸟瞰.md#layers)、
> [书籍索引系统.md §Markdown 导出](./书籍索引系统.md)（书籍被阅读时）、
> [features/reading.md F-17~F-21](../features/reading.md)（产品视角）。

---

## 目录

1. [设计意图：阅读的"动作" 层](#why)
2. [Highlight：5 色 + block_id 反向关联](#highlight)
3. [Excerpt：AI 回答保存为笔记](#excerpt)
4. [与 ReadingMode UI 集成](#integration)
5. [关键源文件](#files)
6. [已知限制](#limitations-inference)

## 设计意图 (why)

DeepReader 的"阅读" = **被动看 + 主动标 + 二次创作**：

- **被动看**（ReadingMode Service）—— 系统展示书内容
- **主动标**（Highlight）—— 用户划词 + 高亮 + block_id 自动生成
- **二次创作**（Excerpt）—— AI 回答保存为可被引用的笔记

**Highlight 与 Excerpt 的边界**：

| 维度 | Highlight | Excerpt |
|---|---|---|
| 触发 | 用户主动 | 用户主动（"保存到笔记"按钮） |
| 内容 | 原文片段 | AI 回答 + 引用块 |
| 存储 | 书的 .md 文件（追加 `==xxx==`） | 新 .md 文件（`DeepReader/Excerpts/`） |
| 块 ID | 自动生成 `^h-{uuid}` | 复用引用块的 `^block_id` |
| 颜色 | 5 色 | N/A |

---

## Highlight

**位置**：`src/services/highlight-service.ts`（177 行）

### 5 色主题

```typescript
const HIGHLIGHT_COLORS: Record<HighlightColorId, string> = {
  yellow: 'rgba(255, 235, 59, 0.4)',
  green:  'rgba(76, 175, 80, 0.4)',
  blue:   'rgba(33, 150, 243, 0.4)',
  pink:   'rgba(233, 30, 99, 0.4)',
  orange: 'rgba(255, 152, 0, 0.4)',
};
```

**5 色** + 透明背景（`0.4` alpha）—— 视觉舒适，不抢文字焦点。

### 核心流程

```
用户在 ReadingMode 选中文字
  └─→ ReadingMode Service 捕获选区
        └─→ HighlightService.addHighlight(text, color)
              ├─→ findBlockIdNearText(content, position)
              ├─→ 生成 markdown: ==text== ^h-{uuid}
              ├─→ 追加到原书 .md 文件
              └─→ 写 HighlightColorId + ExcerptMetadata 到 .highlights/
```

### 块 ID 反向关联

**关键函数**：`findBlockIdNearText(content, position)`

```typescript
function findBlockIdNearText(content, position): string | null {
  // 向前 500 字搜 ^block_id
  const forward = content.substring(position, Math.min(position + 500, content.length));
  const fwdMatch = forward.match(/\^([a-zA-Z0-9_-]+)/);
  if (fwdMatch) return fwdMatch[1];

  // 向后 500 字搜
  const backward = content.substring(Math.max(0, position - 500), position);
  const bwdMatch = backward.match(/\^([a-zA-Z0-9_-]+)/);
  return bwdMatch?.[1] ?? null;
}
```

**为什么前后 500 字**——用户高亮的可能**正好在两个 block_id 之间**（前 500 或后 500 找一个最接近的）。

### 元数据

```typescript
interface HighlightColorId {
  yellow | green | blue | pink | orange;
}

interface ExcerptMetadata {
  sourcePdf: string;        // 哪本书
  sourceBlockId?: string;  // 反向关联的 block_id
  createdAt: number;
  color?: HighlightColorId;
  userNote?: string;       // 用户手写注释
}
```

### Frontmatter 处理

```typescript
function splitFrontmatter(content): { frontmatter, body, hasFrontmatter } {
  const match = content.match(/^(---\n[\s\S]*?\n---)(\n*)/);
  // ...
}
```

**关键**：高亮不能插入到 frontmatter 里——必须 split 后**只改 body**。

### 持久化路径

- **正文**：`books/{bookId}/XX.md` 追加 `==text== ^h-{uuid}`
- **元数据**：`.highlights/{bookId}/{uuid}.json`

---

## Excerpt

**位置**：`src/services/excerpt-service.ts`（249 行）

### 核心流程

```
用户在聊天回答里点"保存为摘录"
  └─→ ExcerptService.saveExcerpt(content, metadata, options)
        ├─→ getExcerptPath(sourcePdf)  ← 决定保存到哪
        ├─→ ensureExcerptFile(targetPath)  ← 文件不存在则创建
        ├─→ 拼装 markdown 内容（content + frontmatter）
        └─→ 写盘
```

### 目标文件路径生成

```typescript
private getExcerptPath(sourcePdf: string): string {
  const bookName = sourcePdf.replace(/\.pdf$/, '');
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  return `DeepReader/Excerpts/${bookName}/${today}.md`;
}
```

**组织形式**：`DeepReader/Excerpts/{书名}/{日期}.md`

**同一天多次摘录** → append 到同一文件（**不覆盖**）。

### ExcerptContent 字段

```typescript
interface ExcerptContent {
  text: string;                    // AI 回答正文
  citedBlocks?: {                  // 引用块
    fileName: string;
    blockId: string;
    snippet: string;
  }[];
  userNote?: string;               // 用户注释
}
```

---

## Integration

```
ReadingMode Component
  ├─→ 捕获选区 (window.getSelection())
  ├─→ 弹出选区工具栏 (SelectionToolbar)
  │     └─→ 5 色高亮按钮
  │     └─→ 写注释按钮
  │
  └─→ 选区工具栏点击
        ├─→ HighlightService.addHighlight(...)
        │     └─→ 修改 .md 文件 + 写 .highlights/
        │
        └─→ AgentChatController.injectExcerpt(...)
              └─→ ExcerptService.saveExcerpt(...)
                    └─→ 创建/追加 DeepReader/Excerpts/...
```

**关键**：高亮是**直接修改书文件**——不是 metadata overlay。**必须解析 frontmatter**避免破坏 YAML。

---

## Files

| 文件 | 职责 |
|---|---|
| `src/services/highlight-service.ts` | 高亮服务（177 行） |
| `src/services/excerpt-service.ts` | 摘录服务（249 行） |
| `src/components/reading-mode/selection-toolbar.ts` | 选区工具栏 UI |
| `src/components/reading-mode/reading-mode-orchestrator.ts` | ReadingMode 主状态机（1019 行） |
| `src/types/highlight.ts` | HighlightColorId / Highlight 类型 |
| `src/types/excerpt.ts` | ExcerptContent / ExcerptMetadata 类型 |
| `src/utils/markdown-utils.ts` | findTextInMarkdown 等工具（60 行） |
| `tests/unit/services/highlight-service.test.ts` | 高亮单测 |
| `tests/unit/services/excerpt-service.test.ts` | 摘录单测 |

---

## Limitations [INFERENCE]

### Highlight

- **不跨段落高亮** —— 选区跨多个 block 时**只关联第一个** block_id
- **block_id 关联依赖前/后 500 字** —— 超长段落（>1000 字）**找不到**的可能
- **不实现高亮移除** —— 用户无法取消高亮（需要手动编辑 .md）
- **不实现跨书高亮共享** —— 不同书的 `^h-{uuid}` 命名空间独立
- **不持久化颜色偏好** —— 用户每次选色都从头选
- **frontmatter 解析简单** —— 嵌套 YAML / 多段 frontmatter 不支持
- **不高亮图片** —— `![]()` 里的文本不被识别
- **不实时更新 ReadingMode** —— 高亮后用户要手动重载

### Excerpt

- **同一天多个摘录追加到同一文件** —— 翻历史麻烦
- **不实现按章节组织** —— 一律按日期，章节维度缺失
- **不实现摘要压缩** —— 一天上百条摘录会让单文件过大
- **不实现去重** —— 同一 AI 回答保存多次会重复
- **不实现搜索** —— 已保存的摘录**没有索引**
- **不支持 Markdown 模板** —— 用户不能自定义 frontmatter
- **不支持图片** —— AI 回答里的图片 base64 不保存
- **不通知** —— 保存成功只 log，**不弹窗**

### 集成

- **与 Search 系统未联动** —— 已保存的摘录**不被 S2 ReAct 检索**
- **与 Profile 未联动** —— 用户写注释时**不更新 profile fact**
- **与 Proactive 未联动** —— 摘录数高不触发主动引导

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/services/highlight-service.ts` 177 行 + `src/services/excerpt-service.ts` 249 行的架构视角文档。5 色 + block_id 反向关联 + 目标文件路径 + 16 条已知限制 |
