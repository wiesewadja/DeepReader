# DeepReader 插件体积分析报告

## 📊 当前状态

### 主包大小
```
main.js: 1.0MB
```

### PageIndex 依赖大小

| 依赖 | 大小 | 用途 | 必需性 |
|------|------|------|--------|
| **pdf-parse** | **29MB** | PDF 解析引擎 | 可选（核心功能） |
| ├── v2.0.550 | 6.0MB | 最新版 PDF.js | ✅ 仅需此版本 |
| ├── v1.10.100 | 6.1MB | 旧版本 | ❌ 可删除 |
| ├── v1.9.426 | 8.1MB | 旧版本 | ❌ 可删除 |
| └── v1.10.88 | 8.7MB | 旧版本 | ❌ 可删除 |
| **openai** | **9.6MB** | LLM API 客户端 | 可选（可用 LM Studio） |
| **turndown** | **208KB** | HTML → Markdown | 必需（EPUB） |
| **adm-zip** | **164KB** | ZIP 解压 | 必需（EPUB） |
| **xml2js** | **68KB** | XML 解析 | 必需（EPUB） |

### 总计

| 场景 | 大小 | 包含内容 |
|------|------|----------|
| **核心功能** | **1.0MB** | main.js（无需安装依赖） |
| **完整功能** | **~40MB** | main.js + 所有依赖 |
| **优化后完整功能** | **~17MB** | main.js + 仅必需依赖 |

---

## 🔍 问题根源

### 问题 1: pdf-parse 包含多个 PDF.js 版本

`pdf-parse` 包含了 4 个版本的 PDF.js（共 29MB），但实际上只需要最新版（6MB）：

```bash
node_modules/pdf-parse/lib/pdf.js/
├── v1.9.426    8.1MB  ← 旧版本（可删除）
├── v1.10.88    8.7MB  ← 旧版本（可删除）
├── v1.10.100   6.1MB  ← 旧版本（可删除）
└── v2.0.550    6.0MB  ← 最新版（保留）
```

**优化潜力**：29MB → 6MB（节省 23MB）

### 问题 2: OpenAI SDK 非必需

`openai` 包（9.6MB）用于调用 LLM API，但可以使用：
- LM Studio（免费，本地）
- Ollama（免费，本地）
- OpenAI 兼容 API（无需 SDK）

**优化潜力**：9.6MB → 0MB（节省 9.6MB）

---

## ✅ 优化方案

### 方案 A：精简 pdf-parse（推荐）

创建自定义的精简版 pdf-parse：

```bash
# 安装后清理旧版本
cd node_modules/pdf-parse/lib/pdf.js
rm -rf v1.9.426 v1.10.88 v1.10.100
# 保留 v2.0.550
```

**效果**：29MB → 6MB

**优点**：
- 大幅减小体积（节省 23MB）
- 无需修改代码
- 保留完整 PDF 功能

---

### 方案 B：使用替代 PDF 库

使用更轻量的 PDF 解析库：

#### 选项 1: pdf-lib（推荐）

```bash
npm install pdf-lib
```

**特点**：
- 大小：~1MB（vs pdf-parse 29MB）
- 功能：PDF 创建、修改、提取文本
- 纯 JavaScript，无原生依赖

**缺点**：
- 文本提取功能较弱
- 需要修改 PageIndex 代码

#### 选项 2: pdfjs-dist（官方库）

```bash
npm install pdfjs-dist
```

**特点**：
- 大小：~6MB（仅最新版）
- 功能：Mozilla 官方 PDF.js
- 文本提取功能强大

**缺点**：
- 需要配置 Worker
- 需要修改 PageIndex 代码

---

### 方案 C：OCR 模式（零依赖）

使用 LM Studio / Ollama 的视觉模型进行 OCR：

```typescript
const pageIndex = new PageIndex({
    extractionMode: 'ocr',
    baseUrl: 'http://localhost:1234/v1',  // LM Studio
    ocrModel: 'qwen-vl',  // 视觉模型
});
```

**优点**：
- 无需安装 pdf-parse
- 支持扫描版 PDF
- 支持手写内容

**缺点**：
- 需要本地运行 LM Studio
- 速度较慢（需生成图片）
- 需要支持视觉的模型

---

## 📋 优化后的体积对比

### 场景 1：核心功能（零依赖）

```
main.js: 1.0MB
总计: 1.0MB
```

**功能**：
- Markdown 结构提取
- TOC 生成
- 文本处理
- LLM 调用（需 LM Studio/Ollama）

