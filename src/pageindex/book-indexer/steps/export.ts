/**
 * Pipeline Step: export — TOC cleanup + Markdown export (PDF/EPUB).
 */

import { nodePath } from "../../../utils/node-compat.js";
import { IndexError, IndexErrorCode as ErrorCode } from "../../book-types.js";
import { log as piLog } from "../../core/logger.js";
import {
  DEFAULT_INCLUDE_INDEX,
  DEFAULT_ASSETS_PATH,
} from "../../defaults.js";
import { collectNodeSummaries } from "../../book-indexer.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";

export const exportStep: PipelineStep = {
  name: "export_markdown",

  async execute(ctx: PipelineContext): Promise<void> {
    const path = nodePath();

    // TOC LLM Cleanup
    try {
      const { cleanTocTitles } = await import("../../core/toc-cleaner.js");
      const cleanup = await cleanTocTitles(ctx.parseResult.structure, {
        bookTitle: ctx.rootTitle!,
        model: ctx.options.tocModel || ctx.options.model || "deepseek-chat",
        apiKey: ctx.options.apiKey,
        baseUrl: ctx.options.baseUrl,
        onLlmCall: (call: any) => ctx.tracer.recordLlmCall(call),
      });

      ctx.parseResult.structure = cleanup.structure;
      ctx.quality = cleanup.result.quality;
      ctx.qualityReason = cleanup.result.qualityReason;

      // Sync cleaned titles to epubInfo chapters for EPUB
      if (ctx.fileType === "epub" && ctx.parseResult.epubInfo) {
        const limit = Math.min(ctx.parseResult.structure.length, ctx.parseResult.epubInfo.chapters.length);
        for (let i = 0; i < limit; i++) {
          const node = ctx.parseResult.structure[i];
          if (node && node.title) {
            ctx.parseResult.epubInfo.chapters[i]!.title = node.title;
          }
        }
      }
    } catch (err) {
      piLog(`[TOC Cleanup] Failed to run TOC cleanup: ${err}`);
      ctx.quality = "degraded";
      ctx.qualityReason = `TOC Cleanup failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    ctx.reportProgress({
      percent: 70,
      step: "export_markdown",
      stepLabel: "导出 Markdown",
    });

    // Markdown export
    try {
      if (ctx.fileType === "pdf") {
        const { exportPdfToObsidian } = await import("../../exporters/pdf-to-obsidian.js");
        const exportResult = await exportPdfToObsidian({
          outputDir: ctx.deepReaderDir!,
          parseResult: ctx.parseResult,
          includeIndex: DEFAULT_INCLUDE_INDEX,
          sourcePdf: ctx.filePath,
          exportName: ctx.exportName!,
          author: ctx.parseResult.author,
          coverPath: ctx.coverRelPath || undefined,
          bookId: ctx.bookId!,
        });
        ctx.parseResult._nodeFileMap = exportResult.nodeFileMap;
      } else {
        const { exportToObsidian } = await import("../../exporters/epub-to-obsidian.js");
        const exportResult = await exportToObsidian(
          ctx.filePath,
          {
            outputDir: ctx.deepReaderDir!,
            includeIndex: DEFAULT_INCLUDE_INDEX,
            assetsPath: DEFAULT_ASSETS_PATH,
            docDescription: ctx.parseResult.docDescription,
            nodeSummaries: collectNodeSummaries(ctx.parseResult.structure),
            exportName: ctx.exportName!,
            coverPath: ctx.coverRelPath || undefined,
            bookId: ctx.bookId!,
          },
          ctx.parseResult.epubInfo,
        );
        ctx.parseResult._nodeFileMap = exportResult.nodeFileMap;
        ctx.parseResult._hierarchicalTree = exportResult.treeNodes;
      }
    } catch (error) {
      throw new IndexError(
        `Markdown export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        ErrorCode.MD_PARSE_ERROR,
        "Markdown 导出失败",
        "请检查输出目录是否有写入权限"
      );
    }

    ctx.reportProgress({
      percent: 80,
      step: "export_complete",
      stepLabel: "Markdown 导出完成",
    });
  },
};
