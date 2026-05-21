/**
 * LangSmith Tracer Setup
 *
 * Creates a LangChainTracer instance for LangGraph observability.
 * When enabled, all LangGraph node executions, LLM calls, and tool calls
 * are automatically traced and sent to LangSmith.
 *
 * Usage:
 *   const tracer = createLangSmithTracer({ apiKey, projectName });
 *   // Pass via callbacks in graph stream/invoke config
 */

import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith/client';
import { agentLog as log } from '../../utils/logger.js';

export interface LangSmithConfig {
  apiKey: string;
  projectName?: string;
  /** Optional: custom API URL for LangSmith self-hosted */
  apiUrl?: string;
}

let cachedTracer: LangChainTracer | null = null;
let cachedConfig: string = '';

/**
 * Wrap tracer with Proxy so any callback error is silently swallowed.
 * LangSmith failures must never block the main conversation flow.
 */
function safeWrap(tracer: LangChainTracer): LangChainTracer {
  return new Proxy(tracer, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = (value as (...a: unknown[]) => unknown).apply(target, args);
            if (result instanceof Promise) {
              return result.catch((err: unknown) => {
                log('[LangSmith] Silent error in', String(prop), ':', err instanceof Error ? err.message : err);
              });
            }
            return result;
          } catch (err) {
            log('[LangSmith] Silent error in', String(prop), ':', err instanceof Error ? err.message : err);
          }
        };
      }
      return value;
    },
  }) as LangChainTracer;
}

/**
 * Create or return cached LangChainTracer.
 *
 * Caches by config hash to avoid re-creating on every call.
 * Returns null if config is incomplete or creation fails.
 */
export function getLangSmithTracer(config?: LangSmithConfig): LangChainTracer | null {
  if (!config?.apiKey) {
    return null;
  }

  const configKey = `${config.apiKey}:${config.projectName}:${config.apiUrl}`;
  if (cachedTracer && cachedConfig === configKey) {
    return cachedTracer;
  }

  try {
    const client = new Client({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl || 'https://api.smith.langchain.com',
    });

    cachedTracer = safeWrap(new LangChainTracer({
      client,
      projectName: config.projectName || 'DeepReader',
    }));
    cachedConfig = configKey;

    log('[LangSmith] Tracer 初始化成功, project:', config.projectName || 'DeepReader');
    return cachedTracer;
  } catch (err) {
    log('[LangSmith] Tracer 初始化失败:', err);
    return null;
  }
}

/**
 * Reset cached tracer (called when settings change).
 */
export function resetLangSmithTracer(): void {
  cachedTracer = null;
  cachedConfig = '';
}