---

### 场景 2：EPUB 索引

```
main.js:       1.0MB
adm-zip:       0.16MB
xml2js:        0.07MB
turndown:      0.21MB
─────────────────────
总计:          1.44MB
```

**功能**：
- EPUB 解析
- 章节提取
- Markdown 导出

---

### 场景 3：PDF 索引（优化版）

```
main.js:       1.0MB
pdf-parse:     6.0MB（精简后）
─────────────────────
总计:          7.0MB
```

**优化措施**：
- 仅保留 pdf.js v2.0.550
- 删除旧版本（节省 23MB）

---

### 场景 4：完整功能（优化版）

```
main.js:       1.0MB
pdf-parse:     6.0MB（精简后）
adm-zip:       0.16MB
xml2js:        0.07MB
turndown:      0.21MB
─────────────────────
总计:          7.44MB
```

**优化措施**：
- 精简 pdf-parse
- 使用 LM Studio（无需 openai SDK）

**对比优化前**：40MB → 7.44MB（节省 32.56MB，**减少 81%**）

---

## 🛠️ 实施建议

### 立即可做（无需改代码）

#### 1. 精简 pdf-parse

```bash
# 在安装依赖后执行
cd /path/to/vault/.obsidian/plugins/deepreader
npm install pdf-parse adm-zip xml2js turndown

# 清理旧版本 PDF.js
cd node_modules/pdf-parse/lib/pdf.js
rm -rf v1.9.426 v1.10.88 v1.10.100

# 验证大小
du -sh node_modules/pdf-parse
# 预期：~6MB（vs 原来的 29MB）
```

#### 2. 使用 LM Studio（无需 OpenAI SDK）

```bash
# 安装 LM Studio
# https://lmstudio.ai/

# 下载模型
# - Qwen 2.5 (推荐)
# - Llama 3.2
# - 或其他支持的模型

# 启动本地服务器
# LM Studio → Local Server → Start Server
```

**配置**：
```typescript
const pageIndex = new PageIndex({
    model: 'qwen2.5',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
});
```

---

### 中期优化（需改代码）

#### 1. 替换 pdf-parse

使用 `pdf-lib` 或 `pdfjs-dist` 替代：

```typescript
// 使用 pdf-lib
import { PDFDocument } from 'pdf-lib';

async function extractTextFromPdf(pdfPath: string): Promise<string> {
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    // 提取文本...
}
```

#### 2. 按需加载依赖

```typescript
// 动态导入大型依赖
async function parsePdf(pdfPath: string) {
    const { default: PDFParse } = await import('pdf-parse');
    // 使用 PDFParse...
}
```

---

### 长期优化

#### 1. WebAssembly PDF 解析

使用 WASM 版本的 PDF.js：

```bash
npm install pdfjs-dist
```

**优点**：
- 体积小（~3MB）
- 性能好
- 跨平台

#### 2. 服务端 PDF 解析

将 PDF 解析移到后端：

```typescript
// 调用后端 API
const result = await fetch('http://localhost:6088/api/parse-pdf', {
    method: 'POST',
    body: formData,
});
```

**优点**：
- 前端零依赖
- 性能更好
- 可复用后端代码

---

## 📊 总结

### 当前状态
- **主包**：1.0MB ✅
- **完整功能**：40MB ⚠️

### 优化后
- **主包**：1.0MB ✅
- **完整功能**：7.44MB ✅（减少 81%）

### 核心优化措施
1. ✅ 精简 pdf-parse（29MB → 6MB）
2. ✅ 使用 LM Studio（无需 openai SDK）
3. ✅ 按需安装依赖
4. ✅ 核心功能零依赖

### 用户选择
- **核心功能**：1.0MB（零依赖）
- **EPUB 索引**：1.44MB
- **PDF 索引**：7.0MB
- **完整功能**：7.44MB

---

## 🎯 推荐配置

### 开发者（完整功能）
```bash
npm install pdf-parse adm-zip xml2js turndown
cd node_modules/pdf-parse/lib/pdf.js && rm -rf v1.9.426 v1.10.88 v1.10.100
```

### 普通用户（推荐）
```bash
# 安装 LM Studio
# https://lmstudio.ai/

# 安装最小依赖
npm install adm-zip xml2js turndown
```

### 轻度用户（核心功能）
```bash
# 无需安装依赖
# 使用 LM Studio / Ollama 进行 LLM 调用
```