/**
 * DebugLogger - Agent 调试日志记录器
 *
 * 记录完整的 Agent 执行过程，包括：
 * - 意图路由决策
 * - 认知状态机流转
 * - SharedContext 变化
 * - LLM 交互
 * - 工具调用与拦截
 * - 记忆系统操作
 *
 * 日志输出格式：
 * debug-logs/
 *   └── 2026-03-19_14-30-00/           # 会话目录
 *       ├── 00-summary.md              # 总览
 *       ├── 01-router.md               # S0 路由状态
 *       ├── 02-inspectional.md         # S1 检视状态
 *       ├── 03-analytical.md           # S2 分析状态
 *       ├── 04-formatter.md            # S4 格式化状态
 *       ├── tools.md                   # 工具调用日志
 *       └── session.json               # 完整 JSON 数据
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type {
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
import { DEFAULT_DEBUG_CONFIG } from './types.js';

/**
 * 🔧 调试日志开关
 * 设为 true 启用完整调试日志，设为 false 禁用
 */
export const DEBUG_LOG_ENABLED = true;

/**
 * 获取调用栈信息
 */
export function getCallStack(): string {
  const stack = new Error().stack?.split('\n') || [];

  const relevantLines = stack
    .filter(line => {
      return line.includes('.ts:') &&
             !line.includes('node_modules') &&
             !line.includes('logger.ts');
    })
    .map(line => {
      const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
      if (match) {
        const fnName = match[1] || '<anonymous>';
        const filePath = match[2].split('/').pop() || match[2];
        const lineNum = match[3];
        return `${filePath}:${lineNum} → ${fnName}()`;
      }
      return line.trim();
    });

  if (relevantLines.length === 0) {
    return '(无法获取调用栈)';
  }

  return relevantLines.slice(0, 6).join('\n  → ');
}

/**
 * DebugLogger - Agent 调试日志记录器
 */
export class DebugLogger {
  private app: App;
  private config: DebugLogConfig;
  private sessionDir: string | null = null;

  // ===== 新版日志数据 =====
  private sessionLog: AgentSessionLog | null = null;
  private currentStateLog: StateExecutionLog | null = null;
  private currentLLMInteraction: LLMInteractionLog | null = null;

  // ===== 向后兼容 =====
  private currentIteration = 0;
  private currentIterationLog: IterationLog | null = null;
  private sessionStartTime = 0;
  private sessionQuery = '';
  private allIterationLogs: IterationLog[] = [];

  constructor(app: App, config?: Partial<DebugLogConfig>) {
    this.app = app;
    this.config = { ...DEFAULT_DEBUG_CONFIG, ...config };
  }

  /**
   * 检查日志是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  // ============================================================================
  // 会话管理
  // ============================================================================

  /**
   * 开始新的调试会话
   */
  async startSession(userQuery: string, bookName: string = '', indexId: string = ''): Promise<void> {
    if (!this.config.enabled) return;

    // 创建会话目录
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.sessionDir = `${this.config.logDir}/${timestamp}`;

    const dirPath = normalizePath(this.sessionDir);

    // 确保目录存在
    try {
      await this.app.vault.adapter.mkdir(this.config.logDir);
    } catch { /* ignore */ }

    try {
      await this.app.vault.adapter.mkdir(dirPath);
    } catch { /* ignore */ }

    // 初始化会话日志
    this.sessionLog = {
      sessionId: timestamp,
      startTime: new Date().toISOString(),
      userQuery,
      bookName,
      indexId,
      stateExecutions: [],
      stats: {
        totalDuration: 0,
        stateCount: 0,
        llmCallCount: 0,
        llmDuration: 0,
        toolCallCount: 0,
        toolDuration: 0,
        tokens: { input: 0, output: 0, total: 0 },
        toolDistribution: {},
      },
      files: [],
    };

    // 向后兼容
    this.sessionQuery = userQuery;
    this.sessionStartTime = Date.now();
    this.currentIteration = 0;
    this.allIterationLogs = [];

    console.log(`[DebugLogger] 📁 开始调试会话: ${this.sessionDir}`);
  }

  /**
   * 记录最终输出（答案）
   */
  setFinalOutput(output: string): void {
    if (!this.config.enabled || !this.sessionLog) return;

    this.sessionLog.finalOutput = output;
    this.sessionLog.finalOutputLength = output.length;

    console.log(`[DebugLogger] 💬 最终答案: ${output.length} 字符`);
    // 预览前 100 字符
    const preview = output.length > 100 ? output.slice(0, 100) + '...' : output;
    console.log(`[DebugLogger]    预览: ${preview.replace(/\n/g, ' ')}`);
  }

  /**
   * 结束调试会话
   */
  async endSession(): Promise<void> {
    if (!this.config.enabled || !this.sessionDir || !this.sessionLog) return;

    // 更新会话结束时间
    this.sessionLog.endTime = new Date().toISOString();
    this.sessionLog.stats.totalDuration = Date.now() - new Date(this.sessionLog.startTime).getTime();

    // 写入摘要文件
    await this.writeSummaryMarkdown();

    // 写入完整 JSON
    await this.writeSessionJson();

    // 写入各状态详细日志
    for (const stateLog of this.sessionLog.stateExecutions) {
      await this.writeStateMarkdown(stateLog);
    }

    // 写入工具调用日志
    await this.writeToolsMarkdown();

    console.log(`[DebugLogger] ✅ 调试会话结束: ${this.sessionDir}`);
    this.sessionDir = null;
    this.sessionLog = null;
  }

  // ============================================================================
  // 意图路由日志
  // ============================================================================

  /**
   * 记录意图路由结果
   */
  logIntentRouting(routing: IntentRoutingLog): void {
    if (!this.config.enabled || !this.sessionLog) return;

    this.sessionLog.intentRouting = routing;

    console.log(`[DebugLogger] 🎯 意图路由: ${routing.detectedIntents.join(', ')}`);
    console.log(`[DebugLogger]    允许工具: ${routing.allowedTools.join(', ')}`);
  }

  // ============================================================================
  // 状态执行日志
  // ============================================================================

  /**
   * 开始状态执行
   */
  startStateExecution(stateName: string, input: Partial<StateInputLog>): void {
    if (!this.config.enabled || !this.sessionLog) return;

    const iteration = this.sessionLog.stateExecutions.length + 1;

    this.currentStateLog = {
      stateName,
      iteration,
      startTime: new Date().toISOString(),
      duration: 0,
      input: {
        historyCount: 0,
        availableTools: [],
        ...input,
      },
      output: {
        finishReason: 'stop',
      },
      llmInteractions: [],
      toolCalls: [],
      stats: {
        llmCallCount: 0,
        llmDuration: 0,
        toolCallCount: 0,
        toolDuration: 0,
      },
    };

    // 向后兼容
    this.currentIteration = iteration;
    this.startIteration(iteration);

    console.log(`[DebugLogger] ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[DebugLogger] ┃ 🔄 状态 ${iteration}: ${stateName}`);
    console.log(`[DebugLogger] ┃    输入: ${input.query || '(无查询)'}`);
    console.log(`[DebugLogger] ┃    工具: ${input.availableTools?.join(', ') || '(无工具)'}`);
  }

