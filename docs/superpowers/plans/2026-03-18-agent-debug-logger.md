# Agent 调试日志系统实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 FrontendAgent 添加完整的调试日志系统，记录所有 LLM 交互、工具调用、前后端通信信息。

**Architecture:** 创建一个 DebugLogger 类，通过依赖注入方式在 AgentLoop、LLMClient、ToolRegistry、DeepPDFClient 中注入日志记录。使用常量开关控制启用/禁用。

**Tech Stack:** TypeScript, Node.js fs 模块（通过 Obsidian adapter）

---

## Chunk 1: DebugLogger 核心类

### Task 1: 创建 DebugLogger 核心模块

**Files:**
- Create: `frontend/src/agent/debug/logger.ts`
- Create: `frontend/src/agent/debug/types.ts`
- Create: `frontend/src/agent/debug/index.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// frontend/src/agent/debug/types.ts

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
  messages: any[];
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
  body: any;
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
    arguments: any;
  }>;
  rawChunks: string[];  // 流式响应的原始数据块
}

export interface ToolExecutionLog {
  timestamp: string;
  callStack: string;
  toolCallId: string;
  toolName: string;
  args: any;
  result?: any;
  error?: string;
  duration: number;
}

export interface BackendCallLog {
  timestamp: string;
  callStack: string;
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  responseStatus: number;
  responseBody?: any;
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
```

- [ ] **Step 2: 创建 DebugLogger 核心类**

