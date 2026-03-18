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

// State instances
const routerState = new RouterState();
const inspectionalState = new InspectionalState();
const analyticalState = new AnalyticalState();
const syntopicalState = new SyntopicalState();
const formatterState = new FormatterState();

/**
 * Main orchestrator for the cognitive engine
 */
export async function runCognitiveEngine(
  ctx: SharedContext,
  callbacks: EngineCallbacks
): Promise<string> {
  // 1. S0: Router + Query Rewrite
  callbacks.onProgress('🌀 正在研判问题深度...');
  await routerState.execute(ctx);

  // 2. Route based on depth
  switch (ctx.depth) {
    case 0:
      // Casual chat, skip to S4
      callbacks.onProgress('💬 日常闲聊模式...');
      break;

    case 1:
      // Inspectional reading
      callbacks.onProgress('🗺️ 正在扫描书籍宏观框架...');
      await inspectionalState.execute(ctx);
      break;

    case 2:
      // Analytical reading (S2 internally calls S1 if needed)
      callbacks.onProgress('🔍 正在与作者达成共识并解构逻辑...');
      await analyticalState.execute(ctx);
      break;

    case 3:
      // Syntopical reading (deferred, downgrade to depth 2)
      callbacks.onProgress('⚠️ 主题阅读暂未实现，降级为分析阅读...');
      ctx.depth = 2;
      await analyticalState.execute(ctx);
      break;
  }

  // 3. S4: Format output
  callbacks.onProgress('📝 正在排版双链笔记...');
  await formatterState.execute(ctx);

  // 4. Generate output (placeholder)
  const output = generateOutput(ctx);
  callbacks.onContent(output);

  // 5. Save session (only clean chat history)
  saveSession(ctx, output);

  callbacks.onComplete();
  return output;
}

/**
 * Generate formatted output from context
 */
function generateOutput(ctx: SharedContext): string {
  if (ctx.depth === 0) {
    return `你好！我是奚童，昭先生的专属知识助理。有什么我可以帮助你的吗？`;
  }

  if (ctx.analysisResult) {
    // In production, this would be the LLM-formatted output
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