  /**
   * 结束状态执行
   */
  endStateExecution(output: Partial<StateOutputLog>): void {
    if (!this.config.enabled || !this.sessionLog || !this.currentStateLog) return;

    // 更新输出
    this.currentStateLog.output = {
      ...this.currentStateLog.output,
      ...output,
    };

    // 计算耗时
    this.currentStateLog.duration = Date.now() - new Date(this.currentStateLog.startTime).getTime();
    this.currentStateLog.endTime = new Date().toISOString();

    // 添加到会话日志
    this.sessionLog.stateExecutions.push(this.currentStateLog);

    // 更新统计
    this.sessionLog.stats.stateCount++;
    this.sessionLog.stats.llmCallCount += this.currentStateLog.stats.llmCallCount;
    this.sessionLog.stats.llmDuration += this.currentStateLog.stats.llmDuration;
    this.sessionLog.stats.toolCallCount += this.currentStateLog.stats.toolCallCount;
    this.sessionLog.stats.toolDuration += this.currentStateLog.stats.toolDuration;

    // 输出摘要
    const duration = (this.currentStateLog.duration / 1000).toFixed(1);
    console.log(`[DebugLogger] ┃ ✅ 完成: ${duration}s`);
    if (output.depth !== undefined) {
      console.log(`[DebugLogger] ┃    深度: ${output.depth}`);
    }
    if (output.scopeNodeIds && output.scopeNodeIds.length > 0) {
      console.log(`[DebugLogger] ┃    范围: ${output.scopeNodeIds.slice(0, 3).join(', ')}${output.scopeNodeIds.length > 3 ? '...' : ''}`);
    }
    console.log(`[DebugLogger] ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // 向后兼容
    this.endIteration({
      duration: this.currentStateLog.duration,
      llmDuration: this.currentStateLog.stats.llmDuration,
      toolsDuration: this.currentStateLog.stats.toolDuration,
      tokenStart: 0,
      tokenEnd: 0,
    });

    this.currentStateLog = null;
  }

  // ============================================================================
  // LLM 交互日志
  // ============================================================================

  /**
   * 开始 LLM 交互
   */
  startLLMInteraction(request: {
    model: string;
    modelType: 'fast' | 'main';
    systemPrompt: string;
    userMessage: string;
    toolCount: number;
    messageCount: number;
  }): void {
    if (!this.config.enabled || !this.currentStateLog) return;

    this.currentLLMInteraction = {
      index: this.currentStateLog.llmInteractions.length + 1,
      startTime: new Date().toISOString(),
      duration: 0,
      request: {
        model: request.model,
        modelType: request.modelType,
        systemPrompt: request.systemPrompt,
        systemPromptLength: request.systemPrompt.length,
        userMessage: request.userMessage,
        toolCount: request.toolCount,
        messageCount: request.messageCount,
      },
      response: {
        finishReason: 'stop',
        content: '',
        contentLength: 0,
        toolCallRequests: [],
      },
    };

    console.log(`[DebugLogger]    🤖 LLM 调用 #${this.currentLLMInteraction.index} (${request.modelType})`);
    console.log(`[DebugLogger]       系统提示词: ${request.systemPrompt.length} 字符`);
    console.log(`[DebugLogger]       用户消息: ${request.userMessage.length} 字符`);
  }

  /**
   * 结束 LLM 交互
   */
  endLLMInteraction(response: {
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
    content: string;
    toolCallRequests?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    ttfb?: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    if (!this.config.enabled || !this.currentStateLog || !this.currentLLMInteraction) return;

    // 更新响应
    this.currentLLMInteraction.response = {
      finishReason: response.finishReason,
      content: response.content,
      contentLength: response.content.length,
      toolCallRequests: response.toolCallRequests || [],
      ttfb: response.ttfb,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };

    // 计算耗时
    this.currentLLMInteraction.duration = Date.now() - new Date(this.currentLLMInteraction.startTime).getTime();

    // 添加到状态日志
    this.currentStateLog.llmInteractions.push(this.currentLLMInteraction);

    // 更新状态统计
    this.currentStateLog.stats.llmCallCount++;
    this.currentStateLog.stats.llmDuration += this.currentLLMInteraction.duration;

    // 更新会话 Token 统计
    if (this.sessionLog && response.inputTokens && response.outputTokens) {
      this.sessionLog.stats.tokens.input += response.inputTokens;
      this.sessionLog.stats.tokens.output += response.outputTokens;
      this.sessionLog.stats.tokens.total += response.inputTokens + response.outputTokens;
    }

    // 输出摘要
    const duration = (this.currentLLMInteraction.duration / 1000).toFixed(1);
    const tokens = response.inputTokens && response.outputTokens
      ? ` | ${response.inputTokens}+${response.outputTokens} tokens`
      : '';
    console.log(`[DebugLogger]    🤖 LLM 响应: ${response.finishReason} | ${duration}s${tokens}`);

    if (response.toolCallRequests && response.toolCallRequests.length > 0) {
      console.log(`[DebugLogger]       工具请求: ${response.toolCallRequests.map(t => t.name).join(', ')}`);
    }

    this.currentLLMInteraction = null;
  }

  // ============================================================================
  // 工具调用日志
  // ============================================================================

  /**
   * 记录工具调用
   */
  logToolCall(toolCall: {
    callId: string;
    toolName: string;
    originalArgs: Record<string, unknown>;
    interceptedArgs?: Record<string, unknown>;
    interceptorNote?: string;
    status: 'success' | 'error';
    result?: string;
    error?: string;
    duration: number;
  }): void {
    if (!this.config.enabled || !this.currentStateLog) return;

    const toolLog: ToolCallLog = {
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      startTime: new Date().toISOString(),
      duration: toolCall.duration,
      originalArgs: toolCall.originalArgs,
      interceptedArgs: toolCall.interceptedArgs,
      interceptorNote: toolCall.interceptorNote,
      status: toolCall.status,
      result: toolCall.result,
      resultLength: toolCall.result?.length,
      error: toolCall.error,
    };

    // 解析结果
    if (toolCall.result) {
      try {
        const parsed = JSON.parse(toolCall.result);
        toolLog.parsedResult = {
          status: parsed.status,
          hits: parsed.hits?.length || parsed.total_hits,
          blockIds: parsed.hits?.map((h: any) => h.block_id).filter(Boolean),
        };
      } catch { /* ignore */ }
    }

    // 添加到状态日志
    this.currentStateLog.toolCalls.push(toolLog);

    // 更新状态统计
    this.currentStateLog.stats.toolCallCount++;
    this.currentStateLog.stats.toolDuration += toolCall.duration;

    // 更新会话工具分布
    if (this.sessionLog) {
      const dist = this.sessionLog.stats.toolDistribution[toolCall.toolName] || { count: 0, duration: 0 };
      this.sessionLog.stats.toolDistribution[toolCall.toolName] = {
        count: dist.count + 1,
        duration: dist.duration + toolCall.duration,
      };
    }

    // 输出摘要
    const duration = (toolCall.duration / 1000).toFixed(1);
    const status = toolCall.status === 'success' ? '✅' : '❌';
    let summary = `${status} ${toolCall.toolName} (${duration}s)`;

    if (toolLog.parsedResult) {
      if (toolLog.parsedResult.status) {
        summary += ` [${toolLog.parsedResult.status}]`;
      }
      if (toolLog.parsedResult.hits) {
        summary += ` ${toolLog.parsedResult.hits} hits`;
      }
    }

    if (toolCall.interceptorNote) {
      summary += ` | 拦截: ${toolCall.interceptorNote}`;
    }

    console.log(`[DebugLogger]    🔧 ${summary}`);
  }

  // ============================================================================
  // 便捷方法（简化调用）
  // ============================================================================

  /**
   * 记录系统提示词（便捷方法）
   */
  logSystemPrompt(prompt: string): void {
    // 新版日志通过 startLLMInteraction 记录，此方法仅用于控制台输出
    if (!this.config.enabled) return;
    console.log(`[DebugLogger]    📝 系统提示词: ${prompt.length} 字符`);
  }

  /**
   * 记录消息历史（便捷方法）
   */
  logMessages(messages: unknown[]): void {
    // 仅在需要时输出
    if (!this.config.enabled) return;
    console.log(`[DebugLogger]    📨 消息历史: ${Array.isArray(messages) ? messages.length : 0} 条`);
  }

  /**
   * 记录 LLM 请求（便捷方法，用于 agent-loop 兼容）
   */
  logLLMRequest(request: { url: string; method: string; headers: Record<string, string>; body: unknown }): void {
    if (!this.config.enabled) return;
    const bodyObj = request.body as { model?: string; messages?: unknown[]; tools?: unknown[] };
    console.log(`[DebugLogger]    🚀 LLM 请求: ${bodyObj.model || 'unknown'}, ${bodyObj.messages?.length || 0} 条消息, ${bodyObj.tools?.length || 0} 个工具`);
  }

  /**
   * 记录 LLM 响应（便捷方法，用于 agent-loop 兼容）
   */
  logLLMResponse(response: { metadata?: { model?: string; finishReason?: string; ttfb?: number }; content?: string; toolCalls?: Array<{ id: string; name: string; arguments: unknown }> }): void {
    if (!this.config.enabled) return;
    const finishReason = response.metadata?.finishReason || 'unknown';
    const contentLen = response.content?.length || 0;
    const toolCount = response.toolCalls?.length || 0;
    console.log(`[DebugLogger]    📥 LLM 响应: ${finishReason}, ${contentLen} 字符, ${toolCount} 个工具调用`);
  }

  /**
   * 添加 LLM 输出片段（便捷方法）
   */
  addLLMChunk(_chunk: string): void {
    // 新版日志不需要累积 chunks
  }

  /**
   * 记录工具调用开始（便捷方法）
   */
  logToolStart(toolCallId: string, toolName: string, args: unknown): void {
    if (!this.config.enabled) return;
    console.log(`[DebugLogger]    🔧 工具开始: ${toolName} (${toolCallId})`);
    // 解析参数中的关键信息
    try {
      const argsObj = args as Record<string, unknown>;
      const keyParams = Object.entries(argsObj)
        .slice(0, 2)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v)?.slice(0, 30)}`)
        .join(', ');
      console.log(`[DebugLogger]       参数: ${keyParams}${Object.keys(argsObj).length > 2 ? '...' : ''}`);
    } catch { /* ignore */ }
  }

  /**
   * 记录工具调用结果（便捷方法）
   */
  logToolResult(toolCallId: string, result: unknown, duration: number): void {
    if (!this.config.enabled) return;
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const resultLen = resultStr.length;
    console.log(`[DebugLogger]    ✅ 工具结果: ${duration}ms, ${resultLen} 字符`);
  }

  /**
   * 记录工具调用错误（便捷方法）
   */
  logToolError(toolCallId: string, error: string, duration: number): void {
    if (!this.config.enabled) return;
    console.log(`[DebugLogger]    ❌ 工具错误: ${error} (${duration}ms)`);
  }

  /**
   * 记录状态信息（便捷方法）
   */
  logStateInfo(stateName: string, info: {
    depth?: number;
    standaloneQuery?: string;
    scopeNodeIds?: string[];
    structuralAnalysis?: string;
    innerIterations?: number;
  }, _method: 'regex' | 'llm' = 'llm'): void {
    if (!this.config.enabled) return;
    if (info.depth !== undefined) {
      console.log(`[DebugLogger]    📊 深度: ${info.depth}`);
    }
    if (info.standaloneQuery) {
      console.log(`[DebugLogger]    📝 独立查询: ${info.standaloneQuery.slice(0, 50)}...`);
    }
    if (info.structuralAnalysis) {
      console.log(`[DebugLogger]    🌐 宏观检视: ${info.structuralAnalysis.slice(0, 50)}...`);
    } else if (info.scopeNodeIds && info.scopeNodeIds.length > 0) {
      console.log(`[DebugLogger]    🎯 范围锁定: ${info.scopeNodeIds.length} 个章节`);
    }
  }

  /**
   * 记录内部迭代次数（便捷方法）
   */
  logInnerIterations(count: number): void {
    if (!this.config.enabled) return;
    console.log(`[DebugLogger]    🔄 内部迭代: ${count} 次`);
  }

  // ============================================================================
  // 已废弃方法（保持类型兼容）
  // ============================================================================

  /** @deprecated 使用 startStateExecution 替代 */
  startIteration(iteration: number): void {
    // 向后兼容：转发到新版 API
    if (!this.config.enabled || !this.sessionLog) return;
    this.currentIteration = iteration;
  }

  /** @deprecated 使用 endStateExecution 替代 */
  async endIteration(_stats: Partial<{ duration: number; llmDuration: number; toolsDuration: number; tokenStart: number; tokenEnd: number }>): Promise<void> {
    // 向后兼容：无操作
  }

  /** @deprecated 不再使用 */
  logBackendCall(_call: Omit<BackendCallLog, 'timestamp' | 'callStack'>): void {
    // 不再记录后端调用
  }

  // ============================================================================
  // 文件写入
  // ============================================================================

  /**
   * 写入摘要 Markdown
   */
  private async writeSummaryMarkdown(): Promise<void> {
    if (!this.sessionDir || !this.sessionLog) return;

    const content = this.formatSummaryMarkdown(this.sessionLog);
    const filePath = normalizePath(`${this.sessionDir}/00-summary.md`);
    await this.app.vault.adapter.write(filePath, content);
    this.sessionLog.files.push('00-summary.md');

    console.log(`[DebugLogger] 📝 写入: 00-summary.md`);
  }

  /**
   * 写入状态 Markdown
   */
  private async writeStateMarkdown(stateLog: StateExecutionLog): Promise<void> {
    if (!this.sessionDir) return;

    const content = this.formatStateMarkdown(stateLog);
    const fileName = `${String(stateLog.iteration).padStart(2, '0')}-${stateLog.stateName.toLowerCase()}.md`;
    const filePath = normalizePath(`${this.sessionDir}/${fileName}`);
    await this.app.vault.adapter.write(filePath, content);

    if (this.sessionLog) {
      this.sessionLog.files.push(fileName);
    }

    console.log(`[DebugLogger] 📝 写入: ${fileName}`);
  }

  /**
   * 写入会话 JSON
   */
  private async writeSessionJson(): Promise<void> {
    if (!this.sessionDir || !this.sessionLog) return;

    const content = JSON.stringify(this.sessionLog, null, 2);
    const filePath = normalizePath(`${this.sessionDir}/session.json`);
    await this.app.vault.adapter.write(filePath, content);
    this.sessionLog.files.push('session.json');

    console.log(`[DebugLogger] 📝 写入: session.json`);
  }

  /**
   * 写入工具调用日志 Markdown
   */
  private async writeToolsMarkdown(): Promise<void> {
    if (!this.sessionDir || !this.sessionLog) return;

    const content = this.formatToolsMarkdown(this.sessionLog);
    const filePath = normalizePath(`${this.sessionDir}/tools.md`);
    await this.app.vault.adapter.write(filePath, content);
    this.sessionLog.files.push('tools.md');

    console.log(`[DebugLogger] 📝 写入: tools.md`);
  }

  // ============================================================================
  // Markdown 格式化
  // ============================================================================

  /**
   * 格式化摘要 Markdown
   */
  private formatSummaryMarkdown(log: AgentSessionLog): string {
    let md = '';

    // 标题
    md += `# 🤖 Agent 执行日志\n\n`;
    md += `> **会话 ID**: ${log.sessionId}\n`;
    md += `> **时间**: ${new Date(log.startTime).toLocaleString()}\n`;
    md += `> **书籍**: ${log.bookName || '-'}\n`;
    md += `> **问题**: ${log.userQuery}\n\n`;

    // ===== 快速摘要 =====
    md += `---\n\n`;
    md += `## 🎯 快速摘要\n\n`;

    // 提取关键决策
    const routerState = log.stateExecutions.find(s => s.stateName === 'Router');
    const inspectionalState = log.stateExecutions.find(s => s.stateName === 'Inspectional');
    const analyticalState = log.stateExecutions.find(s => s.stateName === 'Analytical');
    const formatterState = log.stateExecutions.find(s => s.stateName === 'Formatter');

    md += `| 阶段 | 决策 |\n`;
    md += `|------|------|\n`;

    if (routerState) {
      md += `| 🔍 路由 | 深度 ${routerState.output.depth ?? '-'} |\n`;
    }

    if (inspectionalState) {
      const scopeCount = inspectionalState.output.scopeNodeIds?.length || 0;
      const scopeText = scopeCount > 0 ? `锁定 ${scopeCount} 个章节` : '全局搜索';
      md += `| 📖 检视 | ${scopeText} |\n`;
    }

    if (analyticalState) {
      const searchCount = analyticalState.toolCalls.filter(t => t.toolName === 'search_markdown_text').length;
      const totalHits = analyticalState.toolCalls
        .filter(t => t.toolName === 'search_markdown_text')
        .reduce((sum, t) => sum + (t.parsedResult?.hits || 0), 0);
      md += `| 🔬 分析 | ${searchCount} 次搜索 → ${totalHits} 条结果 |\n`;
    }

    if (formatterState) {
      const outputLen = formatterState.output.content?.length || formatterState.output.analysisResult?.length || 0;
      const hasMemory = formatterState.llmInteractions[0]?.request.systemPrompt?.includes('<memory_context>');
      md += `| 📝 格式化 | ${outputLen} 字符${hasMemory ? ' | 用户画像 ✅' : ''} |\n`;
    }

    md += `\n`;

    // ===== 最终答案 =====
    if (log.finalOutput) {
      md += `---\n\n`;
      md += `## 💬 最终答案\n\n`;
      md += `> **答案长度**: ${log.finalOutputLength || log.finalOutput.length} 字符\n\n`;

      // 截断显示（超过 1000 字符折叠）
      if (log.finalOutput.length > 1000) {
        md += `<details>\n`;
        md += `<summary>点击展开完整答案</summary>\n\n`;
        md += `${log.finalOutput}\n\n`;
        md += `</details>\n\n`;
      } else {
        md += `${log.finalOutput}\n\n`;
      }
    }

    // ===== 时间分布 =====
    md += `**总耗时**: ${(log.stats.totalDuration / 1000).toFixed(1)}s\n\n`;
    md += `\`\`\`\n`;
    for (const state of log.stateExecutions) {
      const emoji = this.getStateEmoji(state.stateName);
      const duration = (state.duration / 1000).toFixed(1);
      const bar = '█'.repeat(Math.round(state.duration / log.stats.totalDuration * 20));
      md += `${emoji} ${state.stateName.padEnd(12)} ${bar} ${duration}s\n`;
    }
    md += `\`\`\`\n\n`;

    // ===== 状态流转图 =====
    md += `---\n\n`;
    md += `## 📊 状态流转\n\n`;
    md += `\`\`\`\n`;
    md += `用户输入\n`;
    md += `   │\n`;

    for (const state of log.stateExecutions) {
      const emoji = this.getStateEmoji(state.stateName);
      const duration = (state.duration / 1000).toFixed(1);
      md += `   ▼\n`;
      md += `${emoji} ${state.stateName} (${duration}s)\n`;
    }

    md += `   │\n`;
    md += `   ▼\n`;
    md += `💬 输出回复\n`;
    md += `\`\`\`\n\n`;

    // ===== 数据流追踪 =====
    md += `---\n\n`;
    md += `## 🔄 数据流追踪\n\n`;
    md += `展示关键信息如何在状态之间流转：\n\n`;
    md += `\`\`\`\n`;

    // 追踪用户查询的变化
    md += `📝 查询演变:\n`;
    md += `   原始问题 → ${log.userQuery.slice(0, 50)}${log.userQuery.length > 50 ? '...' : ''}\n`;

    if (routerState?.output.standaloneQuery) {
      md += `   独立查询 → ${routerState.output.standaloneQuery.slice(0, 50)}${routerState.output.standaloneQuery.length > 50 ? '...' : ''}\n`;
    }

    // 追踪范围锁定或结构分析
    if (inspectionalState?.output.structuralAnalysis) {
      // 深度1：宏观检视
      md += `\n🌐 宏观检视 (深度1):\n`;
      const structPreview = inspectionalState.output.structuralAnalysis.slice(0, 100);
      md += `   ${structPreview.replace(/\n/g, ' ')}${inspectionalState.output.structuralAnalysis.length > 100 ? '...' : ''}\n`;
    } else if (inspectionalState?.output.scopeNodeIds && inspectionalState.output.scopeNodeIds.length > 0) {
      // 深度2/3：圈定战区
      md += `\n🎯 范围锁定:\n`;
      md += `   章节 ID → ${inspectionalState.output.scopeNodeIds.slice(0, 3).join(', ')}`;
      if (inspectionalState.output.scopeNodeIds.length > 3) {
        md += ` (+${inspectionalState.output.scopeNodeIds.length - 3} 个)`;
      }
      md += `\n`;
    }

    // 追踪分析结果
    if (analyticalState?.output.analysisResult) {
      md += `\n🔬 分析结果:\n`;
      const analysisPreview = analyticalState.output.analysisResult.slice(0, 100);
      md += `   ${analysisPreview.replace(/\n/g, ' ')}${analyticalState.output.analysisResult.length > 100 ? '...' : ''}\n`;
    }

    // 追踪最终输出
    if (log.finalOutput) {
      md += `\n💬 最终输出:\n`;
      const outputPreview = log.finalOutput.slice(0, 100);
      md += `   ${outputPreview.replace(/\n/g, ' ')}${log.finalOutput.length > 100 ? '...' : ''}\n`;
    }

    md += `\`\`\`\n\n`;

    // ===== 会话时间线 =====
    md += `---\n\n`;
    md += `## ⏱️ 会话时间线\n\n`;
    md += `| 时间 | 事件 |\n`;
    md += `|------|------|\n`;

    // 会话开始
    const sessionStartTime = new Date(log.startTime);
    md += `| ${sessionStartTime.toLocaleTimeString()} | 🚀 会话开始 |\n`;

    // 各状态执行
    for (const state of log.stateExecutions) {
      const stateStartTime = new Date(state.startTime);
      const duration = (state.duration / 1000).toFixed(1);
      const emoji = this.getStateEmoji(state.stateName);

      // 状态开始
      let eventDetail = `${emoji} ${state.stateName} 开始`;
      if (state.input.query && state.input.query !== log.userQuery) {
        eventDetail += ` (查询: ${state.input.query.slice(0, 30)}...)`;
      }
      md += `| ${stateStartTime.toLocaleTimeString()} | ${eventDetail} |\n`;

      // LLM 调用
      for (const llm of state.llmInteractions) {
        const llmTime = new Date(llm.startTime);
        const llmDuration = (llm.duration / 1000).toFixed(1);
        let llmEvent = `   └─ 🤖 LLM #${llm.index} (${llm.request.modelType})`;
        if (llm.response.finishReason === 'tool_calls') {
          const tools = llm.response.toolCallRequests.map(t => t.name).join(', ');
          llmEvent += ` → [${tools}]`;
        }
        md += `| ${llmTime.toLocaleTimeString()} | ${llmEvent} (${llmDuration}s) |\n`;
      }

      // 工具调用
      for (const tool of state.toolCalls) {
        const toolTime = new Date(tool.startTime);
        const toolDuration = (tool.duration / 1000).toFixed(2);
        const status = tool.status === 'success' ? '✅' : '❌';
        let toolEvent = `   └─ ${status} ${tool.toolName}`;
        if (tool.parsedResult?.hits) {
          toolEvent += ` (${tool.parsedResult.hits} 条)`;
        }
        md += `| ${toolTime.toLocaleTimeString()} | ${toolEvent} (${toolDuration}s) |\n`;
      }

      // 状态结束
      if (state.endTime) {
        const stateEndTime = new Date(state.endTime);
        md += `| ${stateEndTime.toLocaleTimeString()} | ${emoji} ${state.stateName} 完成 (${duration}s) |\n`;
      }
    }

    // 最终输出
    if (log.endTime) {
      const sessionEndTime = new Date(log.endTime);
      md += `| ${sessionEndTime.toLocaleTimeString()} | ✅ 会话结束 |\n`;
    }

    md += `\n`;

    // 意图路由
    if (log.intentRouting) {
      md += `---\n\n`;
      md += `## 🎯 意图路由\n\n`;
      md += `| 字段 | 值 |\n`;
      md += `|------|-----|\n`;
      md += `| 检测意图 | ${log.intentRouting.detectedIntents.join(', ')} |\n`;
      md += `| 允许工具 | ${log.intentRouting.allowedTools.join(', ')} |\n`;
      md += `| 最大迭代 | ${log.intentRouting.maxIterations} |\n\n`;
    }

    // 统计
    md += `---\n\n`;
    md += `## 📈 统计\n\n`;
    md += `| 指标 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 总耗时 | ${(log.stats.totalDuration / 1000).toFixed(1)}s |\n`;
    md += `| 状态数 | ${log.stats.stateCount} |\n`;
    md += `| LLM 调用 | ${log.stats.llmCallCount} 次 (${(log.stats.llmDuration / 1000).toFixed(1)}s) |\n`;
    md += `| 工具调用 | ${log.stats.toolCallCount} 次 (${(log.stats.toolDuration / 1000).toFixed(1)}s) |\n`;
    md += `| Token 使用 | ${log.stats.tokens.input} + ${log.stats.tokens.output} = ${log.stats.tokens.total} |\n\n`;

    // 工具分布
    if (Object.keys(log.stats.toolDistribution).length > 0) {
      md += `### 🛠️ 工具调用分布\n\n`;
      md += `| 工具 | 调用次数 | 总耗时 |\n`;
      md += `|------|----------|--------|\n`;
      for (const [name, stats] of Object.entries(log.stats.toolDistribution)) {
        md += `| ${name} | ${stats.count} | ${(stats.duration / 1000).toFixed(1)}s |\n`;
      }
      md += `\n`;
    }

    // 文件列表
    md += `---\n\n`;
    md += `## 📁 详细日志\n\n`;
    for (const file of log.files) {
      if (file !== '00-summary.md' && file !== 'session.json') {
        md += `- [${file}](./${file})\n`;
      }
    }

    return md;
  }

  /**
   * 格式化工具调用日志 Markdown
   */
  private formatToolsMarkdown(log: AgentSessionLog): string {
    let md = '';

    // 收集所有工具调用
    const allToolCalls: Array<ToolCallLog & { stateName: string }> = [];
    for (const state of log.stateExecutions) {
      for (const toolCall of state.toolCalls) {
        allToolCalls.push({ ...toolCall, stateName: state.stateName });
      }
    }

    // 标题
    md += `# 🔧 工具调用日志\n\n`;
    md += `> **会话**: ${log.sessionId}\n`;
    md += `> **书籍**: ${log.bookName || '-'}\n`;
    md += `> **总调用**: ${allToolCalls.length} 次\n\n`;
    md += `---\n\n`;

    // 遍历每个工具调用
    for (let i = 0; i < allToolCalls.length; i++) {
      const tool = allToolCalls[i];
      const num = i + 1;

      // 标题
      const statusEmoji = tool.status === 'success' ? '✅' : '❌';
      md += `## ${num}. ${tool.toolName}\n\n`;

      // 元信息
      const time = new Date(tool.startTime).toLocaleTimeString();
      const duration = (tool.duration / 1000).toFixed(1);
      md += `**时间**: ${time}  \n`;
      md += `**耗时**: ${duration}s  \n`;
      md += `**状态**: ${statusEmoji} ${tool.status === 'success' ? '成功' : '失败'}  \n`;
      md += `**状态机**: ${tool.stateName}\n\n`;

      // 参数
      md += `### 参数\n\n`;
      md += '```json\n';
      const args = tool.interceptedArgs || tool.originalArgs;
      md += JSON.stringify(args, null, 2);
      md += '\n```\n\n';

      // 拦截器信息
      if (tool.interceptorNote) {
        md += `> ⚠️ **拦截器**: ${tool.interceptorNote}\n\n`;
      }

      // 结果
      md += `### 返回结果\n\n`;

      if (tool.status === 'error') {
        md += `❌ **错误**: ${tool.error || '未知错误'}\n\n`;
      } else if (tool.result) {
        // 尝试解析 JSON 结果
        try {
          const parsed = JSON.parse(tool.result);

          // 根据工具类型格式化输出
          if (tool.toolName === 'search_markdown_text') {
            md += this.formatSearchResult(parsed);
          } else if (tool.toolName === 'get_toc') {
            md += this.formatTocResult(parsed);
          } else if (tool.toolName === 'get_chapter') {
            md += this.formatChapterResult(parsed);
          } else if (tool.toolName === 'read_markdown_section') {
            md += this.formatReadResult(parsed, tool.result);
          } else {
            // 通用格式
            md += this.formatGenericResult(parsed);
          }
        } catch {
          // 非 JSON 结果，直接显示
          const truncated = tool.result.length > 2000
            ? tool.result.slice(0, 2000) + '\n\n... (内容已截断)'
            : tool.result;
          md += '```\n' + truncated + '\n```\n\n';
        }
      } else {
        md += `_无返回结果_\n\n`;
      }

      md += `---\n\n`;
    }

    // 统计表格
    md += `## 统计\n\n`;
    md += `| 工具 | 调用次数 | 总耗时 |\n`;
    md += `|------|----------|--------|\n`;

    const toolStats: Record<string, { count: number; duration: number }> = {};
    for (const tool of allToolCalls) {
      if (!toolStats[tool.toolName]) {
        toolStats[tool.toolName] = { count: 0, duration: 0 };
      }
      toolStats[tool.toolName].count++;
      toolStats[tool.toolName].duration += tool.duration;
    }

    for (const [name, stats] of Object.entries(toolStats)) {
      md += `| ${name} | ${stats.count} | ${(stats.duration / 1000).toFixed(1)}s |\n`;
    }

    return md;
  }

  /**
   * 格式化搜索结果
   */
  private formatSearchResult(parsed: any): string {
    let md = '';

    const hits = parsed.hits || [];
    md += `找到 **${hits.length}** 条结果：\n\n`;

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const score = hit.score ? hit.score.toFixed(2) : '-';
      md += `**结果 ${i + 1}** (score: ${score})\n`;

      // 章节信息
      if (hit.section || hit.chapter) {
        md += `> 📖 ${hit.section || hit.chapter}\n`;
      }

      // 内容
      const text = hit.text || hit.content || '';
      const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text;
      md += `> ${truncated.replace(/\n/g, '\n> ')}\n\n`;
    }

    return md;
  }

