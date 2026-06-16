import type { TreeNode } from "./types.js";
import {
  flattenStructure,
  assessByLevel,
  detectLanguage,
  type LayerQuality,
  type FlattenNode,
} from "./toc-quality.js";
import { TOC_CLEANUP_BATCH_PROMPT, TOC_SUBTITLE_BATCH_PROMPT } from "./cleanup-prompts.js";
import { chatGPTWithUsage } from "../llm/client.js";
import { log as piLog } from "./logger.js";

export interface CleanTocOptions {
  bookTitle: string;
  llmClient?: any; // kept for signature compatibility
  model: string;
  apiKey?: string;
  baseUrl?: string;
  onLlmCall?: (call: any) => void;
}

export interface LayerCleanupReport {
  level: number;
  totalNodes: number;
  cleanedCount: number;
  preservedCount: number;
  fallbackCount: number;
  isBroken: boolean;
  reason: string;
}

export interface CleanupResult {
  cleanedCount: number;
  preservedCount: number;
  fallbackCount: number;
  quality: "good" | "degraded" | "poor";
  qualityReason?: string;
  perLayer: LayerCleanupReport[];
}

/**
 * Extracts a JSON array from LLM response text
 */
export function extractJsonArray(text: string): any[] {
  // Try balanced bracket matching to correctly handle nested arrays
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "[") depth++;
      else if (text[j] === "]") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("Could not find JSON array in LLM response");
}

/**
 * Mutates the original structure to update a node title using its path
 */
export function updateNodeTitle(structure: TreeNode[], path: number[], newTitle: string) {
  let current: TreeNode[] = structure;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    const node = current[idx];
    if (!node) return;
    if (i === path.length - 1) {
      node.title = newTitle;
      return;
    }
    current = node.nodes || [];
  }
}

/**
 * Main entrance for TOC title cleanup using LLM reasoning
 */
