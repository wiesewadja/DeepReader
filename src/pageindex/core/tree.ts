/**
 * PageIndex: Tree building and processing
 * Functions for building, processing, and managing document tree structures
 */

import { chatGPT, chatGPTWithUsage } from "../llm/client";
import { log as piLog } from "./logger";
import type { PdfPage } from "../parsers/pdf";
import type { TreeNode, TocItem } from "./types";
import {
  countTokens,
  postProcessing,
  addPrefaceIfNeeded,
  writeNodeId,
  structureToList,
  createCleanStructureForDescription,
  formatStructure,
} from "./utils";
import * as prompts from "./prompts";
import {
  tocTransformer,
  tocIndexExtractor,
  generateTocInit,
  generateTocContinue,
  addPageNumberToToc,
  checkTitleAppearance,
  checkTitleAppearanceInStartConcurrent,
  singleTocItemIndexFixer,
  type TocOptions,
} from "./toc";

export interface TreeOptions extends TocOptions {
  maxPageNumEachNode: number;
  maxTokenNumEachNode: number;
  addNodeId: boolean;
  addNodeSummary: boolean;
  addDocDescription: boolean;
  addNodeText: boolean;
  /** Whether to LLM-format node text as Markdown (PDF needs it, EPUB already has structure) */
  formatMarkdown?: boolean;
}

/**
 * Split page list into groups based on token limits
 */
export function pageListToGroupText(
  pageContents: string[],
  tokenLengths: number[],
  maxTokens: number = 20000,
  overlapPage: number = 1
): string[] {
  const numTokens = tokenLengths.reduce((a, b) => a + b, 0);

  if (numTokens <= maxTokens) {
    return [pageContents.join("")];
  }

  const subsets: string[] = [];
  let currentSubset: string[] = [];
  let currentTokenCount = 0;

  const expectedPartsNum = Math.ceil(numTokens / maxTokens);
  const averageTokensPerPart = Math.ceil(
    (numTokens / expectedPartsNum + maxTokens) / 2
  );

  for (let i = 0; i < pageContents.length; i++) {
    const pageContent = pageContents[i] || "";
    const pageTokens = tokenLengths[i] || 0;

    if (currentTokenCount + pageTokens > averageTokensPerPart) {
      subsets.push(currentSubset.join(""));
      // Start new subset from overlap
      const overlapStart = Math.max(i - overlapPage, 0);
      currentSubset = pageContents.slice(overlapStart, i);
      currentTokenCount = tokenLengths
        .slice(overlapStart, i)
        .reduce((a, b) => a + b, 0);
    }

    currentSubset.push(pageContent);
    currentTokenCount += pageTokens;
  }

  if (currentSubset.length > 0) {
    subsets.push(currentSubset.join(""));
  }

  return subsets;
}

/**
 * Extract matching page pairs from TOC
 */
function extractMatchingPagePairs(
  tocPage: TocItem[],
  tocPhysicalIndex: TocItem[],
  startPageIndex: number
): Array<{ title: string; page: number; physicalIndex: number }> {
  const pairs: Array<{ title: string; page: number; physicalIndex: number }> =
    [];

  for (const phyItem of tocPhysicalIndex) {
    for (const pageItem of tocPage) {
      if (phyItem.title === pageItem.title) {
        const physicalIndex = phyItem.physicalIndex;
        if (physicalIndex !== undefined && physicalIndex >= startPageIndex) {
          pairs.push({
            title: phyItem.title,
            page: pageItem.page || 0,
            physicalIndex,
          });
        }
      }
    }
  }

  return pairs;
}

/**
 * Calculate page offset from matching pairs
 */