  /**
   * 格式化目录结果
   */
  private formatTocResult(parsed: any): string {
    let md = '';

    const nodes = parsed.nodes || parsed.toc || [];
    md += `共 **${nodes.length}** 个章节：\n\n`;

    for (let i = 0; i < Math.min(nodes.length, 20); i++) {
      const node = nodes[i];
      const title = node.title || node.node_name || node.section || '-';
      const level = node.level || 0;
      const indent = '  '.repeat(level);
      md += `${indent}${i + 1}. ${title}\n`;
    }

    if (nodes.length > 20) {
      md += `\n_... 还有 ${nodes.length - 20} 个章节_\n`;
    }

    md += '\n';
    return md;
  }

  /**
   * 格式化章节结果
   */
  private formatChapterResult(parsed: any): string {
    let md = '';

    const title = parsed.title || parsed.section || '章节内容';
    const text = parsed.text || parsed.content || '';
    const wordCount = text.length;

    md += `**${title}**（共 ${wordCount} 字）：\n\n`;

    const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
    md += `> ${truncated.replace(/\n/g, '\n> ')}\n\n`;

    return md;
  }

  /**
   * 格式化读取结果
   */
  private formatReadResult(parsed: any, rawResult: string): string {
    let md = '';

    // 尝试提取文件路径
    const path = parsed.path || parsed.section_path || '';
    if (path) {
      md += `**文件**: \`${path}\`\n\n`;
    }

    const text = parsed.content || parsed.text || rawResult;
    const wordCount = text.length;

    md += `文件内容（共 ${wordCount} 字）：\n\n`;

    const truncated = text.length > 1500 ? text.slice(0, 1500) + '\n\n... (内容已截断)' : text;
    md += '```markdown\n' + truncated + '\n```\n\n';

    return md;
  }

