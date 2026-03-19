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
  // 向后兼容方法
  // ============================================================================

  /**
   * @deprecated 使用 startStateExecution 替代
   */
  startIteration(iteration: number): void {
    if (!this.config.enabled) return;

    this.currentIteration = iteration;
    this.currentIterationLog = {
      iteration,
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
      messages: [],
      toolExecutions: [],
      backendCalls: [],
      stats: {
        duration: 0,
        llmDuration: 0,
        toolsDuration: 0,
        tokenStart: 0,
        tokenEnd: 0,
        toolCallCount: 0,
      },
    };
  }

  /**
   * @deprecated 使用 endStateExecution 替代
   */
  async endIteration(stats: Partial<IterationStats>): Promise<void> {
    if (!this.config.enabled || !this.currentIterationLog || !this.sessionDir) return;

    this.currentIterationLog.stats = {
      ...this.currentIterationLog.stats,
      ...stats,
    };
    this.currentIterationLog.stats.toolCallCount = this.currentIterationLog.toolExecutions.length;

    this.allIterationLogs.push(this.currentIterationLog);
    this.currentIterationLog = null;
  }

  logSystemPrompt(prompt: string): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    this.currentIterationLog.systemPrompt = prompt;
  }

  logStateInfo(stateName: string, info: {
    depth?: number;
    standaloneQuery?: string;
    scopeNodeIds?: string[];
    innerIterations?: number;
  }, method: 'regex' | 'llm' = 'llm'): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    this.currentIterationLog.stateInfo = { stateName, method, ...info };
  }

  logInnerIterations(count: number): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    if (this.currentIterationLog.stateInfo) {
      this.currentIterationLog.stateInfo.innerIterations = count;
    } else {
      this.currentIterationLog.stateInfo = { stateName: 'Unknown', method: 'llm', innerIterations: count };
    }
  }

  logMessages(messages: unknown[]): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    this.currentIterationLog.messages = JSON.parse(JSON.stringify(messages));
  }

  logLLMRequest(request: Omit<LLMRequestLog, 'timestamp' | 'callStack'>): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    this.currentIterationLog.llmRequest = {
      ...request,
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
    };
  }

  logLLMResponse(response: Partial<Omit<LLMResponseLog, 'timestamp' | 'callStack'>>): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    this.currentIterationLog.llmResponse = {
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
      metadata: response.metadata || { model: '', finishReason: '' },
      content: response.content || '',
      toolCalls: response.toolCalls || [],
      rawChunks: response.rawChunks || [],
    };
  }

  addLLMChunk(chunk: string): void {
    if (!this.config.enabled || !this.currentIterationLog?.llmResponse) return;
    this.currentIterationLog.llmResponse.rawChunks.push(chunk);
  }

  logToolStart(toolCallId: string, toolName: string, args: unknown): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    const existing = this.currentIterationLog.toolExecutions.find(t => t.toolCallId === toolCallId);
    if (!existing) {
      this.currentIterationLog.toolExecutions.push({
        timestamp: new Date().toISOString(),
        callStack: getCallStack(),
        toolCallId,
        toolName,
        args,
        duration: 0,
      });
    }
  }

  logToolResult(toolCallId: string, result: unknown, duration: number): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    const tool = this.currentIterationLog.toolExecutions.find(t => t.toolCallId === toolCallId);
    if (tool) {
      tool.result = result;
      tool.duration = duration;
    }
  }

  logToolError(toolCallId: string, error: string, duration: number): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    const tool = this.currentIterationLog.toolExecutions.find(t => t.toolCallId === toolCallId);
    if (tool) {
      tool.error = error;
      tool.duration = duration;
    }
  }

  logBackendCall(call: Omit<BackendCallLog, 'timestamp' | 'callStack'>): void {
    if (!this.config.enabled || !this.currentIterationLog) return;
    this.currentIterationLog.backendCalls.push({
      ...call,
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
    });
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
      if (state.output.scopeNodeIds && state.output.scopeNodeIds.length > 0) {
        md += `| 锁定章节 | ${state.output.scopeNodeIds.length} 个 |\n`;
        if (state.output.scopeNodeTitles && state.output.scopeNodeTitles.length > 0) {
          md += `| 章节列表 | ${state.output.scopeNodeTitles.slice(0, 5).join('、')}${state.output.scopeNodeTitles.length > 5 ? '...' : ''} |\n`;
        } else {
          md += `| 章节 ID | ${state.output.scopeNodeIds.slice(0, 5).join(', ')} |\n`;
        }
      } else {
        md += `| 锁定章节 | 全局搜索 |\n`;
      }
      if (state.output.tocSummary) {
        const summary = state.output.tocSummary.length > 200
          ? state.output.tocSummary.slice(0, 200) + '...'
          : state.output.tocSummary;
        md += `| 搜索建议 | ${summary} |\n`;
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
        if (tool.parsedResult?.hits) {
          summary += ` → ${tool.parsedResult.hits} 条结果`;
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