export async function cleanTocTitles(
  structure: TreeNode[],
  options: CleanTocOptions
): Promise<{ structure: TreeNode[]; result: CleanupResult }> {
  const { bookTitle, model, apiKey, baseUrl, onLlmCall } = options;

  const result: CleanupResult = {
    cleanedCount: 0,
    preservedCount: 0,
    fallbackCount: 0,
    quality: "good",
    perLayer: [],
  };

  if (!structure || structure.length === 0) {
    return { structure, result };
  }

  // 1. Flatten and assess
  const flattenNodes = flattenStructure(structure, bookTitle);
  const layerQualities = assessByLevel(flattenNodes, bookTitle);

  // Group flatten nodes by level for processing
  const nodesByLevel = new Map<number, FlattenNode[]>();
  flattenNodes.forEach((node) => {
    const list = nodesByLevel.get(node.level) || [];
    list.push(node);
    nodesByLevel.set(node.level, list);
  });

  // Track degraded or poor layers
  let hasDegraded = false;
  let hasPoor = false;

  // 2. Clean layer-by-layer
  for (const quality of layerQualities) {
    const nodes = nodesByLevel.get(quality.level) || [];
    if (nodes.length === 0) continue;

    const report: LayerCleanupReport = {
      level: quality.level,
      totalNodes: quality.totalNodes,
      cleanedCount: 0,
      preservedCount: 0,
      fallbackCount: 0,
      isBroken: quality.isBroken,
      reason: quality.reason,
    };

    if (!quality.isBroken) {
      result.perLayer.push(report);
      continue;
    }

    piLog(`[TOC Cleanup] Layer level=${quality.level} is broken. Reason: ${quality.reason}. Cleaning...`);

    // Unique titles set to prevent sibling duplication within the layer
    const usedTitles = new Set<string>();

    if (quality.reason === "placeholders" && quality.bookNamePlaceholderCount === quality.totalNodes) {
      // Rule 4: Entire layer is book name placeholders -> run subtitle batch extraction
      hasPoor = true;
      try {
        const cleanedNodesMap = new Map<string, string>(); // nodeId -> subtitle

        // Filter nodes that have text content
        const nodesWithText = nodes.filter((n) => n.text && n.text.trim().length > 0);

        // Batch processing (max 15 nodes per batch)
        const batchSize = 15;
        for (let i = 0; i < nodesWithText.length; i += batchSize) {
          const batch = nodesWithText.slice(i, i + batchSize);

          const nodeListPrompt = batch
            .map((n) => `- nodeId ${n.nodeId}: current title "${n.originalTitle}"`)
            .join("\n");
          const excerptsPrompt = batch
            .map((n) => `### nodeId ${n.nodeId}\n${(n.text || "").slice(0, 300)}`)
            .join("\n\n");

          const prompt = TOC_SUBTITLE_BATCH_PROMPT
            .replace("{bookTitle}", bookTitle)
            .replace("{nodeList}", nodeListPrompt)
            .replace("{bodyExcerpts}", excerptsPrompt);

          const t0 = Date.now();
          const chatResult = await chatGPTWithUsage({
            model,
            prompt,
            apiKey,
            baseUrl,
          });
          const durationMs = Date.now() - t0;
          onLlmCall?.({
            purpose: "toc_cleanup_subtitles",
            model,
            durationMs,
            usage: chatResult.usage,
          });

          const parsedArr = extractJsonArray(chatResult.content);
          parsedArr.forEach((item: any) => {
            if (item.nodeId && item.subtitle) {
              cleanedNodesMap.set(item.nodeId, item.subtitle.trim());
            }
          });
        }

        // Apply fallback naming
        const isZhBook = detectLanguage(bookTitle) === "zh";

        nodes.forEach((node, index) => {
          const numbering = isZhBook ? `第 ${index + 1} 章` : `Chapter ${index + 1}`;
          const subtitle = cleanedNodesMap.get(node.nodeId);

          let finalTitle = numbering;
          if (subtitle && subtitle.length > 0) {
            finalTitle = isZhBook ? `${numbering} · ${subtitle}` : `${numbering}: ${subtitle}`;
          }

          updateNodeTitle(structure, node.path, finalTitle);
          report.fallbackCount++;
          result.fallbackCount++;
        });

      } catch (err) {
        piLog(`[TOC Cleanup] Subtitle extraction failed for level=${quality.level}: ${err}. Falling back to default numbering.`);
        hasDegraded = true;
        // Default numbering fallback
        const isZhBook = detectLanguage(bookTitle) === "zh";
        nodes.forEach((node, index) => {
          const finalTitle = isZhBook ? `第 ${index + 1} 章` : `Chapter ${index + 1}`;
          updateNodeTitle(structure, node.path, finalTitle);
          report.fallbackCount++;
          result.fallbackCount++;
        });
      }

    } else {
      // Normal Batch Cleanup
      try {
        const batchSize = 15;
        for (let i = 0; i < nodes.length; i += batchSize) {
          const batch = nodes.slice(i, i + batchSize);

          const nodeListPrompt = batch
            .map((n) => `- nodeId ${n.nodeId}: current title "${n.originalTitle}"`)
            .join("\n");
          const excerptsPrompt = batch
            .map((n) => `### nodeId ${n.nodeId}\n${(n.text || "").slice(0, 300)}`)
            .join("\n\n");

          let prompt = TOC_CLEANUP_BATCH_PROMPT
            .replace("{bookTitle}", bookTitle)
            .replace("{depth}", String(quality.level + 1))
            .replace("{parentTitle}", batch[0]?.parentTitle || "None")
            .replace("{nodeList}", nodeListPrompt)
            .replace("{bodyExcerpts}", excerptsPrompt);

          // Inject already used titles to prevent duplicates across batches
          if (usedTitles.size > 0) {
            prompt += `\n\n- Already used titles in this layer (DO NOT duplicate): ${Array.from(
              usedTitles
            ).join(", ")}`;
          }

          const t0 = Date.now();
          const chatResult = await chatGPTWithUsage({
            model,
            prompt,
            apiKey,
            baseUrl,
          });
          const durationMs = Date.now() - t0;
          onLlmCall?.({
            purpose: "toc_cleanup_batch",
            model,
            durationMs,
            usage: chatResult.usage,
          });

          const parsedArr = extractJsonArray(chatResult.content);
          const responseMap = new Map<string, { inferred_title: string; confidence: number }>();
          parsedArr.forEach((item: any) => {
            if (item.nodeId && item.inferred_title) {
              responseMap.set(item.nodeId, {
                inferred_title: item.inferred_title,
                confidence: typeof item.confidence === "number" ? item.confidence : 1.0,
              });
            }
          });

          // Apply clean titles
          batch.forEach((node) => {
            const llmRes = responseMap.get(node.nodeId);
            if (llmRes && llmRes.confidence >= 0.7) {
              let finalTitle = llmRes.inferred_title.trim();
              // Prevent duplicate siblings
              if (usedTitles.has(finalTitle.toLowerCase())) {
                finalTitle = node.originalTitle; // fallback to original
                report.preservedCount++;
                result.preservedCount++;
                hasDegraded = true;
              } else {
                updateNodeTitle(structure, node.path, finalTitle);
                usedTitles.add(finalTitle.toLowerCase());
                report.cleanedCount++;
                result.cleanedCount++;
              }
            } else {
              // Low confidence or LLM skipped -> preserve original
              report.preservedCount++;
              result.preservedCount++;
              if (llmRes && llmRes.confidence < 0.7) {
                hasDegraded = true;
              }
            }
          });
        }
      } catch (err) {
        piLog(`[TOC Cleanup] LLM Batch Cleanup failed for level=${quality.level}: ${err}. Preserving original titles.`);
        hasDegraded = true;
        nodes.forEach(() => {
          report.preservedCount++;
          result.preservedCount++;
        });
      }
    }

    result.perLayer.push(report);
  }

  // 3. Overall quality resolve
  if (hasPoor) {
    result.quality = "poor";
    result.qualityReason = "Some TOC layers were filled with book name placeholders and required numbering fallback.";
  } else if (hasDegraded) {
    result.quality = "degraded";
    result.qualityReason = "LLM failed or returned low confidence for some chapters, preserving original titles.";
  } else {
    result.quality = "good";
  }

  return { structure, result };
}