  /**
   * 格式化通用结果
   */
  private formatGenericResult(parsed: any): string {
    let md = '';

    const str = JSON.stringify(parsed, null, 2);
    const truncated = str.length > 2000 ? str.slice(0, 2000) + '\n... (已截断)' : str;
    md += '```json\n' + truncated + '\n```\n\n';

    return md;
  }

  /**
   * 格式化状态 Markdown
   */
  private formatStateMarkdown(state: StateExecutionLog): string {
    let md = '';

    const emoji = this.getStateEmoji(state.stateName);
    const duration = (state.duration / 1000).toFixed(1);

    // 标题
    md += `# ${emoji} ${state.stateName}\n\n`;
    md += `> **迭代**: ${state.iteration} | **耗时**: ${duration}s\n\n`;

    // ===== 决策摘要（关键信息一目了然） =====
    md += `---\n\n`;
    md += `## 🎯 决策摘要\n\n`;

    // 根据状态类型显示不同的摘要信息
    if (state.stateName === 'Router') {
      md += `| 决策 | 值 |\n`;
      md += `|------|-----|\n`;
      md += `| 阅读深度 | ${state.output.depth ?? '-'} |\n`;
      md += `| 独立查询 | ${state.output.standaloneQuery || state.input.query || '-'} |\n`;
      if (state.llmInteractions.length > 0 && state.llmInteractions[0].response.content) {
        const content = state.llmInteractions[0].response.content;
        // 尝试提取 reason
        const reasonMatch = content.match(/"reason"\s*:\s*"([^"]+)"/);
        if (reasonMatch) {
          md += `| 分类理由 | ${reasonMatch[1]} |\n`;
        }
      }
    } else if (state.stateName === 'Inspectional') {
      md += `| 决策 | 值 |\n`;
      md += `|------|-----|\n`;
      // 深度1时显示结构分析
      if (state.output.structuralAnalysis) {
        const analysis = state.output.structuralAnalysis.length > 300
          ? state.output.structuralAnalysis.slice(0, 300) + '...'
          : state.output.structuralAnalysis;
        md += `| 模式 | 🌐 宏观检视 (深度1) |\n`;
        md += `| 结构分析 | ${analysis.replace(/\n/g, ' ')} |\n`;
      } else {
        // 深度2/3时显示范围锁定
        if (state.output.scopeNodeIds && state.output.scopeNodeIds.length > 0) {
          md += `| 模式 | 🎯 圈定战区 (深度2/3) |\n`;
          md += `| 锁定章节 | ${state.output.scopeNodeIds.length} 个 |\n`;
          if (state.output.scopeNodeTitles && state.output.scopeNodeTitles.length > 0) {
            md += `| 章节列表 | ${state.output.scopeNodeTitles.slice(0, 5).join('、')}${state.output.scopeNodeTitles.length > 5 ? '...' : ''} |\n`;
          } else {
            md += `| 章节 ID | ${state.output.scopeNodeIds.slice(0, 5).join(', ')} |\n`;
          }
        } else {
          md += `| 模式 | 🔍 全局搜索 |\n`;
        }
        if (state.output.tocSummary) {
          const summary = state.output.tocSummary.length > 200
            ? state.output.tocSummary.slice(0, 200) + '...'
            : state.output.tocSummary;
          md += `| 搜索建议 | ${summary} |\n`;
        }
      }
    } else if (state.stateName === 'Analytical') {
      md += `| 决策 | 值 |\n`;
      md += `|------|-----|\n`;
      md += `| LLM 调用 | ${state.stats.llmCallCount} 次 |\n`;
      md += `| 工具调用 | ${state.stats.toolCallCount} 次 |\n`;
      // 统计搜索关键词
      const searchTools = state.toolCalls.filter(t => t.toolName === 'search_markdown_text');
      if (searchTools.length > 0) {
        const keywords = searchTools.map(t => t.originalArgs?.query || t.originalArgs?.keyword).filter(Boolean);
        if (keywords.length > 0) {
          md += `| 搜索关键词 | ${[...new Set(keywords)].slice(0, 5).join('、')} |\n`;
        }
        const totalHits = searchTools.reduce((sum, t) => sum + (t.parsedResult?.hits || 0), 0);
        md += `| 搜索结果 | ${totalHits} 条 |\n`;
      }
    } else if (state.stateName === 'Formatter') {
      md += `| 决策 | 值 |\n`;
      md += `|------|-----|\n`;
      md += `| 输出长度 | ${state.output.content?.length || state.output.analysisResult?.length || 0} 字符 |\n`;
      // 检查是否有 memory_context
      if (state.llmInteractions.length > 0 && state.llmInteractions[0].request.systemPrompt) {
        const hasMemory = state.llmInteractions[0].request.systemPrompt.includes('<memory_context>');
        md += `| 用户画像 | ${hasMemory ? '✅ 已注入' : '❌ 无'} |\n`;
      }
    }
    md += `\n`;

