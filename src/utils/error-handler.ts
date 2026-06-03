/**
 * DeepPDF 错误处理工具
 * 提供全局错误处理、用户友好的错误消息和错误日志功能
 */

import { Notice } from 'obsidian';
import { warn } from './logger.js';

// ==================== 错误类型定义 ====================

/**
 * 错误严重程度
 */
export enum ErrorSeverity {
	/** 信息性提示 */
	INFO = 'info',
	/** 警告 */
	WARNING = 'warning',
	/** 错误 */
	ERROR = 'error',
	/** 致命错误 */
	FATAL = 'fatal'
}

/**
 * 错误类别
 */
export enum ErrorCategory {
	/** 网络错误 */
	NETWORK = 'network',
	/** API 错误 */
	API = 'api',
	/** 验证错误 */
	VALIDATION = 'validation',
	/** 文件处理错误 */
	FILE = 'file',
	/** 未知错误 */
	UNKNOWN = 'unknown'
}

/**
 * DeepPDF 自定义错误类
 */
export class DeepPDFError extends Error {
	public readonly category: ErrorCategory;
	public readonly severity: ErrorSeverity;
	public readonly userMessage: string;
	public readonly originalError?: Error;
	public readonly context?: Record<string, unknown>;

	constructor(
		message: string,
		category: ErrorCategory = ErrorCategory.UNKNOWN,
		severity: ErrorSeverity = ErrorSeverity.ERROR,
		userMessage?: string,
		originalError?: Error,
		context?: Record<string, unknown>
	) {
		super(message);
		this.name = 'DeepPDFError';
		this.category = category;
		this.severity = severity;
		this.userMessage = userMessage || this.getDefaultUserMessage(category, message);
		this.originalError = originalError;
		this.context = context;

		// 维护正确的堆栈跟踪（仅在 V8 引擎中可用）
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, DeepPDFError);
		}
	}

	private getDefaultUserMessage(category: ErrorCategory, message: string): string {
		switch (category) {
			case ErrorCategory.NETWORK:
				return '网络连接失败，请检查服务器是否运行';
			case ErrorCategory.API:
				return '服务器请求失败，请稍后重试';
			case ErrorCategory.VALIDATION:
				return '输入数据有误，请检查后重试';
			case ErrorCategory.FILE:
				return '文件处理失败，请检查文件格式';
			default:
				return '操作失败，请稍后重试';
		}
	}

	/**
	 * 获取完整错误信息（用于日志）
	 */
	getFullErrorInfo(): string {
		const parts = [
			`[${this.severity.toUpperCase()}]`,
			`[${this.category}]`,
			this.message
		];

		if (this.originalError) {
			parts.push(`\n原始错误: ${this.originalError.message}`);
		}

		if (this.context) {
			parts.push(`\n上下文: ${JSON.stringify(this.context, null, 2)}`);
		}

		return parts.join(' ');
	}
}

// ==================== 错误处理器类 ====================

/**
 * 错误处理配置选项
 */
export interface ErrorHandlerOptions {
	/** 是否显示用户通知 */
	showNotice?: boolean;
	/** 是否记录控制台日志 */
	logToConsole?: boolean;
	/** 通知持续时间（毫秒），0 表示使用默认值 */
	noticeTimeout?: number;
	/** 自定义错误消息处理函数 */
	customMessageHandler?: (error: DeepPDFError) => string;
}

/**
 * 全局错误处理器
 */
export class ErrorHandler {
	private static instance: ErrorHandler;
	private options: ErrorHandlerOptions;
	private errorCounts: Map<string, number> = new Map();
	private lastErrorTime: Map<string, number> = new Map();

	private constructor(options: ErrorHandlerOptions = {}) {
		this.options = {
			showNotice: true,
			logToConsole: true,
			...options
		};
	}

	/**
	 * 获取单例实例
	 */
	static getInstance(options?: ErrorHandlerOptions): ErrorHandler {
		if (!ErrorHandler.instance) {
			ErrorHandler.instance = new ErrorHandler(options);
		}
		return ErrorHandler.instance;
	}

	/**
	 * 更新配置选项
	 */
	updateOptions(options: Partial<ErrorHandlerOptions>): void {
		this.options = { ...this.options, ...options };
	}

