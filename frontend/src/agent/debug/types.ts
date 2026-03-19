/**
 * Agent 调试日志类型定义
 *
 * 记录完整的 Agent 执行过程，包括：
 * - 意图路由决策
 * - 认知状态机流转
 * - SharedContext 变化
 * - LLM 交互
 * - 工具调用与拦截
 * - 记忆系统操作
 */

// ==================== 基础配置 ====================

export interface DebugLogConfig {
  /** 是否启用日志 */
  enabled: boolean;
  /** 日志目录（相对于 Vault 根目录） */
  logDir: string;
  /** 是否记录详细的消息内容 */
  verboseMessages: boolean;
  /** 是否记录工具结果完整内容 */
  verboseToolResults: boolean;
}

export const DEFAULT_DEBUG_CONFIG: DebugLogConfig = {
  enabled: true,
  logDir: 'debug-logs',
  verboseMessages: false,
  verboseToolResults: false,
};

// ==================== 会话级别日志 ====================

/**
 * 完整的 Agent 会话日志
 */
export interface AgentSessionLog {
  /** 会话 ID */
  sessionId: string;
  /** 开始时间 */
  startTime: string;
  /** 结束时间 */
  endTime?: string;
  /** 用户原始问题 */
  userQuery: string;
  /** 书籍名称 */
  bookName: string;
  /** 索引 ID */
  indexId: string;

  // ===== 意图路由 =====
  intentRouting?: IntentRoutingLog;

  // ===== 状态机执行 =====
  stateExecutions: StateExecutionLog[];

  // ===== 统计信息 =====
  stats: SessionStats;

  // ===== 生成的文件列表 =====
  files: string[];
}

/**
 * 意图路由日志
 */
export interface IntentRoutingLog {
  /** 匹配的意图列表 */
  detectedIntents: string[];
  /** 允许的工具列表 */
  allowedTools: string[];
  /** 动态系统指令 */
  systemNote: string;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 路由耗时 */
  duration: number;
}

// ==================== 状态执行日志 ====================

/**
 * 状态执行日志
 */
export interface StateExecutionLog {
  /** 状态名称 */
  stateName: string;
  /** 迭代序号 */
  iteration: number;
  /** 开始时间 */
  startTime: string;
  /** 结束时间 */
  endTime?: string;
  /** 执行时长 */
  duration: number;

  // ===== 状态输入 =====
  input: StateInputLog;

  // ===== 状态输出 =====
  output: StateOutputLog;

  // ===== LLM 交互 =====
  llmInteractions: LLMInteractionLog[];

  // ===== 工具调用 =====
  toolCalls: ToolCallLog[];

  // ===== 统计 =====
  stats: StateStats;
}

/**
 * 状态输入日志
 */
export interface StateInputLog {
  /** 用户查询（重写后） */
  query?: string;
  /** 聊天历史摘要 */
  historyCount: number;
  /** 可用工具列表 */
  availableTools: string[];
  /** 范围锁定 */
  scopeNodeIds?: string[];
}

/**
 * 状态输出日志
 */
export interface StateOutputLog {
  /** 阅读深度 */
  depth?: number;
  /** 独立查询 */
  standaloneQuery?: string;
  /** 锁定的章节范围 */
  scopeNodeIds?: string[];
  /** 锁定的章节标题（用于显示） */
  scopeNodeTitles?: string[];
  /** 目录摘要 */
  tocSummary?: string;
  /** 分析结果 */
  analysisResult?: string;
  /** 最终输出内容 */
  content?: string;
  /** 完成原因 */
  finishReason: 'stop' | 'max_iterations' | 'error' | 'forced';
}

/**
 * 状态统计
 */
export interface StateStats {
  /** LLM 调用次数 */
  llmCallCount: number;
  /** LLM 总耗时 */
  llmDuration: number;
  /** 工具调用次数 */
  toolCallCount: number;
  /** 工具总耗时 */
  toolDuration: number;
  /** 输入 Token 估算 */
  inputTokens?: number;
  /** 输出 Token 估算 */
  outputTokens?: number;
}

