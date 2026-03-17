/**
 * 调试日志类型定义
 */

export interface DebugLogConfig {
  enabled: boolean;
  logDir: string;
}

export interface IterationLog {
  iteration: number;
  timestamp: string;
  callStack: string;
  systemPrompt?: string;
  messages: unknown[];
  llmRequest?: LLMRequestLog;
  llmResponse?: LLMResponseLog;
  toolExecutions: ToolExecutionLog[];
  backendCalls: BackendCallLog[];
  stats: IterationStats;
}

export interface LLMRequestLog {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  timestamp: string;
  callStack: string;
}

export interface LLMResponseLog {
  timestamp: string;
  callStack: string;
  metadata: {
    model: string;
    finishReason: string;
    inputTokens?: number;
    outputTokens?: number;
    ttfb?: number;
  };
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: unknown;
  }>;
  rawChunks: string[];  // 流式响应的原始数据块
}

export interface ToolExecutionLog {
  timestamp: string;
  callStack: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: string;
  duration: number;
}

export interface BackendCallLog {
  timestamp: string;
  callStack: string;
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseStatus: number;
  responseBody?: unknown;
  duration: number;
}

export interface IterationStats {
  duration: number;
  llmDuration: number;
  toolsDuration: number;
  tokenStart: number;
  tokenEnd: number;
  toolCallCount: number;
}

export interface SessionSummary {
  timestamp: string;
  userQuery: string;
  totalIterations: number;
  totalDuration: number;
  totalStats: {
    llmDuration: number;
    toolsDuration: number;
    tokenStart: number;
    tokenEnd: number;
    toolCallCount: number;
  };
  toolSummary: Array<{
    iteration: number;
    toolName: string;
    duration: number;
  }>;
  files: string[];
}
