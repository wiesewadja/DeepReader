/**
 * StateNode abstract base class for all states in the Cognitive Engine
 */

import type { SharedContext, ModelType, StateNodeOptions } from '../types';
import type { ToolDefinition } from '../../types';
import { StateTimeoutError, StateExecutionError } from '../errors';

/**
 * Abstract base class for all state nodes
 */
export abstract class StateNode {
  abstract readonly name: string;
  abstract readonly model: ModelType;
  abstract readonly tools: string[];

  protected options: StateNodeOptions = {
    timeout: 30000,
    retries: 1,
    retryDelay: 1000,
  };

  /**
   * Execute the state logic
   */
  abstract execute(ctx: SharedContext): Promise<void>;

  /**
   * Build the system prompt for this state
   */
  abstract buildSystemPrompt(ctx: SharedContext): string;

  /**
   * Get tool definitions for this state
   */
  getToolDefinitions(allTools: Map<string, { definition: ToolDefinition }>): ToolDefinition[] {
    return this.tools
      .map(name => allTools.get(name)?.definition)
      .filter((def): def is ToolDefinition => def !== undefined);
  }

  /**
   * Set execution options
   */
  setOptions(options: Partial<StateNodeOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

/**
 * Execute a promise with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  stateName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new StateTimeoutError(stateName, timeout)), timeout)
    ),
  ]);
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Execute a state with timeout and retry
 */
export async function executeStateWithProtection<T>(
  stateName: string,
  fn: () => Promise<T>,
  options: StateNodeOptions
): Promise<T> {
  const timeout = options.timeout ?? 30000;
  const retries = options.retries ?? 1;
  const delay = options.retryDelay ?? 1000;

  try {
    return await withRetry(
      () => withTimeout(fn(), timeout, stateName),
      retries,
      delay
    );
  } catch (error) {
    if (error instanceof StateTimeoutError) {
      throw error;
    }
    throw new StateExecutionError(stateName, error instanceof Error ? error : new Error(String(error)));
  }
}