    // ===== 时间分布 =====
    if (state.stats.llmCallCount > 0 || state.stats.toolCallCount > 0) {
      md += `**时间分布**: `;
      const parts: string[] = [];
      if (state.stats.llmDuration > 0) {
        parts.push(`LLM ${(state.stats.llmDuration / 1000).toFixed(1)}s`);
      }
      if (state.stats.toolDuration > 0) {
        parts.push(`工具 ${(state.stats.toolDuration / 1000).toFixed(1)}s`);
      }
      const otherDuration = state.duration - state.stats.llmDuration - state.stats.toolDuration;
      if (otherDuration > 100) {
        parts.push(`其他 ${(otherDuration / 1000).toFixed(1)}s`);
      }
      md += parts.join(' | ') + '\n\n';
    }

    // ===== 工具调用摘要 =====
    if (state.toolCalls.length > 0) {
      md += `**工具调用**:\n`;
      for (const tool of state.toolCalls) {
        const status = tool.status === 'success' ? '✅' : '❌';
        let summary = `${status} \`${tool.toolName}\``;

        // 参数预览（显示关键参数）
        const argsPreview = this.formatArgsPreview(tool.originalArgs);
        if (argsPreview && argsPreview !== '{}') {
          summary += ` \`${argsPreview}\``;
        }

        // 结果预览
        if (tool.parsedResult?.hits) {
          summary += ` → ${tool.parsedResult.hits} 条`;
        } else if (tool.parsedResult?.status) {
          summary += ` → [${tool.parsedResult.status}]`;
        } else if (tool.result) {
          const resultPreview = this.formatResultPreview(tool.result);
          if (resultPreview) {
            summary += ` → ${resultPreview}`;
          }
        }

        if (tool.interceptorNote) {
          summary += ` [拦截: ${tool.interceptorNote}]`;
        }
        md += `- ${summary}\n`;
      }
      md += `\n`;
    }

