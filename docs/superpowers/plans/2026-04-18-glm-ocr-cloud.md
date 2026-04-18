# GLM-OCR 云端化实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OCR 管线从 LM Studio 本地模型切换到智谱云端 GLM-4V，并在索引时自动检测扫描档 PDF。

**Architecture:** 复用 `pageindex` 角色的服务商配置（apiKey/baseUrl），OCR 默认走智谱云端。在 `PageIndex.fromPdf()` 入口增加前 5 页文本密度检测，低于阈值自动切换 OCR 路径。

**Tech Stack:** TypeScript, 智谱 GLM-4V API, pdftocairo (Poppler), Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/pageindex/defaults.ts` | Modify | 更新 OCR 默认模型和 baseUrl |
| `src/pageindex/parsers/ocr.ts` | Modify | 移除 LM Studio 默认值，改用智谱云端 |
| `src/pageindex/pageindex.ts` | Modify | `fromPdf()` 增加自动检测扫描档逻辑 |
| `src/pageindex/__tests__/ocr-scan-detection.test.ts` | Create | 扫描检测 + OCR 云端调用的单元测试 |

---

## Chunk 1: Defaults & OCR Cloud Migration

### Task 1: 更新 OCR 默认配置

**Files:**
- Modify: `src/pageindex/defaults.ts:50-51`

- [ ] **Step 1: 修改 defaults.ts 中的 OCR 默认值**

将 `DEFAULT_OCR_MODEL` 从 LM Studio 本地模型改为智谱云端模型：

```typescript
// 修改前
export const DEFAULT_OCR_MODEL = "mlx-community/GLM-OCR-bf16";

// 修改后
export const DEFAULT_OCR_MODEL = "glm-4v-flash";
```

- [ ] **Step 2: Commit**

```bash
git add src/pageindex/defaults.ts
git commit -m "refactor: OCR 默认模型改为智谱 GLM-4V Flash"
```

---

### Task 2: 改造 ocr.ts 使用智谱云端

**Files:**
- Modify: `src/pageindex/parsers/ocr.ts:162-172`

- [ ] **Step 1: 修改 ocrImage() 中的默认值逻辑**

将 `ocrImage()` 中的 LM Studio 默认值改为依赖外部传入（不再 fallback 到 localhost）：

```typescript
// 修改 ocrImage() 中的默认值逻辑（约 line 170-171）
// 修改前:
const apiKey = options.apiKey || process.env.OPENAI_API_KEY || "lm-studio";
const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || "http://localhost:1234/v1";

// 修改后:
if (!options.apiKey) {
  console.error("[OCR Error] API Key is required for cloud OCR");
  return "";
}
const apiKey = options.apiKey;
const baseUrl = options.baseUrl || "https://open.bigmodel.cn/api/paas/v4";
```

- [ ] **Step 2: 更新 OcrOptions 的 JSDoc 注释**

```typescript
export interface OcrOptions {
  /** OCR model to use (default: glm-4v-flash) */
  ocrModel?: string;
  /** API key for OCR model (required) */
  apiKey?: string;
  /** Base URL for OCR model API (default: https://open.bigmodel.cn/api/paas/v4) */
  baseUrl?: string;
  // ... 其余不变
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pageindex/parsers/ocr.ts
git commit -m "refactor: OCR 管线改用智谱云端 API，移除 LM Studio 默认值"
```

---

## Chunk 2: Auto-Detection in fromPdf()

### Task 3: 在 PageIndex.fromPdf() 中增加扫描档自动检测

**Files:**
- Modify: `src/pageindex/pageindex.ts:240-290`
- Test: `src/pageindex/__tests__/ocr-scan-detection.test.ts`

- [ ] **Step 1: 写扫描检测的单元测试**

```typescript
// src/pageindex/__tests__/ocr-scan-detection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Scanned PDF Detection', () => {
  it('should detect scanned PDF when average chars per page < 50', () => {
    // 模拟扫描档：5 页，每页 < 50 字符
    const pages = [
      { text: '', tokenCount: 0 },
      { text: '   ', tokenCount: 0 },
      { text: '', tokenCount: 0 },
      { text: 'a', tokenCount: 0 },
      { text: '', tokenCount: 0 },
    ];
    const avgChars = pages.reduce((sum, p) => sum + p.text.trim().length, 0) / pages.length;
    expect(avgChars).toBeLessThan(50);
  });

