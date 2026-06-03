/**
 * PageIndex: Main PageIndex API
 * Primary entry point for PDF document indexing
 */

import { parsePdf, getPdfName, type PdfPage } from "./parsers/pdf";
import { parseEpub, epubChaptersToPages, splitLargeEpubPages, EPUB_SPLIT_THRESHOLD } from "./parsers/epub";
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
import { convertPhysicalIndexToInt, removeFields, countTokens, structureToList } from "./core/utils";
import { log as piLog } from "./core/logger";
import type { PageIndexOptions, PageIndexResult, TreeNode, TocItem, ExtractionMode, ProgressInfo } from "./core/types";

/**
 * Flatten PDF outline (bookmarks) to a Map<title, pageNumber> for easy lookup
 */
function flattenOutlineToMap(outline: TreeNode[]): Map<string, number> {
  const map = new Map<string, number>();
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.title && node.startIndex && node.startIndex > 0) {
        map.set(node.title.trim(), node.startIndex);
      }
      if (node.nodes?.length) walk(node.nodes);
    }
  };
  walk(outline);
  return map;
}

/**
 * Find a bookmark page number that matches the given title (fuzzy matching)
 * Strips common punctuation/whitespace for comparison
 */
function findBookmarkMatch(title: string, bookmarkMap: Map<string, number>): number | null {
  const normalize = (s: string) => s.replace(/[\s\-—:：.·]/g, "").toLowerCase();
  const normalizedTitle = normalize(title);

  // Exact match first
  for (const [bmTitle, page] of bookmarkMap) {
    if (normalize(bmTitle) === normalizedTitle) return page;
  }

  // Substring match: TOC title contains bookmark title or vice versa
  for (const [bmTitle, page] of bookmarkMap) {
    const normBm = normalize(bmTitle);
    if (normBm.length > 2 && (normalizedTitle.includes(normBm) || normBm.includes(normalizedTitle))) {
      return page;
    }
  }

  return null;
}

/**
 * Evaluate if PDF outline/bookmarks are high-quality enough to skip LLM
 * Criteria: enough entries with valid page numbers and good page coverage
 */
function isOutlineHighQuality(outline: TreeNode[], totalPages: number): boolean {
  const MIN_ENTRIES = 5;

  let validEntries = 0;
  let minPage = Infinity;
  let maxPage = 0;

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      const page = node.startIndex;
      if (page !== undefined && page > 0) {
        validEntries++;
        minPage = Math.min(minPage, page);
        maxPage = Math.max(maxPage, page);
      }
      if (node.nodes?.length) walk(node.nodes);
    }
  };
  walk(outline);

  if (validEntries < MIN_ENTRIES) return false;

  const span = maxPage - minPage + 1;
  const coverage = span / totalPages;
  return coverage >= 0.6;
}

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
  DEFAULT_IMAGE_DPI,
  DEFAULT_IMAGE_FORMAT,
  DEFAULT_OCR_CONCURRENCY,
} from "./defaults.js";

interface InternalOptions extends TreeOptions {
  extractionMode: ExtractionMode;
  ocrModel: string;
  imageDpi: number;
  imageFormat: "png" | "jpeg";
  ocrConcurrency: number;
  mineruApiKey?: string;
  onProgress?: (progress: ProgressInfo) => void;
}

