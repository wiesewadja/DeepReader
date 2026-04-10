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
import { convertPhysicalIndexToInt, removeFields, countTokens } from "./core/utils";
import { log as piLog } from "./core/logger";
import type { PageIndexOptions, PageIndexResult, TreeNode, TocItem, ExtractionMode, ProgressInfo } from "./core/types";

/**
 * Validate and truncate physical indices that exceed document length
 * Filters out items with undefined or out-of-range indices early,
 * preventing wasted verify+fix LLM calls on invalid entries
 */
function validateAndTruncatePhysicalIndices(items: TocItem[], totalPages: number): TocItem[] {
  return items.filter(item => {
    if (item.physicalIndex === undefined || item.physicalIndex === null) return false;
    if (item.physicalIndex < 1 || item.physicalIndex > totalPages) return false;
    return true;
  });
}
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
  /** Cover PNG from PDF first page, passed through to result */
  private _pendingCoverPng?: Buffer;

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
      piLog("[OCR Mode] Processing PDF with OCR...");
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

      // Pass cover image through
      this._pendingCoverPng = pdfInfo.coverPng;

      // Save outline for fallback
      const savedOutline = pdfInfo.outline;

      // LLM-first: always try LLM path for better TOC accuracy
      // (outline path skips verification, causing text misalignment)
      try {
        const result = await this.processPdfPages(pages, pdfName);
        result.coverPng = this._pendingCoverPng;
        this._pendingCoverPng = undefined;
        return result;
      } catch (error) {
        // LLM failed — fall back to outline if available
        if (savedOutline && savedOutline.length > 0) {
          piLog(`[fromPdf] LLM path failed, falling back to outline (${savedOutline.length} entries): ${(error as Error).message}`);
          const result = await this.processPdfWithOutline(pages, savedOutline, pdfName);
          result.coverPng = this._pendingCoverPng;
          this._pendingCoverPng = undefined;
          return result;
        }
        throw error;
      }
    }

    // OCR mode path (no outline available)
    const result = await this.processPdfPages(pages, pdfName);
    result.coverPng = this._pendingCoverPng;
    this._pendingCoverPng = undefined;
    return result;
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
    piLog(
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
      piLog("Generating structure from document content...");
      tocItems = await processNoToc(pages, startIndex, this.options);
    } else if (tocResult.pageIndexGivenInToc === "no") {
      // TOC without page numbers
      piLog("Processing TOC without page numbers...");
      tocItems = await processTocNoPageNumbers(
        tocResult.tocContent,
        pages,
        startIndex,
        this.options
      );
    } else {
      // TOC with page numbers
      piLog("Processing TOC with page numbers...");
      tocItems = await processTocWithPageNumbers(
        tocResult.tocContent,
        tocResult.tocPageList,
        pages,
        this.options
      );
    }

    // Convert physical_index strings to integers
    tocItems = convertPhysicalIndexToInt(tocItems) as TocItem[];

    // Validate: filter out items with invalid/out-of-range physical indices early
    tocItems = validateAndTruncatePhysicalIndices(tocItems, pages.length);
    piLog(`After validation: ${tocItems.length} valid TOC items`);

    if (tocItems.length === 0) {
      throw new Error("No valid TOC items after validation");
    }

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
    piLog("Verifying TOC...");
    const { incorrect } = await verifyToc(pages, tocItems, startIndex, this.options);
    const accuracy = tocItems.length > 0 ? (tocItems.length - incorrect.length) / tocItems.length : 0;
    piLog(`TOC accuracy: ${(accuracy * 100).toFixed(1)}% (${incorrect.length} incorrect)`);

    // Accuracy-based fallback cascade (matching Python PageIndex behavior)
    if (accuracy < 0.6 && tocResult.tocContent !== null) {
      // Downgrade strategy and retry
      piLog(`Accuracy too low (${(accuracy * 100).toFixed(1)}%), retrying with fallback strategy...`);
      if (tocResult.pageIndexGivenInToc === "yes") {
        // TOC with page numbers → try without page numbers
        piLog("Falling back: processTocWithPageNumbers → processTocNoPageNumbers");
        tocItems = await processTocNoPageNumbers(tocResult.tocContent, pages, startIndex, this.options);
      } else {
        // TOC without page numbers → generate from scratch
        piLog("Falling back: processTocNoPageNumbers → processNoToc");
        tocItems = await processNoToc(pages, startIndex, this.options);
      }
      tocItems = convertPhysicalIndexToInt(tocItems) as TocItem[];
      tocItems = validateAndTruncatePhysicalIndices(tocItems, pages.length);
      if (tocItems.length === 0) {
        throw new Error("No valid TOC items after fallback");
      }
      tocItems = await checkTitleAppearanceInStartConcurrent(tocItems, pages, this.options);

      // Re-verify after fallback to check quality
      const reverifyResult = await verifyToc(pages, tocItems, startIndex, this.options);
      const reverifyAccuracy = tocItems.length > 0 ? (tocItems.length - reverifyResult.incorrect.length) / tocItems.length : 0;
      piLog(`Fallback accuracy: ${(reverifyAccuracy * 100).toFixed(1)}% (${reverifyResult.incorrect.length} incorrect)`);

      if (reverifyAccuracy < 0.6) {
        // All strategies exhausted — throw to trigger outline fallback in fromPdf
        throw new Error(`TOC accuracy still too low after fallback: ${(reverifyAccuracy * 100).toFixed(1)}%`);
      }

      if (reverifyResult.incorrect.length > 0) {
        piLog(`Fixing ${reverifyResult.incorrect.length} incorrect items after fallback...`);
        const fixResult = await fixIncorrectToc(tocItems, pages, reverifyResult.incorrect, startIndex, this.options);
        tocItems = fixResult.fixed;
      }
    } else if (incorrect.length > 0) {
      // Fix incorrect items (up to 2 retries for transient errors)
      piLog(`Fixing ${incorrect.length} incorrect TOC items...`);
      let fixed = tocItems;
      let remainingIncorrect = incorrect;
      for (let retry = 0; retry < 2 && remainingIncorrect.length > 0; retry++) {
        const result = await fixIncorrectToc(fixed, pages, remainingIncorrect, startIndex, this.options);
        fixed = result.fixed;
        remainingIncorrect = result.stillIncorrect;
        if (remainingIncorrect.length > 0) {
          piLog(`Retry ${retry + 1}: ${remainingIncorrect.length} items still incorrect`);
        }
      }
      tocItems = fixed;
    }

    // Build tree structure
    const tree = buildTree(tocItems, endPhysicalIndex, this.options);

    // Add node text if requested
    if (this.options.addNodeText || this.options.addNodeSummary) {
      addNodeText(tree, pages);
    }

    // Recursively split large leaf nodes into sub-chapters
    await this.processLargeNodesRecursively(tree, pages);

    return this.finalizeProcessing(tree, docName);
  }

  /**
   * Recursively split large leaf nodes into sub-chapters
   * Matches Python PageIndex's process_large_node_recursively behavior
   */
  private async processLargeNodesRecursively(
    nodes: TreeNode[],
    pages: PdfPage[]
  ): Promise<void> {
    const maxPageNum = this.options.maxPageNumEachNode;
    const maxTokenNum = this.options.maxTokenNumEachNode;
    const leafNodes: { node: TreeNode; parent?: TreeNode; index?: number }[] = [];

    // Collect all leaf nodes (nodes without children)
    const collectLeaves = (items: TreeNode[], parent?: TreeNode) => {
      for (let i = 0; i < items.length; i++) {
        const node = items[i];
        if (!node.nodes || node.nodes.length === 0) {
          leafNodes.push({ node, parent, index: i });
        } else {
          collectLeaves(node.nodes, node);
        }
      }
    };
    collectLeaves(nodes);

    // Filter to only large nodes that need splitting
    const largeNodes = leafNodes.filter(({ node }) => {
      const pageCount = (node.endIndex ?? 0) - (node.startIndex ?? 0);
      const tokenCount = node.text ? countTokens(node.text) : 0;
      return pageCount > maxPageNum && tokenCount > maxTokenNum;
    });

    if (largeNodes.length === 0) return;

    piLog(`[processLargeNodes] Splitting ${largeNodes.length} large leaf nodes...`);

    // Process all large nodes in parallel (siblings are independent)
    const results = await Promise.all(
      largeNodes.map(async ({ node, parent, index }) => {
        const startPage = (node.startIndex ?? 1) - 1; // 0-based
        const endPage = node.endIndex ?? pages.length;
        const subPages = pages.slice(startPage, endPage);

        if (subPages.length === 0) return null;

        try {
          const subTocItems = await processNoToc(subPages, 1, this.options);
          const validated = validateAndTruncatePhysicalIndices(subTocItems, subPages.length);
          if (validated.length === 0) return null;

          const subTree = buildTree(validated, subPages.length, this.options);

          // Offset page indices back to document-level
          const offsetTree = (items: TreeNode[], offset: number) => {
            for (const item of items) {
              if (item.startIndex !== undefined) item.startIndex += offset;
              if (item.endIndex !== undefined) item.endIndex += offset;
              if (item.nodes) offsetTree(item.nodes, offset);
            }
          };
          offsetTree(subTree, startPage);

          // Add text to sub-nodes
          addNodeText(subTree, pages);

          return { subTree, parent, index: index! };
        } catch (e) {
          piLog(`[processLargeNodes] Failed to split node "${node.title}": ${(e as Error).message}`);
          return null;
        }
      })
    );

    // Apply results: replace large leaf nodes with their sub-chapters
    for (const result of results) {
      if (!result) continue;
      const { subTree, parent, index } = result;
      if (parent) {
        // Replace the leaf node with sub-chapter in parent's nodes array
        parent.nodes = parent.nodes || [];
        parent.nodes.splice(index, 1, ...subTree);
      } else {
        // Top-level replacement
        nodes.splice(index, 1, ...subTree);
      }
    }

    // Recurse on newly created leaf nodes
    await this.processLargeNodesRecursively(nodes, pages);
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
    piLog(`[Outline] Converted ${tocItems.length} TOC items from bookmarks`);

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
      piLog("Generating summaries...");
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
      piLog("Generating document description...");
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
    piLog("[EPUB Mode] Processing EPUB...");

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

    piLog(`[EPUB Mode] Extracted ${pages.length} chapters`);

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

    piLog(`[EPUB Mode] Built ${tocItems.length} TOC items from chapter structure`);

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
      piLog("Generating summaries...");
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
      piLog("Generating document description...");
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
    piLog(
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
      piLog("Generating structure from chapter content...");
      tocItems = await processNoToc(pages, startIndex, this.options);
    } else {
      // Use embedded TOC
      piLog("Processing embedded TOC...");
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
