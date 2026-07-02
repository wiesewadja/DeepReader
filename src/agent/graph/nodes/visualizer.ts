/**
 * Visualizer Node — 异步图表生成节点（fire-and-forget）
 *
 * 检测到可视化意图时由 edges.ts 路由到本节点。
 *
 * 设计：节点同步触发 onDiagramStart、启动后台 generateDiagram 任务后立即返回，
 * 不阻塞 formatter 节点开始流式输出，从而把 TTCF 从"等图表完成"降到"等 formatter 首 token"。
 *
 * 数据流：
 * - 输入：state.analysisResult / state.structuralAnalysis（合并作为图表内容源）
 * - 输出：state 不变（embed 不写回 state），embed 通过 onDiagramReady 回调直达前端
 *
 * 回调：
 * - onDiagramStart: 同步触发，前端标记"本次回复会附带图表"（占位气泡延迟到 formatter 完成后才创建）
 * - onDiagramReady: 异步触发（embed 字符串），前端把占位符替换为实际嵌入
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { agentLog as log } from '../../../utils/logger.js';
import type { CognitiveEngineState } from '../state';
import { generateDiagram } from '../utils/diagram-helper.js';
// 注：generateDiagramProgressive（渐进式分节）已回退未接入，代码保留在 diagram-helper.ts 待未来重启
import type { EngineCallbacks } from '../shared-context.js';

export async function visualizerNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  // 画图优先用 fastModel（更快），不可用回退 mainModel。
  // 画图是单次大输出（完整 Excalidraw JSON），fastModel 速度优势明显；
  // fastModel 未配置时 createChatModels 会令其等于 mainModel，故总是存在。
  const fastModel = config.configurable?.fastModel ?? config.configurable?.mainModel;
  const ctx = config.configurable?.sharedContext;
  const toolContext = ctx?.toolContext;
  const callbacks = config.configurable?.callbacks as Partial<EngineCallbacks> | undefined;
  const abortSignal = ctx?.abortSignal;

  if (!fastModel || !toolContext) {
    log('[Visualizer] 缺少 fastModel/mainModel 或 toolContext，跳过图表生成');
    return { analysisResult: state.analysisResult || '' };
  }

  const content = [state.analysisResult, state.structuralAnalysis].filter(Boolean).join('\n\n');
  if (!content) {
    log('[Visualizer] 无分析内容，跳过图表生成');
    return { analysisResult: state.analysisResult || '' };
  }

  // 同步触发：标记本次回复会附带图表。
  // 注意：占位气泡不在这里创建——前端会在 formatter onComplete 后才创建占位，
  // 避免文字流式输出时就冒出空的"画图中"气泡。后台任务在这里立即启动（fire-and-forget）。
  callbacks?.onDiagramStart?.();

  // fire-and-forget：用 setTimeout(0) 把后台任务推到下一轮 macrotask，
  // 彻底脱离当前 async function 的执行上下文。
  // 否则 LangSmith tracer 的 async context 会把 IIFE 视为节点的一部分，
  // 直到 IIFE 完成才记录节点 end_time，导致 formatter 被延迟启动。
  const userSignal = abortSignal;
  const start = callbacks;
  const query = state.rewrittenQuery || '';
  const pdfName = state.pdfName;

  // 独立的 watchdog AbortController：与用户 abortSignal 分开。
  // 超时后 abort 中断底层 invoke fetch，并触发 onDiagramFailed 清理占位。
  // 单次生成约 40s，超时放宽到 180s 容纳 LLM 偶发慢响应。
  const DIAGRAM_TIMEOUT_MS = 180_000; // 3 分钟
  const watchdog = new AbortController();
  const watchdogTimer = setTimeout(() => {
    if (!watchdog.signal.aborted) {
      watchdog.abort();
      log(`[Visualizer] 画图超时 (${DIAGRAM_TIMEOUT_MS / 1000}s)，已 abort + 通知失败`);
      start?.onDiagramFailed?.(`画图超时 (${DIAGRAM_TIMEOUT_MS / 1000}s)，请稍后重试`);
    }
  }, DIAGRAM_TIMEOUT_MS);

  setTimeout(() => {
    void (async () => {
      try {
        if (userSignal?.aborted) {
          log('[Visualizer] 用户 abortSignal 已触发，跳过图表生成');
          clearTimeout(watchdogTimer);
          return;
        }

        // 单次生成：LLM 一次性输出完整 Excalidraw JSON。
        // 渐进式分节方案（generateDiagramProgressive）实测首图更慢 + 布局乱 + 闪烁，
        // 已回退；代码保留在 diagram-helper.ts 待未来局部更新方案成熟后重启。
        const drawStart = Date.now();
        log(`[Visualizer] 开始绘图（fire-and-forget，与 formatter 并行）query="${query.slice(0, 30)}"`);
        const embed = await generateDiagram(query, content, fastModel, toolContext, {
          pdfName,
          signal: watchdog.signal,
        });
        log(`[Visualizer] 绘图 invoke 完成，耗时 ${((Date.now() - drawStart) / 1000).toFixed(1)}s`);

        // watchdog 已触发（超时）→ 结果作废
        if (watchdog.signal.aborted) {
          log('[Visualizer] 图表生成完成但已超时，丢弃结果');
          return;
        }
        clearTimeout(watchdogTimer);

        // 用户在生成运行中主动 abort
        if (userSignal?.aborted) {
          log('[Visualizer] 图表生成完成但用户 abortSignal 已触发，丢弃结果');
          return;
        }

        if (!embed) {
          // 失败（LLM 未返回有效结果 / JSON 解析失败 / 工具执行失败）
          log('[Visualizer] 图表生成失败');
          start?.onDiagramFailed?.('图表生成失败，请稍后重试');
          return;
        }

        log(`[Visualizer] 图表就绪，总耗时 ${((Date.now() - drawStart) / 1000).toFixed(1)}s，通知前端`);
        start?.onDiagramReady?.(embed);
      } catch (err) {
        clearTimeout(watchdogTimer);
        // watchdog abort 会让 invoke 抛 AbortError——但 onDiagramFailed 已在 watchdog 里调过，这里跳过
        if (watchdog.signal.aborted) {
          log('[Visualizer] invoke 被 watchdog abort 中断（超时），已在 watchdog 通知失败');
          return;
        }
        const reason = err instanceof Error ? err.message : String(err);
        log('[Visualizer] 后台图表生成异常:', reason);
        start?.onDiagramFailed?.(reason);
      }
    })();
  }, 0);

  // 同步返回原 state 内容，formatter 立即开始流式输出
  return { analysisResult: state.analysisResult || '' };
}
