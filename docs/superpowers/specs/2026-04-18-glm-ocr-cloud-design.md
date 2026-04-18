# GLM-OCR 云端化设计

## 目标

将 PageIndex 的 OCR 管线从 LM Studio 本地模型切换到智谱云端 GLM-4V API，并在索引时自动检测扫描档 PDF 走 OCR 路径。

## 背景

- `src/pageindex/parsers/ocr.ts` 已有完整的 OCR 管线（pdftocairo → PNG → vision API）
- 当前默认使用 LM Studio 本地模型 (`mlx-community/GLM-OCR-bf16`)，需本地部署
- 智谱已是内置服务商，用户配置过 API Key 即可使用

## 设计

### API Key 来源

OCR 复用 `pageindex` 角色的服务商配置（通过 `resolveRoleConfig('pageindex')` 获取 apiKey/baseUrl），不新增独立角色。

### 自动检测扫描档

在 `PageIndex.fromPdf()` 入口处：

1. 先用 `pdf-parse` 快速解析前 5 页文本
2. 计算平均每页字符数
3. 阈值判定：平均 < 50 字符 → 扫描档，切换 OCR 路径
4. 扫描档使用智谱云端 GLM-4V 调用 `parsePdfWithOcr()`

### 调用链

```
book-indexer.ts::indexBook()
  → resolveRoleConfig('pageindex') → { apiKey, baseUrl }
  → PageIndex.fromPdf(filePath)
    → 快速解析前 5 页，检测文本密度
    → 正常档？→ pdf-parse 文本提取（现有流程）
    → 扫描档？→ parsePdfWithOcr(input, { apiKey, baseUrl, model: 'glm-4v-flash' })
```

### 文件变更

| 文件 | 变更 |
|------|------|
| `parsers/ocr.ts` | 移除 LM Studio 默认值，改为智谱云端；默认模型 `glm-4v-flash` |
| `pageindex.ts` | `fromPdf()` 加入前 5 页自动检测逻辑 |
| `defaults.ts` | `DEFAULT_OCR_MODEL` 改为 `glm-4v-flash`，baseUrl 改为智谱 |
| `book-indexer.ts` | 确保传入 resolveRoleConfig 的 apiKey/baseUrl 到 OCR options |

### 不做的事

- 不新增 `ocr` 角色 — 复用 pageindex 角色的服务商
- 不改 pdftocairo 图片转换方式
- 不改 exporters 层 — OCR 产出格式与文本模式一致，下游无感知
- 不改 UI — 自动检测，无需用户手动选择
