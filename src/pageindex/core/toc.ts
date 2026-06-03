/**
 * PageIndex: TOC Detection and Extraction
 * Functions for detecting, extracting, and processing table of contents
 */

import { chatGPT, chatGPTWithFinishReason } from "../llm/client";
import { log as piLog } from "./logger";
import { apiLog } from "../../utils/logger.js";
import type { PdfPage } from "../parsers/pdf";
import type { TocItem, TocCheckResult } from "./types";
import { extractJson, getJsonContent, convertPhysicalIndexToInt, convertPageToInt } from "./utils";
import * as prompts from "./prompts";
import type { LlmCallTrace } from "../index-tracer.js";

export interface TocOptions {
  model: string;
  tocCheckPageNum: number;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number; // 可选的输出 token 上限，不同模型不同
  onLlmCall?: (call: Omit<LlmCallTrace, "phase">) => void;
}

/**
 * Detect if a single page contains a TOC
 */
export async function tocDetectorSinglePage(
  content: string,
  options: TocOptions
): Promise<"yes" | "no"> {
  const prompt = prompts.tocDetectorPrompt(content);
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<{ toc_detected: string }>(response);
  return (json?.toc_detected === "yes" ? "yes" : "no");
}

/**
 * Find all pages containing TOC
 * Scans pages in parallel batches for faster detection
 */
export async function findTocPages(
  startPageIndex: number,
  pages: PdfPage[],
  options: TocOptions
): Promise<number[]> {
  const BATCH_SIZE = 5;
  const tocPageList: number[] = [];
  let foundAny = false;
  let foundEnd = false;

  // Scan pages in parallel batches
  for (let batchStart = startPageIndex; batchStart < Math.min(pages.length, options.tocCheckPageNum); batchStart += BATCH_SIZE) {
    if (foundEnd) break;

    const batchIndices: number[] = [];
    const batchPromises: Promise<"yes" | "no">[] = [];

    for (let i = batchStart; i < Math.min(batchStart + BATCH_SIZE, pages.length, options.tocCheckPageNum); i++) {
      const page = pages[i];
      if (!page || !page.text || page.text.trim().length === 0) continue;
      batchIndices.push(i);
      batchPromises.push(tocDetectorSinglePage(page.text, options));
    }

    if (batchPromises.length === 0) continue;

    const batchResults = await Promise.all(batchPromises);

    for (let j = 0; j < batchResults.length; j++) {
      const pageIndex = batchIndices[j];
      const detected = batchResults[j];

      if (detected === "yes") {
        tocPageList.push(pageIndex);
        foundAny = true;
      } else if (detected === "no" && foundAny) {
        // Found the end of the TOC section
        foundEnd = true;
        break;
      }
    }
  }

  return tocPageList;
}

/**
 * Transform dots/ellipsis to colon in TOC text
 */
function transformDotsToColon(text: string): string {
  // Handle multiple consecutive dots
  text = text.replace(/\.{5,}/g, ": ");
  // Handle dots separated by spaces
  text = text.replace(/(?:\. ){5,}\.?/g, ": ");
  return text;
}

/**
 * Detect if page numbers are given in TOC
 */
export async function detectPageIndex(
  tocContent: string,
  options: TocOptions
): Promise<"yes" | "no"> {
  const prompt = prompts.detectPageIndexPrompt(tocContent);
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<{ page_index_given_in_toc: string }>(response);
  return json?.page_index_given_in_toc === "yes" ? "yes" : "no";
}

/**
 * Extract TOC content from pages
 */
export async function tocExtractor(
  pages: PdfPage[],
  tocPageList: number[],
  options: TocOptions
): Promise<{ tocContent: string; pageIndexGivenInToc: "yes" | "no" }> {
  let tocContent = "";
  for (const pageIndex of tocPageList) {
    const page = pages[pageIndex];
    if (page) {
      tocContent += page.text;
    }
  }
  tocContent = transformDotsToColon(tocContent);
  
  const hasPageIndex = await detectPageIndex(tocContent, options);

  return {
    tocContent,
    pageIndexGivenInToc: hasPageIndex,
  };
}

/**
 * Try multiple methods to extract TocItem[] from LLM response
 * Handles truncated JSON, markdown-wrapped JSON, and partial responses
 */
