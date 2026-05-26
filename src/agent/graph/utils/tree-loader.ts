/**
 * Tree Loader Utility
 *
 * Load tree.json from .pageindex/{bookId}/tree.json for S1 Inspectional node.
 * Extracted from cognitive-engine/states/inspectional.ts
 */

import type { OutlineNode } from '../../tools/local/types';
import { createHash } from 'crypto';
import { PAGEINDEX_DIR } from '../../../pageindex/paths.js';

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
): Promise<OutlineNode[]> {
  try {
    const vaultPath = (app.vault.adapter as unknown as { basePath: string }).basePath;

    // Use indexId directly as bookId
    let bookId = indexId;
    if (!bookId) {
      // Fallback: compute bookId from file path
      if (!pdfName) return [];
      const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
      const files = app.vault.getFiles();
      const bookFile = files.find((f: { path: string; extension: string }) =>
        f.path.includes(bookName) && (f.extension === 'pdf' || f.extension === 'epub')
      );
      if (!bookFile) return [];
      const filePath = `${vaultPath}/${bookFile.path}`;
      bookId = createHash("sha256").update(filePath).digest("hex").slice(0, 8);
    }

    const treePath = `${PAGEINDEX_DIR}/${bookId}/tree.json`;
    const treeContent = await app.vault.adapter.read(treePath);
    const treeData = JSON.parse(treeContent);

    return treeToOutlineNodes(treeData.structure || [], treeData.nodeFileMap || {});
  } catch {
    return [];
  }
}
