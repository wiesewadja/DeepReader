# Spec: MinerU PDF 解析迁移

> 状态：**进行中**
> 更新日期：2026-05-18
> 分支：worktree-mineru-parser

---

## 一、目标

将 DeepReader 的 PDF 解析引擎从本地 `pdf-parse` 切换为 MinerU 云 API，消除约 10.7MB 的打包体积，获得更好的解析质量（表格/公式/OCR/多栏布局）。

**成功标准：**
- `npm run build` 后 `bin/main.js` 体积减少 ≥10MB（pdf-parse 不再打包）
- 现有 `parsePdf` 调用方需要修改（返回类型变化）
- 插件设置页 AI Tab 含 MinerU Token 配置
- 端到端测试覆盖 Agent API 和精准 API 路径

---

## 二、技术架构

### 2.1 双模式决策

| 条件 | API | Token | 文件限制 |
|------|-----|-------|----------|
| ≤10MB 且 ≤20页 | Agent 轻量 API | 不需要 | ≤10MB, ≤20页 |
| >10MB 或 >20页 | 精准 API | 需要 | ≤200MB, ≤200页 |

### 2.2 API 端点

**Agent 轻量 API：**
```
POST https://mineru.net/api/v1/agent/parse/file
GET  https://mineru.net/api/v1/agent/parse/{task_id}
```

**精准 API：**
```
POST https://mineru.net/api/v4/file-urls/batch
PUT  {file_url}  (OSS 上传)
GET  https://mineru.net/api/v4/extract-results/batch/{batch_id}
```

### 2.3 超时设置

| API | 超时 |
|-----|------|
| Agent API | 300 秒 |
| 精准 API | 600 秒 |

轮询间隔：3-5 秒

---

## 三、数据流

```
用户打开 PDF
    │
    ▼
parsePdf(input)                              ← pdf.ts (新)
    │
    ├─ 读取文件为 Buffer
    │
    ├─ 文件 ≤10MB AND ≤20页?
    │   └─ YES → MineruClient.parseViaAgent()
    │       ├─ POST /api/v1/agent/parse/file → { task_id, file_url }
    │       ├─ PUT file → OSS
    │       └─ 轮询 GET /api/v1/agent/parse/{task_id}
    │           ├─ state=pending/running → 继续轮询
    │           ├─ state=done → 返回 markdown_url
    │           └─ state=failed → 抛出错误
    │
    └─ 文件 >10MB OR >20页?
        └─ YES → MineruClient.parseViaPrecision()
            ├─ POST /api/v4/file-urls/batch → { batch_id, file_urls[] }
            ├─ PUT file → OSS
            └─ 轮询 GET /api/v4/extract-results/batch/{batch_id}
                ├─ state=running → 继续轮询
                ├─ state=done → 返回 { full_zip_url }
                ├─ 下载 ZIP → 解压 (adm-zip)
                └─ 读取 JSON → 解析
    │
    ▼
markdownToPdfInfo()                          ← mineru.ts
    ├─ 解析 JSON page_idx → 构建 pages[]
    ├─ 解析 para_blocks → 提取文本/表格
    ├─ HTML 表格 → Markdown (node-html-markdown)
    ├─ 解析 title blocks → 构建 outline (TreeNode[])
    └─ 返回 MineruPdfResult
    │
    ▼
PageIndexResult
    ├─ docName = result.title
    ├─ structure = result.outline (TreeNode[])
    ├─ pages = result.pages (阅读模式用)
    └─ coverPng = undefined (SVG 文字封面降级)
```

---

## 四、MinerU JSON 解析

### 4.1 JSON 结构

MinerU 精准 API 返回的 ZIP 包包含 JSON 文件，结构如下：

