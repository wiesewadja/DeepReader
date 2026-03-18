/**
 * S3: Syntopical Reading State (DEFERRED)
 *
 * Responsibilities:
 * - Cross-book comparison
 * - Dialectical synthesis
 *
 * Status: Stub implementation, falls back to S2
 */

import { StateNode } from './base';
import type { SharedContext } from '../types';

/**
 * S3: Syntopical Reading State (DEFERRED)
 */
export class SyntopicalState extends StateNode {
  readonly name = 'Syntopical';
  readonly model = 'main' as const;
  readonly tools = ['search_read_books'];

  constructor() {
    super();
    this.options = { timeout: 90000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    // Mark as not implemented
    ctx.markStateExecuted(
      this.name,
      false,
      'Syntopical reading not yet implemented, falling back to analytical reading',
      Date.now() - startTime
    );

    // Throw to signal fallback
    throw new Error('SyntopicalState not implemented');
  }

  buildSystemPrompt(_ctx: SharedContext): string {
    return `主题阅读功能尚未实现，敬请期待。`;
  }
}