  it('should not detect normal PDF as scanned', () => {
    // 模拟正常 PDF：5 页，每页 > 50 字符
    const pages = [
      { text: '这是一段正常的PDF文本内容，包含足够的字符来通过检测。'.repeat(2), tokenCount: 50 },
      { text: '这是另一段正常的PDF文本内容，包含足够的字符来通过检测。'.repeat(2), tokenCount: 50 },
      { text: '这是第三段正常的PDF文本内容，包含足够的字符来通过检测。'.repeat(2), tokenCount: 50 },
      { text: '这是第四段正常的PDF文本内容，包含足够的字符来通过检测。'.repeat(2), tokenCount: 50 },
      { text: '这是第五段正常的PDF文本内容，包含足够的字符来通过检测。'.repeat(2), tokenCount: 50 },
    ];
    const avgChars = pages.reduce((sum, p) => sum + p.text.trim().length, 0) / pages.length;
    expect(avgChars).toBeGreaterThanOrEqual(50);
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npm run test:run -- src/pageindex/__tests__/ocr-scan-detection.test.ts`
Expected: PASS

- [ ] **Step 3: 修改 fromPdf() 增加自动检测逻辑**

在 `pageindex.ts` 的 `fromPdf()` 方法中，将现有的 `if (this.options.extractionMode === "ocr")` 分支改为：

```typescript
async fromPdf(input: string | Buffer | ArrayBuffer): Promise<PageIndexResult> {
  let pages: PdfPage[];
  let pdfName: string;

  // 判断是否需要 OCR
  let useOcr = this.options.extractionMode === "ocr";

  // 自动检测模式：先快速解析前 5 页，检查文本密度
  if (!useOcr && this.options.extractionMode !== "text") {
    piLog("[fromPdf] Auto-detecting scanned PDF...");
    try {
      const pdfInfo = await parsePdf(input);
      const samplePages = pdfInfo.pages.slice(0, 5);
      if (samplePages.length > 0) {
        const avgCharsPerPage = samplePages
          .reduce((sum, p) => sum + p.text.trim().length, 0) / samplePages.length;
        if (avgCharsPerPage < 50) {
          piLog(`[fromPdf] Detected scanned PDF (avg ${avgCharsPerPage.toFixed(1)} chars/page), switching to OCR mode`);
          useOcr = true;
        }
      }
    } catch {
      // 解析失败时 fallback 到 OCR
      piLog("[fromPdf] PDF text extraction failed, falling back to OCR mode");
      useOcr = true;
    }
  }

  if (useOcr) {
    piLog("[OCR Mode] Processing PDF with OCR...");
    const ocrOptions: OcrOptions = {
      ocrModel: this.options.ocrModel || 'glm-4v-flash',
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      imageFormat: this.options.imageFormat,
      imageDpi: this.options.imageDpi,
      ocrPromptType: this.options.ocrPromptType,
      concurrency: this.options.ocrConcurrency,
    };
    const result = await parsePdfWithOcr(input, ocrOptions);
    pages = result.pages;
    pdfName = typeof input === "string" ? getPdfName(input) : "Untitled";
  } else {
    // Text mode: Direct text extraction（现有逻辑不变）
    const pdfInfo = await parsePdf(input);
    pages = pdfInfo.pages;
    pdfName = typeof input === "string" ? getPdfName(input) : pdfInfo.title;
    // ... 后续 outline/cover 逻辑保持不变
  }
```

注意：自动检测模式下，`parsePdf` 会被调用两次（一次检测、一次正式解析）。优化方案：检测通过后将 `pdfInfo` 缓存下来直接使用，避免重复解析。完整实现如下：

```typescript
async fromPdf(input: string | Buffer | ArrayBuffer): Promise<PageIndexResult> {
  let pages: PdfPage[];
  let pdfName: string;
  let cachedPdfInfo: Awaited<ReturnType<typeof parsePdf>> | null = null;

  // 判断是否需要 OCR
  let useOcr = this.options.extractionMode === "ocr";

  // 自动检测模式：先快速解析前 5 页，检查文本密度
  if (!useOcr && this.options.extractionMode !== "text") {
    piLog("[fromPdf] Auto-detecting scanned PDF...");
    try {
      cachedPdfInfo = await parsePdf(input);
      const samplePages = cachedPdfInfo.pages.slice(0, 5);
      if (samplePages.length > 0) {
        const avgCharsPerPage = samplePages
          .reduce((sum, p) => sum + p.text.trim().length, 0) / samplePages.length;
        if (avgCharsPerPage < 50) {
          piLog(`[fromPdf] Detected scanned PDF (avg ${avgCharsPerPage.toFixed(1)} chars/page), switching to OCR`);
          useOcr = true;
          cachedPdfInfo = null; // 不缓存，因为要走 OCR 路径
        }
      }
    } catch {
      piLog("[fromPdf] PDF text extraction failed, falling back to OCR");
      useOcr = true;
    }
  }

  if (useOcr) {
    piLog("[OCR Mode] Processing PDF with cloud GLM-4V...");
    const ocrOptions: OcrOptions = {
      ocrModel: this.options.ocrModel || 'glm-4v-flash',
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      imageFormat: this.options.imageFormat,
      imageDpi: this.options.imageDpi,
      ocrPromptType: this.options.ocrPromptType,
      concurrency: this.options.ocrConcurrency,
    };
    const result = await parsePdfWithOcr(input, ocrOptions);
    pages = result.pages;
    pdfName = typeof input === "string" ? getPdfName(input) : "Untitled";
  } else {
    // Text mode: 使用缓存的解析结果（避免重复解析）
    const pdfInfo = cachedPdfInfo || await parsePdf(input);
    pages = pdfInfo.pages;
    pdfName = typeof input === "string" ? getPdfName(input) : pdfInfo.title;
    // ... 后续 outline/cover 逻辑完全保持不变
  }
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 无 TypeScript 错误

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/pageindex.ts src/pageindex/__tests__/ocr-scan-detection.test.ts
git commit -m "feat: PageIndex.fromPdf() 自动检测扫描档 PDF 并切换 OCR 路径"
```

---

## Chunk 3: Build & Deploy Verification

### Task 4: 构建并部署验证

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 2: 运行测试**

Run: `npm run test:run`
Expected: 所有测试通过

- [ ] **Step 3: 部署到测试 vault**

Run: `cp bin/main.js /Users/lizhao/workspace/deepreadertest/.obsidian/plugins/deepreader/ && cp bin/styles.css /Users/lizhao/workspace/deepreadertest/.obsidian/plugins/deepreader/`

- [ ] **Step 4: 在 Obsidian 中 Cmd+R 重载，测试索引一个扫描档 PDF**
