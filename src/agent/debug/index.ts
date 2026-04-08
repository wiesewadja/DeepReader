/**
 * Agent 调试日志模块
 *
 * 提供完整的 Agent 执行过程记录，包括：
 * - 意图路由决策
 * - 认知状态机流转
 * - SharedContext 变化
 * - LLM 交互
 * - 工具调用与拦截
 * - 记忆系统操作
 *
 * 使用方式：
 * 1. 在 FrontendAgent 初始化时调用 initDebugLogger(app)
 * 2. 在各组件中通过 getDebugLogger() 获取实例
 * 3. 使用 DEBUG_LOG_ENABLED 常量控制开关
 *
 * 日志输出格式：
 * debug-logs/
 *   └── 2026-03-19_14-30-00/           # 会话目录
 *       ├── 00-summary.md              # 总览
 *       ├── 01-router.md               # S0 路由状态
 *       ├── 02-inspectional.md         # S1 检视状态
 *       ├── 03-analytical.md           # S2 分析状态
 *       ├── 04-formatter.md            # S4 格式化状态
 *       └── session.json               # 完整 JSON 数据
 */

export {
  DebugLogger,
  initDebugLogger,
  getDebugLogger,
  getCallStack,
  DEBUG_LOG_ENABLED,
} from './logger.js';

// 新版类型
export type {
  DebugLogConfig,
  AgentSessionLog,
  IntentRoutingLog,
  StateExecutionLog,
  StateInputLog,
  StateOutputLog,
  LLMInteractionLog,
  ToolCallLog,
  SessionStats,
  // 向后兼容
  IterationLog,
  LLMRequestLog,
  LLMResponseLog,
  ToolExecutionLog,
  BackendCallLog,
  IterationStats,
  SessionSummary,
} from './types.js';

// 默认配置
export { DEFAULT_DEBUG_CONFIG } from './types.js';