function calculatePageOffset(
  pairs: Array<{ page: number; physicalIndex: number }>
): number | null {
  const differences: number[] = [];

  for (const pair of pairs) {
    const difference = pair.physicalIndex - pair.page;
    differences.push(difference);
  }

  if (differences.length === 0) return null;

  // Find most common difference
  const counts = new Map<number, number>();
  for (const diff of differences) {
    counts.set(diff, (counts.get(diff) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommon = 0;
  for (const [diff, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = diff;
    }
  }

  return mostCommon;
}

/**
 * Add page offset to TOC JSON
 */
function addPageOffsetToTocJson(data: TocItem[], offset: number): TocItem[] {
  for (const item of data) {
    if (item.page !== undefined && typeof item.page === "number") {
      item.physicalIndex = item.page + offset;
      delete item.page;
    }
  }
  return data;
}

/**
 * Process document without existing TOC
 */
export async function processNoToc(
  pages: PdfPage[],
  startIndex: number,
  options: TreeOptions
): Promise<TocItem[]> {
  const pageContents: string[] = [];
  const tokenLengths: number[] = [];

  for (let pageIndex = startIndex; pageIndex < startIndex + pages.length; pageIndex++) {
    const pageText = `<physical_index_${pageIndex}>\n${pages[pageIndex - startIndex]?.text || ""}\n<physical_index_${pageIndex}>\n\n`;
    pageContents.push(pageText);
    tokenLengths.push(countTokens(pageText));
  }

  const totalTokens = tokenLengths.reduce((a, b) => a + b, 0);
  piLog(`[processNoToc] Total pages: ${pages.length}, total tokens: ${totalTokens}, startIndex: ${startIndex}`);

  const groupTexts = pageListToGroupText(pageContents, tokenLengths, options.maxTokenNumEachNode);
  piLog(`[processNoToc] Split into ${groupTexts.length} groups (maxTokensPerGroup: ${options.maxTokenNumEachNode})`);

  const t0 = Date.now();
  piLog(`[processNoToc] Group 1/${groupTexts.length}: calling generateTocInit (input ~${countTokens(groupTexts[0] || "")} tokens)...`);
  let tocWithPageNumber = await generateTocInit(groupTexts[0] || "", options);
  piLog(`[processNoToc] Group 1 done: ${tocWithPageNumber.length} items, elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  for (let i = 1; i < groupTexts.length; i++) {
    const tGroup = Date.now();
    piLog(`[processNoToc] Group ${i + 1}/${groupTexts.length}: calling generateTocContinue (input ~${countTokens(groupTexts[i] || "")} tokens)...`);
    const additional = await generateTocContinue(tocWithPageNumber, groupTexts[i] || "", options);
    tocWithPageNumber.push(...additional);
    piLog(`[processNoToc] Group ${i + 1} done: +${additional.length} items (total ${tocWithPageNumber.length}), elapsed ${((Date.now() - tGroup) / 1000).toFixed(1)}s`);
  }

  piLog(`[processNoToc] Complete: ${tocWithPageNumber.length} TOC items in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return tocWithPageNumber;
}

/**
 * Process TOC without page numbers
 */
export async function processTocNoPageNumbers(
  tocContent: string,
  pages: PdfPage[],
  startIndex: number,
  options: TreeOptions
): Promise<TocItem[]> {
  const pageContents: string[] = [];
  const tokenLengths: number[] = [];

  const tocItems = await tocTransformer(tocContent, options);

  for (let pageIndex = startIndex; pageIndex < startIndex + pages.length; pageIndex++) {
    const pageText = `<physical_index_${pageIndex}>\n${pages[pageIndex - startIndex]?.text || ""}\n<physical_index_${pageIndex}>\n\n`;
    pageContents.push(pageText);
    tokenLengths.push(countTokens(pageText));
  }

  const groupTexts = pageListToGroupText(pageContents, tokenLengths, options.maxTokenNumEachNode);

  let tocWithPageNumber = [...tocItems];
  for (const groupText of groupTexts) {
    tocWithPageNumber = await addPageNumberToToc(groupText, tocWithPageNumber, options);
  }

  return tocWithPageNumber;
}

/**
 * Process TOC with page numbers
 */
export async function processTocWithPageNumbers(
  tocContent: string,
  tocPageList: number[],
  pages: PdfPage[],
  options: TreeOptions
): Promise<TocItem[]> {
  const tocWithPageNumber = await tocTransformer(tocContent, options);

  // Remove page numbers for physical index extraction
  const tocNoPageNumber = tocWithPageNumber.map((item) => {
    const newItem = { ...item };
    delete newItem.page;
    return newItem;
  });

  const startPageIndex = (tocPageList[tocPageList.length - 1] || 0) + 1;
  let mainContent = "";

  for (
    let pageIndex = startPageIndex;
    pageIndex < Math.min(startPageIndex + options.tocCheckPageNum, pages.length);
    pageIndex++
  ) {
    mainContent += `<physical_index_${pageIndex + 1}>\n${pages[pageIndex]?.text || ""}\n<physical_index_${pageIndex + 1}>\n\n`;
  }

  const tocWithPhysicalIndex = await tocIndexExtractor(tocNoPageNumber, mainContent, options);

  const matchingPairs = extractMatchingPagePairs(
    tocWithPageNumber,
    tocWithPhysicalIndex,
    startPageIndex
  );

  const offset = calculatePageOffset(matchingPairs);

  if (offset !== null) {
    addPageOffsetToTocJson(tocWithPageNumber, offset);
  }

  return tocWithPageNumber;
}

/**
 * Add text content to tree nodes
 */
export function addNodeText(
  node: TreeNode | TreeNode[],
  pages: PdfPage[]
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      addNodeText(item, pages);
    }
    return;
  }

  const startPage = node.startIndex;
  const endPage = node.endIndex;

  if (startPage !== undefined && endPage !== undefined) {
    let text = "";
    for (let i = startPage - 1; i < endPage && i < pages.length; i++) {
      text += pages[i]?.text || "";
    }
    // Strip any residual page delimiter markers
    text = text.replace(/===?PAGE_DELIMITER(?:_END?)?===?/g, "");
    node.text = text;
  }

  if (node.nodes) {
    addNodeText(node.nodes, pages);
  }
}

/**
 * Add text content to tree nodes with page labels
 */
export function addNodeTextWithLabels(
  node: TreeNode | TreeNode[],
  pages: PdfPage[]
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      addNodeTextWithLabels(item, pages);
    }
    return;
  }

  const startPage = node.startIndex;
  const endPage = node.endIndex;

  if (startPage !== undefined && endPage !== undefined) {
    let text = "";
    for (let i = startPage - 1; i < endPage && i < pages.length; i++) {
      text += `<physical_index_${i + 1}>\n${pages[i]?.text || ""}\n<physical_index_${i + 1}>\n`;
    }
    node.text = text;
  }

  if (node.nodes) {
    addNodeTextWithLabels(node.nodes, pages);
  }
}

