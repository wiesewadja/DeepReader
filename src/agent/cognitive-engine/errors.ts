/**
 * Custom error classes for the Cognitive Engine
 */

/**
 * Error thrown when JSON parsing fails in state output
 */
export class StateParseError extends Error {
  constructor(
    message: string,
    public readonly rawContent: string
  ) {
    super(message);
    this.name = 'StateParseError';
  }
}

/**
 * Error thrown when state execution times out
 */
export class StateTimeoutError extends Error {
  constructor(
    public readonly stateName: string,
    public readonly timeout: number
  ) {
    super(`State ${stateName} timed out after ${timeout}ms`);
    this.name = 'StateTimeoutError';
  }
}

/**
 * Error thrown when state execution fails after retries
 */
export class StateExecutionError extends Error {
  constructor(
    public readonly stateName: string,
    public readonly cause: Error
  ) {
    super(`State ${stateName} failed: ${cause.message}`);
    this.name = 'StateExecutionError';
  }
}