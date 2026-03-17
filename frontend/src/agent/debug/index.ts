/**
 * Agent 调试日志模块
 *
 * 提供完整的 Agent 执行过程记录，包括：
 * - 系统提示词
 * - LLM 请求/响应
 * - 工具调用
 * - 后端 API 通信
 *
 * 使用方式：
 * 1. 在 FrontendAgent 初始化时调用 initDebugLogger(app)
 * 2. 在各组件中通过 getDebugLogger() 获取实例
 * 3. 使用 DEBUG_LOG_ENABLED 常量控制开关
 */

export {
  DebugLogger,
  initDebugLogger,
  getDebugLogger,
  getCallStack,
  DEBUG_LOG_ENABLED,
} from './logger.js';

export type {
  DebugLogConfig,
  IterationLog,
  LLMRequestLog,
  LLMResponseLog,
  ToolExecutionLog,
  BackendCallLog,
  IterationStats,
  SessionSummary,
} from './types.js';
