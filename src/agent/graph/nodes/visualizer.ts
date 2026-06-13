/**
 * Visualizer Node — 统一图表生成节点
 *
 * 检测到可视化意图时，由 edges.ts 路由到本节点。
 * 调用 diagram-helper 生成 excalidraw 图形，追加 embed 到分析结果。
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { agentLog as log } from '../../../utils/logger.js';
import type { CognitiveEngineState } from '../state';
import { generateDiagram } from '../utils/diagram-helper.js';

export async function visualizerNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;

  if (!mainModel || !toolContext) {
    log('[Visualizer] 缺少 mainModel 或 toolContext，跳过图表生成');
    return { analysisResult: state.analysisResult || '' };
  }

  const content = [state.analysisResult, state.structuralAnalysis].filter(Boolean).join('\n\n');
  if (!content) {
    log('[Visualizer] 无分析内容，跳过图表生成');
    return { analysisResult: state.analysisResult || '' };
  }

  const embed = await generateDiagram(
    state.rewrittenQuery || '',
    content,
    mainModel,
    toolContext,
    { pdfName: state.pdfName },
  );

  if (!embed) {
    log('[Visualizer] 图表生成失败或 LLM 未返回有效结果');
    return { analysisResult: state.analysisResult || '' };
  }

  if (state.analysisResult) {
    return { analysisResult: `${state.analysisResult}\n\n${embed}` };
  }
  return { structuralAnalysis: `${state.structuralAnalysis || ''}\n\n${embed}` };
}