/**
 * Generate summary for a single node
 */
interface NodeSummaryResult {
  content: string;
  durationMs: number;
  usage?: { inputTokens: number; outputTokens: number };
}

async function generateNodeSummary(
  node: TreeNode,
  options: TreeOptions
): Promise<NodeSummaryResult> {
  if (!node.text) return { content: "", durationMs: 0 };

  const t0 = Date.now();

  if (options.formatMarkdown !== false) {
    // Combined: format text + generate summary in one LLM call (PDF path)
    const prompt = prompts.formatAndSummarizePrompt(node.text, node.title || "");
    const result = await chatGPTWithUsage({
      model: options.model,
      prompt,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });

    // Parse response: <<<MARKDOWN>>>...\n<<<SUMMARY>>>...
    const mdMatch = result.content.match(/<<<MARKDOWN>>>([\s\S]*?)<<<SUMMARY>>>/);
    const summaryMatch = result.content.match(/<<<SUMMARY>>>([\s\S]*?)$/);

    if (mdMatch) {
      node.text = mdMatch[1].trim();
    }
    const summary = summaryMatch ? summaryMatch[1].trim() : result.content.trim();
    return { content: summary, durationMs: Date.now() - t0, usage: result.usage };
  } else {
    // EPUB path: text is already formatted, only generate summary
    const prompt = prompts.generateNodeSummaryPrompt(node.text);
    const result = await chatGPTWithUsage({
      model: options.model,
      prompt,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
    return { content: result.content, durationMs: Date.now() - t0, usage: result.usage };
  }
}

/**
 * Generate summaries for all nodes in structure
 * Also formats node text as proper Markdown (combined in one LLM call)
 */
export async function generateSummariesForStructure(
  structure: TreeNode[],
  options: TreeOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  const nodes = structureToList(structure);
  const total = nodes.length;

  piLog(`[generateSummaries] Processing ${total} nodes (format + summary)...`);

  // Process in batches to balance speed with API rate limits
  const batchSize = 3;
  for (let i = 0; i < nodes.length; i += batchSize) {
    const batch = nodes.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((node) => generateNodeSummary(node as TreeNode, options))
    );

    for (let j = 0; j < batch.length; j++) {
      const node = batch[j] as TreeNode;
      node.summary = results[j]!.content;
      options.onLlmCall?.({
        purpose: "generate_summary",
        model: options.model,
        durationMs: results[j]!.durationMs,
        inputTokens: results[j]!.usage?.inputTokens,
        outputTokens: results[j]!.usage?.outputTokens,
      });
    }

    // 报告进度
    const completed = Math.min(i + batchSize, total);
    onProgress?.(completed, total);
  }
}

/**
 * Generate document description from structure
 */
export async function generateDocDescription(
  structure: TreeNode[],
  options: TreeOptions
): Promise<string> {
  const t0 = Date.now();
  const cleanStructure = createCleanStructureForDescription(structure);
  const prompt = prompts.generateDocDescriptionPrompt(JSON.stringify(cleanStructure));

  const result = await chatGPTWithUsage({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  options.onLlmCall?.({
    purpose: "generate_description",
    model: options.model,
    durationMs: Date.now() - t0,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  });

  return result.content;
}

/**
 * Verify TOC by checking title appearances
 */
export async function verifyToc(
  pages: PdfPage[],
  listResult: TocItem[],
  startIndex: number,
  options: TreeOptions
): Promise<{
  correct: TocItem[];
  incorrect: Array<{ listIndex: number; title: string; physicalIndex?: number }>;
}> {
  const t0 = Date.now();
  const correct: TocItem[] = [];
  const incorrect: Array<{ listIndex: number; title: string; physicalIndex?: number }> = [];

  // Parallel verification — all checks are independent
  const results = await Promise.all(
    listResult.map((item, i) => {
      if (!item) return Promise.resolve(null);
      const itemWithIndex = { ...item, listIndex: i };
      return checkTitleAppearance(itemWithIndex, pages, startIndex, options).then(
        (result) => ({ item, index: i, result })
      );
    })
  );

  for (const entry of results) {
    if (!entry) continue;
    if (entry.result.answer === "yes") {
      correct.push(entry.item);
    } else {
      incorrect.push({
        listIndex: entry.index,
        title: entry.item.title,
        physicalIndex: entry.item.physicalIndex,
      });
    }
  }

  // checkTitleAppearance 内部使用 chatGPT（不含 usage），暂无法追踪 token
  options.onLlmCall?.({ purpose: "verify_page", model: options.model, durationMs: Date.now() - t0 });

  return { correct, incorrect };
}

/**
 * Fix incorrect TOC items
 */
export async function fixIncorrectToc(
  tocWithPageNumber: TocItem[],
  pages: PdfPage[],
  incorrectResults: Array<{ listIndex: number; title: string; physicalIndex?: number }>,
  startIndex: number,
  options: TreeOptions
): Promise<{
  fixed: TocItem[];
  stillIncorrect: Array<{ listIndex: number; title: string; physicalIndex?: number }>;
}> {
  const t0 = Date.now();
  const fixed = [...tocWithPageNumber];
  const stillIncorrect: Array<{ listIndex: number; title: string; physicalIndex?: number }> = [];
  const incorrectIndices = new Set(incorrectResults.map((r) => r.listIndex));
  const endIndex = pages.length + startIndex - 1;

  // All fix operations are independent — run in parallel
  const fixResults = await Promise.all(
    incorrectResults.map(async (incorrectItem) => {
      const { listIndex } = incorrectItem;

      // Find previous correct physical index
      let prevCorrect = startIndex - 1;
      for (let i = listIndex - 1; i >= 0; i--) {
        if (!incorrectIndices.has(i)) {
          const item = tocWithPageNumber[i];
          if (item?.physicalIndex !== undefined) {
            prevCorrect = item.physicalIndex;
            break;
          }
        }
      }

      // Find next correct physical index
      let nextCorrect = endIndex;
      for (let i = listIndex + 1; i < tocWithPageNumber.length; i++) {
        if (!incorrectIndices.has(i)) {
          const item = tocWithPageNumber[i];
          if (item?.physicalIndex !== undefined) {
            nextCorrect = item.physicalIndex;
            break;
          }
        }
      }

      // Build content for the range (truncate to fit model context window)
      const MAX_CONTENT_TOKENS = 40_000;
      const pageContents: string[] = [];
      let accumulatedTokens = 0;
      for (let pageIndex = prevCorrect; pageIndex <= nextCorrect; pageIndex++) {
        const idx = pageIndex - startIndex;
        if (idx >= 0 && idx < pages.length) {
          const pageText = `<physical_index_${pageIndex}>\n${pages[idx]?.text || ""}\n<physical_index_${pageIndex}>\n\n`;
          const pageTokens = countTokens(pageText);
          if (accumulatedTokens + pageTokens > MAX_CONTENT_TOKENS) {
            piLog(`[fixIncorrectToc] Truncated content at page ${pageIndex}, ${accumulatedTokens} tokens (range: ${prevCorrect}-${nextCorrect})`);
            break;
          }
          pageContents.push(pageText);
          accumulatedTokens += pageTokens;
        }
      }

      const contentRange = pageContents.join("");
      const physicalIndexInt = await singleTocItemIndexFixer(
        incorrectItem.title,
        contentRange,
        options
      );

      if (physicalIndexInt !== null && fixed[listIndex]) {
        fixed[listIndex]!.physicalIndex = physicalIndexInt;

        // Verify the fix
        const checkItem = { ...fixed[listIndex]!, listIndex };
        const checkResult = await checkTitleAppearance(checkItem, pages, startIndex, options);

        if (checkResult.answer !== "yes") {
          return {
            listIndex,
            title: incorrectItem.title,
            physicalIndex: physicalIndexInt,
          };
        }
        return null; // Successfully fixed
      } else {
        return incorrectItem;
      }
    })
  );

  for (const result of fixResults) {
    if (result !== null) {
      stillIncorrect.push(result);
    }
  }

  // singleTocItemIndexFixer 内部使用 chatGPT（不含 usage），暂无法追踪 token
  options.onLlmCall?.({ purpose: "fix_toc_entry", model: options.model, durationMs: Date.now() - t0 });

  return { fixed, stillIncorrect };
}

/**
 * Build final tree structure from TOC items
 */
export function buildTree(
  tocItems: TocItem[],
  endPhysicalIndex: number,
  options: TreeOptions
): TreeNode[] {
  // Add preface if needed
  const withPreface = addPrefaceIfNeeded(tocItems);

  // Post-process: add start/end indices and convert to tree
  const tree = postProcessing(withPreface, endPhysicalIndex);

  // Add node IDs if requested
  if (options.addNodeId) {
    writeNodeId(tree);
  }

  // Format structure with preferred key order
  const keyOrder = ["title", "nodeId", "startIndex", "endIndex", "summary", "text", "nodes"];
  return formatStructure(tree, keyOrder) as TreeNode[];
}
