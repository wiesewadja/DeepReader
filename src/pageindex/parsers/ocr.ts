/**
 * pageindex-ocr: OCR module for scanned PDFs
 * Uses system poppler tools for PDF→image conversion and GLM-OCR for text extraction
 * 
 * Node.js compatible version - uses native fetch API (no openai SDK dependency)
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { apiLog } from "../../utils/logger.js";
import { safeRequest } from "../../utils/safe-request.js";
import { log as piLog } from "../core/logger";
import { countTokens } from "../core/utils";
import {
  DEFAULT_OCR_MODEL,
  DEFAULT_IMAGE_FORMAT,
  DEFAULT_IMAGE_DPI,
  DEFAULT_OCR_CONCURRENCY,
} from "../defaults.js";
import type { PdfPage } from "./pdf";

/** 解析 poppler 工具可执行文件路径（兼容 macOS Electron renderer 进程） */
function popplerBin(name: string): string {
	if (process.platform !== "darwin") return name;
	for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
		const full = path.join(dir, name);
		if (existsSync(full)) return full;
	}
	return name;
}

export interface OcrOptions {
  /** OCR model to use (default: glm-ocr) */
  ocrModel?: string;
  /** API key for OCR model (required) */
  apiKey?: string;
  /** Base URL for OCR model API (default: https://open.bigmodel.cn/api/paas/v4) */
  baseUrl?: string;
  /** Image format for conversion (default: png) */
  imageFormat?: "png" | "jpeg";
  /** Image DPI for conversion (default: 150) */
  imageDpi?: number;
  /** Concurrent OCR requests (default: 3) */
  concurrency?: number;
}

const DEFAULT_OCR_OPTIONS: Required<Omit<OcrOptions, "apiKey" | "baseUrl">> = {
  ocrModel: DEFAULT_OCR_MODEL,
  imageFormat: DEFAULT_IMAGE_FORMAT,
  imageDpi: DEFAULT_IMAGE_DPI,
  concurrency: DEFAULT_OCR_CONCURRENCY,
};

/**
 * GLM-OCR layout_parsing API response structure
 */
interface LayoutParsingResponse {
  layout_analysis: {
    content_list: Array<{
      type: string;
      text: string;
      bbox?: number[];
    }>;
  };
}

/**
 * Check if poppler tools are installed on the system
 */
export async function checkPopplerInstalled(): Promise<boolean> {
  const cmd = popplerBin("pdftocairo");
  return new Promise((resolve) => {
    const child = spawn(cmd, ["-v"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      // pdftocairo -v 在多数系统上输出版本到 stderr 后返回 exit code 1
      resolve(code === 0 || code === 1);
    });
  });
}

/**
 * Get PDF page count using pdfinfo
 */
async function getPdfPageCount(pdfPath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(popplerBin("pdfinfo"), [pdfPath], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const match = stdout.match(/^Pages:\s*(\d+)/m);
      resolve(match ? parseInt(match[1]) : 0);
    });
  });
}

/**
 * Convert a PDF file to images using system pdftocairo
 * Returns paths to the generated images
 */