```typescript
// frontend/src/agent/debug/logger.ts

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
 *
 * 记录完整的 Agent 执行过程，包括：
 * - 系统提示词
 * - LLM 请求/响应
 * - 工具调用
 * - 后端 API 通信
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
    await this.app.vault.adapter.mkdir(dirPath);

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
   * 记录消息列表
   */
  logMessages(messages: any[]): void {
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
  logLLMResponse(response: Partial<LLMResponseLog>): void {
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
  logToolStart(toolCallId: string, toolName: string, args: any): void {
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
  logToolResult(toolCallId: string, result: any, duration: number): void {
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
    const filePath = normalizePath(`${this.sessionDir}/iteration-${log.iteration}.md`);

    await this.app.vault.adapter.write(filePath, content);
    console.log(`[DebugLogger] 📝 写入: iteration-${log.iteration}.md`);
  }

  /**
   * 写入迭代 JSON 数据
   */
  private async writeIterationJson(log: IterationLog): Promise<void> {
    if (!this.sessionDir) return;

    const content = JSON.stringify(log, null, 2);
    const filePath = normalizePath(`${this.sessionDir}/iteration-${log.iteration}-messages.json`);

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
      files: this.allIterationLogs.map(l => `iteration-${l.iteration}.md`),
    };

    const content = this.formatSummaryMarkdown(summary);
    const filePath = normalizePath(`${this.sessionDir}/summary.md`);

    await this.app.vault.adapter.write(filePath, content);
    console.log(`[DebugLogger] 📝 写入: summary.md`);
  }

  /**
   * 格式化迭代日志为 Markdown
   */
  private formatIterationMarkdown(log: IterationLog): string {
    const divider = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    let md = `# 迭代 ${log.iteration}\n\n`;
    md += `**时间**: ${log.timestamp}\n\n`;
    md += divider;

    // 调用链
    md += `## 📍 调用链\n\n\`\`\`\n${log.callStack}\n\`\`\`\n`;
    md += divider;

    // 发送给 LLM
    md += `## 📥 发送给 LLM\n\n`;

    // 系统提示词
    if (log.systemPrompt) {
      md += `### 系统提示词\n**长度**: ${log.systemPrompt.length} 字符\n\n\`\`\`\n${log.systemPrompt}\n\`\`\`\n\n`;
    }

    // 消息历史
    if (log.messages.length > 0) {
      md += `### 对话历史\n**消息数**: ${log.messages.length} 条\n\n\`\`\`json\n${JSON.stringify(log.messages, null, 2)}\n\`\`\`\n\n`;
    }

    // LLM 请求
    if (log.llmRequest) {
      md += `### 发送的完整请求\n`;
      md += `**URL**: \`${log.llmRequest.url}\`\n`;
      md += `**方法**: ${log.llmRequest.method}\n`;
      md += `**Headers**: \`${JSON.stringify(log.llmRequest.headers)}\`\n\n`;
      md += `\`\`\`json\n${JSON.stringify(log.llmRequest.body, null, 2)}\n\`\`\`\n`;
    }

    md += divider;

    // LLM 响应
    if (log.llmResponse) {
      md += `## 🤖 LLM 响应\n\n`;
      md += `📍 调用链:\n\`\`\`\n${log.llmResponse.callStack}\n\`\`\`\n\n`;

      md += `### 响应元数据\n\n`;
      md += `| 字段 | 值 |\n`;
      md += `|------|-----|\n`;
      md += `| 模型 | ${log.llmResponse.metadata.model} |\n`;
      md += `| finish_reason | ${log.llmResponse.metadata.finishReason} |\n`;
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

      // 流式输出内容
      if (log.llmResponse.content) {
        md += `### 流式输出内容\n\n\`\`\`\n${log.llmResponse.content}\n\`\`\`\n\n`;
      }

      // 工具调用请求
      if (log.llmResponse.toolCalls.length > 0) {
        md += `### 工具调用请求\n\n`;
        md += `| ID | 工具名 | 参数 |\n`;
        md += `|----|--------|------|\n`;
        for (const tc of log.llmResponse.toolCalls) {
          md += `| \`${tc.id}\` | ${tc.name} | 见下方详情 |\n`;
        }
        md += `\n`;

        for (const tc of log.llmResponse.toolCalls) {
          md += `\`\`\`json\n${JSON.stringify(tc.arguments, null, 2)}\n\`\`\`\n\n`;
        }
      }
    }

    md += divider;

    // 工具执行
    if (log.toolExecutions.length > 0) {
      for (const tool of log.toolExecutions) {
        md += `## 🔧 工具执行: ${tool.toolName}\n\n`;
        md += `📍 调用链:\n\`\`\`\n${tool.callStack}\n\`\`\`\n\n`;

        // 关联的后端 API 调用
        const relatedBackendCall = log.backendCalls.find(
          bc => bc.timestamp >= tool.timestamp
        );

        if (relatedBackendCall) {
          md += `### 🌐 后端 API 请求\n\n`;
          md += `**URL**: \`${relatedBackendCall.url}\`\n`;
          md += `**方法**: ${relatedBackendCall.method}\n`;
          if (relatedBackendCall.requestHeaders) {
            md += `**Headers**: \`${JSON.stringify(relatedBackendCall.requestHeaders)}\`\n`;
          }
          md += `\n**请求体**:\n\`\`\`json\n${JSON.stringify(relatedBackendCall.requestBody, null, 2)}\n\`\`\`\n\n`;

          md += `### 🌐 后端 API 响应\n\n`;
          md += `**状态码**: ${relatedBackendCall.responseStatus}\n`;
          md += `**耗时**: ${(relatedBackendCall.duration / 1000).toFixed(2)}s\n\n`;
          md += `**响应体**:\n\`\`\`json\n${JSON.stringify(relatedBackendCall.responseBody, null, 2)}\n\`\`\`\n`;
        }

        md += `\n### 工具结果\n\n`;
        if (tool.error) {
          md += `❌ **错误**: ${tool.error}\n`;
        } else if (tool.result !== undefined) {
          md += `- **耗时**: ${(tool.duration / 1000).toFixed(2)}s\n\n`;
          md += `\`\`\`\n${typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}\n\`\`\`\n`;
        }

        md += divider;
      }
    }

    // 迭代统计
    md += `## 📊 迭代 ${log.iteration} 统计\n\n`;
    md += `| 指标 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 迭代耗时 | ${(log.stats.duration / 1000).toFixed(1)}s |\n`;
    md += `| LLM 耗时 | ${(log.stats.llmDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具耗时 | ${(log.stats.toolsDuration / 1000).toFixed(1)}s |\n`;
    md += `| Token 变化 | ${log.stats.tokenStart} → ${log.stats.tokenEnd} (${log.stats.tokenEnd - log.stats.tokenStart >= 0 ? '+' : ''}${log.stats.tokenEnd - log.stats.tokenStart}) |\n`;
    md += `| 工具调用数 | ${log.stats.toolCallCount} |\n`;
    md += divider;

    return md;
  }

  /**
   * 格式化摘要为 Markdown
   */
  private formatSummaryMarkdown(summary: SessionSummary): string {
    const divider = '\n---\n';

    let md = `# Agent 调试日志\n\n`;
    md += `**时间**: ${summary.timestamp}\n`;
    md += `**用户问题**: ${summary.userQuery}\n`;
    md += `**总迭代数**: ${summary.totalIterations}\n`;
    md += `**总耗时**: ${(summary.totalDuration / 1000).toFixed(1)}s\n`;
    md += divider;

    md += `## 📊 总体统计\n\n`;
    md += `| 指标 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 总 Token 消耗 | ${summary.totalStats.tokenStart} → ${summary.totalStats.tokenEnd} (${summary.totalStats.tokenEnd - summary.totalStats.tokenStart >= 0 ? '+' : ''}${summary.totalStats.tokenEnd - summary.totalStats.tokenStart}) |\n`;
    md += `| LLM 总耗时 | ${(summary.totalStats.llmDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具总耗时 | ${(summary.totalStats.toolsDuration / 1000).toFixed(1)}s |\n`;
    md += `| 工具调用总数 | ${summary.totalStats.toolCallCount} |\n`;
    md += divider;

    if (summary.toolSummary.length > 0) {
      md += `## 🔧 工具调用汇总\n\n`;
      md += `| 迭代 | 工具 | 耗时 |\n`;
      md += `|------|------|------|\n`;
      for (const t of summary.toolSummary) {
        md += `| ${t.iteration} | ${t.toolName} | ${(t.duration / 1000).toFixed(1)}s |\n`;
      }
      md += divider;
    }

    md += `## 📁 文件列表\n\n`;
    for (const file of summary.files) {
      const baseName = file.replace('.md', '');
      md += `- [${file}](./${file})\n`;
      md += `- [${baseName}-messages.json](./${baseName}-messages.json)\n`;
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
```

- [ ] **Step 3: 创建模块导出文件**

```typescript
// frontend/src/agent/debug/index.ts

export { DebugLogger, initDebugLogger, getDebugLogger, getCallStack, DEBUG_LOG_ENABLED } from './logger.js';
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
```

- [ ] **Step 4: 验证编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 无类型错误

---

## Chunk 2: 注入日志到 AgentLoop

### Task 2: 修改 AgentLoop 集成 DebugLogger

**Files:**
- Modify: `frontend/src/agent/agent-loop.ts:1-725`

- [ ] **Step 1: 在 agent-loop.ts 中导入 DebugLogger**

在文件顶部添加导入：

```typescript
// 在第 14 行 agentLog 导入后添加
import { getDebugLogger, getCallStack } from './debug/index.js';
```

- [ ] **Step 2: 在 runAgentLoop 函数中添加会话日志**

在 `runAgentLoop` 函数开头（第 271 行后）添加：

```typescript
export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  // ... 现有代码 ...

  // 🐛 调试日志：开始会话
  const debugLogger = getDebugLogger();
  if (debugLogger?.isEnabled()) {
    const userQuestion = [...messages].reverse().find(m => m.role === 'user');
    const questionText = typeof userQuestion?.content === 'string'
      ? userQuestion.content
      : '(复杂内容)';
    await debugLogger.startSession(questionText);
  }

  // ... 继续现有代码 ...
```

- [ ] **Step 3: 在迭代循环中添加日志**

在 `while (iterations < maxIterations)` 循环内：

1. 迭代开始时（第 324 行 `iterations++;` 后）：
```typescript
    iterations++;
    const iterationStartTime = Date.now();

    // 🐛 调试日志：开始迭代
    debugLogger?.startIteration(iterations);
    debugLogger?.logMessages(workingMessages);
```

2. LLM 调用前（第 343 行 `agentLog` 后）：
```typescript
    agentLog(`[AgentLoop] 🤖 开始调用 LLM...`);

    // 🐛 调试日志：记录 LLM 请求
    const systemMsg = workingMessages.find(m => m.role === 'system');
    if (systemMsg) {
      debugLogger?.logSystemPrompt(typeof systemMsg.content === 'string' ? systemMsg.content : '');
    }
    debugLogger?.logLLMRequest({
      url: client.getApiUrl?.() || 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ***', // 掩码
      },
      body: {
        model: client.getModel?.() || 'deepseek-chat',
        messages: workingMessages,
        tools: tools,
        stream: true,
      },
    });
```

3. LLM 响应后（第 388 行后）：
```typescript
    agentLog(`[AgentLoop] 🤖 LLM 响应完成: ${formatDuration(llmDuration)}, finishReason=${finishReason}`);

    // 🐛 调试日志：记录 LLM 响应
    debugLogger?.logLLMResponse({
      metadata: {
        model: 'deepseek-chat',
        finishReason: finishReason || 'stop',
        ttfb: llmDuration,
      },
      content: accumulatedContent,
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.parse(tc.arguments),
      })),
    });
