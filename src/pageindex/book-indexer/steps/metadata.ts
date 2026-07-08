/**
 * Pipeline Step: metadata — build bookMeta + tree.json.
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { log as piLog } from "../../core/logger.js";
import type { BookMeta, TreeData } from "../../book-types.js";
import type { TreeNode, PageIndexResult } from "../../core/types.js";
import type { EmbeddingOptions } from "../../vault/types.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

async function buildBookMeta(
  parseResult: PageIndexResult,
  bookId: string,
  bookDir: string,
  filePath: string,
  fileType: "pdf" | "epub",
  embedding?: EmbeddingOptions,
  author?: string,
): Promise<BookMeta> {
  const path = nodePath();
  const title = parseResult.docName || parseResult.structure[0]?.title || "Unknown";
  const exportName = path.basename(bookDir);

  return {
    version: 3,
    bookId,
    title,
    exportName,
    description: parseResult.docDescription || parseResult.structure[0]?.summary || "",
    author,
    filePath,
    fileType,
    indexedAt: new Date().toISOString(),
    status: "indexing",
    embedding: embedding ? {
      provider: embedding.provider,
      model: embedding.model || "text-embedding-3-small",
    } : undefined,
    chapters: [],
  };
}

export const metadataStep: PipelineStep = {
  name: "build_meta",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    ctx.reportProgress({
      percent: 82,
      step: "build_meta",
      stepLabel: "构建元数据",
    });

    ctx.bookMeta = await buildBookMeta(
      ctx.parseResult,
      ctx.bookId!,
      ctx.bookDir!,
      ctx.filePath,
      ctx.fileType,
      ctx.options.embedding,
      ctx.parseResult.author,
    );

    await fs.mkdir(ctx.indexDir!, { recursive: true });
    await fs.writeFile(
      path.join(ctx.indexDir!, "book-meta.json"),
      JSON.stringify(ctx.bookMeta, null, 2)
    );

    // Build tree.json
    let treeData: TreeData = {
      title: ctx.rootTitle!,
      exportName: ctx.exportName,
      structure: ctx.parseResult.structure,
      nodeFileMap: {},
    };

    try {
      const nodeFileMap = ctx.parseResult._nodeFileMap || {};
      const hierarchicalTree = ctx.parseResult._hierarchicalTree;
      let finalStructure = ctx.parseResult.structure;

      if (hierarchicalTree && hierarchicalTree.length > 0) {
        const summaryMap = new Map<string, { summary?: string; text?: string; startIndex?: number; endIndex?: number }>();
        for (const node of ctx.parseResult.structure || []) {
          if (node.nodeId) {
            summaryMap.set(node.nodeId, {
              summary: node.summary,
              text: node.text,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            });
          }
        }

        const enrichNode = (n: TreeNode): TreeNode => {
          const data = n.nodeId ? summaryMap.get(n.nodeId) : undefined;
          const result: TreeNode = {
            title: n.title,
            nodeId: n.nodeId,
            startIndex: data?.startIndex ?? n.startIndex,
            endIndex: data?.endIndex ?? n.endIndex,
          };
          if (data?.summary || n.summary) result.summary = data?.summary || n.summary;
          if (data?.text || n.text) result.text = data?.text || n.text;
          if (n.nodes?.length) result.nodes = n.nodes.map(enrichNode);
          return result;
        };

        finalStructure = hierarchicalTree.map(enrichNode);
      }

      treeData = {
        title: ctx.rootTitle!,
        exportName: ctx.exportName,
        docDescription: ctx.parseResult.docDescription,
        source: ctx.filePath,
        nodeFileMap,
        structure: finalStructure,
        quality: ctx.quality,
        qualityReason: ctx.qualityReason,
      };

      await fs.writeFile(
        path.join(ctx.indexDir!, "tree.json"),
        JSON.stringify(treeData, null, 2)
      );
      piLog(`[book-indexer] tree.json written to ${ctx.indexDir}`);
    } catch (err) {
      piLog(`[book-indexer] Warning: tree.json write failed: ${err}`);
    }

    ctx.treeData = treeData;

    ctx.reportProgress({
      percent: 85,
      step: "meta_complete",
      stepLabel: "元数据构建完成",
    });
  },
};
