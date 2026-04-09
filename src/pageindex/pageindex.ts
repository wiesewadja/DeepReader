/**
 * PageIndex: Main PageIndex API
 * Primary entry point for PDF document indexing
 */

import { parsePdf, getPdfName, outlineToTocItems, type PdfInfo, type PdfPage, type PdfOutlineItem } from "./parsers/pdf";
import { parseEpub, getEpubName, epubChaptersToPages } from "./parsers/epub";
import { parsePdfWithOcr, type OcrOptions } from "./parsers/ocr";
import { checkToc, checkTitleAppearanceInStartConcurrent, type TocOptions } from "./core/toc";
import {
  processNoToc,
  processTocNoPageNumbers,
  processTocWithPageNumbers,
  buildTree,
  addNodeText,
  generateSummariesForStructure,
  generateDocDescription,
  verifyToc,
  fixIncorrectToc,
  type TreeOptions,
} from "./core/tree";
import { convertPhysicalIndexToInt, removeFields } from "./core/utils";
import type { PageIndexOptions, PageIndexResult, TreeNode, TocItem, ExtractionMode, ProgressInfo } from "./core/types";
import type { ObsidianVaultIndexOptions, VaultIndexResult, SearchOptions, SearchResult } from "./vault/types";
import { indexObsidianVault as indexVault, getVaultIndexStatus as getVaultStatus, loadVaultIndex } from "./vault";
import { searchVault as searchVaultFn } from "./vault/search";
import {
  DEFAULT_MODEL,
  DEFAULT_ADD_NODE_ID,
  DEFAULT_ADD_NODE_SUMMARY,
  DEFAULT_ADD_DOC_DESCRIPTION,
  DEFAULT_ADD_NODE_TEXT,
  DEFAULT_TOC_CHECK_PAGE_NUM,
  DEFAULT_MAX_PAGE_NUM_EACH_NODE,
  DEFAULT_MAX_TOKEN_NUM_EACH_NODE,
  DEFAULT_EXTRACTION_MODE,
  DEFAULT_OCR_MODEL,
  DEFAULT_OCR_PROMPT_TYPE,
  DEFAULT_IMAGE_DPI,
  DEFAULT_IMAGE_FORMAT,
  DEFAULT_OCR_CONCURRENCY,
} from "./defaults.js";

interface InternalOptions extends TreeOptions {
  extractionMode: ExtractionMode;
  ocrModel: string;
  ocrPromptType: "text" | "formula" | "table";
  imageDpi: number;
  imageFormat: "png" | "jpeg";
  ocrConcurrency: number;
  onProgress?: (progress: ProgressInfo) => void;
}

const DEFAULT_OPTIONS: Required<Omit<PageIndexOptions, "apiKey" | "baseUrl" | "onProgress">> = {
  model: DEFAULT_MODEL,
  tocCheckPageNum: DEFAULT_TOC_CHECK_PAGE_NUM,
  maxPageNumEachNode: DEFAULT_MAX_PAGE_NUM_EACH_NODE,
  maxTokenNumEachNode: DEFAULT_MAX_TOKEN_NUM_EACH_NODE,
  addNodeId: DEFAULT_ADD_NODE_ID,
  addNodeSummary: DEFAULT_ADD_NODE_SUMMARY,
  addDocDescription: DEFAULT_ADD_DOC_DESCRIPTION,
  addNodeText: DEFAULT_ADD_NODE_TEXT,
  // OCR defaults
  extractionMode: DEFAULT_EXTRACTION_MODE,
  ocrModel: DEFAULT_OCR_MODEL,
  ocrPromptType: DEFAULT_OCR_PROMPT_TYPE,
  imageDpi: DEFAULT_IMAGE_DPI,
  imageFormat: DEFAULT_IMAGE_FORMAT,
  ocrConcurrency: DEFAULT_OCR_CONCURRENCY,
};

/**
 * Main PageIndex class for processing PDFs
 * Supports both text extraction (native PDFs) and OCR mode (scanned PDFs)
 */
export class PageIndex {
  private options: InternalOptions;