```

4. 工具执行时（第 488-546 行工具执行循环内）：
```typescript
      // 🐛 调试日志：工具开始
      debugLogger?.logToolStart(tc.id, tc.name, args);

      try {
        // ... 现有工具执行代码 ...

        // 🐛 调试日志：工具结果
        debugLogger?.logToolResult(tc.id, result, duration);
      } catch (error) {
        // 🐛 调试日志：工具错误
        debugLogger?.logToolError(tc.id, errorMsg, duration);
      }
```

5. 迭代结束时（第 619 行后）：
```typescript
    agentLog(`[AgentLoop] 📊 当前消息历史: ${workingMessages.length} 条, 估算 tokens: ~${estimateTokens(workingMessages)}`);

    // 🐛 调试日志：结束迭代
    await debugLogger?.endIteration({
      duration: iterationDuration,
      llmDuration: llmDuration,
      toolsDuration: toolsDuration,
      tokenStart: startTokens,
      tokenEnd: estimateTokens(workingMessages),
    });
```

6. 会话结束时（第 719 行后）：
```typescript
  printPerformanceReport(metrics);

  // 🐛 调试日志：结束会话
  await debugLogger?.endSession();

  // 🧹 Memory GC: 清理中间消息，只保留用户对话
```

- [ ] **Step 4: 验证编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 无类型错误

---

## Chunk 3: 注入日志到 LLMClient

### Task 3: 修改 LLMClient 集成 DebugLogger

**Files:**
- Modify: `frontend/src/agent/llm-client.ts:1-374`

- [ ] **Step 1: 添加导入和方法**

在文件顶部添加导入：

```typescript
import { getDebugLogger } from './debug/index.js';
```

在 LLMClient 类中添加辅助方法：

```typescript
  /**
   * 获取 API URL（供调试日志使用）
   */
  getApiUrl(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  /**
   * 获取模型名称（供调试日志使用）
   */
  getModel(): string {
    return this.model;
  }
```

- [ ] **Step 2: 在 streamChat 中记录流式响应块**

在第 222 行 `callbacks.onContent(delta.content)` 后添加：

```typescript
              // 处理文本内容
              if (delta.content) {
                callbacks.onContent(delta.content);
                // 🐛 调试日志：记录流式块
                getDebugLogger()?.addLLMChunk(delta.content);
              }
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 无类型错误

---

## Chunk 4: 注入日志到 DeepPDFClient

### Task 4: 修改 DeepPDFClient 记录后端 API 调用

**Files:**
- Modify: `frontend/src/api/http-client.ts:547-575`

- [ ] **Step 1: 添加导入**

在文件顶部添加：

```typescript
import { getDebugLogger } from '../agent/debug/index.js';
```

- [ ] **Step 2: 修改 request 方法记录 API 调用**

修改 `request` 私有方法（第 547-575 行）：

```typescript
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    const timerId = `api:${endpoint}`;

    log(`[HTTP] ${method} ${endpoint}`);
    const startTime = performance.now();

    // 🐛 调试日志：记录请求
    const debugLogger = getDebugLogger();
    let requestBody: any = undefined;
    if (options.body) {
      try {
        requestBody = JSON.parse(options.body as string);
      } catch {
        requestBody = options.body;
      }
    }

    try {
      const response = await fetch(url, options);
      const duration = performance.now() - startTime;

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        logError(`[HTTP] ${method} ${endpoint} 失败 (${response.status}):`, error.detail || error.message);

        // 🐛 调试日志：记录失败响应
        debugLogger?.logBackendCall({
          url,
          method,
          requestBody,
          responseStatus: response.status,
          responseBody: error,
          duration,
        });

        throw new Error(error.detail || error.message || 'Request failed');
      }

      const result = await response.json();
      log(`[HTTP] ${method} ${endpoint} 成功 (${duration.toFixed(0)}ms)`);

      // 🐛 调试日志：记录成功响应
      debugLogger?.logBackendCall({
        url,
        method,
        requestBody,
        responseStatus: response.status,
        responseBody: result,
        duration,
      });

      return result;
    } catch (e) {
      const duration = performance.now() - startTime;
      logError(`[HTTP] ${method} ${endpoint} 异常 (${duration.toFixed(0)}ms):`, e);
      throw e;
    }
  }
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 无类型错误

---

## Chunk 5: 初始化 DebugLogger

### Task 5: 在 FrontendAgent 中初始化 DebugLogger

**Files:**
- Modify: `frontend/src/agent/index.ts:1-326`

- [ ] **Step 1: 添加导入**

在文件顶部添加：

```typescript
import { initDebugLogger, getDebugLogger } from './debug/index.js';
```

- [ ] **Step 2: 在 FrontendAgent 构造函数中初始化**

修改构造函数（第 60-74 行）：

```typescript
  constructor(private options: FrontendAgentOptions) {
    this.llmClient = new LLMClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      providerName: options.providerName,
    });
    this.skillLoader = new SkillLoader(options.skillsDir);
    this.contextLoader = new ContextLoader(options.app);
    this.memoryStore = new MemoryStore(options.app);
    this.contextBuilder = new ContextBuilder(options.app, this.memoryStore, {
      deepReaderDir: 'DeepReader',
    });
    this.intentRouter = new IntentRouter();

    // 🐛 初始化调试日志器
    initDebugLogger(options.app, {
      logDir: 'debug-logs',
    });
  }
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 无类型错误

