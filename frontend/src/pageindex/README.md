# PageIndex Integration Guide

## 分层架构说明

PageIndex 模块采用分层设计，支持两种运行时环境：

### 1. **核心层 (Node.js Compatible)**
适用于 Obsidian 插件和 Node.js 环境

**入口文件**: `node.ts`

**功能**:
- PDF/EPUB 解析和索引
- Markdown 结构提取
- LLM 智能摘要和 TOC 生成
- Obsidian 笔记导出（不含 vault 索引）

**依赖**:
- Node.js 标准 API (`fs/promises`, `path`, `crypto`)
- PDF 解析: `pdf-parse`
- EPUB 解析: `adm-zip`, `xml2js`, `turndown`
- LLM: `openai` SDK

### 2. **Vault 层 (Bun Native)**
仅适用于 Bun 运行时（CLI 工具）

**入口文件**: `index.ts`

**功能**:
- Obsidian Vault 索引和编译
- 向量嵌入存储和搜索
- 文件扫描和重组
- 概念提取和智能聚合

**依赖**:
- Bun 特定 API (`Bun.Glob`, `Bun.file()`, `Bun.write()`)
- 高性能文件操作和向量存储

---

## 使用指南

### 在 Obsidian 插件中使用

```typescript
// 导入核心功能（Node.js 兼容）
import { PageIndex, processPdfForObsidian } from './pageindex/node';
import type { ObsidianPdfResult } from './pageindex/node';

// 方式 1: 使用简化 API
const result: ObsidianPdfResult = await processPdfForObsidian(pdfPath, {
  model: 'gpt-4o',
  apiKey: 'your-api-key',
  addNodeSummary: true,
  onProgress: (progress) => {
    console.log(`${progress.stage}: ${progress.percent}%`);
  }
});

// 方式 2: 使用完整 PageIndex API
const pageIndex = new PageIndex({
  model: 'gpt-4o',
  addNodeText: true
});
const tree = await pageIndex.fromPdf(pdfPath);
```

### 在 Bun CLI 中使用

```bash
# 使用 Bun CLI（完整功能）
bun run pageindex/cli.ts --pdf document.pdf

# Vault 编译（仅 Bun）
bun run pageindex/cli.ts compile <vault-path>

# Vault 搜索（仅 Bun）
bun run pageindex/cli.ts search <vault-path> "query"
```

---

## 导出入口对比

| 入口文件 | 运行时 | Vault 功能 | 适用场景 |
|---------|-------|----------|---------|
| `node.ts` | Node.js | ❌ 禁用 | Obsidian 插件、Node.js 服务 |
| `index.ts` | Bun | ✅ 启用 | Bun CLI、Vault 管理工具 |
| `unified-core.ts` | Node.js | ❌ 禁用 | 核心 API 内部使用 |
| `unified.ts` | Bun/Node | ⚠️ 动态加载 | 通用入口（自动检测） |

---

## 架构分层

```
frontend/src/pageindex/
├── node.ts                    # Node.js 导出入口
├── index.ts                   # Bun 完整导出入口
├── unified-core.ts            # 核心统一 API (Node)
├── unified.ts                 # 完整统一 API (Bun)
├── pageindex.ts               # PageIndex 主类
│
├── core/                      # ✅ Node.js 兼容
│   ├── types.ts
│   ├── utils.ts
│   ├── tree.ts
│   └── toc.ts
│
├── parsers/                   # ✅ Node.js 兼容
│   ├── pdf.ts
│   ├── epub.ts
│   ├── markdown.ts
│   └── ocr.ts
│
├── exporters/                 # ✅ Node.js 兼容
│   ├── pdf-to-obsidian.ts
│   └── epub-to-obsidian.ts
│
├── llm/                       # ✅ Node.js 兼容
│   └── client.ts
│
└── vault/                     # ⚠️ Bun 专用
    ├── scan.ts                # Bun.Glob, Bun.file()
    ├── vectors.ts             # Bun.write(), Bun.file()
    ├── compiler.ts            # Vault 编译
    └── search.ts              # 向量搜索
```

---

## 集成到 Obsidian 插件

### 步骤 1: 导入核心 API

在 `main.ts` 中：

