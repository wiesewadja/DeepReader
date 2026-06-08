/**
 * EPUB to Obsidian adapter for PageIndex
 * Integrates EPUB processing with Obsidian export, supporting summaries and node splitting
 */

import { countTokens } from "../core/utils";
import { chatGPT } from "../llm/client";
import { parseEpub, type EpubInfo, type EpubChapter } from "../parsers/epub";
import { exportToObsidian, type ObsidianExportOptions } from "./epub-to-obsidian";

export interface EpubObsidianExportOptions extends ObsidianExportOptions {
  /** Maximum tokens per node (paragraph) - splits large chapters into smaller nodes */
  maxTokensPerNode?: number;
  /** Maximum nodes per chapter (0 = unlimited) */
  maxNodesPerChapter?: number;
  /** Generate summary for each node using LLM */
  generateNodeSummaries?: boolean;
  /** LLM model for summary generation */
  summaryModel?: string;
  /** API key for summary generation */
  apiKey?: string;
  /** Base URL for LLM API */
  baseUrl?: string;
  /** Progress callback */
  onProgress?: (info: { stage: string; percent: number }) => void;
}

interface ProcessedChapter extends EpubChapter {
  nodes: EpubNode[];
}

interface EpubNode {
  id: string;
  content: string;
  tokenCount: number;
  summary?: string;
  blockIds: string[];
}

/**
 * Split chapter content into nodes based on token limit
 */
function splitChapterIntoNodes(
  chapter: EpubChapter,
  maxTokens: number,
  maxNodes: number
): EpubNode[] {
  const nodes: EpubNode[] = [];
  const paragraphs = chapter.content.split(/\n\n+/).filter(p => p.trim());

  let currentContent: string[] = [];
  let currentTokens = 0;
  let nodeIndex = 0;

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    if (currentTokens + paraTokens > maxTokens && currentContent.length > 0) {
      const content = currentContent.join("\n\n");
      nodes.push({
        id: `${chapter.id}_node${nodeIndex}`,
        content,
        tokenCount: currentTokens,
        blockIds: extractBlockIds(content),
      });
      nodeIndex++;

      if (maxNodes > 0 && nodes.length >= maxNodes) {
        const remaining = paragraphs.slice(paragraphs.indexOf(para)).join("\n\n");
        nodes[nodes.length - 1].content += "\n\n" + remaining;
        nodes[nodes.length - 1].tokenCount = countTokens(nodes[nodes.length - 1].content);
        break;
      }

      currentContent = [para];
      currentTokens = paraTokens;
    } else {
      currentContent.push(para);
      currentTokens += paraTokens;
    }
  }

  if (currentContent.length > 0 && (maxNodes === 0 || nodes.length < maxNodes)) {
    const content = currentContent.join("\n\n");
    nodes.push({
      id: `${chapter.id}_node${nodeIndex}`,
      content,
      tokenCount: currentTokens,
      blockIds: extractBlockIds(content),
    });
  }

  return nodes;
}

function extractBlockIds(content: string): string[] {
  const matches = content.match(/\^([a-zA-Z0-9-]+)/g);
  return matches ? matches.map(m => m.substring(1)) : [];
}

/**
 * Generate summary for a node using LLM
 */
async function generateNodeSummary(
  node: EpubNode,
  model: string,
  apiKey?: string,
  baseUrl?: string
): Promise<string> {
  const preview = node.content.substring(0, 800);
  return chatGPT({
    model,
    prompt: `请用一句话（不超过50字）概括以下内容的核心要点：\n\n${preview}`,
    apiKey,
    baseUrl,
  });
}

/**
 * Process chapters into nodes with optional summaries
 */
async function processChapters(
  chapters: EpubChapter[],
  options: EpubObsidianExportOptions
): Promise<ProcessedChapter[]> {
  const maxTokens = options.maxTokensPerNode || 2000;
  const maxNodes = options.maxNodesPerChapter || 0;
  const generateSummaries = options.generateNodeSummaries || false;

  const processed: ProcessedChapter[] = [];
  const totalChapters = chapters.length;

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];

    options.onProgress?.({
      stage: `Processing chapter ${i + 1}/${totalChapters}: ${chapter.title}`,
      percent: Math.round((i / totalChapters) * 50),
    });

    const nodes = splitChapterIntoNodes(chapter, maxTokens, maxNodes);

    if (generateSummaries) {
      for (let j = 0; j < nodes.length; j++) {
        options.onProgress?.({
          stage: `Generating summaries for ${chapter.title} (${j + 1}/${nodes.length})`,
          percent: Math.round((i / totalChapters) * 50 + (j / nodes.length) * 25),
        });

        nodes[j].summary = await generateNodeSummary(
          nodes[j],
          options.summaryModel || "gpt-4o-mini",
          options.apiKey,
          options.baseUrl
        );
      }
    }

    processed.push({ ...chapter, nodes });
  }

  return processed;
}

/**
 * Export EPUB to Obsidian with PageIndex integration
 * Supports node splitting, summaries, and size limits
 */
export async function exportEpubToObsidian(
  epubPath: string,
  options: EpubObsidianExportOptions
): Promise<{ mocPath: string; totalNodes: number; totalChapters: number }> {
  options.onProgress?.({ stage: "Parsing EPUB...", percent: 0 });
  const epubInfo = await parseEpub(epubPath);

  options.onProgress?.({ stage: "Processing chapters...", percent: 10 });
  const processedChapters = await processChapters(epubInfo.chapters, options);

  const totalNodes = processedChapters.reduce((sum, ch) => sum + ch.nodes.length, 0);

  const virtualChapters: EpubChapter[] = [];
  let virtualOrder = 0;

  for (const chapter of processedChapters) {
    if (chapter.nodes.length === 1) {
      virtualChapters.push({
        ...chapter,
        content: chapter.nodes[0].content,
        tokenCount: chapter.nodes[0].tokenCount,
        order: virtualOrder++,
        id: chapter.id,
      });
    } else {
      for (let i = 0; i < chapter.nodes.length; i++) {
        const node = chapter.nodes[i];
        const nodeTitle = i === 0
          ? chapter.title
          : `${chapter.title} (Part ${i + 1}/${chapter.nodes.length})`;

        let content = node.content;
        if (node.summary) {
          content = `> ${node.summary}\n\n${content}`;
        }

        virtualChapters.push({
          id: node.id,
          title: nodeTitle,
          content,
          tokenCount: node.tokenCount,
          order: virtualOrder++,
          href: chapter.href,
          blockMap: chapter.blockMap,
          blocks: node.blockIds,
        });
      }
    }
  }

  const virtualEpubInfo: EpubInfo = {
    title: epubInfo.title,
    author: epubInfo.author,
    numChapters: virtualChapters.length,
    chapters: virtualChapters,
    coverImage: epubInfo.coverImage,
  };

  options.onProgress?.({ stage: "Exporting to Obsidian...", percent: 75 });
  const result = await exportToObsidian(epubPath, options, virtualEpubInfo);

  options.onProgress?.({ stage: "Complete!", percent: 100 });

  return {
    mocPath: result.mocPath,
    totalNodes,
    totalChapters: epubInfo.chapters.length,
  };
}

// Re-export types
export type { EpubNode, ProcessedChapter };