---

## Chunk 6: 更新 .gitignore

### Task 6: 排除调试日志目录

**Files:**
- Modify: `frontend/.gitignore`

- [ ] **Step 1: 添加调试日志目录到 .gitignore**

在 `frontend/.gitignore` 文件末尾添加：

```
# Agent debug logs
debug-logs/
```

- [ ] **Step 2: 验证 .gitignore 生效**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && git status`
Expected: debug-logs/ 目录不会被追踪

---

## Chunk 7: 测试验证

### Task 7: 构建并测试

- [ ] **Step 1: 完整构建**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 2: 部署到测试环境**

Run: `npm run deploy && obsidian plugin:reload id=deepreader`
Expected: 插件重新加载成功

- [ ] **Step 3: 功能测试**

1. 在 Obsidian 中打开 DeepReader
2. 与 Agent 进行一次对话
3. 检查 `frontend/debug-logs/` 目录下是否生成了日志文件
4. 验证日志内容是否完整

---

## 文件清单

| 操作 | 文件路径 |
|------|----------|
| Create | `frontend/src/agent/debug/types.ts` |
| Create | `frontend/src/agent/debug/logger.ts` |
| Create | `frontend/src/agent/debug/index.ts` |
| Modify | `frontend/src/agent/agent-loop.ts` |
| Modify | `frontend/src/agent/llm-client.ts` |
| Modify | `frontend/src/api/http-client.ts` |
| Modify | `frontend/src/agent/index.ts` |
| Modify | `frontend/.gitignore` |