  constructor(options: PageIndexOptions = {}) {
    this.options = {
      model: options.model || DEFAULT_OPTIONS.model,
      tocCheckPageNum: options.tocCheckPageNum || DEFAULT_OPTIONS.tocCheckPageNum,
      maxPageNumEachNode: options.maxPageNumEachNode || DEFAULT_OPTIONS.maxPageNumEachNode,
      maxTokenNumEachNode: options.maxTokenNumEachNode || DEFAULT_OPTIONS.maxTokenNumEachNode,
      addNodeId: options.addNodeId ?? DEFAULT_OPTIONS.addNodeId,
      addNodeSummary: options.addNodeSummary ?? DEFAULT_OPTIONS.addNodeSummary,
      addDocDescription: options.addDocDescription ?? DEFAULT_OPTIONS.addDocDescription,
      addNodeText: options.addNodeText ?? DEFAULT_OPTIONS.addNodeText,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      onProgress: options.onProgress,
      // OCR options
      extractionMode: options.extractionMode || DEFAULT_OPTIONS.extractionMode,
      ocrModel: options.ocrModel || DEFAULT_OPTIONS.ocrModel,
      ocrPromptType: options.ocrPromptType || DEFAULT_OPTIONS.ocrPromptType,
      imageDpi: options.imageDpi || DEFAULT_OPTIONS.imageDpi,
      imageFormat: options.imageFormat || DEFAULT_OPTIONS.imageFormat,
      ocrConcurrency: options.ocrConcurrency || DEFAULT_OPTIONS.ocrConcurrency,
    };
  }

  /**
   * Set base URL for OpenAI-compatible API (e.g., LM Studio)
   */
  setBaseUrl(baseUrl: string): this {
    this.options.baseUrl = baseUrl;
    return this;
  }

  /**
   * Use LM Studio configuration
   */
  useLMStudio(): this {
    this.options.baseUrl = "http://localhost:1234/v1";
    this.options.apiKey = "lm-studio";
    return this;
  }

  /**
   * Use Ollama configuration
   */
  useOllama(): this {
    this.options.baseUrl = "http://localhost:11434/v1";
    this.options.apiKey = "ollama";
    return this;
  }

  /**
   * Enable OCR mode for scanned PDFs
   */
  useOcrMode(ocrModel?: string): this {
    this.options.extractionMode = "ocr";
    if (ocrModel) {
      this.options.ocrModel = ocrModel;
    }
    return this;
  }

  /**
   * Report progress via callback
   */
  private reportProgress(progress: ProgressInfo): void {
    if (this.options.onProgress) {
      this.options.onProgress(progress);
    }
  }

