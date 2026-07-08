/**
 * Pipeline Step: propositions — extract proposition cards (optional).
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { apiLog } from "../../../utils/logger.js";
import { log as piLog } from "../../core/logger.js";
import { indexPropositions } from "../../proposition-indexer.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

export const propositionsStep: PipelineStep = {
  name: "extract_propositions",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    if (!ctx.options.propositions?.enabled || !ctx.options.propositions.apiKey) {
      return;
    }

    ctx.reportProgress({
      percent: 97,
      step: "extract_propositions",
      stepLabel: "提取命题卡片",
    });

    try {
      const treePath = path.join(ctx.indexDir!, "tree.json");
      const treeContent = await fs.readFile(treePath, "utf-8");
      const treeData = JSON.parse(treeContent);

      const propResult = await indexPropositions({
        bookId: ctx.bookId!,
        vaultPath: ctx.options.outputDir,
        treeData,
        embedding: ctx.options.embedding?.provider !== 'local' ? ctx.options.embedding : undefined,
        llm: {
          model: ctx.options.propositions!.model || 'Qwen/Qwen3-8B',
          apiKey: ctx.options.propositions!.apiKey,
          baseUrl: ctx.options.propositions!.baseUrl || 'https://api.siliconflow.cn/v1',
        },
        cardsPer500Words: ctx.options.propositions!.cardsPer500Words,
        onProgress: (p) => {
          ctx.reportProgress({
            percent: 97 + Math.round(p.percent * 0.02),
            step: "extract_propositions",
            stepLabel: p.message,
          });
        },
      });

      ctx.bookMeta!.propositions = {
        enabled: true,
        totalCards: propResult.totalCards,
        model: ctx.options.propositions!.model || 'Qwen/Qwen3-8B',
        generatedAt: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(ctx.indexDir!, "book-meta.json"),
        JSON.stringify(ctx.bookMeta, null, 2)
      );

      piLog(`[book-indexer] Proposition cards: ${propResult.totalCards}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      apiLog.warn("[book-indexer] Proposition extraction failed:", errorMsg);

      ctx.bookMeta!.propositions = {
        enabled: false,
        totalCards: 0,
        model: ctx.options.propositions!.model || 'Qwen/Qwen3-8B',
        error: errorMsg.slice(0, 200),
      };

      await fs.writeFile(
        path.join(ctx.indexDir!, "book-meta.json"),
        JSON.stringify(ctx.bookMeta, null, 2)
      );

      ctx.reportProgress({
        percent: 97,
        step: "propositions_failed",
        stepLabel: `命题卡片提取失败: ${errorMsg.slice(0, 50)}`,
      });
    }
  },
};