	/**
	 * 处理错误
	 */
	handle(error: Error | DeepPDFError | unknown, customOptions?: ErrorHandlerOptions): void {
		const deepPdfError = this.normalizeError(error);
		const options = { ...this.options, ...customOptions };

		// 记录错误统计
		this.trackError(deepPdfError);

		// 控制台日志
		if (options.logToConsole) {
			this.logError(deepPdfError);
		}

		// 用户通知
		if (options.showNotice) {
			this.showUserNotice(deepPdfError, options);
		}

		// 检查是否为致命错误
		if (deepPdfError.severity === ErrorSeverity.FATAL) {
			this.handleFatalError(deepPdfError);
		}
	}

	/**
	 * 处理网络错误
	 */
	handleNetworkError(error: Error, context?: Record<string, unknown>): void {
		const deepPdfError = new DeepPDFError(
			`网络请求失败: ${(error instanceof Error ? error.message : String(error))}`,
			ErrorCategory.NETWORK,
			ErrorSeverity.ERROR,
			'网络连接失败，请检查服务器是否运行',
			error,
			context
		);
		this.handle(deepPdfError);
	}

	/**
	 * 处理 API 错误
	 */
	handleAPIError(statusCode: number, message: string, context?: Record<string, unknown>): void {
		let userMessage = '服务器请求失败';

		// 根据状态码提供更具体的错误消息
		switch (statusCode) {
			case 400:
				userMessage = '请求参数有误，请检查输入';
				break;
			case 401:
				userMessage = '未授权访问，请检查配置';
				break;
			case 404:
				userMessage = '请求的资源不存在';
				break;
			case 500:
				userMessage = '服务器内部错误，请稍后重试';
				break;
			case 503:
				userMessage = '服务暂时不可用，请稍后重试';
				break;
		}

		const deepPdfError = new DeepPDFError(
			`API 错误 [${statusCode}]: ${message}`,
			ErrorCategory.API,
			ErrorSeverity.ERROR,
			userMessage,
			undefined,
			{ ...context, statusCode }
		);
		this.handle(deepPdfError);
	}

	/**
	 * 处理验证错误
	 */
	handleValidationError(message: string, context?: Record<string, unknown>): void {
		const deepPdfError = new DeepPDFError(
			`验证失败: ${message}`,
			ErrorCategory.VALIDATION,
			ErrorSeverity.WARNING,
			message || '输入数据有误，请检查后重试',
			undefined,
			context
		);
		this.handle(deepPdfError);
	}

	/**
	 * 处理文件错误
	 */
	handleFileError(error: Error, fileName?: string, context?: Record<string, unknown>): void {
		const userMessage = fileName
			? `文件 "${fileName}" 处理失败`
			: '文件处理失败';

		const deepPdfError = new DeepPDFError(
			`文件错误: ${(error instanceof Error ? error.message : String(error))}`,
			ErrorCategory.FILE,
			ErrorSeverity.ERROR,
			userMessage,
			error,
			{ ...context, fileName }
		);
		this.handle(deepPdfError);
	}

	/**
	 * 标准化错误对象
	 */
	private normalizeError(error: Error | DeepPDFError | unknown): DeepPDFError {
		if (error instanceof DeepPDFError) {
			return error;
		}

		if (error instanceof Error) {
			// 尝试根据错误消息判断错误类别
			let category = ErrorCategory.UNKNOWN;
			const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

			if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
				category = ErrorCategory.NETWORK;
			} else if (message.includes('api') || message.includes('http')) {
				category = ErrorCategory.API;
			} else if (message.includes('file') || message.includes('upload')) {
				category = ErrorCategory.FILE;
			}

			return new DeepPDFError(
				(error instanceof Error ? error.message : String(error)),
				category,
				ErrorSeverity.ERROR,
				undefined,
				error
			);
		}

