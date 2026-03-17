/**
 * IntentRouter 类型定义
 */

/**
 * 意图规则
 */
export interface IntentRule {
  id: string;
  pattern: string;       // 正则表达式字符串
  intent: string;        // 意图名称
  tools: string[];       // 允许的工具列表
  priority: number;      // 优先级（暂未使用，保留扩展）
}

/**
 * 路由分析结果
 */
export interface IntentResult {
  allowedTools: string[];      // 允许的工具列表
  systemNote: string;          // 动态注入的 <system_note>
  detectedIntents: string[];   // 检测到的意图（用于日志）
}

/**
 * 规则配置文件结构
 */
export interface IntentRulesConfig {
  version: string;
  description: string;
  rules: IntentRule[];
  fallback: {
    intent: string;
    tools: string[];
  };
  tool_aliases?: Record<string, string>;
}