function tryExtractTocItems(content: string): TocItem[] {
  // Method 1: Use extractJson (handles markdown blocks, cleaning, etc.)
  const json = extractJson<{ table_of_contents: TocItem[] }>(content);
  if (json?.table_of_contents?.length) {
    return convertPageToInt(json.table_of_contents);
  }

  // Method 2: Try parsing as top-level array
  const arrJson = extractJson<TocItem[]>(content);
  if (Array.isArray(arrJson) && arrJson.length > 0) {
    return convertPageToInt(arrJson);
  }

  // Method 3: Find "table_of_contents" array and extract items individually
  // This handles truncated JSON where the closing brackets are missing
  const tocArrayMatch = content.match(/"table_of_contents"\s*:\s*\[/);
  if (tocArrayMatch) {
    const arrayStart = content.indexOf("[", tocArrayMatch.index!);
    if (arrayStart !== -1) {
      // Extract individual items using regex
      const itemRegex = /\{\s*"structure"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]*)"/g;
      const items: TocItem[] = [];
      let match;
      while ((match = itemRegex.exec(content)) !== null) {
        const item: TocItem = { structure: match[1], title: match[2] };
        const fragment = content.slice(match.index, content.indexOf("}", match.index));
        // Try to extract physical_index
        const physMatch = fragment.match(/"physical_index"\s*:\s*"<physical_index_(\d+)>"/);
        if (physMatch) item.physicalIndex = parseInt(physMatch[1]);
        // Try to extract page number
        const pageMatch = fragment.match(/"page"\s*:\s*(\d+)/);
        if (pageMatch) item.page = parseInt(pageMatch[1]);
        items.push(item);
      }
      if (items.length > 0) {
        return convertPageToInt(items);
      }
    }
  }

  // Method 4: Extract items from truncated JSON by finding all complete objects
  const objectRegex = /\{\s*"structure"\s*:\s*"[^"]+"\s*,\s*"title"\s*:\s*"[^"]*"[^}]*\}/g;
  const items: TocItem[] = [];
  let objMatch;
  while ((objMatch = objectRegex.exec(content)) !== null) {
    try {
      const obj = JSON.parse(objMatch[0]) as Record<string, unknown>;
      if (obj.structure && obj.title !== undefined) {
        const item: TocItem = { structure: obj.structure as string, title: obj.title as string };
        // Normalize snake_case key
        if (obj.physical_index !== undefined) {
          const val = obj.physical_index;
          item.physicalIndex = typeof val === "number" ? val : parseInt(String(val).replace(/<physical_index_|>/g, ""), 10);
        }
        if (obj.page !== undefined) {
          item.page = obj.page as number;
        }
        items.push(item);
      }
    } catch {}
  }
  if (items.length > 0) {
    return convertPageToInt(items);
  }

  return [];
}

/**
 * Transform raw TOC content to JSON structure
 */
export async function tocTransformer(
  tocContent: string,
  options: TocOptions
): Promise<TocItem[]> {
  const prompt = prompts.tocTransformerPrompt(tocContent);
  const maxTokens = options.maxTokens || 8192;

  let t0 = Date.now();
  let { content: lastComplete, finishReason, usage: firstUsage } = await chatGPTWithFinishReason({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    maxTokens,
  });
  options.onLlmCall?.({ purpose: "extract_page_numbers", model: options.model, inputTokens: firstUsage?.inputTokens, outputTokens: firstUsage?.outputTokens, durationMs: Date.now() - t0 });

  piLog(`[DIAG-tocTransformer] LLM response length: ${lastComplete.length}, finishReason: ${finishReason}`);

  // Try to extract items from the first response (even if truncated)
  const firstAttemptItems = tryExtractTocItems(lastComplete);
  if (firstAttemptItems.length > 0) {
    piLog(`[DIAG-tocTransformer] Extracted ${firstAttemptItems.length} items from first response`);
    return firstAttemptItems;
  }

  // If LLM finished, try standard JSON parsing
  if (finishReason === "finished") {
    const json = extractJson<{ table_of_contents: TocItem[] }>(lastComplete);
    if (json?.table_of_contents) {
      piLog(`[DIAG-tocTransformer] Complete response: ${json.table_of_contents.length} items`);
      return convertPageToInt(json.table_of_contents);
    }
  }

  // Handle continuation — skip checkTocTransformationComplete when tryExtractTocItems suffices
  lastComplete = getJsonContent(lastComplete);
  let attempts = 0;
  const maxAttempts = 5;

  while (finishReason !== "finished" && attempts < maxAttempts) {
    // Trim to last complete object
    const position = lastComplete.lastIndexOf("}");
    if (position !== -1) {
      lastComplete = lastComplete.slice(0, position + 1);
    }

    const continuePrompt = prompts.tocTransformerContinuePrompt(tocContent, lastComplete);
    t0 = Date.now();
    const result = await chatGPTWithFinishReason({
      model: options.model,
      prompt: continuePrompt,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxTokens,
    });
    options.onLlmCall?.({ purpose: "extract_page_numbers", model: options.model, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, durationMs: Date.now() - t0 });

    let newContent = result.content;
    finishReason = result.finishReason;

    if (newContent.startsWith("```json")) {
      newContent = getJsonContent(newContent);
    }
    lastComplete = lastComplete + newContent;

    // Try to extract items after each continuation attempt
    const continuationItems = tryExtractTocItems(lastComplete);
    if (continuationItems.length > 0) {
      piLog(`[DIAG-tocTransformer] Extracted ${continuationItems.length} items after continuation ${attempts + 1}`);
      return continuationItems;
    }

    attempts++;
  }

  // Final attempt: try all extraction methods
  const finalItems = tryExtractTocItems(lastComplete);
  if (finalItems.length > 0) {
    piLog(`[DIAG-tocTransformer] Final extraction: ${finalItems.length} items`);
    return finalItems;
  }

  apiLog.error("[DIAG-tocTransformer] All JSON extraction methods failed, returning empty");
  return [];
}

