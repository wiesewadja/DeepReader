/**
 * Visualizer Node — 占位实现
 *
 * 图表生成功能已迁移到 Hermes MCP Server。
 * 此节点保留占位，后续 Hermes MCP client 集成时替换实现。
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { agentLog as log } from '../../../utils/logger.js';
import type { CognitiveEngineState } from '../state';

export async function visualizerNode(
  state: CognitiveEngineState,
  _config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  log('[Visualizer] 图表生成功能正在升级中，即将支持 Hermes 后端');

  return {
    analysisResult: '📊 图表生成功能正在升级中，即将通过 Hermes 后端支持思维导图、知识图谱等信息图生成。',
  };
}
