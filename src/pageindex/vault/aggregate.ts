/**
 * PageIndex: Obsidian Vault Directory-level Aggregation
 * Aggregates file-level PageIndexResult into directory-level DirectoryIndex
 */

import type { DirectoryIndex, FileMeta } from "./types";
import type { TreeNode } from "../core/types";
import { countTokens } from "../core/utils";

export function aggregateDirectories(
  files: Record<string, FileMeta>
): Record<string, DirectoryIndex> {
  const dirMap = new Map<string, Array<{ relativePath: string; meta: FileMeta }>>();

  for (const [relativePath, meta] of Object.entries(files)) {
    const dir = getDirectory(relativePath);
    if (!dirMap.has(dir)) {
      dirMap.set(dir, []);
    }
    dirMap.get(dir)!.push({ relativePath, meta });
  }

  const result: Record<string, DirectoryIndex> = {};

  for (const [dir, dirFiles] of dirMap) {
    dirFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const structure: TreeNode[] = dirFiles.map(({ relativePath, meta }, index) => {
      const docName = meta.result.docName;
      const summaries = meta.result.structure
        .map((n) => n.summary)
        .filter(Boolean)
        .join("、");

      return {
        title: docName,
        nodeId: `dir-${String(index + 1).padStart(3, "0")}`,
        summary: summaries || docName,
        nodes: meta.result.structure.map((node) => ({
          title: node.title,
          nodeId: node.nodeId,
          summary: node.summary,
          lineNum: node.lineNum,
        })),
      };
    });

    const totalTokens = dirFiles.reduce(
      (sum, f) => sum + (f.meta.tokenCount || 0),
      0
    );

    result[dir] = {
      docName: dir || "root",
      docDescription: `${dirFiles.length} files, ${totalTokens.toLocaleString()} tokens`,
      structure,
    };
  }

  return result;
}

function getDirectory(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}
