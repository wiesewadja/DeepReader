/**
 * Visualizer Node — Converts analysis result into Excalidraw diagram
 *
 * Takes content from S1 (structuralAnalysis) or S2/S3 (analysisResult),
 * uses an LLM to structure it, then calls the excalidraw engine to render.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { buildVisualizerPrompt } from '../prompts/visualizer-prompt';
import { createVizTools } from '../../tools/index.js';
import { runEngine } from '../../tools/excalidraw-engine/index.js';
import type { EngineInput } from '../../tools/excalidraw-engine/types.js';
import { agentLog as log } from '../../../utils/logger.js';
import { parseToolCallArgs } from '../utils/tool-call-parser.js';
import type { VisualizerInput } from '../node-io.js';
import type { ToolCallLike } from '../utils/tool-call-parser.js';
import type { PiProcessManager } from '../../pi/pi-manager.js';
import type { PiConfig } from '../../pi/types.js';
import { buildSkillContext, scanSkillDescriptions, generateOutputPath } from '../../pi/pi-context.js';
import type { EngineCallbacks } from '../shared-context.js';

/**
 * 执行 excalidraw draw 动作并返回格式化结果
 */
async function executeDrawAction(
  args: { data?: unknown; diagramType?: string; filename?: string; style?: string; action?: string },
  pdfName: string,
  text: string,
): Promise<{ description: string; success: boolean }> {
  if (!args?.data) {
    return { description: `图表生成失败: draw 缺少 data 参数`, success: false };
  }

  const folder = pdfName
    ? `DeepReader/Excalidraw/${pdfName.replace(/[<>:"/\\|?*]/g, '')}`
    : undefined;
  const result = await runEngine({
    diagramType: (args.diagramType as EngineInput['diagramType']) || 'mindmap',
    data: args.data as EngineInput['data'],
    filename: args.filename,
    folder,
    style: args.style as EngineInput['style'],
  });

  if (result.success) {
    const wikiPath = (result.filePath ?? '').replace(/\.excalidraw\.md$/, '.excalidraw');
    const displayName = args.filename || '图表';
    const desc = `已生成 Excalidraw 图表：[[${wikiPath}|${displayName}]]\n节点数: ${result.nodeCount}，边数: ${result.edgeCount}\n\n${text}`;
    log(`[Visualizer] 图表生成成功: ${result.filePath}`);
    return { description: desc, success: true };
  } else {
    log(`[Visualizer] 图表生成失败: ${result.error}`);
    return { description: `图表生成失败: ${result.error}\n\n${text}`, success: false };
  }
}

/**
 * 尝试从 LLM 文本响应中提取 JSON 结构化数据（fallback 路径）
 * 某些模型不支持 tool calling 但会在文本中输出 JSON
 */
function tryExtractDrawArgsFromText(text: string): { action: string; diagramType: string; data: unknown; filename?: string } | null {
  // 在文本中查找 JSON 块
  const jsonPatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /\{[\s\S]*"action"\s*:\s*"draw"[\s\S]*\}/,
    /\{[\s\S]*"diagramType"[\s\S]*"data"[\s\S]*\}/,
  ];

  for (const pattern of jsonPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const jsonStr = match[1] || match[0];
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.action === 'draw' && parsed.data) {
        return parsed;
      }
    } catch {
      // not valid JSON, try next pattern
    }
  }

  return null;
}

