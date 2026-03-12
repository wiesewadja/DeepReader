/**
 * Result 类型 - 函数式错误处理
 *
 * 参考 Rust 的 Result<T, E> 设计，提供类型安全的错误处理
 */

/**
 * 成功结果
 */
export interface Ok<T> {
	readonly ok: true;
	readonly value: T;
}

/**
 * 失败结果
 */
export interface Err<E> {
	readonly ok: false;
	readonly error: E;
}

/**
 * Result 类型 - 成功或失败
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * 创建成功结果
 */
export function Ok<T>(value: T): Ok<T> {
	return { ok: true, value };
}

/**
 * 创建失败结果
 */
export function Err<E>(error: E): Err<E> {
	return { ok: false, error };
}

/**
 * 从可能抛出异常的函数创建 Result
 */
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
	try {
		const value = await promise;
		return Ok(value);
	} catch (e) {
		return Err(e instanceof Error ? e : new Error(String(e)));
	}
}

/**
 * 从可能抛出异常的同步函数创建 Result
 */
export function fromTry<T>(fn: () => T): Result<T, Error> {
	try {
		return Ok(fn());
	} catch (e) {
		return Err(e instanceof Error ? e : new Error(String(e)));
	}
}

/**
 * Result 辅助方法
 */
export namespace Result {
	/**
	 * 检查是否为成功结果
	 */
	export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
		return result.ok === true;
	}

	/**
	 * 检查是否为失败结果
	 */
	export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
		return result.ok === false;
	}

	/**
	 * 映射成功值
	 */
	export function map<T, U, E>(
		result: Result<T, E>,
		fn: (value: T) => U
	): Result<U, E> {
		if (result.ok) {
			return Ok(fn(result.value));
		}
		return result;
	}

	/**
	 * 映射错误
	 */
	export function mapErr<T, E, F>(
		result: Result<T, E>,
		fn: (error: E) => F
	): Result<T, F> {
		if (!result.ok) {
			return Err(fn(result.error));
		}
		return result as Result<T, F>;
	}

	/**
	 * 链式调用（flatMap）
	 */
	export function andThen<T, U, E>(
		result: Result<T, E>,
		fn: (value: T) => Result<U, E>
	): Result<U, E> {
		if (result.ok) {
			return fn(result.value);
		}
		return result;
	}

	/**
	 * 获取值或默认值
	 */
	export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
		if (result.ok) {
			return result.value;
		}
		return defaultValue;
	}

	/**
	 * 获取值或抛出错误
	 */
	export function unwrap<T, E>(result: Result<T, E>): T {
		if (result.ok) {
			return result.value;
		}
		throw result.error;
	}

	/**
	 * 获取值或使用默认函数
	 */
	export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
		if (result.ok) {
			return result.value;
		}
		return fn(result.error);
	}

	/**
	 * 转换为字符串（用于工具返回）
	 */
	export function toString<T, E extends { message?: string }>(
		result: Result<T, E>,
		errorHint?: string
	): string {
		if (result.ok) {
			return String(result.value);
		}
		const errorMsg = result.error.message || String(result.error);
		const hint = errorHint || '\n\n[分析上面的错误，尝试不同的方法。]';
		return `Error: ${errorMsg}${hint}`;
	}
}

/**
 * 工具执行结果
 */
export type ToolResult = Result<string, ToolError>;

/**
 * 工具错误类型
 */
export class ToolError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'ToolError';
	}

	/**
	 * 参数缺失错误
	 */
	static missingParam(paramName: string): ToolError {
		return new ToolError(`缺少必需参数: ${paramName}`, 'MISSING_PARAM');
	}

	/**
	 * 参数类型错误
	 */
	static invalidParam(paramName: string, expected: string, actual: string): ToolError {
		return new ToolError(
			`参数 "${paramName}" 类型错误: 期望 ${expected}, 实际 ${actual}`,
			'INVALID_PARAM_TYPE'
		);
	}

	/**
	 * 参数值错误
	 */
	static invalidValue(paramName: string, reason: string): ToolError {
		return new ToolError(`参数 "${paramName}" 值无效: ${reason}`, 'INVALID_VALUE');
	}

	/**
	 * 执行失败错误
	 */
	static executionFailed(toolName: string, cause: unknown): ToolError {
		return new ToolError(
			`工具 "${toolName}" 执行失败`,
			'EXECUTION_FAILED',
			cause
		);
	}

	/**
	 * 超时错误
	 */
	static timeout(toolName: string, timeoutMs: number): ToolError {
		return new ToolError(
			`工具 "${toolName}" 执行超时 (${timeoutMs}ms)`,
			'TIMEOUT'
		);
	}

	/**
	 * 上下文缺失错误
	 */
	static missingContext(requiredContext: string): ToolError {
		return new ToolError(
			`缺少必要的上下文: ${requiredContext}`,
			'MISSING_CONTEXT'
		);
	}
}
