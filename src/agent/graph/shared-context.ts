/**
 * SharedContext — immutable request context for LangGraph nodes.
 *
 * 边界（见 ADR-0001）：SharedContext 只放"本次请求的不可变输入/依赖"。
 * 节点执行中产生、需向下游流转的可变数据归 LangGraph State，不进此处。
 * 判定规则：输入 = Context，产出 = State。
 */

import type { ToolContext } from '../tools/types';
import type { ChatMessage } from '../types';
import type { HistorySummary } from './utils/history-summarizer';

/**
 * Callbacks for engine progress reporting
 */
export interface EngineCallbacks {
  onProgress: (status: string) => void;
  onContent: (text: string) => void;
  onReasoning?: (text: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  /**
   * 图表生成开始时同步触发（visualizer 节点内）。
   * 前端用于标记"本次回复会附带图表"，占位气泡延迟到 formatter onComplete 后才创建
   * （避免文字流式输出时就冒出空的画图气泡，体验割裂）。
   */
  onDiagramStart?: () => void;
  /**
   * 图表生成完成时异步触发（visualizer 节点的 fire-and-forget 任务内）。
   * embed 形如 "![[Excalidraw/xxx.excalidraw.md]]"。
   */
  onDiagramReady?: (embed: string) => void;
  /**
   * 图表生成失败/超时异步触发（visualizer fire-and-forget 任务内）。
   * 前端用于把占位气泡替换为失败提示，并重置 diagramPending 等状态，避免占位永远卡住。
   */
  onDiagramFailed?: (reason: string) => void;
}

/**
 * Shared context passed to graph nodes via config.configurable.sharedContext.
 *
 * 单一来源原则：节点统一从 `config.configurable.sharedContext` 取业务上下文，
 * 不再从 `config.configurable` 顶层取同名键（消除双轨制）。
 * 运行时基础设施（mainModel/fastModel/callbacks/enableHumanReview）仍留顶层，
 * 不属本接口——它们是 LangGraph 执行依赖，与本次对话的业务上下文无关。
 */
export interface SharedContext {
  /** 用户原始输入（未经 standalone/betterQuestion 改写）。 */
  rawUserQuery: string;
  /** 进入本次图执行前的对话历史（只读输入）。 */
  chatHistory: ChatMessage[];
  /** 用户长期记忆摘要（注入 prompt）。 */
  memoryContext?: string;
  /** 用户画像摘要（注入 prompt）。 */
  userProfileSummary?: string;
  /** 从历史中抽取的近期对话摘要（注入 prompt）。 */
  recentHistorySummaries?: HistorySummary[];
  /**
   * 上一轮已检索过的 block id 种子（避免本轮重复检索）。
   * 仅作"初始种子"——运行中节点间流转的累积去重集合归 State.prevSearchedBlockIds。
   */
  initialPrevSearchedBlockIds?: string[];
  /** 工具上下文（Vault / book / plugin 等运行时依赖）。 */
  toolContext?: ToolContext;
  /** 用户取消信号。 */
  abortSignal?: AbortSignal;
}

/**
 * Factory function to create a new SharedContext
 */
export function createSharedContext(params: {
  rawUserQuery: string;
  chatHistory?: ChatMessage[];
  abortSignal?: AbortSignal;
  memoryContext?: string;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  initialPrevSearchedBlockIds?: string[];
  userProfileSummary?: string;
}): SharedContext {
  return {
    chatHistory: params.chatHistory || [],
    rawUserQuery: params.rawUserQuery,
    abortSignal: params.abortSignal,
    memoryContext: params.memoryContext,
    toolContext: params.toolContext,
    recentHistorySummaries: params.recentHistorySummaries,
    initialPrevSearchedBlockIds: params.initialPrevSearchedBlockIds,
    userProfileSummary: params.userProfileSummary,
  };
}