```typescript
import { PageIndex, type PageIndexResult } from './pageindex/node';

export default class DeepPDFPlugin extends Plugin {
  async processPdf(pdfPath: string) {
    const pageIndex = new PageIndex({
      model: this.settings.model,
      apiKey: this.settings.apiKey,
      baseUrl: this.settings.baseUrl,
      addNodeSummary: true,
    });

    const result = await pageIndex.fromPdf(pdfPath);
    
    // 使用 result.structure（TOC 树）
    // 使用 result.docDescription（文档描述）
    return result;
  }
}
```

### 步骤 2: 配置依赖

在 `package.json` 中添加必要依赖：

```json
{
  "dependencies": {
    "openai": "^4.0.0",
    "adm-zip": "^0.5.0",
    "xml2js": "^0.4.0",
    "turndown": "^7.0.0",
    "pdf-parse": "^1.1.1"
  }
}
```

### 步骤 3: 在 UI 中调用

```typescript
// 在侧边栏视图中
async handlePdfUpload(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await this.plugin.processPdf(arrayBuffer);
  
  // 显示 TOC 结构
  this.displayTocTree(result.structure);
}
```

---

## Vault 功能（仅 Bun）

Vault 管理功能需要独立运行 Bun CLI：

```bash
# 安装 Bun（如果未安装）
curl -fsSL https://bun.sh/install | bash

# 编译 Vault
bun run frontend/src/pageindex/cli.ts compile /path/to/vault

# 搜索 Vault
bun run frontend/src/pageindex/cli.ts search /path/to/vault "概念关键词"
```

**为什么 Vault 需要 Bun？**
- `Bun.Glob`: 高性能文件扫描
- `Bun.file()`: 零拷贝文件读取
- `Bun.write()`: 快速向量存储写入
- 性能优势: 比 Node.js 快 3-5 倍

---

## 依赖管理

### 包体积优化

主插件包仅 1MB，PageIndex 的大型依赖采用运行时加载策略：

| 依赖 | 大小 | 用途 | 是否必需 |
|------|------|------|---------|
| `openai` | 9.6MB | LLM API 客户端 | 否（可用 LM Studio/Ollama） |
| `pdf-parse` | 29MB | PDF 解析 | 否（可用 LM Studio OCR） |
| `adm-zip` | 164KB | EPUB 解压 | 是（仅 EPUB 必需） |
| `xml2js` | 68KB | XML 解析 | 是（仅 EPUB 必需） |
| `turndown` | 208KB | HTML 转 Markdown | 是（仅 EPUB 必需） |

### 安装依赖

#### 场景 1：PDF TOC 提取

```bash
# 安装 PDF 解析库
cd /path/to/vault/.obsidian/plugins/deepreader
npm install pdf-parse
```

或者使用 LM Studio OCR 模式（无需安装依赖）：

```typescript
const pageIndex = new PageIndex({
    extractionMode: 'ocr',
    baseUrl: 'http://localhost:1234/v1',  // LM Studio
});
```

#### 场景 2：EPUB 索引

```bash
# 安装 EPUB 解析依赖
cd /path/to/vault/.obsidian/plugins/deepreader
npm install adm-zip xml2js turndown
```

#### 场景 3：LLM 调用

**方式 A：使用 OpenAI API（需安装依赖）**
```bash
npm install openai
```

**方式 B：使用 LM Studio（无需安装依赖）**
```typescript
const pageIndex = new PageIndex({
    model: 'local-model',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',  // LM Studio 默认
});
```

**方式 C：使用 Ollama（无需安装依赖）**
```typescript
const pageIndex = new PageIndex({
    model: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
});
```

---

## 类型安全

所有导出都提供完整的 TypeScript 类型：

```typescript
import type {
  PageIndexOptions,
  PageIndexResult,
  TreeNode,
  ProgressInfo,
  ObsidianPluginOptions,
  ObsidianPdfResult,
} from './pageindex/node';
```

---

## 运行时检测

在 `unified.ts` 中自动检测运行时：

```typescript
const isBunRuntime = typeof Bun !== "undefined";

if (isBunRuntime) {
  // Vault 功能可用
  await indexVault(options);
} else {
  // Node.js 环境 - vault 功能禁用
  console.warn("Vault features require Bun runtime");
}
```

---

## 总结

✅ **方案 A（分层集成）已实施**:
1. `node.ts` - Node.js 兼容导出（Obsidian 插件可用）
2. `index.ts` - Bun 完整导出（CLI 工具）
3. `unified-core.ts` - 核心 API（无 vault）
4. `unified.ts` - 动态加载 vault（自动检测运行时）

🎯 **下一步**: 在 Obsidian 插件中测试核心功能集成