/**
 * Tree Loader Utility
 *
 * Load tree.json from .pageindex/{bookId}/tree.json for S1 Inspectional node.
 * Extracted from cognitive-engine/states/inspectional.ts
 */

import { resolveBookIdFromPdf } from '../../../pageindex/book-resolver.js';
import { PAGEINDEX_DIR } from '../../../pageindex/paths.js';
import type { OutlineNode } from '../../tools/local/types';

export type OutlineTreeResult = OutlineNode[] & {
  quality?: "good" | "degraded" | "poor";
  qualityReason?: string;
};

/**
 * Convert tree.json structure to OutlineNode[] for formatTreeStructure
 */
function treeToOutlineNodes(structure: Array<{ nodeId?: string; title?: string; summary?: string; nodes?: Array<unknown> }>, nodeFileMap: Record<string, string> = {}): OutlineNode[] {
  const result: OutlineNode[] = [];

  for (const node of structure) {
    const nodeId = node.nodeId || '';
    const rawFileName = nodeFileMap[nodeId] || '';
    const fileName = rawFileName.replace(/\.md$/i, '');
    result.push({
      node_id: nodeId,
      heading: node.title || '',
      level: 1,
      file_name: fileName || undefined,
      summary: node.summary,
      children: node.nodes ? treeToOutlineNodes(node.nodes as typeof structure, nodeFileMap) : [],
    });
  }

  return result;
}

/**
 * Load tree.json from .pageindex/{bookId}/tree.json
 *
 * @param app - Obsidian App instance
 * @param indexId - The book index ID (bookId)
 * @param pdfName - PDF file name (fallback for computing bookId)
 */
export async function loadTreeJson(
  app: import('obsidian').App,
  indexId: string,
  pdfName?: string
): Promise<OutlineTreeResult> {
  try {
    // Use indexId directly as bookId
    let bookId = indexId;
    if (!bookId) {
      if (!pdfName) return [];
      const resolved = await resolveBookIdFromPdf(app, pdfName);
      if (!resolved) return [];
      bookId = resolved;
    }

    const treePath = `${PAGEINDEX_DIR}/${bookId}/tree.json`;
    const treeContent = await app.vault.adapter.read(treePath);
    const treeData = JSON.parse(treeContent);

    const result = treeToOutlineNodes(treeData.structure || [], treeData.nodeFileMap || {}) as OutlineTreeResult;
    if (treeData.quality) {
      result.quality = treeData.quality;
    }
    if (treeData.qualityReason) {
      result.qualityReason = treeData.qualityReason;
    }
    return result;
  } catch {
    return [];
  }
}
