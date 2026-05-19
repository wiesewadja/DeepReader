# SPEC: PDF 图片提取与本地化

> 状态：**已批准** | 分支：`feat/pdf-image-extraction` | 日期：2026-05-18

---

## 1. 目标

MinerU API 解析 PDF 时会识别图片块（type=image），包含图片的 CDN URL。
当前代码完全跳过图片块，导致导出的 Markdown 中没有图片。
需要将图片下载到本地并通过 Obsidian wiki 语法引用。

## 2. 数据现状

### 精准 API（JSON）
- `block.type === 'image'`，含 `sub_type`（natural_image / text_image）
- span 中 `image_path` 是 CDN URL（均为 `.jpg`），`content` 是 OCR 文字或 AI caption
- 图片按阅读顺序与 text/title 块交替排列
- 实测：130 页教科书有 112 张图片

### Agent API（Markdown）
- `![image](https://cdn-mineru.openxlab.org.cn/.../xxx.jpg)` 格式

## 3. 实施步骤

### Step 1: 扩展类型定义
**文件**: `src/pageindex/parsers/mineru-types.ts`

- `MineruSpan.type` 扩展为 `'text' | 'table' | 'image'`
- `MineruSpan` 新增 `image_path?: string`
- 新增 `MineruImage` 接口：
```typescript
export interface MineruImage {
  url: string;           // CDN URL
  fileName: string;      // 本地文件名，如 "p5-2.jpg"
  caption?: string;      // 图片 OCR 文字或 AI 描述
}
```
- `MineruPdfResult` 新增 `images: MineruImage[]`

### Step 2: parseMineruJson 处理图片块
**文件**: `src/pageindex/parsers/mineru.ts`

遍历 `para_blocks` 时，对 `block.type === 'image'`：
- 从 `blocks[].lines[].spans[]` 中找 `span.image_path`
- 生成文件名：`p{pageIdx+1}-{seqInPage}.jpg`（从 URL 提取扩展名，默认 .jpg）
- URL 去重（同一 URL 只下载一次，多处引用）
- 将 `![[images/fileName]]` 插入 pageTextParts，保持与 text/table 块的阅读顺序
- 收集到 `images` 数组

### Step 3: parseMarkdown 处理 Agent API 图片
**文件**: `src/services/mineru-api.ts`

- 正则匹配 `![...](https://cdn-mineru.openxlab.org.cn/...)`
- URL 去重，生成唯一文件名 `img-{seq}.jpg`（从 URL 提取扩展名）
- 替换 Markdown 中的远程 URL 为 `![[images/fileName]]`
- 收集到 `images` 数组

### Step 4: book-indexer 下载图片（并发）
**文件**: `src/pageindex/book-indexer.ts`

在封面保存之后、Markdown 导出之前：
- 创建 `DeepReader/{exportName}/images/` 目录
- 遍历 `parseResult.images`（已去重）
- 并发下载（5 路），用 `safeRequest` 下载，单张限制 10MB
- 验证 URL 域名为 `cdn-mineru.openxlab.org.cn`
- 保存为本地文件
- 进度汇报：`下载图片 (12/112)...`

### Step 5: 导出验证
**文件**: `src/pageindex/exporters/pdf-to-obsidian.ts`

无需额外处理。TreeNode.text 中已包含 `![[images/xxx.jpg]]`，
Obsidian 自动按最短路径匹配解析。

## 4. 关键文件

| 文件 | 修改 |
|------|------|
| `src/pageindex/parsers/mineru-types.ts` | 扩展 span type + MineruImage 接口 |
| `src/pageindex/parsers/mineru.ts` | 处理 image block，生成 wiki 引用 |
| `src/services/mineru-api.ts` | Agent API Markdown 图片替换 |
| `src/pageindex/book-indexer.ts` | 并发下载图片到本地 |

## 5. 约束

- 图片域名白名单：`cdn-mineru.openxlab.org.cn`
- 单张图片大小限制：10MB
- 并发下载数：5 路
- URL 去重：同一 CDN URL 只下载一次
- 不影响无图片 PDF 的现有流程

## 6. 验证

1. `npm run build` 编译通过
2. `npm run test:run` 无回归
3. 用 `语文三上` PDF 端到端测试
4. 确认 `DeepReader/{书名}/images/` 下有图片文件
5. 确认 Markdown 中有 `![[images/xxx.jpg]]` 且 Obsidian 可渲染