		// 处理未知错误类型
		return new DeepPDFError(
			String(error),
			ErrorCategory.UNKNOWN,
			ErrorSeverity.ERROR
		);
	}

	/**
	 * 记录错误到控制台
	 */
	private logError(error: DeepPDFError): void {
		const timestamp = new Date().toISOString();

		switch (error.severity) {
			case ErrorSeverity.INFO:
			case ErrorSeverity.WARNING:
				warn(`[${timestamp}]`, error.getFullErrorInfo());
				break;
			case ErrorSeverity.ERROR:
			case ErrorSeverity.FATAL:
				console.error(`[${timestamp}]`, error.getFullErrorInfo());
				break;
		}
	}

	/**
	 * 显示用户通知
	 */
	private showUserNotice(error: DeepPDFError, options: ErrorHandlerOptions): void {
		let message = error.userMessage;

		// 允许自定义消息处理
		if (options.customMessageHandler) {
			message = options.customMessageHandler(error);
		}

		// 根据严重程度显示不同时长的通知
		const timeout = options.noticeTimeout || this.getDefaultTimeout(error.severity);

		new Notice(message, timeout);
	}

	/**
	 * 获取默认通知时长
	 */
	private getDefaultTimeout(severity: ErrorSeverity): number {
		switch (severity) {
			case ErrorSeverity.INFO:
				return 3000;
			case ErrorSeverity.WARNING:
				return 5000;
			case ErrorSeverity.ERROR:
			case ErrorSeverity.FATAL:
				return 8000;
			default:
				return 5000;
		}
	}

	/**
	 * 跟踪错误频率
	 */
	private trackError(error: DeepPDFError): void {
		const key = `${error.category}:${(error instanceof Error ? error.message : String(error))}`;
		const now = Date.now();

		// 重置计数（如果超过5分钟）
		const lastTime = this.lastErrorTime.get(key);
		if (lastTime && now - lastTime > 5 * 60 * 1000) {
			this.errorCounts.delete(key);
		}

		const count = (this.errorCounts.get(key) || 0) + 1;
		this.errorCounts.set(key, count);
		this.lastErrorTime.set(key, now);

		// 如果同一错误频繁发生，升级严重程度
		if (count >= 5 && error.severity !== ErrorSeverity.FATAL) {
			warn(`[DeepPDF] 错误频繁发生 (${count}次): ${key}`);
		}
	}

	/**
	 * 处理致命错误
	 */
	private handleFatalError(error: DeepPDFError): void {
		console.error('[DeepPDF] 致命错误:', error.getFullErrorInfo());
		// 可以在这里添加更多的致命错误处理逻辑，比如清理资源、禁用插件等
	}

	/**
	 * 清除错误统计
	 */
	clearErrorStats(): void {
		this.errorCounts.clear();
		this.lastErrorTime.clear();
	}

	/**
	 * 获取错误统计
	 */
	getErrorStats(): Map<string, { count: number; lastTime: number }> {
		const stats = new Map<string, { count: number; lastTime: number }>();

		this.errorCounts.forEach((count, key) => {
			const lastTime = this.lastErrorTime.get(key) || 0;
			stats.set(key, { count, lastTime });
		});

		return stats;
	}
}

// ==================== 便捷函数 ====================

/**
 * 获取全局错误处理器实例
 */
export const errorHandler = ErrorHandler.getInstance();

/**
 * 处理错误的便捷函数
 */
export function handleError(error: Error | DeepPDFError | unknown, options?: ErrorHandlerOptions): void {
	errorHandler.handle(error, options);
}

/**
 * 处理网络错误的便捷函数
 */
export function handleNetworkError(error: Error, context?: Record<string, unknown>): void {
	errorHandler.handleNetworkError(error, context);
}

/**
 * 处理 API 错误的便捷函数
 */
export function handleAPIError(statusCode: number, message: string, context?: Record<string, unknown>): void {
	errorHandler.handleAPIError(statusCode, message, context);
}

/**
 * 处理验证错误的便捷函数
 */
export function handleValidationError(message: string, context?: Record<string, unknown>): void {
	errorHandler.handleValidationError(message, context);
}

/**
 * 处理文件错误的便捷函数
 */
export function handleFileError(error: Error, fileName?: string, context?: Record<string, unknown>): void {
	errorHandler.handleFileError(error, fileName, context);
}

/**
 * 包装异步函数以自动处理错误
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
	fn: T,
	options?: ErrorHandlerOptions
): T {
	return (async (...args: Parameters<T>) => {
		try {
			return await fn(...args);
		} catch (error) {
			errorHandler.handle(error, options);
			throw error; // 重新抛出错误以便调用者处理
		}
	}) as T;
}

/**
 * 安全执行异步函数，返回错误而不是抛出
 */
export async function safeAsync<T>(
	fn: () => Promise<T>,
	defaultValue: T,
	options?: ErrorHandlerOptions
): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		errorHandler.handle(error, options);
		return defaultValue;
	}
}