/**
 * Extract physical index from pages for TOC items
 */
export async function tocIndexExtractor(
  toc: TocItem[],
  content: string,
  options: TocOptions
): Promise<TocItem[]> {
  const prompt = prompts.tocIndexExtractorPrompt(JSON.stringify(toc), content);
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<TocItem[]>(response);
  return json || [];
}

/**
 * Generate TOC from document pages (no existing TOC)
 */
export async function generateTocInit(
  part: string,
  options: TocOptions
): Promise<TocItem[]> {
  const prompt = prompts.generateTocInitPrompt(part);
  const inputTokens = Math.round(part.length / 4);
  piLog(`[generateTocInit] Sending to ${options.model} (input ~${inputTokens} chars, baseUrl: ${options.baseUrl})...`);

  const t0 = Date.now();
  const { content, finishReason, usage } = await chatGPTWithFinishReason({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    maxTokens: 16384,
  });
  const durationMs = Date.now() - t0;

  options.onLlmCall?.({ purpose: "generate_toc", model: options.model, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, durationMs });

  piLog(`[generateTocInit] Response received: finishReason=${finishReason}, output ${content.length} chars`);

  if (finishReason === "finished") {
    const json = extractJson<TocItem[]>(content);
    const items = Array.isArray(json) ? json : [];
    piLog(`[generateTocInit] Parsed ${items.length} TOC items`);
    return items;
  }

  // Truncated output — extract partial items instead of throwing
  const partialItems = tryExtractTocItems(content);
  if (partialItems.length > 0) {
    piLog(`[generateTocInit] Extracted ${partialItems.length} items from truncated response (${finishReason})`);
    return partialItems;
  }

  piLog(`[generateTocInit] ERROR: finishReason=${finishReason}, output preview: ${content.slice(0, 200)}`);
  throw new Error(`Generation incomplete: ${finishReason}`);
}

/**
 * Continue TOC generation with previous structure
 */
export async function generateTocContinue(
  tocContent: TocItem[],
  part: string,
  options: TocOptions
): Promise<TocItem[]> {
  const prompt = prompts.generateTocContinuePrompt(part, JSON.stringify(tocContent, null, 2));
  const inputTokens = Math.round(part.length / 4);
  piLog(`[generateTocContinue] Sending to ${options.model} (input ~${inputTokens} chars, context ${tocContent.length} items)...`);

  const t0 = Date.now();
  const { content, finishReason, usage } = await chatGPTWithFinishReason({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    maxTokens: 16384,
  });
  const durationMs = Date.now() - t0;

  options.onLlmCall?.({ purpose: "generate_toc", model: options.model, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, durationMs });

  piLog(`[generateTocContinue] Response received: finishReason=${finishReason}, output ${content.length} chars`);

  if (finishReason === "finished") {
    const json = extractJson<TocItem[]>(content);
    const items = Array.isArray(json) ? json : [];
    piLog(`[generateTocContinue] Parsed ${items.length} new TOC items`);
    return items;
  }

  // Truncated output — extract partial items instead of throwing
  const partialItems = tryExtractTocItems(content);
  if (partialItems.length > 0) {
    piLog(`[generateTocContinue] Extracted ${partialItems.length} items from truncated response (${finishReason})`);
    return partialItems;
  }

  piLog(`[generateTocContinue] ERROR: finishReason=${finishReason}, output preview: ${content.slice(0, 200)}`);
  throw new Error(`Generation incomplete: ${finishReason}`);
}

/**
 * Add page numbers to TOC structure from document parts
 */
