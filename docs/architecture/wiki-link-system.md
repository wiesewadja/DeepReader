# Wiki Link 系统

> DeepReader Agent 输出的核心引用格式——`[[file#^block|alias]]` 双链 + 模糊匹配 + 自动纠正。
> S2 Analytical 工具结果中的 `^block_id` 锚点反向追溯，LLM 输出走 post-processing
> hook 自动校验和纠正。
>
> 配套阅读：[book-search.md](./book-search.md)（matchedBlocks 三级块定位）、
> [agent-state-machine/L2-langgraph-state-machine.md](./agent-state-machine/L2-langgraph-state-machine.md)（state 字段定义）——[system-overview.md 第 5 节](../architecture/system-overview.md#state)（`toolResultsSnapshot`）、
> [early-stop-decision.md §Bug 5](../architecture/early-stop-decision.md)（幽灵引用警告）、
> [testing/](../testing/) 目录。

---

## 目录

1. [设计意图：LLM 输出与 vault 文件的桥](#why)
2. [Wiki Link 语法规范](#syntax)
3. [3 大功能：解析 / 校验 / 纠正](#features)
4. [4 类问题检测](#issues)
5. [5 接口：输入 / 输出 / 度量](#api)
6. [post-processing hook 调用点](#integration)
7. [关键源文件](#files)
8. [已知限制](#limitations-inference)

---

## 设计意图 (why)

LLM 在 S2/S4 节点的输出里，**必须**带 Obsidian 双链 `[[file#^block|alias]]`——这是用户点击跳转的入口。

**问题**：
- LLM 经常**编造路径或 block_id**（幻觉）
- LLM 经常**用错文件名**（大小写、扩展名）
- LLM 经常**漏 `#^block_id`**（只引用到文件级）
- LLM 经常**少 `|alias`**（用户看不到友好名）

**需要**：在 LLM 输出落地到 UI **之前**做一次 post-processing——校验每条 link，找最近似的"真链接"自动纠正，找不到的降级为文件级（`[[file|alias]]`）。

**为什么不直接拒绝 LLM 输出？**——**绝大多数 link 是对的**，只对错的部分纠正，避免大幅降低答案质量。

---

## Syntax

**位置**：`src/agent/utils/wiki-link-hook.ts:59`

```typescript
const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g;
```

**4 种形式**（按完整度）：

| 形式 | 例子 | 用途 |
|---|---|---|
| 完整 | `[[My Book/第1章#^abc123\|关键概念]]` | 链接到具体段落 |
| 文件级 | `[[My Book/第1章\|关键概念]]` | 链接到文件 |
| 简化 | `[[第1章#^abc123]]` | 短路径（默认 book） |
| 裸 | `[[abc123]]` | 错误形式（hook 会纠正） |

**解析函数**：`parseWikiLinkInternal()`（hook 内部）

```typescript
const parts = linkContent.split('|');
const rawPath = parts[0].trim();
const displayText = parts[1]?.trim() ?? rawPath;
// rawPath 拆分: bookName / fileName / #^blockId
```

---

## Features

### 功能 1：解析

**位置**：`hook.ts:61-95`

**4 字段提取**：
- `bookName` —— 文件所属书
- `fileName` —— 文件名（不含扩展名）
- `blockId` —— `^xxx` 锚点（可选）
- `displayText` —— 显示文本（`|` 后）

**容错**：
- 缺 `^` → 标为 `missing_caret`
- 缺 `|` → `displayText` = `rawPath`
- 多个 `#` → 取最后一个
- 编码问题 → 保留原样

### 功能 2：校验

**位置**：`hook.ts:97-118` `detectLinkIssues()`

**5 类问题检测**（见 §4 详细）。

### 功能 3：纠正

**位置**：`hook.ts:255-275` `buildCorrectedLink()`

**纠正策略**：
- **有 `file_not_found`** → 在缓存的文件列表中**模糊匹配**最相似的
- **有 `block_not_found`** → 在 `toolResults` 中找**同一文件下的相似 block_id**
- **有 `wrong_book`** → 切到 `expectedBookName` 下重找
- **有 `malformed_format`** → 自动补全缺的部分

**置信度阈值**：`confidence > 0.5` 才采纳纠正——低于此值当作死链。

---

## Issues

**位置**：`hook.ts:97-118` `detectLinkIssues()`

| Issue Type | 检测逻辑 | 纠正 |
|---|---|---|
| `file_not_found` | 缓存文件列表中找不到 | 模糊匹配 + Levenshtein 距离 |
| `block_not_found` | `toolResults` 中找不到 | 找同一文件下相似 block_id |
| `malformed_format` | 不符合 `[[file#^block\|alias]]` 规范 | 自动补全 |
| `missing_caret` | 链接没有 `#^` 前缀 | 自动添加（如果 file 实际有 block） |
| `wrong_book` | `bookName !== expectedBookName` | 切到 expectedBookName 目录 |

**问题：实际还有第 6 种？**

`type WikiLinkIssue['issueType']` 联合类型只列了 5 个字符串——**`missing_caret` 和 `malformed_format` 在代码里被检测但实际可能没主动赋值** [INFERENCE]。

---

## API

### 1. `validateWikiLinks(content, context)` — 主入口

**位置**：`hook.ts:278-407`

```typescript
async function validateWikiLinks(
  content: string,
  context: LinkCorrectionContext,
): Promise<WikiLinkValidationResult>;
```

**输入**：
```typescript
interface LinkCorrectionContext {
  app: App;
  bookName: string;          // 当前书
  vaultPath: string;
  toolResults: ToolResultEntry[];
  expectedBookName?: string; // 跨书模式
}
```

**输出**：
```typescript
interface WikiLinkValidationResult {
  correctedContent: string;
  issues: WikiLinkIssue[];       // 检测到的问题
  correctionsApplied: number;    // 实际纠正数
  metrics: WikiLinkMetrics;
}

interface WikiLinkMetrics {
  totalLinks: number;            // 总链接数
  validLinks: number;            // 有效数
  deadLinksRemoved: number;      // 死链降级数
  autoCorrectedLinks: number;    // 自动纠正数
}
```

### 2. `wikiLinkPostProcessingHook(content, context)` — 简化入口

**位置**：`hook.ts:409-420`

```typescript
async function wikiLinkPostProcessingHook(
  content: string,
  context: LinkCorrectionContext,
): Promise<string>;
```

**只**返回 `correctedContent` 字符串——简化调用方代码。

### 3. `validateLinkPairs(content)` — 链接对验证

**位置**：`src/agent/utils/wiki-link-pair-validator.ts:26`

**用途**：检查 LLM 输出的"主文 + 别名"**一致性**——别名必须真反映内容（不只是占位符）。

### 4. `LinkPairValidationResult` — 验证结果

```typescript
interface LinkPairValidationResult {
  pairs: { link: string; alias: string; valid: boolean }[];
  totalPairs: number;
  invalidPairs: number;
}
```

### 5. `WikiLinkIssue` — 单条问题

```typescript
interface WikiLinkIssue {
  original: string;             // 原文 `[[...]]`
  issueType: 'file_not_found' | 'block_not_found' | 'malformed_format' | 'missing_caret' | 'wrong_book';
  parsed: ParsedWikiLink;        // 解析结果
  suggestedCorrection: string | null;
  confidence: number;           // 0-1
}
```

---

## Integration

**位置**：S2 Analytical / S4 Formatter 节点

```
LLM 产出 content
  └─→ wikiLinkPostProcessingHook(content, context)
        └─→ validateWikiLinks(content, context)
              ├─→ 解析所有 `[[...]]`
              ├─→ 检测问题
              ├─→ 模糊匹配
              └─→ 返回 correctedContent
                    └─→ 落到 UI 渲染
```

**关键调用方**：
- S2 Analytical 输出后
- S4 Formatter 输出后
- 早停路径的 LLM 输出（详见 [early-stop-decision.md §Bug 5](../architecture/early-stop-decision.md)）

---

## Files

| 文件 | 职责 |
|---|---|
| `src/agent/utils/wiki-link-hook.ts` | 解析 + 校验 + 纠正主入口（420 行） |
| `src/agent/utils/wiki-link-pair-validator.ts` | 链接-别名一致性验证（101 行） |
| `src/agent/graph/utils/self-verification.ts` | 幽灵引用检测 + LLM 修正（307 行） |
| `src/agent/graph/utils/parse.ts` | 通用 Markdown 解析（169 行，含 wiki link 解析辅助） |
| `tests/unit/agent/utils/wiki-link-hook.test.ts` | 完整 hook 单测 |
| `tests/unit/agent/utils/wiki-link-pair-validator.test.ts` | 链接对验证单测 |
| `docs/testing/` | 测试策略与场景文档 |

---

## Limitations [INFERENCE]

### 通用

- **模糊匹配用 Levenshtein 距离** —— 中英混合 / 同义词不识别
- **不跨书引用** —— 默认 `expectedBookName = bookName`，**跨书需显式传 `expectedBookName`**
- **缓存失效** —— 文件缓存 5 分钟，**新建书后**要等缓存刷新
- **不验证内容** —— 只验证"链接形式"，**不验证"链接指向的内容真支持答案"**

### 4 类问题检测

- **`missing_caret` 和 `malformed_format` 未主动赋值** [INFERENCE]——代码检测了但实际不写入 issues
- **`wrong_book` 的纠正可能不准确** —— 跨书时 LLM 写错书名，纠正为默认书
- **block_id 纠正只看同一文件** —— 跨章节 block_id 找不到

### post-processing

- **同步执行** —— 阻塞 LLM 输出到 UI，**长 content 时可能慢** [INFERENCE]
- **失败时静默** —— `validateWikiLinks` 抛错时不影响主流程
- **不记录纠正日志到用户可见** —— `agentLog` 只到控制台

### 缺失

- **不支持相对路径** —— 必须用 vault 相对路径
- **不支持转义** —— `[[file\[brackets\]]]` 之类不识别
- **不支持预览图** —— Obsidian 1.5+ 的 `![[image.png]]` 嵌入图不处理

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/utils/wiki-link-hook.ts` 420 行 + `wiki-link-pair-validator.ts` 101 行的架构视角文档。3 大功能 + 4 类问题 + 5 接口 + 14 条已知限制 |
