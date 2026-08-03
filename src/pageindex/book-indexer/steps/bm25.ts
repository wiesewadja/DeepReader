/**
 * Pipeline Step: bm25 — BM25 keyword index building.
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { buildBM25Index } from "../../bm25.js";
import type { BM25Data } from "../../book-types.js";
import type { PageIndexResult, TreeNode } from "../../core/types.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

function collectIndexLeafNodes(
  node: TreeNode,
  nodes: Array<{ id: string; title: string; text: string; level: "L0" | "L1" }>,
): void {
  if (!node.nodes || node.nodes.length === 0) return;
  for (const child of node.nodes) {
    nodes.push({
      id: child.nodeId || `L1-${nodes.length}`,
      title: child.title || "",
      text: `${child.title}\n${child.summary || ""}\n${child.text || ""}`,
      level: "L1",
    });
    collectIndexLeafNodes(child, nodes);
  }
}

function buildBM25IndexFromParseResult(parseResult: PageIndexResult): BM25Data {
  const nodes: Array<{ id: string; title: string; text: string; level: "L0" | "L1" }> = [];
  for (const rootNode of parseResult.structure || []) {
    nodes.push({
      id: rootNode.nodeId || `L0-${nodes.length}`,
      title: rootNode.title || "",
      text: `${rootNode.title}\n${rootNode.summary || ""}\n${rootNode.text || ""}`,
      level: "L0",
    });
    collectIndexLeafNodes(rootNode, nodes);
  }
  return buildBM25Index(nodes);
}

export const bm25Step: PipelineStep = {
  name: "build_bm25",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    ctx.reportProgress({
      percent: 94,
      step: "build_bm25",
      stepLabel: "构建 BM25 索引",
    });

    const bm25Data = buildBM25IndexFromParseResult(ctx.parseResult);
    await fs.writeFile(
      path.join(ctx.indexDir!, "bm25.json"),
      JSON.stringify(bm25Data, null, 2)
    );

    ctx.reportProgress({
      percent: 97,
      step: "bm25_complete",
      stepLabel: "BM25 索引构建完成",
    });
  },
};
