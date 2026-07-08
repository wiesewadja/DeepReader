/**
 * Pipeline Step: cover — extract and save cover image (epub/pdf/svg fallback).
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { apiLog } from "../../../utils/logger.js";
import { log as piLog } from "../../core/logger.js";
import { DEFAULT_COVERS_PATH } from "../../defaults.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

export const coverStep: PipelineStep = {
  name: "save_cover",

  async execute(ctx: PipelineContext): Promise<void> {
    const fs = nodeFsPromises();
    const path = nodePath();

    const coversDir = path.join(ctx.deepReaderDir!, DEFAULT_COVERS_PATH);
    await fs.mkdir(coversDir, { recursive: true });

    ctx.coverRelPath = "";

    if (ctx.parseResult.coverImage) {
      try {
        const ext = path.extname(ctx.parseResult.coverImage.name) || ".jpg";
        const coverPath = path.join(coversDir, `${ctx.exportName}${ext}`);
        await fs.writeFile(coverPath, ctx.parseResult.coverImage.data);
        ctx.coverRelPath = `DeepReader/${DEFAULT_COVERS_PATH}${ctx.exportName}${ext}`;
        piLog(`[book-indexer] Cover saved: ${coverPath}`);
      } catch (err) {
        apiLog.warn("[book-indexer] Failed to save cover:", err);
      }
    } else if (ctx.parseResult.coverPng && ctx.parseResult.coverPng.length > 100) {
      try {
        const coverPath = path.join(coversDir, `${ctx.exportName}.png`);
        await fs.writeFile(coverPath, ctx.parseResult.coverPng);
        ctx.coverRelPath = `DeepReader/${DEFAULT_COVERS_PATH}${ctx.exportName}.png`;
        piLog(`[book-indexer] PDF cover saved: ${coverPath} (${ctx.parseResult.coverPng.length} bytes)`);
      } catch (err) {
        apiLog.warn("[book-indexer] Failed to save PDF cover:", err);
      }
    } else {
      // No cover: generate text-based SVG
      try {
        const { generateTextCover } = await import("../../book-indexer.js");
        const svgCover = generateTextCover(ctx.exportName, ctx.fileType);
        const coverPath = path.join(coversDir, `${ctx.exportName}.svg`);
        await fs.writeFile(coverPath, svgCover, "utf-8");
        ctx.coverRelPath = `DeepReader/${DEFAULT_COVERS_PATH}${ctx.exportName}.svg`;
        piLog(`[book-indexer] Text cover generated: ${coverPath}`);
      } catch (err) {
        apiLog.warn("[book-indexer] Failed to generate text cover:", err);
      }
    }

    // Download images (PDF only)
    if (ctx.fileType === "pdf" && ctx.parseResult.images && ctx.parseResult.images.length > 0) {
      const imagesDir = path.join(ctx.bookDir!, "images");
      await fs.mkdir(imagesDir, { recursive: true });

      ctx.reportProgress({
        percent: 70,
        step: "download_images",
        stepLabel: `下载图片 (0/${ctx.parseResult.images.length})`,
      });

      const { downloadImages } = await import("../../book-indexer.js");
      await downloadImages(ctx.parseResult.images, imagesDir, (done: number, total: number) => {
        ctx.reportProgress({
          percent: 70,
          step: "download_images",
          stepLabel: `下载图片 (${done}/${total})`,
        });
      });

      piLog(`[book-indexer] Downloaded images to ${imagesDir}`);
    }
  },
};
