/**
 * Visualizer Node — Converts analysis result into Excalidraw diagram
 *
 * Takes content from S1 (structuralAnalysis) or S2/S3 (analysisResult),
 * uses an LLM to structure it, then calls the excalidraw engine to render.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { PROMPT_VISUALIZER } from '../prompts/visualizer-prompt';
import { createLangChainTools } from '../../tools/index.js';
import { runEngine } from '../../tools/excalidraw-engine/index.js';
import { agentLog as log } from '../../../utils/logger.js';

export async function visualizerNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;

  if (!mainModel || !toolContext) {
    log('[Visualizer] 模型或上下文不可用');
    return { analysisResult: '[Visualizer] 生成图表失败：模型不可用' };
  }

  // Collect source content: prefer S2/S3 analysisResult, fall back to S1 structuralAnalysis
  const sourceContent = state.analysisResult || state.structuralAnalysis || '';
  if (!sourceContent) {
    log('[Visualizer] 无可用内容');
    return { analysisResult: '[Visualizer] 生成图表失败：缺少分析内容' };
  }

  const userQuery = state.rewrittenQuery || '';
  const pdfName = state.pdfName || toolContext.pdfName || '';

  log(`[Visualizer] 开始生成图表，内容长度=${sourceContent.length}，query="${userQuery.slice(0, 50)}"`);

  try {
    // Build tools: only excalidraw
    const allTools = createLangChainTools(toolContext);
    const vizTools = allTools.filter(t => t.name === 'excalidraw');
    const modelWithTools = mainModel.bindTools(vizTools);

    const messages = [
      new SystemMessage(PROMPT_VISUALIZER),
      new HumanMessage(`用户请求：${userQuery}\n\n当前书籍：《${pdfName}》\n\n分析内容：\n${sourceContent.slice(0, 4000)}`),
    ];

    const response = await modelWithTools.invoke(messages, config);
    const text = typeof response.content === 'string' ? response.content : '';

    // Check if LLM made tool calls
    const toolCalls = (response as any).tool_calls || (response.additional_kwargs?.tool_calls as any[]) || [];
    let diagramDescription = text;

    // Execute excalidraw tool calls if present
    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        if (tc.name === 'excalidraw' || tc.function?.name === 'excalidraw') {
          const args = typeof tc.args === 'string' ? JSON.parse(tc.args) : (tc.args || tc.function?.arguments);
          log(`[Visualizer] 执行 excalidraw 工具: action=${args?.action}`);

          if (args?.action === 'draw' && args?.data) {
            const result = await runEngine({
              diagramType: args.diagramType || 'mindmap',
              data: args.data,
              filename: args.filename,
              folder: pdfName ? `DeepReader/Excalidraw/${pdfName.replace(/[<>:"/\\|?*]/g, '')}` : undefined,
              style: args.style,
            });

            if (result.success) {
              // Convert to Obsidian wiki link (strip .md extension for clickable link)
              const wikiPath = (result.filePath ?? '').replace(/\.excalidraw\.md$/, '.excalidraw');
              const displayName = args.filename || '图表';
              diagramDescription = `已生成 Excalidraw 图表：[[${wikiPath}|${displayName}]]\n节点数: ${result.nodeCount}，边数: ${result.edgeCount}\n\n${text}`;
              log(`[Visualizer] 图表生成成功: ${result.filePath}`);
            } else {
              diagramDescription = `图表生成失败: ${result.error}\n\n${text}`;
              log(`[Visualizer] 图表生成失败: ${result.error}`);
            }
          }
        }
      }
    } else {
      // LLM didn't call the tool — try direct invocation as fallback
      log('[Visualizer] LLM 未调用 excalidraw 工具，尝试直接生成');
      diagramDescription = text + '\n\n（图表工具未被调用，请重试）';
    }

    return { analysisResult: diagramDescription };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[Visualizer] 错误: ${msg}`);
    return { analysisResult: `[Visualizer] 生成图表失败: ${msg}` };
  }
}