export async function addPageNumberToToc(
  part: string,
  structure: TocItem[],
  options: TocOptions
): Promise<TocItem[]> {
  const prompt = prompts.addPageNumberToTocPrompt(part, JSON.stringify(structure, null, 2));
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<TocItem[]>(response);
  if (!json) return structure;

  // Remove 'start' field from items
  for (const item of json) {
    delete (item as unknown as Record<string, unknown>).start;
  }

  return json;
}

/**
 * Check title appearance in page
 */
export async function checkTitleAppearance(
  item: TocItem,
  pages: PdfPage[],
  startIndex: number,
  options: TocOptions
): Promise<{ listIndex: number | undefined; answer: "yes" | "no"; title: string; pageNumber: number | undefined }> {
  const title = item.title;
  
  if (!item.physicalIndex) {
    return { listIndex: item.listIndex, answer: "no", title, pageNumber: undefined };
  }

  const pageNumber = item.physicalIndex;
  const pageText = pages[pageNumber - startIndex]?.text || "";

  const prompt = prompts.checkTitleAppearancePrompt(title, pageText);
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<{ answer: string }>(response);
  const answer = json?.answer === "yes" ? "yes" : "no";

  return { listIndex: item.listIndex, answer, title, pageNumber };
}

/**
 * Check title appearance at start of page
 */
export async function checkTitleAppearanceInStart(
  title: string,
  pageText: string,
  options: TocOptions
): Promise<"yes" | "no"> {
  const prompt = prompts.checkTitleStartAtBeginningPrompt(title, pageText);
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<{ start_begin: string }>(response);
  return json?.start_begin === "yes" ? "yes" : "no";
}

/**
 * Check title appearance in start for multiple items concurrently
 */
export async function checkTitleAppearanceInStartConcurrent(
  structure: TocItem[],
  pages: PdfPage[],
  options: TocOptions
): Promise<TocItem[]> {
  // 分批处理，避免一次性发送大量并发请求触发 429 限流
  const batchSize = 5;
  const results: TocItem[] = [];

  for (let i = 0; i < structure.length; i += batchSize) {
    const batch = structure.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item) => {
        if (!item.physicalIndex) {
          return Promise.resolve({ ...item, appearStart: "no" as const });
        }
        const pageText = pages[item.physicalIndex - 1]?.text || "";
        return checkTitleAppearanceInStart(item.title, pageText, options).then(
          (appearStart) => ({ ...item, appearStart } as TocItem)
        );
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Check for TOC in PDF and return result
 */
export async function checkToc(
  pages: PdfPage[],
  options: TocOptions
): Promise<TocCheckResult> {
  const tocPageList = await findTocPages(0, pages, options);

  if (tocPageList.length === 0) {
    return {
      tocContent: null,
      tocPageList: [],
      pageIndexGivenInToc: "no",
    };
  }

  const tocResult = await tocExtractor(pages, tocPageList, options);

  if (tocResult.pageIndexGivenInToc === "yes") {
    return {
      tocContent: tocResult.tocContent,
      tocPageList,
      pageIndexGivenInToc: "yes",
    };
  }

  // Try to find additional TOC pages with page indices
  const lastTocPage = tocPageList[tocPageList.length - 1];
  let currentStartIndex = lastTocPage !== undefined ? lastTocPage + 1 : 0;
  
  while (currentStartIndex < pages.length && currentStartIndex < options.tocCheckPageNum) {
    const additionalTocPages = await findTocPages(currentStartIndex, pages, options);
    
    if (additionalTocPages.length === 0) {
      break;
    }

    const additionalTocResult = await tocExtractor(pages, additionalTocPages, options);
    
    if (additionalTocResult.pageIndexGivenInToc === "yes") {
      return {
        tocContent: additionalTocResult.tocContent,
        tocPageList: additionalTocPages,
        pageIndexGivenInToc: "yes",
      };
    }

    const lastAdditionalPage = additionalTocPages[additionalTocPages.length - 1];
    currentStartIndex = lastAdditionalPage !== undefined ? lastAdditionalPage + 1 : pages.length;
  }

  return {
    tocContent: tocResult.tocContent,
    tocPageList,
    pageIndexGivenInToc: "no",
  };
}

/**
 * Fix single TOC item index
 */
export async function singleTocItemIndexFixer(
  sectionTitle: string,
  content: string,
  options: TocOptions
): Promise<number | null> {
  const prompt = prompts.singleTocItemIndexFixerPrompt(sectionTitle, content);
  const response = await chatGPT({
    model: options.model,
    prompt,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  const json = extractJson<{ physical_index: string }>(response);
  if (!json?.physical_index) return null;

  const result = convertPhysicalIndexToInt(json.physical_index);
  return typeof result === "number" ? result : null;
}
