/**
 * Agent 系统集中常量定义
 *
 * 所有硬编码参数统一在此文件管理，
 * 源文件通过 import 引用。
 */

// ============ 分析节点 ============

/** 分析节点：低于此置信度时提前终止工具循环 */
export const DEFAULT_EARLY_STOP_THRESHOLD = 0.6;

/** @deprecated Use getEarlyStopThreshold() for runtime configuration */
export const EARLY_STOP_THRESHOLD = DEFAULT_EARLY_STOP_THRESHOLD;

/** 从 settings 中获取早停阈值，未配置时回退到默认值 */
export function getEarlyStopThreshold(settings?: unknown): number {
  const obj = settings as Record<string, unknown> | undefined;
  const raw = obj?.earlyStopThreshold;
  if (typeof raw === 'number' && raw > 0 && raw <= 1) return raw;
  return DEFAULT_EARLY_STOP_THRESHOLD;
}

// ============ React Loop ============

/** 工具结果截断长度（字符） */
export const MAX_TOOL_RESULT_LENGTH = 4000;

/** 保留完整内容的工具消息条数上限 */
export const MAX_FULL_TOOL_MESSAGES = 2;

// ============ Agent Loop ============

/** 消息历史最大 token 数（超出时触发压缩） */
export const MAX_CONTEXT_TOKENS = 20000;

/** 工具执行失败最大重试次数 */
export const TOOL_MAX_RETRIES = 2;

// ============ 记忆系统 ============

/** 记忆条数上限（store + consolidator 统一值） */
export const MAX_MEMORY_LINES = 150;

/** 单条记忆最大字符数 */
export const MAX_MEMORY_CHARS = 8000;

// ============ 主题阅读 ============

/** 主题阅读：每本书召回的最大快照数 */
export const SYNTOPICAL_SNAPSHOT_LIMIT = 20;

/** 主题阅读：最大参与书籍数 */
export const SYNTOPICAL_MAX_BOOKS = 5;

/** 主题阅读：每本书返回的 Top-K 结果数 */
export const SYNTOPICAL_TOP_K_PER_BOOK = 5;

// ============ 检视阅读 ============

/** 检视阅读：目录树文本截断长度 */
export const TREE_STRUCTURE_MAX_TEXT_LENGTH = 100;

/** 检视阅读：目录树最大深度 */
export const TREE_STRUCTURE_MAX_DEPTH = 4;

// ============ 工具执行 ============

/** 工具执行超时（毫秒） */
export const TOOL_EXECUTION_TIMEOUT_MS = 60000;