    // ===== 迭代时间线 =====
    if (state.llmInteractions.length > 1) {
      md += `**迭代时间线**:\n`;
      md += `\`\`\`\n`;
      let toolIndex = 0;
      for (const llm of state.llmInteractions) {
        const time = (llm.duration / 1000).toFixed(1);
        if (llm.response.finishReason === 'tool_calls') {
          const tools = llm.response.toolCallRequests.map(t => t.name);
          for (const toolName of tools) {
            const tool = state.toolCalls[toolIndex];
            const toolTime = tool ? (tool.duration / 1000).toFixed(2) : '0';
            let result = '';
            if (tool?.parsedResult) {
              if (tool.parsedResult.status === 'ERROR_TOO_BROAD') {
                result = ` → ⚠️ 太泛`;
              } else if (tool.parsedResult.status === 'ERROR_NOT_FOUND') {
                result = ` → ❌ 未找到`;
              } else if (tool.parsedResult.hits) {
                result = ` → ${tool.parsedResult.hits} 条`;
              }
            }
            if (tool?.status === 'error') {
              result += ' ❌';
            }
            md += `  │  LLM(${time}s) → ${toolName}(${toolTime}s)${result}\n`;
            toolIndex++;
          }
        } else {
          md += `  └─ LLM(${time}s) → 输出完成\n`;
        }
      }
      md += `\`\`\`\n\n`;
    }

