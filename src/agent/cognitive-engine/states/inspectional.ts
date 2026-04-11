/**
 * S1: Inspectional Reading State
 *
 * v2: Reads tree.json directly from .pageindex/ (not via tool call)
 */

import { z } from 'zod';
import { StateNode } from './base';
import type { SharedContext } from '../types';
import { parseStateOutput } from '../parse';
import {
  formatTreeStructure,
  buildInspectionalSystemPrompt,
  buildInspectionalUserMessage,
} from '../prompts/inspectional-prompt';
import type { OutlineNode } from '../../tools/local/types';
import * as crypto from 'crypto';
import * as path from 'path';

// Schema for inspectional output
const InspectionalOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()).max(100),
  tocSummary: z.string(),
  better_question: z.string().optional(),
  structural_analysis: z.string().optional(),
});

/**
 * Convert tree.json structure to OutlineNode[] for formatTreeStructure
 */
function treeToOutlineNodes(structure: any[]): OutlineNode[] {
  const result: OutlineNode[] = [];

  for (const node of structure) {
    result.push({
      node_id: node.nodeId || '',
      heading: node.title || '',
      level: 1,
      summary: node.summary,
      children: node.nodes ? treeToOutlineNodes(node.nodes) : [],
    });
  }

  return result;
}

/**
 * S1: Inspectional Reading State
 */
export class InspectionalState extends StateNode {
  readonly name = 'Inspectional';
  readonly model = 'fast' as const;
  readonly tools: string[] = []; // No tools needed

  constructor() {
    super();
    this.options = { timeout: 60000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      const { llmClientManager, toolRegistry, toolContext } = ctx;
      if (!llmClientManager || !toolRegistry || !toolContext) {
        ctx.scopeNodeIds = [];
        ctx.tocSummary = 'Testing mode - no outline.';
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // Step 1: Load tree.json directly from .pageindex/
      const outlineNodes = await this.loadTreeJson(toolContext);

      if (outlineNodes.length === 0) {
        ctx.scopeNodeIds = [];
        ctx.tocSummary = '无法获取目录结构，使用全局搜索。';
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // Step 2: Format tree structure for prompt
      const treeText = formatTreeStructure(outlineNodes);

      // Step 3: Build prompt
      const systemPrompt = buildInspectionalSystemPrompt(
        treeText,
        ctx.pdfName,
        ctx.depth,
        ctx.docDescription
      );
      const userMessage = buildInspectionalUserMessage(
        ctx.standaloneQuery || ctx.rawUserQuery,
        ctx.depth
      );

      const llmClient = llmClientManager.getClient(this.model);
      const llmGen = ctx.traceContext?.withGeneration('llm-iter1', {
        model: llmClient.getModel(),
        input: { systemPrompt, userMessage },
      });

      // Step 4: Call LLM with JSON Mode
      const llmStartTime = Date.now();
      const response = await llmClient.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        [],
        { type: 'json_object' }
      );
      const llmDuration = Date.now() - llmStartTime;

      llmGen?.end({
        output: { content: response.content, finishReason: 'stop' },
        metadata: { contentLength: response.content?.length ?? 0, duration: llmDuration },
      });

      // Step 5: Parse output
      const defaultOutput = {
        scopeNodeIds: [] as string[],
        tocSummary: '无法解析目录范围，使用全局搜索。',
        structural_analysis: '',
      };

      try {
        const parsed = parseStateOutput(response.content, InspectionalOutputSchema, defaultOutput);
        ctx.scopeNodeIds = parsed.scopeNodeIds;
        ctx.tocSummary = parsed.tocSummary;
        ctx.betterQuestion = parsed.better_question || ctx.rawUserQuery;
        ctx.structuralAnalysis = parsed.structural_analysis || '';
      } catch {
        ctx.scopeNodeIds = defaultOutput.scopeNodeIds;
        ctx.tocSummary = defaultOutput.tocSummary;
        ctx.betterQuestion = ctx.rawUserQuery;
        ctx.structuralAnalysis = defaultOutput.structural_analysis;
      }

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime, 1);
    } catch (error) {
      ctx.markStateExecuted(
        this.name,
        false,
        error instanceof Error ? error.message : String(error),
        Date.now() - startTime
      );
      throw error;
    }
  }

  /**
   * Load tree.json directly from .pageindex/{bookId}/tree.json
   */
  private async loadTreeJson(toolContext: NonNullable<SharedContext['toolContext']>): Promise<OutlineNode[]> {
    try {
      const { app, indexId } = toolContext;
      if (!app) return [];

      const vaultPath = (app.vault.adapter as any).basePath;

      // 优先使用 indexId（即 bookId），避免路径不匹配
      let bookId = indexId;
      console.log('[S1 loadTreeJson] indexId:', indexId, 'vaultPath:', vaultPath);
      if (!bookId) {
        // Fallback: 从文件路径计算
        const pdfName = toolContext.pdfName;
        if (!pdfName) return [];
        const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
        const files = app.vault.getFiles();
        const bookFile = files.find(f =>
          f.path.includes(bookName) && (f.extension === 'pdf' || f.extension === 'epub')
        );
        if (!bookFile) return [];
        const filePath = `${vaultPath}/${bookFile.path}`;
        bookId = crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
      }

      // Read tree.json（使用 vault 相对路径，adapter.read 会自动拼接 vault root）
      const treePath = `.pageindex/${bookId}/tree.json`;
      const treeContent = await (app.vault as any).adapter.read(treePath);
      const treeData = JSON.parse(treeContent);

      return treeToOutlineNodes(treeData.structure || []);
    } catch {
      return [];
    }
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return buildInspectionalSystemPrompt(
      '(目录将在执行时获取)',
      ctx.pdfName,
      ctx.depth,
      ctx.docDescription
    );
  }
}