  /**
   * Process a PDF file and build tree index
   */
  async fromPdf(input: string | Buffer | ArrayBuffer): Promise<PageIndexResult> {
    let pages: PdfPage[];
    let pdfName: string;

    if (this.options.extractionMode === "ocr") {
      // OCR mode: Convert PDF to images and extract text via vision model
      console.log("[OCR Mode] Processing PDF with OCR...");
      const ocrOptions: OcrOptions = {
        ocrModel: this.options.ocrModel,
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
      // Text mode: Direct text extraction
      const pdfInfo = await parsePdf(input);
      pages = pdfInfo.pages;
      pdfName = typeof input === "string" ? getPdfName(input) : pdfInfo.title;

      // Prefer PDF bookmarks/outline (embedded TOC) — no LLM needed
      if (pdfInfo.outline && pdfInfo.outline.length > 0) {
        console.log(`[PDF Outline] Found ${pdfInfo.outline.length} bookmark entries, using as TOC`);
        return this.processPdfWithOutline(pages, pdfInfo.outline, pdfName);
      }
    }

    return this.processPdfPages(pages, pdfName);
  }

  /**
   * Process PDF pages directly
   */
  async processPdfPages(pages: PdfPage[], docName: string): Promise<PageIndexResult> {
    const startIndex = 1;
    const endPhysicalIndex = pages.length;
    const totalSteps = 6;
    let currentStep = 0;

    // Step 1: Check for TOC
    this.reportProgress({
      stage: "detecting_toc",
      message: "检测文档目录 (TOC)...",
      step: ++currentStep,
      totalSteps,
      percent: Math.round((currentStep / totalSteps) * 100),
    });
    const tocResult = await checkToc(pages, this.options);
    console.log(
      `TOC found: ${tocResult.tocContent !== null}, Pages: ${tocResult.tocPageList.length}, Has page numbers: ${tocResult.pageIndexGivenInToc}`
    );

    let tocItems: TocItem[];

    // Step 2: Parse structure
    this.reportProgress({
      stage: "parsing_structure",
      message: tocResult.tocContent ? "解析目录结构..." : "从内容生成结构...",
      step: ++currentStep,
      totalSteps,
      percent: Math.round((currentStep / totalSteps) * 100),
    });

    if (tocResult.tocContent === null) {
      // No TOC - generate structure from document
      console.log("Generating structure from document content...");
      tocItems = await processNoToc(pages, startIndex, this.options);
    } else if (tocResult.pageIndexGivenInToc === "no") {
      // TOC without page numbers
      console.log("Processing TOC without page numbers...");
      tocItems = await processTocNoPageNumbers(
        tocResult.tocContent,
        pages,
        startIndex,
        this.options
      );
    } else {
      // TOC with page numbers
      console.log("Processing TOC with page numbers...");
      tocItems = await processTocWithPageNumbers(
        tocResult.tocContent,
        tocResult.tocPageList,
        pages,
        this.options
      );
    }

    // Convert physical_index strings to integers
    tocItems = convertPhysicalIndexToInt(tocItems) as TocItem[];

    // Add appear_start field
    tocItems = await checkTitleAppearanceInStartConcurrent(tocItems, pages, this.options);

    // Step 3: Verify TOC
    this.reportProgress({
      stage: "verifying_pages",
      message: "验证目录页码...",
      step: ++currentStep,
      totalSteps,
      percent: Math.round((currentStep / totalSteps) * 100),
    });
    console.log("Verifying TOC...");
    const { incorrect } = await verifyToc(pages, tocItems, startIndex, this.options);

    // Fix incorrect items if any
    if (incorrect.length > 0) {
      console.log(`Fixing ${incorrect.length} incorrect TOC items...`);
      const { fixed } = await fixIncorrectToc(
        tocItems,
        pages,
        incorrect,
        startIndex,
        this.options
      );
      tocItems = fixed;
    }

    // Build tree structure
    const tree = buildTree(tocItems, endPhysicalIndex, this.options);

    // Add node text if requested
    if (this.options.addNodeText || this.options.addNodeSummary) {
      addNodeText(tree, pages);
    }

    return this.finalizeProcessing(tree, docName);
  }

  /**
   * Process PDF using embedded bookmarks/outline as TOC
   * No LLM calls needed for structure detection
   */
  async processPdfWithOutline(
    pages: PdfPage[],
    outline: PdfOutlineItem[],
    docName: string
  ): Promise<PageIndexResult> {
    const endPhysicalIndex = pages.length;

    // Convert outline to TocItem format
    let tocItems = outlineToTocItems(outline);
    console.log(`[Outline] Converted ${tocItems.length} TOC items from bookmarks`);

    // Convert physical_index strings to integers (already integers from outline, but ensure consistency)
    tocItems = convertPhysicalIndexToInt(tocItems) as TocItem[];

    // Build tree structure directly — no verification needed, bookmarks are authoritative
    const tree = buildTree(tocItems, endPhysicalIndex, this.options);

    // Add node text if requested
    if (this.options.addNodeText || this.options.addNodeSummary) {
      addNodeText(tree, pages);
    }

    return this.finalizeProcessing(tree, docName);
  }

  /**
   * Finalize processing - generate summaries, description, cleanup
   */
  private async finalizeProcessing(
    tree: TreeNode[],
    docName: string
  ): Promise<PageIndexResult> {
    const totalSteps = 6;
    let currentStep = 3; // Already did TOC detection, structure parsing, verification

    // Step 4: Generate summaries
    if (this.options.addNodeSummary) {
      this.reportProgress({
        stage: "generating_summaries",
        message: "生成节点摘要...",
        step: ++currentStep,
        totalSteps,
        percent: Math.round((currentStep / totalSteps) * 100),
      });
      console.log("Generating summaries...");
      await generateSummariesForStructure(tree, this.options, (completed, total) => {
        const basePercent = Math.round((currentStep / totalSteps) * 100);
        const nextPercent = Math.round(((currentStep + 1) / totalSteps) * 100);
        const summaryPercent = basePercent + Math.round((completed / total) * (nextPercent - basePercent));
        this.reportProgress({
          stage: "generating_summaries",
          message: `正在生成摘要 (${completed}/${total})`,
          step: currentStep,
          totalSteps,
          percent: summaryPercent,
        });
      });
    } else {
      currentStep++;
    }

    // Step 5: Generate document description
    let docDescription: string | undefined;
    if (this.options.addDocDescription) {
      this.reportProgress({
        stage: "generating_description",
        message: "生成文档描述...",
        step: ++currentStep,
        totalSteps,
        percent: Math.round((currentStep / totalSteps) * 100),
      });
      console.log("Generating document description...");
      docDescription = await generateDocDescription(tree, this.options);
    } else {
      currentStep++;
    }

    // Step 6: Complete
    this.reportProgress({
      stage: "complete",
      message: "处理完成!",
      step: totalSteps,
      totalSteps,
      percent: 100,
    });

    // Remove text if not requested in output
    let finalStructure = tree;
    if (!this.options.addNodeText) {
      finalStructure = removeFields(tree, ["text"]) as TreeNode[];
    }

    return {
      docName,
      docDescription,
      structure: finalStructure,
    };
  }

  /**
   * Process an EPUB file and build tree index
   * EPUB chapters are inherently structured — no LLM needed for TOC detection
   */
  async fromEpub(input: string | Buffer): Promise<PageIndexResult> {
    console.log("[EPUB Mode] Processing EPUB...");

    this.reportProgress({
      stage: "parsing_structure",
      message: "解析 EPUB 文档...",
      step: 1,
      totalSteps: 3,
      percent: 5,
    });

    const epubInfo = await parseEpub(input);
    const pages = epubChaptersToPages(epubInfo.chapters);
    const docName = epubInfo.title;
    const endPhysicalIndex = pages.length;
    const totalChapters = epubInfo.chapters.length;

    console.log(`[EPUB Mode] Extracted ${pages.length} chapters`);

    this.reportProgress({
      stage: "parsing_structure",
      message: `解析完成，共 ${totalChapters} 章节`,
      step: 1,
      totalSteps: 3,
      percent: 10,
    });

    // EPUB chapters are already structured — build tree directly
    // Each chapter maps 1:1 to a physical index
    const tocItems: TocItem[] = epubInfo.chapters.map((ch, i) => ({
      structure: `${i + 1}`,
      title: ch.title || `Chapter ${i + 1}`,
      physicalIndex: i + 1, // 1-based
      listIndex: i,
    }));

    console.log(`[EPUB Mode] Built ${tocItems.length} TOC items from chapter structure`);

    const tree = buildTree(tocItems, endPhysicalIndex, this.options);

    // Add node text if requested
    if (this.options.addNodeText || this.options.addNodeSummary) {
      addNodeText(tree, pages);
    }

    // Step 2: Generate summaries — progress mapped by chapter count (10%-95%)
    if (this.options.addNodeSummary) {
      this.reportProgress({
        stage: "generating_summaries",
        message: `正在生成摘要 (0/${totalChapters})`,
        step: 2,
        totalSteps: 3,
        percent: 10,
      });
      console.log("Generating summaries...");
      await generateSummariesForStructure(tree, this.options, (completed, total) => {
        // Map progress: 10%-95% range for summary generation
        const summaryPercent = 10 + Math.round((completed / total) * 85);
        this.reportProgress({
          stage: "generating_summaries",
          message: `正在生成摘要 (${completed}/${total})`,
          step: 2,
          totalSteps: 3,
          percent: summaryPercent,
        });
      });
    }

    // Step 3: Generate document description
    let docDescription: string | undefined;
    if (this.options.addDocDescription) {
      console.log("Generating document description...");
      docDescription = await generateDocDescription(tree, this.options);
    }

    this.reportProgress({
      stage: "complete",
      message: "处理完成!",
      step: 3,
      totalSteps: 3,
      percent: 100,
    });

    // Remove text if not requested in output
    let finalStructure = tree;
    if (!this.options.addNodeText) {
      finalStructure = removeFields(tree, ["text"]) as TreeNode[];
    }

    return {
      docName,
      docDescription,
      author: epubInfo.author,
      structure: finalStructure,
      coverImage: epubInfo.coverImage,
    };
  }
  async processEpubPages(pages: PdfPage[], docName: string): Promise<PageIndexResult> {
    const startIndex = 1;
    const endPhysicalIndex = pages.length;
    const totalSteps = 6;
    let currentStep = 0;

    // Step 1: Check for TOC (EPUBs often have NCX/TOC)
    this.reportProgress({
      stage: "detecting_toc",
      message: "检测 EPUB 目录...",
      step: ++currentStep,
      totalSteps,
      percent: Math.round((currentStep / totalSteps) * 100),
    });

    // For EPUBs, we skip TOC detection since structure comes from spine
    // But we still need to run checkToc to see if content has embedded TOC
    const tocResult = await checkToc(pages, this.options);
    console.log(
      `TOC found: ${tocResult.tocContent !== null}, Pages: ${tocResult.tocPageList.length}`
    );

    let tocItems: TocItem[];

    // Step 2: Parse structure
    this.reportProgress({
      stage: "parsing_structure",
      message: tocResult.tocContent ? "解析目录结构..." : "从章节生成结构...",
      step: ++currentStep,
      totalSteps,
      percent: Math.round((currentStep / totalSteps) * 100),
    });

    if (tocResult.tocContent === null) {
      // No embedded TOC - generate structure from chapters
      console.log("Generating structure from chapter content...");
      tocItems = await processNoToc(pages, startIndex, this.options);
    } else {
      // Use embedded TOC
      console.log("Processing embedded TOC...");
      tocItems = await processTocWithPageNumbers(
        tocResult.tocContent,
        tocResult.tocPageList,
        pages,
        this.options
      );
    }

    // Convert physical_index strings to integers
    tocItems = convertPhysicalIndexToInt(tocItems) as TocItem[];

    // Add appear_start field
    tocItems = await checkTitleAppearanceInStartConcurrent(tocItems, pages, this.options);

    // Step 3: Skip TOC verification for EPUB
    // EPUB chapters come from the spine/manifest with known physical indices.
    // Unlike PDFs where TOC page numbers may not match actual pages,
    // EPUB structure is deterministic and doesn't need verify + fix cycle.
    this.reportProgress({
      stage: "verifying_pages",
      message: "构建章节树...",
      step: ++currentStep,
      totalSteps,
      percent: Math.round((currentStep / totalSteps) * 100),
    });

    // Build tree structure
    const tree = buildTree(tocItems, endPhysicalIndex, this.options);

    // Add node text if requested
    if (this.options.addNodeText || this.options.addNodeSummary) {
      addNodeText(tree, pages);
    }

    return this.finalizeProcessing(tree, docName);
  }

  /**
   * Index an Obsidian vault (or subdirectories)
   */
  async fromObsidianVault(options: ObsidianVaultIndexOptions): Promise<VaultIndexResult> {
    return indexVault({
      ...options,
      model: options.model || this.options.model,
      apiKey: options.apiKey || this.options.apiKey,
      baseUrl: options.baseUrl || this.options.baseUrl,
      addNodeId: options.addNodeId ?? this.options.addNodeId,
      addNodeSummary: options.addNodeSummary ?? this.options.addNodeSummary,
      addNodeText: options.addNodeText ?? this.options.addNodeText,
      addDocDescription: options.addDocDescription ?? this.options.addDocDescription,
    });
  }

  /**
   * Get vault index status without re-indexing
   */
  async getVaultIndexStatus(vaultPath: string): Promise<{
    exists: boolean;
    lastIndexed: string | null;
    fileCount: number;
    staleFiles: string[];
  }> {
    return getVaultStatus(vaultPath);
  }

  /**
   * Search the indexed vault
   */
  async searchVault(query: string, vaultPath: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const index = await loadVaultIndex(vaultPath);
    if (!index) {
      throw new Error(`No vault index found at ${vaultPath}. Run fromObsidianVault() first.`);
    }
    return searchVaultFn(query, index, options);
  }
}

/**
 * Create a PageIndex instance with options
 */
export function createPageIndex(options?: PageIndexOptions): PageIndex {
  return new PageIndex(options);
}

/**
 * Quick function to process a PDF file
 */
export async function indexPdf(
  input: string | Buffer | ArrayBuffer,
  options?: PageIndexOptions
): Promise<PageIndexResult> {
  const pageIndex = new PageIndex(options);
  return pageIndex.fromPdf(input);
}

/**
 * Quick function to process a PDF with LM Studio
 */
export async function indexPdfWithLMStudio(
  input: string | Buffer | ArrayBuffer,
  model: string = "local-model",
  options?: Omit<PageIndexOptions, "model" | "apiKey">
): Promise<PageIndexResult> {
  const pageIndex = new PageIndex({ ...options, model }).useLMStudio();
  return pageIndex.fromPdf(input);
}

/**
 * Quick function to process a scanned PDF with OCR mode
 * Uses GLM-OCR for text extraction and a reasoning model for indexing
 */
export async function indexPdfWithOcr(
  input: string | Buffer | ArrayBuffer,
  options?: Omit<PageIndexOptions, "extractionMode"> & {
    reasoningModel?: string;
    ocrModel?: string;
  }
): Promise<PageIndexResult> {
  const pageIndex = new PageIndex({
    ...options,
    extractionMode: "ocr",
    model: options?.reasoningModel || options?.model || "gpt-4o-2024-11-20",
    ocrModel: options?.ocrModel || "mlx-community/GLM-OCR-bf16",
  });
  return pageIndex.fromPdf(input);
}

/**
 * Quick function to process a scanned PDF with LM Studio (OCR mode)
 * Uses GLM-OCR for text extraction and a local reasoning model
 */
export async function indexPdfWithLMStudioOcr(
  input: string | Buffer | ArrayBuffer,
  reasoningModel: string = "qwen/qwen3-vl-30b",
  ocrModel: string = "mlx-community/GLM-OCR-bf16",
  options?: Omit<PageIndexOptions, "model" | "apiKey" | "extractionMode" | "ocrModel">
): Promise<PageIndexResult> {
  const pageIndex = new PageIndex({
    ...options,
    model: reasoningModel,
    ocrModel,
    extractionMode: "ocr",
  }).useLMStudio();
  return pageIndex.fromPdf(input);
}

/**
 * Quick function to process an EPUB file
 */
export async function indexEpub(
  input: string | Buffer,
  options?: PageIndexOptions
): Promise<PageIndexResult> {
  const pageIndex = new PageIndex(options);
  return pageIndex.fromEpub(input);
}

/**
 * Quick function to process an EPUB with LM Studio
 */
export async function indexEpubWithLMStudio(
  input: string | Buffer,
  model: string = "local-model",
  options?: Omit<PageIndexOptions, "model" | "apiKey">
): Promise<PageIndexResult> {
  const pageIndex = new PageIndex({ ...options, model }).useLMStudio();
  return pageIndex.fromEpub(input);
}

/**
 * Quick function to index an Obsidian vault
 */
export async function indexObsidianVault(
  options: ObsidianVaultIndexOptions
): Promise<VaultIndexResult> {
  const pageIndex = new PageIndex(options);
  return pageIndex.fromObsidianVault(options);
}

export { searchVault } from "./vault/search";
export { loadVaultIndex } from "./vault";
export type { ObsidianVaultIndexOptions, VaultIndexResult, SearchOptions, SearchResult, EmbeddingOptions } from "./vault/types";