```json
{
  "pdf_info": [
    {
      "page_idx": 0,           // 页码 (0-based)
      "page_size": [792, 612], // 页面尺寸
      "para_blocks": [
        {
          "type": "title",     // 类型: title | text | table | image
          "bbox": [...],
          "lines": [
            {
              "spans": [
                {
                  "type": "text",
                  "content": "...",
                  "score": 1.0
                }
              ]
            }
          ]
        },
        {
          "type": "table",
          "blocks": [
            {
              "type": "table_body",
              "lines": [
                {
                  "spans": [
                    {
                      "type": "table",
                      "html": "<table>...</table>"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### 4.2 解析规则

**分页信息：**
- 使用 `page_idx` 字段，不依赖 `<!-- Page N -->` 标记

**para_blocks 类型处理：**

| type | 处理方式 |
|------|----------|
| `title` | 提取 `spans[].content`，估算层级 |
| `text` | 提取 `spans[].content` |
| `table` | 从 `blocks[].lines[].spans[].html` 提取 HTML，转 Markdown |
| `image` | 跳过（不提取图片内容） |

**标题层级估算：**
- 基于 `bbox[1]`（Y 坐标）和文本长度启发式
- Y < 15% 页面高度 → h1
- Y < 35% 页面高度 且 文本 < 80 字符 → h2
- 其他 → h3

**文本拼接：**
- 同一 block 内多个 span 的 content 用空格拼接
- 不同 block 之间用换行拼接

### 4.3 输出类型

```typescript
// src/pageindex/parsers/mineru.ts

interface MineruPdfResult {
  title: string;              // 文档标题（第一个 h1）
  totalPages: number;         // 总页数
  pages: PageText[];         // 每页文本（用于阅读模式）
  outline: TreeNode[];        // 完整树结构
}

interface PageText {
  pageNumber: number;         // 1-based
  text: string;               // 该页完整文本（含 Markdown 格式）
}

interface TreeNode {
  title: string;
  nodeId?: string;
  startIndex?: number;        // 起始页 (1-based)
  endIndex?: number;          // 结束页
  summary?: string;
  prefixSummary?: string;
  text?: string;              // 该节点下的完整文本
  lineNum?: number;
  nodes?: TreeNode[];         // 子节点
}
```

---

## 五、模块设计

### 5.1 文件结构

```
src/
├── services/
│   └── mineru-api.ts              # MineruClient 类
│       ├── parseViaAgent()        # Agent 轻量 API
│       ├── parseViaPrecision()     # 精准 API
│       ├── requestUploadUrl()      # 获取 OSS 上传链接
│       ├── uploadFile()           # PUT 上传文件
│       ├── pollResult()            # 轮询结果
│       └── downloadAndExtractZip()  # 下载并解压 ZIP
│
├── pageindex/
│   └── parsers/
│       ├── mineru.ts              # MinerU JSON 解析
│       │   ├── MineruPdfResult 类型
│       │   ├── parseMineruJson()  # JSON → MineruPdfResult
│       │   ├── extractTextFromBlock()
│       │   ├── extractTableHtml()
│       │   ├── estimateHeadingLevel()
│       │   └── buildTocTree()
│       │
│       └── pdf.ts                  # 保留 getPdfName 等工具函数
│                                   # parsePdf 标记为废弃
```

### 5.2 MineruClient 类

```typescript
// src/services/mineru-api.ts

export class MineruClient {
  constructor(
    private token?: string,
    private options?: {
      timeout?: number;
      pollInterval?: number;
      language?: string;      // 默认 "ch"
    }
  );

  async parseViaAgent(
    input: Buffer,
    fileName: string
  ): Promise<string>;  // 返回 markdown text

  async parseViaPrecision(
    input: Buffer,
    fileName: string,
    options?: {
      modelVersion?: 'pipeline' | 'vlm';  // 默认 vlm
    }
  ): Promise<MineruPdfResult>;
}
```

### 5.3 API 参数

**Agent API 请求体：**
```json
{
  "file_name": "document.pdf",
  "language": "ch"
  // enable_table, enable_formula, is_ocr 使用服务端默认值
}
```

**精准 API 请求体：**
```json
{
  "files": [{ "name": "document.pdf" }],
  "model_version": "vlm",
  "language": "ch",
  "enable_formula": true,
  "enable_table": true
}
```

---

## 六、依赖变更

### 6.1 package.json

**移除：**
- `pdf-parse`

**新增/移动：**
- `adm-zip`: devDependencies → dependencies

**已有（保留）：**
- `node-html-markdown` — HTML → Markdown 转换

---

## 七、Settings 变更

### 7.1 DeepPDFSettings 新增字段

```typescript
// src/config/settings.ts

export interface DeepPDFSettings {
  // 现有字段...

