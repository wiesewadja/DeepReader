/**
 * Pipeline Step: vectorize — L0/L1/L2 vector embedding.
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { apiLog } from "../../../utils/logger.js";
import { log as piLog } from "../../core/logger.js";
import { getPageindexRoot } from "../../paths.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

export const vectorizeStep: PipelineStep = {
  name: "vectorize",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    const shouldVectorize = ctx.options.embedding && ctx.options.embedding.provider !== 'local';

    if (!shouldVectorize) {
      ctx.tracer.recordPathDecision({
        phase: "vectorize",
        decision: "vectorize_skipped",
        reason: ctx.options.embedding?.provider === 'local'
          ? "embedding provider is 'local' (BM25-only)"
          : "embedding role not configured",
      });
      return;
    }

    ctx.reportProgress({
      percent: 87,
      step: "vectorize",
      stepLabel: "向量索引",
    });

    try {
      const nodeFileMap = ctx.parseResult._nodeFileMap || {};
      const { vectorizeAllLevels } = await import("../../book-indexer.js");
      const vectorResult = await vectorizeAllLevels(
        ctx.parseResult, ctx.indexDir!, ctx.options.embedding!, nodeFileMap,
        ctx.treeData!, ctx.options.outputDir,
        (msg: string) => ctx.reportProgress({ percent: 84, step: "vectorize", stepLabel: msg }),
        (info: any) => ctx.tracer.recordEmbedCall({ model: info.model, durationMs: info.durationMs, inputTokens: info.inputTokens, batchSize: info.batchSize }),
      );

      // Update book-meta with detected dimensions
      if (vectorResult && ctx.options.embedding) {
        ctx.bookMeta!.embedding = {
          provider: ctx.options.embedding.provider,
          model: ctx.options.embedding.model || "text-embedding-3-small",
          dimensions: vectorResult.dimensions,
        };
        await fs.writeFile(
          path.join(ctx.indexDir!, "book-meta.json"),
          JSON.stringify(ctx.bookMeta, null, 2)
        );

        const { updateCatalogEntry } = await import("../../vault/vectors.js");
        await updateCatalogEntry(getPageindexRoot(ctx.options.outputDir), ctx.bookId!, {
          title: ctx.bookMeta!.title || path.basename(ctx.filePath),
          vectorModel: ctx.options.embedding.model || "text-embedding-3-small",
          dimensions: vectorResult.dimensions,
          nodeCount: vectorResult.nodeCount,
          hasPropositions: false,
          indexedAt: new Date().toISOString(),
        });
      }

      ctx.tracer.endPhase({ totalVectors: vectorResult?.nodeCount || 0, dimensions: vectorResult?.dimensions || 0 });

      ctx.reportProgress({
        percent: 92,
        step: "vectorize_complete",
        stepLabel: "向量索引完成",
      });
    } catch (error) {
      apiLog.warn("[book-indexer] Vectorization failed, continuing with pure BM25:", error);
      ctx.tracer.failPhase(error instanceof Error ? error.message : "Embedding API failed");

      ctx.bookMeta!.embedding = undefined;
      await fs.writeFile(
        path.join(ctx.indexDir!, "book-meta.json"),
        JSON.stringify(ctx.bookMeta, null, 2)
      );

      ctx.reportProgress({
        percent: 92,
        step: "vectorize_skipped",
        stepLabel: "向量索引跳过（使用纯 BM25）",
        message: error instanceof Error ? error.message : "Embedding API failed",
      });
    }
  },
};
