/**
 * Pipeline Step: validate — file access check, bookId generation,
 * tracer setup, index directory creation, progress/status infrastructure.
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { IndexError, IndexErrorCode as ErrorCode } from "../../book-types.js";
import { createTracer } from "../../index-tracer.js";
import { getBookDir } from "../../paths.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

export const validateStep: PipelineStep = {
  name: "validate",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    // Validate file exists
    try {
      await fs.access(ctx.filePath);
    } catch {
      throw new IndexError(
        `File not found: ${ctx.filePath}`,
        ErrorCode.FILE_NOT_FOUND,
        `文件不存在: ${ctx.filePath}`,
        "请确认文件路径是否正确，或重新选择文件"
      );
    }

    ctx.bookId = await (await import("../../book-indexer.js")).generateBookId(ctx.filePath);
    ctx.indexDir = getBookDir(ctx.options.outputDir, ctx.bookId);

    // Create tracer (NoopIndexTracer when INDEX_TRACE_ENABLED=false)
    ctx.tracer = createTracer(
      ctx.bookId,
      path.basename(ctx.filePath, path.extname(ctx.filePath)),
      ctx.filePath,
      ctx.fileType,
      {
        pageindexModel: ctx.options.model || "unknown",
        embeddingProvider: ctx.options.embedding?.provider,
        embeddingModel: ctx.options.embedding?.model,
        mineruUsed: !!ctx.options.mineruApiKey,
      },
      ctx.options.outputDir,
      ctx.bookId,
    );

    // Create indexing status directory
    await fs.mkdir(ctx.indexDir, { recursive: true });
    ctx.indexingStatusPath = path.join(ctx.indexDir, ".indexing.json");

    // Clean stale status from previous interrupted indexing
    try { await fs.unlink(ctx.indexingStatusPath); } catch { /* not exists */ }

    // Progress reporter: writes to .indexing.json + calls options.onProgress
    ctx.reportProgress = (progress) => {
      ctx.options.onProgress?.(progress);
      fs.writeFile(ctx.indexingStatusPath!, JSON.stringify({
        bookId: ctx.bookId,
        filePath: ctx.filePath,
        fileType: ctx.fileType,
        title: path.basename(ctx.filePath, path.extname(ctx.filePath)),
        ...progress,
      })).catch(() => {});
    };

    // Cleanup function: remove .indexing.json on success
    ctx.cleanupStatus = () => {
      fs.unlink(ctx.indexingStatusPath!).catch(() => {});
    };

    // Record file size in tracer
    let fileSizeBytes = 0;
    try { fileSizeBytes = (await fs.stat(ctx.filePath)).size; } catch {}
    ctx.tracer.endPhase({ fileSizeBytes });
  },
};
