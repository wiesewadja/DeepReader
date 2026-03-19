/**
 * Main orchestrator for the Cognitive Engine
 *
 * Flow:
 * 1. S0: Router + Query Rewrite
 * 2. Based on depth, execute S1, S2, S3
 * 3. S4: Format output
 * 4. Save session
 */

import type { SharedContext, EngineCallbacks } from './types';
import { RouterState } from './states/router';
import { InspectionalState } from './states/inspectional';
import { AnalyticalState } from './states/analytical';
import { SyntopicalState } from './states/syntopical';
import { FormatterState } from './states/formatter';
import { getDebugLogger } from '../debug/logger';
import type { StateOutputLog } from '../debug/types';

// State instances (stateless, can be reused)
const routerState = new RouterState();
const inspectionalState = new InspectionalState();
const analyticalState = new AnalyticalState();
const syntopicalState = new SyntopicalState();

/**
 * Execute a state with debug logging
 */
async function executeStateWithLogging(
  stateName: string,
  state: { 
    name: string;
    execute: (ctx: SharedContext) => Promise<void>;
    tools?: string[];
  },
  ctx: SharedContext,
  callbacks: EngineCallbacks
): Promise<void> {
  const logger = getDebugLogger();
  const startTime = Date.now();

  // 开始状态执行日志
  if (logger?.isEnabled()) {
    logger.startStateExecution(stateName, {
      query: ctx.standaloneQuery || ctx.rawUserQuery,
      historyCount: ctx.chatHistory.length,
      availableTools: state.tools || [],
      scopeNodeIds: ctx.scopeNodeIds,
    });
  }

  try {
    await state.execute(ctx);

    // 构建输出日志
    const output: Partial<StateOutputLog> = {
      depth: ctx.depth,
      standaloneQuery: ctx.standaloneQuery,
      scopeNodeIds: ctx.scopeNodeIds,
      tocSummary: ctx.tocSummary,
      analysisResult: ctx.analysisResult,
      finishReason: 'stop',
    };

    if (logger?.isEnabled()) {
      const stateResult = ctx.stateResults.get(stateName);
      if (stateResult?.innerIterations && stateResult.innerIterations > 1) {
        logger.logInnerIterations(stateResult.innerIterations);
      }
      logger.endStateExecution(output);
    }
  } catch (error) {
    if (logger?.isEnabled()) {
      logger.endStateExecution({
        finishReason: 'error',
      });
    }
    throw error;
  }
}

/**
 * Main orchestrator for the cognitive engine
 */
export async function runCognitiveEngine(
  ctx: SharedContext,
  callbacks: EngineCallbacks
): Promise<string> {
  const logger = getDebugLogger();

  // Start debug session
  if (logger?.isEnabled()) {
    await logger.startSession(ctx.rawUserQuery, ctx.pdfName, ctx.indexId);
  }

  try {
    // Create formatter with callbacks for streaming
    const formatterState = new FormatterState(callbacks);

    // 1. S0: Router + Query Rewrite
    callbacks.onProgress('🌀 正在研判问题深度...');
    await executeStateWithLogging('Router', routerState, ctx, callbacks);

    // 2. Route based on depth
    switch (ctx.depth) {
      case 0:
        // Casual chat, skip to S4
        callbacks.onProgress('💬 日常闲聊模式...');
        break;

      case 1:
        // Inspectional reading
        callbacks.onProgress('🗺️ 正在扫描书籍宏观框架...');
        await executeStateWithLogging('Inspectional', inspectionalState, ctx, callbacks);
        break;

      case 2:
        // Analytical reading (S2 internally calls S1 if needed)
        callbacks.onProgress('🔍 正在与作者达成共识并解构逻辑...');
        await executeStateWithLogging('Analytical', analyticalState, ctx, callbacks);
        break;

      case 3:
        // Syntopical reading (deferred, downgrade to depth 2)
        callbacks.onProgress('⚠️ 主题阅读暂未实现，降级为分析阅读...');
        ctx.depth = 2;
        await executeStateWithLogging('Analytical', analyticalState, ctx, callbacks);
        break;
    }

    // 3. S4: Format output (content is streamed via callbacks)
    callbacks.onProgress('📝 正在排版双链笔记...');
    await executeStateWithLogging('Formatter', formatterState, ctx, callbacks);

    // 4. Generate output (fallback when no LLM available)
    const output = generateOutput(ctx);

    // 5. Save session (only clean chat history)
    saveSession(ctx, output);

    callbacks.onComplete();

    // End debug session
    if (logger?.isEnabled()) {
      await logger.endSession();
    }

    return output;
  } catch (error) {
    // End debug session on error
    if (logger?.isEnabled()) {
      await logger.endSession();
    }
    throw error;
  }
}

/**
 * Generate formatted output from context
 * This serves as fallback when LLM is not available,
 * or provides the content for history when streaming is used
 */
function generateOutput(ctx: SharedContext): string {
  if (ctx.depth === 0) {
    return `你好！我是奚童，昭先生的专属知识助理。有什么我可以帮助你的吗？`;
  }

  if (ctx.analysisResult) {
    return ctx.analysisResult;
  }

  if (ctx.tocSummary) {
    return `根据目录分析：${ctx.tocSummary}`;
  }

  return '抱歉，我暂时无法回答这个问题。请尝试换一种方式提问。';
}

/**
 * Save session to chat history (only clean records)
 */
function saveSession(ctx: SharedContext, finalOutput: string): void {
  // Add user query
  ctx.chatHistory.push({
    role: 'user',
    content: ctx.rawUserQuery,
  });

  // Add assistant response
  ctx.chatHistory.push({
    role: 'assistant',
    content: finalOutput,
  });

  // Note: Background data (scopeNodeIds, rawResults, etc.) is discarded
  // as it only exists in the current SharedContext
}