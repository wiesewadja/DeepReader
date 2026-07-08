/**
 * Pipeline Step: parse — document parsing via PageIndex (PDF/EPUB).
 */

import { nodeFsPromises, nodePath } from "../../../utils/node-compat.js";
import { IndexError, IndexErrorCode as ErrorCode } from "../../book-types.js";
import { log as piLog } from "../../core/logger.js";
import { PageIndex } from "../../pageindex.js";
import {
  DEFAULT_ADD_NODE_TEXT,
  DEFAULT_ADD_NODE_SUMMARY,
  DEFAULT_ADD_DOC_DESCRIPTION,
  DEFAULT_EXPORT_DIR,
} from "../../defaults.js";
import type { PipelineContext, PipelineStep } from "../pipeline-types.js";
import { simplifyTitle } from "../../book-indexer.js";

export const parseStep: PipelineStep = {
  name: "parse_document",

  async execute(ctx: PipelineContext): Promise<void> {
    const path = nodePath();
    const fs = nodeFsPromises();

    ctx.reportProgress({
      percent: 5,
      step: "parse_document",
      stepLabel: "解析文档",
    });

    // Map PageIndex internal progress to book-indexer range (5%-70%)
    const onParseProgress = (progress: { percent: number; message: string; stage: string }) => {
      const mappedPercent = 5 + Math.round(progress.percent * 0.65);
      const safeStep = progress.stage === 'complete' ? 'parse_complete' : (progress.stage || 'parse_document');
      ctx.reportProgress({
        percent: Math.min(mappedPercent, 70),
        step: safeStep,
        stepLabel: progress.message || "处理文档",
      });
    };

    // Early cover save: EPUB cover available right after parseEpub (~5%)
    let earlyCoverSaved = false;
    ctx.deepReaderDir = path.join(ctx.options.outputDir, DEFAULT_EXPORT_DIR);

    const coversDir = path.join(ctx.deepReaderDir, "covers");
    const pageIndex = new PageIndex({
      model: ctx.options.model,
      apiKey: ctx.options.apiKey,
      baseUrl: ctx.options.baseUrl,
      mineruApiKey: ctx.options.mineruApiKey,
      addNodeText: DEFAULT_ADD_NODE_TEXT,
      addNodeSummary: ctx.options.addNodeSummary ?? DEFAULT_ADD_NODE_SUMMARY,
      addDocDescription: ctx.options.addDocDescription ?? DEFAULT_ADD_DOC_DESCRIPTION,
      onProgress: onParseProgress,
      onLlmCall: (call) => ctx.tracer.recordLlmCall(call),
      onCoverReady: (cover, title) => {
        if (!cover) return;
        try {
          const exportName = simplifyTitle(title);
          fs.mkdir(coversDir, { recursive: true }).then(() => {
            const ext = path.extname(cover.name) || ".jpg";
            const coverPath = path.join(coversDir, `${exportName}${ext}`);
            fs.writeFile(coverPath, cover.data).then(() => {
              earlyCoverSaved = true;
              piLog(`[book-indexer] Early cover saved: ${coverPath}`);
            }).catch(() => {});
          }).catch(() => {});
        } catch { /* best-effort, non-blocking */ }
      },
    });

    try {
      if (ctx.fileType === "pdf") {
        ctx.parseResult = await pageIndex.fromPdf(ctx.filePath);
      } else {
        ctx.parseResult = await pageIndex.fromEpub(ctx.filePath);
      }
    } catch (error) {
      throw new IndexError(
        `Document parsing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        ErrorCode.FILE_NOT_FOUND,
        "文档解析失败",
        "请检查文件格式是否正确"
      );
    }

    ctx.tracer.endPhase({
      chaptersCount: ctx.parseResult.structure.length,
      totalNodes: ctx.parseResult.structure.reduce((acc: number, n: any) => acc + 1 + (n.nodes?.length || 0), 0),
    });

    // Record path decision
    if (ctx.fileType === "epub") {
      ctx.tracer.recordPathDecision({
        phase: "parse_document",
        decision: "epub_direct",
        reason: `EPUB has ${ctx.parseResult.structure.length} chapters from spine`,
      });
    } else {
      ctx.tracer.recordPathDecision({
        phase: "parse_document",
        decision: "llm_toc",
        reason: `PDF parsed via LLM, ${ctx.parseResult.structure.length} chapters extracted`,
      });
    }

    ctx.reportProgress({
      percent: 70,
      step: "parse_complete",
      stepLabel: "文档索引完成",
    });

    ctx.rootTitle = ctx.parseResult.docName || ctx.parseResult.structure[0]?.title || "Unknown";
    ctx.exportName = simplifyTitle(ctx.rootTitle);
    ctx.tracer.setTitle(ctx.exportName);
    ctx.bookDir = path.join(ctx.deepReaderDir!, ctx.exportName);

    await fs.mkdir(ctx.deepReaderDir!, { recursive: true });
  },
};