    // ===== 详细信息（折叠） =====
    md += `---\n\n`;
    md += `## 📋 详细信息\n\n`;

    // LLM 交互（简化版）
    if (state.llmInteractions.length > 0) {
      md += `### 🤖 LLM 调用 (${state.llmInteractions.length} 次)\n\n`;

      // 迭代流程图
      md += `**迭代流程**:\n`;
      md += `\`\`\`\n`;
      for (let i = 0; i < state.llmInteractions.length; i++) {
        const llm = state.llmInteractions[i];
        const tools = llm.response.toolCallRequests.map(t => t.name).join(', ');
        if (llm.response.finishReason === 'tool_calls') {
          md += `#${llm.index} LLM → [${tools || '工具'}] → `;
        } else {
          md += `#${llm.index} LLM → 输出 (${(llm.duration / 1000).toFixed(1)}s)\n`;
        }
      }
      md += `\`\`\`\n\n`;

      for (const llm of state.llmInteractions) {
        md += `<details>\n`;
        const tools = llm.response.toolCallRequests.map(t => t.name).join(', ');
        const summaryLabel = llm.response.finishReason === 'tool_calls'
          ? `调用工具: ${tools}`
          : `输出完成`;
        md += `<summary>调用 #${llm.index}: ${llm.request.modelType} | ${(llm.duration / 1000).toFixed(1)}s | ${summaryLabel}</summary>\n\n`;

        // 系统提示词
        if (llm.request.systemPrompt) {
          md += `**系统提示词** (${llm.request.systemPromptLength} 字符):\n`;
          md += `\`\`\`\n${llm.request.systemPrompt}\n\`\`\`\n\n`;
        }

        // 用户消息
        if (llm.request.userMessage) {
          md += `**用户消息**:\n`;
          md += `\`\`\`\n${llm.request.userMessage}\n\`\`\`\n\n`;
        }

        // 工具调用请求
        if (llm.response.toolCallRequests.length > 0) {
          md += `**工具请求**: ${llm.response.toolCallRequests.map(t => t.name).join(', ')}\n\n`;
        }

        // 输出内容
        if (llm.response.content) {
          const content = llm.response.content.length > 1000
            ? llm.response.content.slice(0, 1000) + '\n...[已截断]'
            : llm.response.content;
          md += `**输出**:\n\`\`\`\n${content}\n\`\`\`\n`;
        }

        md += `\n</details>\n\n`;
      }
    }

