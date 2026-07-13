/**
 * GraphConfigurable — LangGraph runtime configuration for cognitive engine nodes.
 *
 * 边界（见 ADR-010）：configurable 顶层只放"本次图执行的运行时基础设施"：
 * 模型实例、回调、线程 ID、HITL 开关、以及可观测性 tracer。
 * 具体某次对话的业务输入（query / history / memory / tool 依赖）全部放在
 * sharedContext 内，不直接在 configurable 顶层暴露。
 */

import type { ChatOpenAI } from '@langchain/openai';
import type { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { EngineCallbacks, SharedContext } from './shared-context.js';

/**
 * LangGraph 运行时的 configurable 对象结构。
 *
 * 注意：`_langsmithTracer` 以下划线开头表示它是一个框架/运行时级别的内部字段，
 * 不对外暴露给节点业务逻辑；仅用于 formatter 中的手动 `wiki_link_verification` trace。
 */
export interface GraphConfigurable {
  /** 线程 ID，用于 LangGraph checkpoint 和 tracing */
  thread_id: string;
  /** 快速模型实例（S1 Inspectional / S2-Pre） */
  fastModel: ChatOpenAI;
  /** 主模型实例（S2 Analytical / S3 Syntopical / S4 Formatter） */
  mainModel: ChatOpenAI;
  /** 业务上下文（输入 = Context，见 ADR-010） */
  sharedContext: SharedContext;
  /** 引擎回调（进度、内容、完成、错误、图表事件） */
  callbacks: EngineCallbacks;
  /** 是否启用 HITL 中断 */
  enableHumanReview: boolean;
  /** 可选：LangSmith tracer，用于额外手动 trace */
  _langsmithTracer?: LangChainTracer;
  /** 允许 LangGraph 传递其他内部字段 */
  [key: string]: unknown;
}

/**
 * 从 LangGraph RunnableConfig 中提取类型化的 GraphConfigurable。
 *
 * 注意：这里只做编译期类型断言；运行时仍依赖 FrontendAgent 正确装配。
 */
export function getGraphConfigurable(config: RunnableConfig): GraphConfigurable {
  return (config.configurable ?? {}) as GraphConfigurable;
}