export async function visualizerNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const { analysisResult: stateAnalysis, structuralAnalysis: stateStructural, rewrittenQuery: stateQuery, pdfName: statePdfName, tocSummary: stateTocSummary }: VisualizerInput = state;
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;
  const piManager = config.configurable?.piManager as PiProcessManager | undefined;
  const piConfig = config.configurable?.piConfig as PiConfig | undefined;
  const callbacks = config.configurable?.callbacks as EngineCallbacks | undefined;

  const sourceContent = stateAnalysis || stateStructural || '';
  if (!sourceContent) {
    log('[Visualizer] 无可用内容');
    return { analysisResult: '图表生成失败: 缺少分析内容' };
  }

  const userQuery = stateQuery || '';
  const pdfName = statePdfName || (toolContext?.book?.pdfName ?? '');

  // ── PI 路径：优先使用 PI 执行可视化 skill ──
  if (piManager && piConfig && !piManager.isBusy()) {
    log('[Visualizer] PI available, using PI backend');
    try {
      const app = toolContext?.vault?.app;
      if (app) {
        piManager.setupExtensionUiBridge();

        const skillDescriptions = await scanSkillDescriptions(app);
        const outputPath = generateOutputPath(app, 'visualize', pdfName || 'diagram');
        const skillContext = buildSkillContext({
          book: { title: pdfName, author: '' },
          currentSection: '',
          analysisSummary: sourceContent.slice(0, 500),
          analysisData: sourceContent,
          structuralAnalysis: stateStructural || undefined,
          tocSummary: stateTocSummary || undefined,
          skillDescriptions,
          outputPath,
          userRequest: userQuery,
        });

        const result = await piManager.executeSkill(
          skillContext,
          piConfig,
          (msg) => { callbacks?.onProgress?.(msg); log(`[Visualizer] PI progress: ${msg}`); },
          (text) => { callbacks?.onContent?.(text); },
        );

        if (result.success) {
          log(`[Visualizer] PI skill succeeded, output: ${result.outputPath}`);
          let statsInfo = '';
          if (result.stats) {
            const s = result.stats;
            statsInfo = `\nToken 消耗: ${s.tokens.total.toLocaleString()} | 费用: $${s.cost.toFixed(4)}`;
          }
          return { analysisResult: `图表已通过 PI 生成\n输出文件: ${result.outputPath}${statsInfo}` };
        }
        log(`[Visualizer] PI skill failed: ${result.error}, falling back to local engine`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[Visualizer] PI execution error: ${msg}, falling back to local engine`);
    }
  }

  // ── 本地路径：ExcalidrawAutomate / SenseNova 信息图 ──
  if (!mainModel || !toolContext) {
    log('[Visualizer] 模型或上下文不可用');
    return { analysisResult: '图表生成失败: 模型不可用' };
  }

  const hasExcalidraw = typeof window !== 'undefined' && window.ExcalidrawAutomate;
  const hasInfographic = !!toolContext.visual?.infographicConfig;
  if (!hasExcalidraw && !hasInfographic) {
    log('[Visualizer] 无可用图表工具（Excalidraw 未安装且信息图未配置）');
    return { analysisResult: '图表生成失败: 未安装 Excalidraw 插件且未配置信息图 API。请安装插件或在设置中配置 SenseNova API Key。' };
  }

  log(`[Visualizer] 开始生成图表，内容长度=${sourceContent.length}，query="${userQuery.slice(0, 50)}"`);

  try {
    const vizTools = createVizTools(toolContext);

    if (vizTools.length === 0) {
      log('[Visualizer] 图表工具未注册');
      return { analysisResult: '图表生成失败: 所有图表工具均不可用' };
    }

    const visualizerPrompt = buildVisualizerPrompt(hasInfographic);
    const modelWithTools = mainModel.bindTools(vizTools);

    const messages = [
      new SystemMessage(visualizerPrompt),
      new HumanMessage(`用户请求：${userQuery}\n\n当前书籍：《${pdfName}》\n\n分析内容：\n${sourceContent.slice(0, 4000)}`),
    ];

    const response = await modelWithTools.invoke(messages, config);
    const text = typeof response.content === 'string' ? response.content : '';

    // Check if LLM made tool calls (support multiple provider formats)
    const toolCalls: ToolCallLike[] = (response as { tool_calls?: ToolCallLike[] }).tool_calls
      || (response.additional_kwargs?.tool_calls as ToolCallLike[])
      || [];
    let diagramDescription = text;
    let drawExecuted = false;

    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const toolName = tc.name || tc.function?.name;

        if (toolName === 'generate_infographic') {
          const tool = vizTools.find(t => t.name === 'generate_infographic');
          if (tool) {
            let infArgs: Record<string, unknown>;
            infArgs = parseToolCallArgs(tc);
            if ('_parseError' in infArgs) {
              log('[Visualizer] generate_infographic 参数解析失败，跳过');
              diagramDescription = `图表生成失败: 信息图工具参数格式错误`;
              continue;
            }
            try {
              log('[Visualizer] 执行 generate_infographic 工具');
              const result = await tool.invoke(infArgs);
              diagramDescription = `已生成信息图：\n${result}`;
              drawExecuted = true;
            } catch (infErr) {
              const errMsg = infErr instanceof Error ? infErr.message : String(infErr);
              diagramDescription = `图表生成失败: 信息图工具执行失败 — ${errMsg}`;
              log(`[Visualizer] generate_infographic 执行失败: ${errMsg}`);
            }
          }
          continue;
        }

        if (toolName !== 'excalidraw') continue;

        const args = parseToolCallArgs(tc) as Record<string, unknown> & { action?: string; data?: unknown };
        if ('_parseError' in args) {
          log(`[Visualizer] tool call 参数解析失败`);
          continue;
        }
        log(`[Visualizer] 执行 excalidraw 工具: action=${args?.action}`);

        if (args?.action === 'draw' && args?.data) {
          const result = await executeDrawAction(args, pdfName, text);
          diagramDescription = result.description;
          drawExecuted = true;
        }
      }
    }

    // Fallback: 尝试从文本中提取结构化 JSON 数据
    if (!drawExecuted) {
      log('[Visualizer] LLM 未通过 tool call 调用，尝试从文本提取 JSON');
      const extracted = tryExtractDrawArgsFromText(text);
      if (extracted) {
        log('[Visualizer] 从文本中提取到 draw 参数，执行图表生成');
        const result = await executeDrawAction(extracted, pdfName, text);
        diagramDescription = result.description;
        drawExecuted = true;
      }
    }

    if (!drawExecuted) {
      log('[Visualizer] 所有尝试均失败，LLM 输出：', text.slice(0, 200));
      diagramDescription = `图表生成失败: 模型未调用绘图工具。请尝试用更明确的措辞重试（如"为这本书画一个思维导图"）。\n\n${text}`;
    }

    return { analysisResult: diagramDescription };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[Visualizer] 错误: ${msg}`);
    return { analysisResult: `图表生成失败: ${msg}` };
  }
}