const DEFAULT_OPTIONS: Required<Omit<PageIndexOptions, "apiKey" | "baseUrl" | "mineruApiKey" | "onProgress" | "onLlmCall" | "ocrPromptType">> = {
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
      mineruApiKey: options.mineruApiKey,
      onProgress: options.onProgress,
      onLlmCall: options.onLlmCall,
      // OCR options
      extractionMode: options.extractionMode || DEFAULT_OPTIONS.extractionMode,
      ocrModel: options.ocrModel || DEFAULT_OPTIONS.ocrModel,
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
    let mineruImages: import("./parsers/mineru-types").MineruImage[] | undefined;

    // ── MinerU 云 API 解析（主路径）──
    // MinerU 精准 API 使用 VLM 视觉模型，本身能处理扫描版 PDF，
    // 因此不再做文本密度检测和 OCR 回退，直接信任 MinerU 结果。
    const hasMineruToken = !!this.options.mineruApiKey;

    if (hasMineruToken || this.options.extractionMode !== "ocr") {
      piLog("[fromPdf] Parsing PDF with MinerU API...");
      // MinerU 解析是独立的 try-catch，失败时直接报错（不降级 OCR）
      const pdfInfo = await parsePdf(input, this.options.mineruApiKey, (msg) => {
        this.options.onProgress?.({ percent: 10, message: msg, stage: 'mineru_batch', step: 0, totalSteps: 0 });
      });
      pages = pdfInfo.pages;
      pdfName = typeof input === "string" ? getPdfName(input) : pdfInfo.title;
      mineruImages = pdfInfo.images;

      const savedOutline = pdfInfo.outline;

      // Outline-first: if PDF has high-quality bookmarks, skip LLM entirely
      if (savedOutline && savedOutline.length > 0 && isOutlineHighQuality(savedOutline, pdfInfo.totalPages)) {
        piLog(`[fromPdf] PDF has ${savedOutline.length} high-quality bookmarks, using outline directly (skipping LLM)`);
        const result = await this.processPdfWithOutline(pages, savedOutline, pdfName);
        result.images = mineruImages;
        return result;
      }

      // LLM path: use outline as hint for page mapping accuracy
      const result = await this.processPdfPages(pages, pdfName, savedOutline);
      result.images = mineruImages;
      return result;
    }

    // ── OCR 兜底路径（无 Token 或 MinerU 失败）──
    return this.ocrFallback(input);
  }

  /** OCR 兜底解析（提取为方法以便复用） */
  private async ocrFallback(input: string | Buffer | ArrayBuffer): Promise<PageIndexResult> {
    piLog("[fromPdf] Using OCR fallback...");
    const ocrOptions: OcrOptions = {
      ocrModel: this.options.ocrModel || DEFAULT_OCR_MODEL,
      apiKey: this.options.apiKey,
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      imageFormat: this.options.imageFormat,
      imageDpi: this.options.imageDpi,
      concurrency: this.options.ocrConcurrency,
    };
    const result = await parsePdfWithOcr(input, ocrOptions);
    const pages = result.pages;
    const pdfName = typeof input === "string" ? getPdfName(input) : "Untitled";

    const ocrResult = await this.processPdfPages(pages, pdfName);
    ocrResult.images = undefined;
    return ocrResult;
  }

  /**
   * Process PDF pages directly
   */
  async processPdfPages(pages: PdfPage[], docName: string, outline?: TreeNode[]): Promise<PageIndexResult> {
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

    // Use PDF bookmarks (outline) to correct LLM page mapping inaccuracies
    if (outline && outline.length > 0) {
      const bookmarkMap = flattenOutlineToMap(outline);
      let corrected = 0;
      for (const item of tocItems) {
        const bookmarkPage = findBookmarkMatch(item.title, bookmarkMap);
        if (bookmarkPage !== null && item.physicalIndex !== bookmarkPage) {
          piLog(`[Outline hint] "${item.title}": LLM=${item.physicalIndex} → bookmark=${bookmarkPage}`);
          item.physicalIndex = bookmarkPage;
          corrected++;
        }
      }
      if (corrected > 0) {
        piLog(`[Outline hint] Corrected ${corrected}/${tocItems.length} items using PDF bookmarks`);
      }
    }

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
    const t0 = Date.now();
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

    this.options.onLlmCall?.({ purpose: "split_large_node", model: this.options.model, durationMs: Date.now() - t0 });
  }

  /**
   * Process PDF using embedded bookmarks/outline as TOC
   * No LLM calls needed for structure detection
   */
  async processPdfWithOutline(
    pages: PdfPage[],
    outline: TreeNode[],
    docName: string
  ): Promise<PageIndexResult> {
    const endPhysicalIndex = pages.length;

    // Convert TreeNode[] (Mineru) to TocItem format
    let tocItems: TocItem[] = [];
    let listIndex = 0;

    const flatten = (nodes: TreeNode[], parentStructure?: string) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const structure = parentStructure
          ? `${parentStructure}.${i + 1}`
          : `${i + 1}`;

        if (node.startIndex && node.startIndex > 0) {
          tocItems.push({
            structure,
            title: node.title,
            physicalIndex: node.startIndex,
            listIndex: listIndex++,
          });
        }

        if (node.nodes?.length) {
          flatten(node.nodes, structure);
        }
      }
    };

    flatten(outline);
    piLog(`[Outline] Converted ${tocItems.length} TOC items from bookmarks`);

    // Convert physical_index strings to integers (already integers from outline, but ensure consistency)
    tocItems = convertPhysicalIndexToInt(tocItems) as TocItem[];

    // Add appear_start field for correct endIndex calculation
    tocItems = await checkTitleAppearanceInStartConcurrent(tocItems, pages, this.options);

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

    // EPUB text is already structured HTML→Markdown, skip LLM formatting
    const epubOptions = { ...this.options, formatMarkdown: false as const };

    piLog(`[EPUB Mode] Extracted ${pages.length} chapters`);

    // EPUB spine may have few entries with entire book in one HTML file.
    // Split large pages by markdown heading markers for proper chapter granularity.
    const splitResult = splitLargeEpubPages(pages, epubInfo.chapters);
    if (splitResult.split) {
      piLog(`[EPUB Mode] Splitting large pages (threshold: ${EPUB_SPLIT_THRESHOLD} tokens)...`);
      piLog(`[EPUB Mode] Page count: ${pages.length} → ${splitResult.pages.length}`);
      pages.length = 0;
      pages.push(...splitResult.pages);
      epubInfo.chapters.length = 0;
      epubInfo.chapters.push(...splitResult.chapters);
    }

    const endPhysicalIndex = pages.length;
    const totalChapters = epubInfo.chapters.length;

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

    const tree = buildTree(tocItems, endPhysicalIndex, epubOptions);

    // EPUB: re-index nodeId from 1-based to match exportToObsidian's buildEpubTree
    // which uses String(i + 1).padStart(4, "0"). Without this, enrichNode in
    // book-indexer.ts matches wrong nodes (parseResult 0000 ↔ hierarchicalTree 0001).
    {
      const flatNodes = structureToList(tree);
      for (const node of flatNodes) {
        if (node.nodeId) {
          const oldNum = parseInt(node.nodeId, 10);
          node.nodeId = String(oldNum + 1).padStart(4, "0");
        }
      }
    }

    // Add node text if requested
    if (epubOptions.addNodeText || epubOptions.addNodeSummary) {
      addNodeText(tree, pages);
    }

    // Step 2: Generate summaries — progress mapped by chapter count (10%-95%)
    if (epubOptions.addNodeSummary) {
      this.reportProgress({
        stage: "generating_summaries",
        message: `正在生成摘要 (0/${totalChapters})`,
        step: 2,
        totalSteps: 3,
        percent: 10,
      });
      piLog("Generating summaries...");
      await generateSummariesForStructure(tree, epubOptions, (completed, total) => {
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
    if (epubOptions.addDocDescription) {
      this.reportProgress({
        stage: "generating_description",
        message: "生成文档描述...",
        step: 3,
        totalSteps: 3,
        percent: 96,
      });
      piLog("Generating document description...");
      docDescription = await generateDocDescription(tree, epubOptions);
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
    if (!epubOptions.addNodeText) {
      finalStructure = removeFields(tree, ["text"]) as TreeNode[];
    }

    return {
      docName,
      docDescription,
      author: epubInfo.author,
      structure: finalStructure,
      coverImage: epubInfo.coverImage,
      epubInfo,
    };
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
