/**
 * DebugLogger - Agent 调试日志记录器
 *
 * 记录完整的 Agent 执行过程，包括：
 * - 系统提示词
 * - LLM 请求/响应
 * - 工具调用
 * - 后端 API 通信
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type {
  DebugLogConfig,
  IterationLog,
  LLMRequestLog,
  LLMResponseLog,
  ToolExecutionLog,
  BackendCallLog,
  IterationStats,
  SessionSummary,
} from './types.js';

/**
 * 🔧 调试日志开关
 * 设为 true 启用完整调试日志，设为 false 禁用
 */
export const DEBUG_LOG_ENABLED = true;

/**
 * 获取调用栈信息
 * 解析 Error.stack 并格式化为可读的调用链
 */
export function getCallStack(): string {
  const stack = new Error().stack?.split('\n') || [];

  const relevantLines = stack
    .filter(line => {
      // 过滤掉 node_modules 和内部实现
      return line.includes('.ts:') &&
             !line.includes('node_modules') &&
             !line.includes('logger.ts');
    })
    .map(line => {
      // 提取文件名、行号和函数名
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
  private currentIteration = 0;
  private currentIterationLog: IterationLog | null = null;
  private sessionStartTime = 0;
  private sessionQuery = '';
  private allIterationLogs: IterationLog[] = [];

  constructor(app: App, config?: Partial<DebugLogConfig>) {
    this.app = app;
    this.config = {
      enabled: DEBUG_LOG_ENABLED,
      logDir: 'debug-logs',
      ...config,
    };
  }

  /**
   * 检查日志是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 开始新的调试会话
   */
  async startSession(userQuery: string): Promise<void> {
    if (!this.config.enabled) return;

    this.sessionQuery = userQuery;
    this.sessionStartTime = Date.now();
    this.currentIteration = 0;
    this.allIterationLogs = [];

    // 创建会话目录
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.sessionDir = `${this.config.logDir}/${timestamp}`;

    const dirPath = normalizePath(this.sessionDir);

    // 确保父目录存在
    try {
      await this.app.vault.adapter.mkdir(this.config.logDir);
    } catch {
      // 目录可能已存在
    }

    try {
      await this.app.vault.adapter.mkdir(dirPath);
    } catch {
      // 目录可能已存在
    }

    console.log(`[DebugLogger] 📁 开始调试会话: ${this.sessionDir}`);
  }

  /**
   * 结束调试会话，写入摘要
   */
  async endSession(): Promise<void> {
    if (!this.config.enabled || !this.sessionDir) return;

    // 写入摘要文件
    await this.writeSummary();

    // 写入所有迭代的 JSON 文件
    for (const log of this.allIterationLogs) {
      await this.writeIterationJson(log);
    }

    console.log(`[DebugLogger] ✅ 调试会话结束: ${this.sessionDir}`);
    this.sessionDir = null;
  }

  /**
   * 开始新迭代
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
   * 结束当前迭代，写入日志文件
   */
  async endIteration(stats: Partial<IterationStats>): Promise<void> {
    if (!this.config.enabled || !this.currentIterationLog || !this.sessionDir) return;

    // 更新统计信息
    this.currentIterationLog.stats = {
      ...this.currentIterationLog.stats,
      ...stats,
    };

    // 计算 token 变化
    this.currentIterationLog.stats.toolCallCount = this.currentIterationLog.toolExecutions.length;

    // 写入 Markdown 日志
    await this.writeIterationMarkdown(this.currentIterationLog);

    // 保存到列表
    this.allIterationLogs.push(this.currentIterationLog);

    this.currentIterationLog = null;
  }

  /**
   * 记录系统提示词
   */
  logSystemPrompt(prompt: string): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    this.currentIterationLog.systemPrompt = prompt;
  }

  /**
   * 记录状态信息
   * @param stateName 状态名称
   * @param info 状态信息
   * @param method 路由方法 ('regex' 或 'llm')
   */
  logStateInfo(stateName: string, info: {
    depth?: number;
    standaloneQuery?: string;
    scopeNodeIds?: string[];
  }, method: 'regex' | 'llm' = 'llm'): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    // 将状态信息存储到 stateInfo 字段
    this.currentIterationLog.stateInfo = {
      stateName,
      method,
      ...info,
    };
  }

  /**
   * 记录消息列表
   */
  logMessages(messages: unknown[]): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    this.currentIterationLog.messages = JSON.parse(JSON.stringify(messages));
  }

  /**
   * 记录 LLM 请求
   */
  logLLMRequest(request: Omit<LLMRequestLog, 'timestamp' | 'callStack'>): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    this.currentIterationLog!.llmRequest = {
      ...request,
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
    };
  }

  /**
   * 记录 LLM 响应
   */
  logLLMResponse(response: Partial<Omit<LLMResponseLog, 'timestamp' | 'callStack'>>): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    this.currentIterationLog!.llmResponse = {
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
      metadata: response.metadata || {
        model: '',
        finishReason: '',
      },
      content: response.content || '',
      toolCalls: response.toolCalls || [],
      rawChunks: response.rawChunks || [],
    };
  }

  /**
   * 添加 LLM 流式响应块
   */
  addLLMChunk(chunk: string): void {
    if (!this.config.enabled || !this.currentIterationLog?.llmResponse) return;

    this.currentIterationLog.llmResponse.rawChunks.push(chunk);
  }

  /**
   * 记录工具调用开始
   */
  logToolStart(toolCallId: string, toolName: string, args: unknown): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    // 工具调用开始时记录，结果稍后更新
    const existing = this.currentIterationLog.toolExecutions.find(
      t => t.toolCallId === toolCallId
    );
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

  /**
   * 记录工具调用结果
   */
  logToolResult(toolCallId: string, result: unknown, duration: number): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    const tool = this.currentIterationLog.toolExecutions.find(
      t => t.toolCallId === toolCallId
    );
    if (tool) {
      tool.result = result;
      tool.duration = duration;
    }
  }

  /**
   * 记录工具调用错误
   */
  logToolError(toolCallId: string, error: string, duration: number): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    const tool = this.currentIterationLog.toolExecutions.find(
      t => t.toolCallId === toolCallId
    );
    if (tool) {
      tool.error = error;
      tool.duration = duration;
    }
  }

  /**
   * 记录后端 API 调用
   */
  logBackendCall(call: Omit<BackendCallLog, 'timestamp' | 'callStack'>): void {
    if (!this.config.enabled || !this.currentIterationLog) return;

    this.currentIterationLog.backendCalls.push({
      ...call,
      timestamp: new Date().toISOString(),
      callStack: getCallStack(),
    });
  }

  // ============================================================================
  // 私有方法：文件写入
  // ============================================================================

  /**
   * 写入迭代 Markdown 日志
   */
  private async writeIterationMarkdown(log: IterationLog): Promise<void> {
    if (!this.sessionDir) return;

    const content = this.formatIterationMarkdown(log);
    // 使用状态名称作为文件名，如果没有状态名称则使用迭代编号
    const fileName = log.stateInfo?.stateName
      ? `${log.iteration}-${log.stateInfo.stateName.toLowerCase()}`
      : `iteration-${log.iteration}`;
    const filePath = normalizePath(`${this.sessionDir}/${fileName}.md`);

    await this.app.vault.adapter.write(filePath, content);
    console.log(`[DebugLogger] 📝 写入: ${fileName}.md`);
  }

  /**
   * 写入迭代 JSON 数据
   */
  private async writeIterationJson(log: IterationLog): Promise<void> {
    if (!this.sessionDir) return;

    const content = JSON.stringify(log, null, 2);
    // 使用与 Markdown 相同的命名规则
    const fileName = log.stateInfo?.stateName
      ? `${log.iteration}-${log.stateInfo.stateName.toLowerCase()}`
      : `iteration-${log.iteration}`;
    const filePath = normalizePath(`${this.sessionDir}/${fileName}.json`);

    await this.app.vault.adapter.write(filePath, content);
  }

  /**
   * 写入会话摘要
   */
  private async writeSummary(): Promise<void> {
    if (!this.sessionDir) return;

    const totalDuration = Date.now() - this.sessionStartTime;
    const tokenStart = this.allIterationLogs[0]?.stats.tokenStart || 0;
    const tokenEnd = this.allIterationLogs[this.allIterationLogs.length - 1]?.stats.tokenEnd || 0;

    const llmDuration = this.allIterationLogs.reduce((sum, l) => sum + l.stats.llmDuration, 0);
    const toolsDuration = this.allIterationLogs.reduce((sum, l) => sum + l.stats.toolsDuration, 0);
    const toolCallCount = this.allIterationLogs.reduce((sum, l) => sum + l.stats.toolCallCount, 0);

    const toolSummary = this.allIterationLogs.flatMap(log =>
      log.toolExecutions.map(t => ({
        iteration: log.iteration,
        toolName: t.toolName,
        duration: t.duration,
      }))
    );

    const summary: SessionSummary = {
      timestamp: new Date().toISOString(),
      userQuery: this.sessionQuery,
      totalIterations: this.allIterationLogs.length,
      totalDuration,
      totalStats: {
        llmDuration,
        toolsDuration,
        tokenStart,
        tokenEnd,
        toolCallCount,
      },
      toolSummary,
      files: this.allIterationLogs.map(l => {
        const fileName = l.stateInfo?.stateName
          ? `${l.iteration}-${l.stateInfo.stateName.toLowerCase()}`
          : `iteration-${l.iteration}`;
        return `${fileName}.md`;
      }),
    };

    const content = this.formatSummaryMarkdown(summary);
    const filePath = normalizePath(`${this.sessionDir}/summary.md`);

    await this.app.vault.adapter.write(filePath, content);
    console.log(`[DebugLogger] 📝 写入: summary.md`);
  }

  /**
   * 格式化迭代日志为 Markdown（按状态组织）
   */
  private formatIterationMarkdown(log: IterationLog): string {
    // 判断是否是状态机迭代（有 stateInfo 或 systemPrompt）
    const isStateIteration = log.stateInfo || log.systemPrompt;

    let md = '';

    // ========================================
    // 标题区域
    // ========================================
    if (isStateIteration && log.stateInfo) {
      const stateName = log.stateInfo.stateName || 'Unknown';
      const depthEmoji = ['🔍', '📖', '🔬', '📚'];
      const emoji = depthEmoji[log.stateInfo.depth ?? 0] || '⚙️';
      md += `# ${emoji} ${stateName}\n\n`;
      md += `> **深度**: ${log.stateInfo.depth ?? '-'} | **方法**: ${log.stateInfo.method || 'llm'}\n\n`;
    } else {
      md += `# ⚙️ 迭代 ${log.iteration}\n\n`;
    }

    md += `**时间**: ${new Date(log.timestamp).toLocaleTimeString()}\n\n`;

    // ========================================
    // 状态信息（非 LLM 调用）
    // ========================================
    if (log.stateInfo) {
      md += `## 📋 禂览\n\n`;
      md += `| 字段 | 值 |\n`;
      md += `|------|-----|\n`;
      if (log.stateInfo.standaloneQuery) {
        md += `| 独立查询 | ${log.stateInfo.standaloneQuery} |\n`;
      }
      if (log.stateInfo.scopeNodeIds && log.stateInfo.scopeNodeIds.length > 0) {
        md += `| 作用域节点 | ${log.stateInfo.scopeNodeIds.slice(0, 3).join(', ')}${log.stateInfo.scopeNodeIds.length > 3 ? '...' : ''} |\n`;
      }
      md += `\n`;
      return md; // 状态机快速路由，无需更多内容
    }

    // ========================================
    // LLM 交互
    // ========================================
    if (log.llmResponse || log.systemPrompt || log.messages.length > 0) {
      md += `---\n\n`;
      md += `## 🤖 LLM 交互\n\n`;

      // 响应元数据
      if (log.llmResponse?.metadata) {
        md += `| 指标 | 值 |\n`;
        md += `|------|-----|\n`;
        md += `| 模型 | ${log.llmResponse.metadata.model || '-'} |\n`;
        if (log.llmResponse.metadata.inputTokens) {
          md += `| 输入 Token | ${log.llmResponse.metadata.inputTokens} |\n`;
        }
        if (log.llmResponse.metadata.outputTokens) {
          md += `| 输出 Token | ${log.llmResponse.metadata.outputTokens} |\n`;
        }
        if (log.llmResponse.metadata.ttfb) {
          md += `| TTFB | ${log.llmResponse.metadata.ttfb}ms |\n`;
        }
        md += `\n`;
      }

      // LLM 输出内容
      if (log.llmResponse?.content) {
        md += `### 💬 LLM 输出\n\n`;
        md += `\`\`\`\n${log.llmResponse.content}\n\`\`\`\n\n`;
      }

      // 工具调用请求
      if (log.llmResponse?.toolCalls && log.llmResponse.toolCalls.length > 0) {
        md += `### 🔧 工具调用请求\n\n`;
        for (const tc of log.llmResponse.toolCalls) {
          md += `**${tc.name}**\n`;
          md += `\`\`\`json\n${JSON.stringify(tc.arguments, null, 2)}\n\`\`\`\n\n`;
        }
      }
    }

    // ========================================
    // 工具执行
    // ========================================
    if (log.toolExecutions.length > 0) {
      md += `---\n\n`;
      md += `## 🛠️ 工具执行 (${log.toolExecutions.length} 个)\n\n`;

      for (let i = 0; i < log.toolExecutions.length; i++) {
        const tool = log.toolExecutions[i];
        md += `### ${i + 1}. ${tool.toolName}\n`;
        md += `> 耗时: ${(tool.duration / 1000).toFixed(2)}s\n\n`;

        // 显示参数
        if (tool.args && Object.keys(tool.args).length > 0) {
          md += `**参数**:\n\`\`\`json\n${JSON.stringify(tool.args, null, 2)}\n\`\`\`\n\n`;
        }

        if (tool.error) {
          md += `❌ **错误**: ${tool.error}\n\n`;
        } else if (tool.result !== undefined) {
          // 完整显示结果（不截断）
          const resultStr = typeof tool.result === 'string'
            ? tool.result
            : JSON.stringify(tool.result, null, 2);
          md += `**结果**:\n\`\`\`\n${resultStr}\n\`\`\`\n\n`;
        }
      }
    }

    // ========================================
    // 统计信息
    // ========================================
    md += `---\n\n`;
    md += `## 📊 统计\n\n`;
    md += `| 指标 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 迭代耗时 | ${(log.stats.duration / 1000).toFixed(1)}s |\n`;
    md += `| LLM 耗时 | ${(log.stats.llmDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具耗时 | ${(log.stats.toolsDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具调用数 | ${log.stats.toolCallCount} |\n`;

    return md;
  }

  /**
   * 格式化摘要为 Markdown
   */
  private formatSummaryMarkdown(summary: SessionSummary): string {
    let md = '';

    // ========================================
    // 标题区域
    // ========================================
    md += `# 🤖 Agent 调试日志\n\n`;
    md += `> **时间**: ${new Date(summary.timestamp).toLocaleString()}\n`;
    md += `> **问题**: ${summary.userQuery}\n\n`;

    // ========================================
    // 状态流转图
    // ========================================
    md += `---\n\n`;
    md += `## 📊 状态流转\n\n`;
    md += `\`\`\`\n`;
    md += `用户输入\n`;
    md += `   │\n`;
    md += `   ▼\n`;
    md += `🔍 Router → 📖 Inspectional → 🔬 Analytical → 📝 Formatter\n`;
    md += `   │           │                  │                │\n`;
    md += `   │           │                  │                ▼\n`;
    md += `   │           │                  │           💬 输出回复\n`;
    md += `\`\`\`\n\n`;

    // ========================================
    // 总体统计
    // ========================================
    md += `---\n\n`;
    md += `## 📈 统计\n\n`;
    md += `| 指标 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 总耗时 | ${(summary.totalDuration / 1000).toFixed(1)}s |\n`;
    md += `| 状态数 | ${summary.totalIterations} |\n`;
    md += `| LLM 耗时 | ${(summary.totalStats.llmDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具耗时 | ${(summary.totalStats.toolsDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具调用数 | ${summary.totalStats.toolCallCount} |\n\n`;

    // ========================================
    // 工具调用汇总（按工具分组）
    // ========================================
    if (summary.toolSummary.length > 0) {
      md += `---\n\n`;
      md += `## 🛠️ 工具调用\n\n`;

      // 按工具名分组统计
      const toolStats = new Map<string, { count: number; totalDuration: number }>();
      for (const t of summary.toolSummary) {
        const existing = toolStats.get(t.toolName) || { count: 0, totalDuration: 0 };
        toolStats.set(t.toolName, {
          count: existing.count + 1,
          totalDuration: existing.totalDuration + t.duration,
        });
      }

      md += `| 工具 | 调用次数 | 总耗时 |\n`;
      md += `|------|----------|--------|\n`;
      for (const [name, stats] of toolStats) {
        md += `| ${name} | ${stats.count} | ${(stats.totalDuration / 1000).toFixed(1)}s |\n`;
      }
      md += `\n`;
    }

    // ========================================
    // 文件列表
    // ========================================
    md += `---\n\n`;
    md += `## 📁 详细日志\n\n`;
    for (const file of summary.files) {
      md += `- [${file}](./${file})\n`;
    }

    return md;
  }
}

// 单例实例（由 FrontendAgent 初始化时设置）
let _instance: DebugLogger | null = null;

export function initDebugLogger(app: App, config?: Partial<DebugLogConfig>): DebugLogger {
  _instance = new DebugLogger(app, config);
  return _instance;
}

export function getDebugLogger(): DebugLogger | null {
  return _instance;
}
