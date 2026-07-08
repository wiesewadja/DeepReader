/**
 * Pipeline executor — runs a sequence of PipelineSteps in order.
 */

import type { PipelineContext, PipelineStep } from "./pipeline-types.js";

export async function executePipeline(
  steps: PipelineStep[],
  ctx: PipelineContext
): Promise<void> {
  for (const step of steps) {
    // Tracer may be undefined before validate step sets it up
    ctx.tracer?.startPhase(step.name);
    try {
      await step.execute(ctx);
      ctx.tracer?.endPhase();
    } catch (error) {
      ctx.tracer?.failPhase(error instanceof Error ? error.message : String(error));
      throw error;
    }
    ctx.tracer?.save();
  }
}