// ==================== LLM 交互日志 ====================

/**
 * LLM 交互日志
 */
export interface LLMInteractionLog {
  /** 交互序号 */
  index: number;
  /** 开始时间 */
  startTime: string;
  /** 耗时 */
  duration: number;

  // ===== 请求 =====
  request: LLMRequestDetail;

  // ===== 响应 =====
  response: LLMResponseDetail;
}

/**
 * LLM 请求详情
 */
export interface LLMRequestDetail {
  /** 模型名称 */
  model: string;
  /** 模型类型 */
  modelType: 'fast' | 'main';
  /** 系统提示词（完整） */
  systemPrompt: string;
  /** 系统提示词长度 */
  systemPromptLength: number;
  /** 用户消息 */
  userMessage: string;
  /** 工具定义数量 */
  toolCount: number;
  /** 消息历史数量 */
  messageCount: number;
}

/**
 * LLM 响应详情
 */
export interface LLMResponseDetail {
  /** 完成原因 */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  /** 输出内容 */
  content: string;
  /** 输出内容长度 */
  contentLength: number;
  /** 工具调用请求 */
  toolCallRequests: ToolCallRequestLog[];
  /** TTFB（首字节时间） */
  ttfb?: number;
  /** 输入 Token */
  inputTokens?: number;
  /** 输出 Token */
  outputTokens?: number;
}

/**
 * 工具调用请求日志
 */
export interface ToolCallRequestLog {
  /** 调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 参数 */
  arguments: Record<string, unknown>;
}

// ==================== 工具调用日志 ====================

/**
 * 工具调用日志
 */
export interface ToolCallLog {
  /** 调用 ID */
  callId: string;
  /** 工具名称 */
  toolName: string;
  /** 开始时间 */
  startTime: string;
  /** 耗时 */
  duration: number;

  // ===== 参数 =====
  originalArgs: Record<string, unknown>;
  /** 拦截后的参数（如果有拦截器） */
  interceptedArgs?: Record<string, unknown>;
  /** 拦截器修改说明 */
  interceptorNote?: string;

  // ===== 结果 =====
  status: 'success' | 'error';
  result?: string;
  resultLength?: number;
  error?: string;

  // ===== 结果解析 =====
  parsedResult?: {
    status?: string;
    hits?: number;
    blockIds?: string[];
  };
}

// ==================== 会话统计 ====================

/**
 * 会话统计
 */
export interface SessionStats {
  /** 总耗时 */
  totalDuration: number;
  /** 状态执行数 */
  stateCount: number;
  /** LLM 调用总次数 */
  llmCallCount: number;
  /** LLM 总耗时 */
  llmDuration: number;
  /** 工具调用总次数 */
  toolCallCount: number;
  /** 工具总耗时 */
  toolDuration: number;
  /** Token 使用统计 */
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  /** 工具调用分布 */
  toolDistribution: Record<string, { count: number; duration: number }>;
}

// ==================== 向后兼容（旧类型） ====================

/**
 * @deprecated 使用 AgentSessionLog 替代
 */
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
  stateInfo?: {
    stateName: string;
    depth?: number;
    standaloneQuery?: string;
    scopeNodeIds?: string[];
    method?: 'regex' | 'llm';
    innerIterations?: number;
  };
}

/**
 * @deprecated 使用 LLMInteractionLog 替代
 */
export interface LLMRequestLog {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  timestamp: string;
  callStack: string;
}

/**
 * @deprecated 使用 LLMInteractionLog 替代
 */
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
  rawChunks: string[];
}

/**
 * @deprecated 使用 ToolCallLog 替代
 */
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

/**
 * @deprecated
 */
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

/**
 * @deprecated 使用 StateStats 替代
 */
export interface IterationStats {
  duration: number;
  llmDuration: number;
  toolsDuration: number;
  tokenStart: number;
  tokenEnd: number;
  toolCallCount: number;
}

/**
 * @deprecated 使用 AgentSessionLog 替代
 */
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