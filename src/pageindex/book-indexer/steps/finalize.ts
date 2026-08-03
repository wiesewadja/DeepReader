/**
 * Pipeline Step: finalize — mark index ready, notify UI, cleanup status file.
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

export const finalizeStep: PipelineStep = {
  name: "finalize",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    // Notify UI directly (do NOT write to .indexing.json — cleanupStatus will delete it)
    if (ctx.options.onProgress) {
      ctx.options.onProgress({ percent: 100, step: "complete", stepLabel: "索引完成" });
    }

    // Mark book-meta as ready BEFORE deleting .indexing.json
    try {
      const metaPath = path.join(ctx.indexDir!, "book-meta.json");
      const metaRaw = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaRaw);
      meta.status = "ready";
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    } catch { /* best-effort */ }

    ctx.tracer.finalize(true);

    // Cleanup .indexing.json on success
    ctx.cleanupStatus?.();
  },
};