    // 工具调用详情
    if (state.toolCalls.length > 0) {
      md += `### 🛠️ 工具调用详情\n\n`;

      for (const tool of state.toolCalls) {
        md += `<details>\n`;
        md += `<summary>${tool.status === 'success' ? '✅' : '❌'} ${tool.toolName} (${(tool.duration / 1000).toFixed(2)}s)</summary>\n\n`;

        md += `**参数**:\n\`\`\`json\n${JSON.stringify(tool.originalArgs, null, 2)}\n\`\`\`\n\n`;

        if (tool.interceptedArgs && tool.interceptorNote) {
          md += `**拦截器**: ${tool.interceptorNote}\n`;
          md += `**修改后参数**:\n\`\`\`json\n${JSON.stringify(tool.interceptedArgs, null, 2)}\n\`\`\`\n\n`;
        }

        if (tool.error) {
          md += `**错误**: ${tool.error}\n`;
        } else if (tool.result) {
          const result = tool.result.length > 2000
            ? tool.result.slice(0, 2000) + '\n...[已截断]'
            : tool.result;
          md += `**结果**:\n\`\`\`json\n${result}\n\`\`\`\n`;
        }

        md += `\n</details>\n\n`;
      }
    }

    return md;
  }

  /**
   * 获取状态图标
   */
  private getStateEmoji(stateName: string): string {
    const emojis: Record<string, string> = {
      'Router': '🔍',
      'Inspectional': '📖',
      'Analytical': '🔬',
      'Syntopical': '📚',
      'Formatter': '📝',
    };
    return emojis[stateName] || '⚙️';
  }

  /**
   * 格式化参数预览（单行，用于摘要）
   */
  private formatArgsPreview(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';

    // 过滤掉空值和不需要显示的参数
    const filtered = entries.filter(([key, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    });

    if (filtered.length === 0) return '';

    const parts = filtered.map(([key, value]) => {
      const valueStr = this.formatValuePreview(value, key);
      return `${key}=${valueStr}`;
    });

    const result = parts.join(', ');
    return result.length > 80 ? result.slice(0, 77) + '...' : result;
  }

  /**
   * 格式化值预览
   */
  private formatValuePreview(value: unknown, key?: string): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    if (typeof value === 'string') {
      // 字符串：显示前 30 字符
      const truncated = value.length > 30 ? value.slice(0, 30) + '...' : value;
      return `"${truncated}"`;
    }

    if (Array.isArray(value)) {
      // 数组：根据参数名决定显示策略
      if (value.length === 0) return '[]';

      // scope_node_ids: 显示前 5 个 ID + 总数
      if (key === 'scope_node_ids' || key === 'scope_node_ids') {
        if (value.length <= 5) {
          return `[${value.join(',')}]`;
        }
        const first5 = value.slice(0, 5).join(',');
        return `[${first5}... +${value.length - 5}]`;
      }

      // keywords: 显示前 3 个关键词
      if (key === 'keywords') {
        if (value.length <= 3) {
          const items = value.map(v => this.formatValuePreview(v)).join(', ');
          return `[${items}]`;
        }
        const first3 = value.slice(0, 3).map(v => String(v).slice(0, 15)).join(', ');
        return `[${first3}... +${value.length - 3}]`;
      }

      // 其他数组：显示前几个元素
      if (value.length <= 3) {
        const items = value.map(v => this.formatValuePreview(v)).join(', ');
        return `[${items}]`;
      }
      return `[${value.length}项]`;
    }

    if (typeof value === 'object') {
      // 对象：显示键名
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.length === 0) return '{}';
      if (keys.length <= 3) {
        return `{${keys.join(',')}}`;
      }
      return `{${keys.length}个字段}`;
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    return String(value);
  }

  /**
   * 格式化结果预览（提取关键信息）
   */
  private formatResultPreview(result: string | undefined): string {
    if (!result) return '';

    try {
      const parsed = JSON.parse(result);

      // 提取关键状态
      if (parsed.status) {
        // SUCCESS 状态：显示关键信息
        if (parsed.status === 'SUCCESS') {
          // 搜索结果
          if (parsed.total_hits !== undefined) {
            return `${parsed.total_hits} 条`;
          }
          // 读取结果
          if (parsed.word_count !== undefined) {
            return `${parsed.word_count} 字`;
          }
          // 大纲结果
          if (parsed.total_chapters !== undefined) {
            return `${parsed.total_chapters} 章`;
          }
          return 'SUCCESS';
        }

        // 错误状态：显示状态和提示
        let preview = parsed.status;
        if (parsed.message) {
          preview += `: ${parsed.message.slice(0, 30)}`;
        }
        return preview;
      }

      return 'JSON结果';
    } catch {
      // 非 JSON：显示前 30 字符
      return result.length > 30 ? result.slice(0, 30) + '...' : result;
    }
  }
}

// ============================================================================
// 单例管理
// ============================================================================

let _instance: DebugLogger | null = null;

export function initDebugLogger(app: App, config?: Partial<DebugLogConfig>): DebugLogger {
  _instance = new DebugLogger(app, config);
  return _instance;
}

export function getDebugLogger(): DebugLogger | null {
  return _instance;
}