export async function pdfToImages(
  pdfPath: string,
  options: Pick<OcrOptions, "imageFormat" | "imageDpi"> = {}
): Promise<string[]> {
  const format = options.imageFormat || DEFAULT_OCR_OPTIONS.imageFormat;
  const dpi = options.imageDpi || DEFAULT_OCR_OPTIONS.imageDpi;

  // Check if poppler is installed
  const installed = await checkPopplerInstalled();
  if (!installed) {
    throw new Error(
      "Poppler tools not installed. Install with:\n" +
      "  macOS: brew install poppler\n" +
      "  Ubuntu: sudo apt-get install poppler-utils"
    );
  }

  // Create temp directory for images
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pageindex-ocr-"));
  const outputPrefix = path.join(tempDir, "page");

  // Use pdftocairo for conversion
  const formatFlag = format === "png" ? "-png" : "-jpeg";

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(popplerBin("pdftocairo"), [formatFlag, "-r", String(dpi), pdfPath, outputPrefix], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Exit code ${code}`)));
    });
  } catch (error) {
    // Cleanup on error
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`PDF conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Get list of generated images (sorted by page number)
  const files = await fs.readdir(tempDir);
  const imageFiles = files
    .filter((f) => f.endsWith(`.${format}`))
    .sort((a, b) => {
      // Extract page numbers from filenames like "page-1.png" or "page-01.png"
      const numA = parseInt(a.match(/-(\d+)\./)?.[1] || "0");
      const numB = parseInt(b.match(/-(\d+)\./)?.[1] || "0");
      return numA - numB;
    })
    .map((f) => path.join(tempDir, f));

  return imageFiles;
}

/**
 * Convert a PDF buffer to images
 */
export async function pdfBufferToImages(
  pdfBuffer: Buffer | ArrayBuffer,
  options: Pick<OcrOptions, "imageFormat" | "imageDpi"> = {}
): Promise<string[]> {
  // Write buffer to temp file
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pageindex-pdf-"));
  const tempPdfPath = path.join(tempDir, "input.pdf");

  const buffer = pdfBuffer instanceof ArrayBuffer ? Buffer.from(pdfBuffer) : pdfBuffer;
  await fs.writeFile(tempPdfPath, buffer);

  try {
    return await pdfToImages(tempPdfPath, options);
  } finally {
    // Cleanup temp PDF (images will be cleaned up after OCR)
    await fs.unlink(tempPdfPath).catch(() => {});
    await fs.rmdir(tempDir).catch(() => {});
  }
}

/**
 * Run OCR on a single image using GLM-OCR layout_parsing API
 */
export async function ocrImage(
  imagePath: string,
  options: OcrOptions = {}
): Promise<string> {
  const model = options.ocrModel || DEFAULT_OCR_OPTIONS.ocrModel;

  if (!options.apiKey) {
    apiLog.error("[OCR Error] API Key is required for cloud OCR");
    return "";
  }
  const apiKey = options.apiKey;
  // 支持用户自定义 OCR API 端点（默认使用智谱 GLM-OCR）
  const baseUrl = options.baseUrl || "https://open.bigmodel.cn/api/paas/v4";

  // Read image and convert to base64 data URL
  const imageData = await fs.readFile(imagePath);
  const base64Image = imageData.toString("base64");
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  try {
    // Use GLM-OCR layout_parsing API
    const response = await safeRequest({
      url: `${baseUrl}/layout_parsing`,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: apiKey },
      body: JSON.stringify({
        model,
        file: dataUrl,
      }),
    });

    if (response.status >= 400) {
      apiLog.error(`[OCR Error] API error: ${response.status} - ${response.text}`);
      return "";
    }

    const data = response.json as LayoutParsingResponse;

    // Extract text from content_list
    if (data.layout_analysis?.content_list) {
      return data.layout_analysis.content_list
        .map((item) => item.text)
        .filter(Boolean)
        .join("\n");
    }

    return "";
  } catch (error) {
    apiLog.error(`[OCR Error] Failed to process ${imagePath}:`, error);
    return "";
  }
}

/**
 * Run OCR on multiple images concurrently
 */
export async function ocrImages(
  imagePaths: string[],
  options: OcrOptions = {}
): Promise<string[]> {
  const concurrency = options.concurrency || DEFAULT_OCR_OPTIONS.concurrency;
  const results: string[] = [];

  for (let i = 0; i < imagePaths.length; i += concurrency) {
    const batch = imagePaths.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((imagePath) => ocrImage(imagePath, options))
    );
    results.push(...batchResults);

    // Log progress
    const processed = Math.min(i + concurrency, imagePaths.length);
    piLog(`[OCR] Processed ${processed}/${imagePaths.length} pages`);
  }

  return results;
}

/**
 * Parse PDF using OCR mode (for scanned PDFs)
 * Converts PDF to images, then uses GLM-OCR to extract text
 */
export async function parsePdfWithOcr(
  input: string | Buffer | ArrayBuffer,
  options: OcrOptions = {}
): Promise<{ pages: PdfPage[]; tempDir?: string }> {
  piLog("[OCR Mode] Converting PDF to images...");

  let imagePaths: string[];
  let tempDir: string | undefined;

  if (typeof input === "string") {
    // File path
    imagePaths = await pdfToImages(input, options);
  } else {
    // Buffer
    const buffer = input instanceof ArrayBuffer ? Buffer.from(input) : input;
    imagePaths = await pdfBufferToImages(buffer, options);
  }

  if (imagePaths.length > 0) {
    tempDir = path.dirname(imagePaths[0]!);
  }

  piLog(`[OCR Mode] Extracted ${imagePaths.length} page images`);
  piLog("[OCR Mode] Running OCR on pages...");

  // Run OCR on all images
  const texts = await ocrImages(imagePaths, options);

  // Convert to PdfPage format
  const pages: PdfPage[] = texts.map((text) => ({
    text,
    tokenCount: countTokens(text),
  }));

  // Cleanup images
  await cleanupTempImages(imagePaths);

  return { pages };
}

/**
 * Clean up temporary image files
 */
async function cleanupTempImages(imagePaths: string[]): Promise<void> {
  if (imagePaths.length === 0) return;

  const firstPath = imagePaths[0];
  if (!firstPath) return;
  
  const tempDir = path.dirname(firstPath);

  // Delete all images
  await Promise.all(
    imagePaths.map((p) => fs.unlink(p).catch(() => {}))
  );

  // Try to remove the temp directory
  await fs.rmdir(tempDir).catch(() => {});
}

/**
 * Get PDF info (page count) without full parsing
 */
export async function getPdfInfo(pdfPath: string): Promise<{ pages: number }> {
  const pages = await getPdfPageCount(pdfPath);
  return { pages };
}