  // AI Tab - MinerU 配置
  mineruApiKey: string;   // 默认 ""
}
```

---

## 八、影响分析

### 8.1 移除的功能

| 功能 | 旧实现 | 新实现 | 影响 |
|------|--------|--------|------|
| PDF 封面图 | PDF.js canvas 渲染 | SVG 文字封面 | 书库缩略图降级 |
| PDF 作者 | pdf-parse 提取 | 不再提取 | 书库不显示作者 |
| 扫描件检测 | 前 5 页字符密度检测 | 不做检测，默认 vlm | 统一走 vlm |
| LLM 结构解析 | checkToc/verifyToc 等 | 不需要 | 减少 LLM 调用 |

### 8.2 保留的工具函数

以下函数保留在 `pdf.ts`，可能被其他模块引用：
- `getPdfName(pdfPath: string): string`

---

## 九、错误处理

### 9.1 错误类型

| 场景 | 处理方式 |
|------|----------|
| 网络超时 | 重试 1-2 次 |
| 429 IP 限频 | 报用户错："IP 限频，请稍后再试" |
| 5xx 服务端错误 | 重试 1-2 次 |
| state=failed | 抛出 MineruError，err_msg 给用户 |
| 轮询超时 | 抛出 TimeoutError |

### 9.2 MineruError 类型

```typescript
export class MineruError extends Error {
  constructor(
    message: string,
    public code?: number
  );
}
```

---

## 十、已确认的决策清单

| # | 决策 | 结论 |
|---|------|------|
| 1 | 10MB/20页阈值 | 官方文档，Agent API 限制 |
| 2 | enable_table/formula 默认值 | 不传，用服务端默认值 (true) |
| 3 | coverPng | SVG 文字封面降级 |
| 4 | author 字段 | 放弃提取 |
| 5 | mineruApiKey 存储 | settings.ts DeepPDFSettings |
| 6 | page_range 参数 | 不加 |
| 7 | 错误处理策略 | 简单重试 1-2 次 |
| 8 | 分页标记 | 不存在，使用 page_idx |
| 9 | ZIP 解压 | adm-zip |
| 10 | para_blocks 类型 | 全部拼接（title/text/table） |
| 11 | HTML 表格格式 | node-html-markdown 转 Markdown |
| 12 | 扫描件检测 | 删除，默认 vlm |
| 13 | LLM 管道 | 不用，纯 MinerU JSON |
| 14 | Agent API | 保留 |
| 15 | 超时设置 | Agent 300s / 精准 600s |
| 16 | API 参数 | 不传 enable_table/formula |
| 17 | preproc_blocks | 不用，只用 para_blocks |
| 18 | 输出类型 | TreeNode[]，在解析函数内转换 |
| 19 | model_version | 默认 vlm |
| 20 | language | 默认 "ch"，设置可配置 |
| 21 | 运行环境 | Node.js (Obsidian 插件) |
| 22 | parsePdf 返回 | { title, totalPages, pages, outline } |
| 23 | MineruPdfResult 位置 | src/pageindex/parsers/mineru.ts |
| 24 | mineru.ts 职责 | JSON 解析逻辑 |
| 25 | mineru-api.ts 职责 | API 调用 + ZIP 下载 |
| 26 | Token 配置位置 | AI Tab |
| 27 | LLM fallback | 不要，纯 MinerU 路径 |
| 28 | 依赖变更 | 移除 pdf-parse，adm-zip 移入 dependencies |

---

## 十一、边界与限制

- **网络依赖**：需要访问 mineru.net，无网络时无法解析
- **隐私**：PDF 内容会上传到 MinerU 服务器
- **Token 必要性**：大文件 (>10MB 或 >20页) 必须配置 Token
- **精准 API 限额**：每日 1000 页最高优先级

---

## 十二、待确认 / Open Questions

- [x] Agent 轻量 API 的 waiting-file 状态 → 轮询逻辑已覆盖
- [x] 精准 API 的 ZIP 包中 full.md 路径 → 固定为 full.md
- [x] `<!-- Page N -->` 分页标记 → 不存在，使用 page_idx
- [x] 扫描件检测 → 删除，默认 vlm
- [ ] 并发上传是否触发 429 限频 → 待实测
- [ ] `page_range` 参数在 Agent API 中的实际行为 → 暂不需要
- [ ] MinerU Markdown 公式格式与 DeepReader 渲染兼容性 → 待实测
