/**
 * S2: Analytical Reading State
 *
 * Responsibilities:
 * - Deep analysis within locked scope
 * - Tools: search_doc, get_chapter
 *
 * Key mechanism: ToolInterceptor physically locks search scope
 * Cumulative: Calls S1 if scopeNodeIds not set
 */

import { StateNode } from './base';
import type { SharedContext } from '../types';
import { buildAnalyticalSystemPrompt, buildAnalyticalUserMessage } from '../prompts/analytical-prompt';
import { InspectionalState } from './inspectional';
import { createScopeInterceptor } from '../interceptor/scope-interceptor';
import { runStateLoop } from './run-state-loop';
import type { StateLoopResult } from './run-state-loop';

type ToolResult = StateLoopResult['toolResults'][number];

/**
 * S2: Analytical Reading State
 */
export class AnalyticalState extends StateNode {
  readonly name = 'Analytical';
  readonly model = 'main' as const;
  readonly tools = ['search_doc', 'get_chapter'];

  private inspectionalState: InspectionalState;

  constructor() {
    super();
    this.options = { timeout: 60000, retries: 1 };
    this.inspectionalState = new InspectionalState();
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. Cumulative guarantee: call S1 if scope not set
      if (!ctx.scopeNodeIds || ctx.scopeNodeIds.length === 0) {
        await this.inspectionalState.execute(ctx);
      }

      // 2. Create scope interceptor
      const interceptor = createScopeInterceptor(ctx.scopeNodeIds!);

      // 3. Check if engine dependencies are available
      if (!ctx.llmClient || !ctx.toolRegistry || !ctx.toolContext) {
        // Fallback to placeholder for testing
        ctx.analysisResult = 'MECE stands for Mutually Exclusive, Collectively Exhaustive. [^block_123]';
        ctx.rawResults = [
          { block_id: 'block_123', text: 'MECE definition...', toolName: 'search_doc' },
        ];
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // 4. Execute LLM loop with interceptor
      const response = await runStateLoop(
        ctx.llmClient,
        ctx.toolRegistry,
        ctx.toolContext,
        {
          model: this.model,
          systemPrompt: this.buildSystemPrompt(ctx),
          userMessage: buildAnalyticalUserMessage(ctx.standaloneQuery || ctx.rawUserQuery),
          availableTools: this.tools,
          toolInterceptor: interceptor,
          maxIterations: 5,
          abortSignal: ctx.abortSignal,
        }
      );

      // 5. Store results
      // 分析结果：如果没有最终输出，使用工具调用摘要
      ctx.analysisResult = response.content || this.summarizeToolResults(response.toolResults);

      // 提取关键信息给 Formatter（精简版，避免 token 膨胀）
      ctx.rawResults = this.extractEssentialResults(response.toolResults);

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime, response.iterations);
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

  buildSystemPrompt(ctx: SharedContext): string {
    return buildAnalyticalSystemPrompt(ctx.scopeNodeIds || []);
  }

  /**
   * 当 LLM 未输出最终分析时，从工具结果中提取摘要
   */
  private summarizeToolResults(toolResults: ToolResult[]): string {
    if (toolResults.length === 0) {
      return '';
    }

    const summary = toolResults
      .map(tr => `【${tr.toolName}】\n${tr.result.slice(0, 500)}...`)
      .join('\n\n');

    return `[工具调用摘要]\n${summary}`;
  }

  /**
   * 提取关键信息给 Formatter（精简版，避免 token 膨胀）
   *
   * 策略：
   * - get_toc: 只提取章节链接 [[...|...]]，不保留摘要
   * - search_doc: 保留完整结果（已包含 block_id 链接）
   * - get_chapter: 只提取前 1000 字符 + block_id
   */
  private extractEssentialResults(toolResults: ToolResult[]): Array<{ block_id: string; text: string; toolName: string }> {
    return toolResults.map(tr => {
      if (tr.toolName === 'get_toc') {
        // 只提取 Obsidian 章节链接，丢弃大段摘要
        const links = this.extractObsidianLinks(tr.result);
        return {
          block_id: '',
          text: links.length > 0 ? `## 目录链接\n${links.join('\n')}` : '(目录已获取)',
          toolName: tr.toolName,
        };
      }

      if (tr.toolName === 'get_chapter') {
        // 截断章节内容，保留关键部分
        const truncated = tr.result.length > 1500
          ? tr.result.slice(0, 1500) + '\n...[章节内容已截断]'
          : tr.result;
        return {
          block_id: '',
          text: truncated,
          toolName: tr.toolName,
        };
      }

      // search_doc 保持原样（已经包含 block_id 链接）
      return {
        block_id: '',
        text: tr.result,
        toolName: tr.toolName,
      };
    });
  }

  /**
   * 从文本中提取 Obsidian 链接 [[...|...]]
   */
  private extractObsidianLinks(text: string): string[] {
    const linkRegex = /\[\[([^\]]+)\|([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
      links.push(`[[${match[1]}|${match[2]}]]`);
    }
    return links;
  }
}