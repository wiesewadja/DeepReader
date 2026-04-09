/**
 * Tool 基类 - 提供参数验证和错误处理
 *
 * 参考 nanobot 的设计模式：
 * - 参数类型转换 (castParams)
 * - JSON Schema 验证 (validateParams)
 * - 错误消息附加提示
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';

/**
 * 工具参数的 JSON Schema 属性定义
 */
export interface ParameterSchema {
	type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
	description?: string;
	enum?: string[];
	default?: unknown;
	items?: ParameterSchema;
	properties?: Record<string, ParameterSchema>;
	required?: string[];
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
}

/**
 * 工具元数据
 */
export interface ToolMeta {
	/** 工具名称 */
	name: string;
	/** 工具描述 */
	description: string;
	/** 参数定义 */
	parameters: Record<string, ParameterSchema>;
	/** 必需参数列表 */
	required?: string[];
}

/**
 * 参数验证错误
 */
export interface ValidationError {
	/** 参数名 */
	param: string;
	/** 错误消息 */
	message: string;
}

/**
 * 工具抽象基类
 *
 * 使用方式：
 * ```typescript
 * class MyTool extends BaseTool {
 *   name = 'my_tool';
 *   description = '我的工具';
 *   parameters = {
 *     query: { type: 'string', description: '查询字符串' }
 *   };
 *   required = ['query'];
 *
 *   async execute(args: { query: string }, context: ToolContext): Promise<string> {
 *     return `查询结果: ${args.query}`;
 *   }
 * }
 * ```
 */
export abstract class BaseTool implements ToolExecutor {
	/** 工具名称（必须由子类实现） */
	abstract readonly name: string;

	/** 工具描述（必须由子类实现） */
	abstract readonly description: string;

	/** 参数定义（必须由子类实现） */
	abstract readonly parameters: Record<string, ParameterSchema>;

	/** 必需参数列表 */
	readonly required?: string[];

	/** 错误提示后缀 */
	protected readonly errorHint = '\n\n[分析上面的错误，尝试不同的方法。]';

	/**
	 * 获取工具定义（用于 LLM 工具列表）
	 */
	get definition(): ToolDefinition {
		return {
			type: 'function',
			function: {
				name: this.name,
				description: this.description,
				parameters: {
					type: 'object',
					properties: this.parameters,
					required: this.required || [],
				},
			},
		};
	}

	/**
	 * 执行工具（带参数验证和错误处理）
	 *
	 * 注意：这是 ToolExecutor 接口的实现，内部调用 validateAndExecute
	 */
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		return this.validateAndExecute(args, context);
	}

	/**
	 * 验证参数并执行
	 *
	 * 子类应该实现 `run` 方法而不是直接重写此方法
	 */
	protected async validateAndExecute(
		args: Record<string, unknown>,
		context: ToolContext
	): Promise<string> {
		// 1. 参数类型转换
		const castedArgs = this.castParams(args);

		// 2. 参数验证
		const errors = this.validateParams(castedArgs);
		if (errors.length > 0) {
			const errorMessages = errors.map((e) => `  - ${e.param}: ${e.message}`).join('\n');
			return `参数验证失败:\n${errorMessages}${this.errorHint}`;
		}

		// 3. 检查必需参数
		const missingRequired = this.checkRequiredParams(castedArgs);
		if (missingRequired.length > 0) {
			return `缺少必需参数: ${missingRequired.join(', ')}${this.errorHint}`;
		}

		// 4. 执行工具
		try {
			const result = await this.run(castedArgs, context);

			// 如果结果以 Error 开头，附加提示
			if (typeof result === 'string' && result.startsWith('Error')) {
				return result + this.errorHint;
			}

			return result;
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			return `执行工具 ${this.name} 失败: ${errorMsg}${this.errorHint}`;
		}
	}

	/**
	 * 实际执行逻辑（子类实现）
	 */
	protected abstract run(
		args: Record<string, unknown>,
		context: ToolContext
	): Promise<string>;

	/**
	 * 参数类型转换
	 *
	 * 将字符串参数转换为正确的类型（例如 URL 参数中的数字）
	 */
	protected castParams(params: Record<string, unknown>): Record<string, unknown> {
		const result: Record<string, unknown> = { ...params };

		for (const [key, schema] of Object.entries(this.parameters)) {
			const value = result[key];

			// 跳过未定义的参数
			if (value === undefined || value === null) {
				continue;
			}

			// 应用默认值
			if (value === '' && schema.default !== undefined) {
				result[key] = schema.default;
				continue;
			}

			// 类型转换
			switch (schema.type) {
				case 'integer':
					if (typeof value === 'string') {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed)) {
							result[key] = parsed;
						}
					} else if (typeof value === 'number') {
						result[key] = Math.round(value);
					}
					break;

				case 'number':
					if (typeof value === 'string') {
						const parsed = parseFloat(value);
						if (!isNaN(parsed)) {
							result[key] = parsed;
						}
					}
					break;

				case 'boolean':
					if (typeof value === 'string') {
						if (value.toLowerCase() === 'true') {
							result[key] = true;
						} else if (value.toLowerCase() === 'false') {
							result[key] = false;
						}
					}
					break;

				case 'string':
					// 确保字符串类型
					if (typeof value !== 'string') {
						result[key] = String(value);
					}
					break;
			}
		}

		return result;
	}

	/**
	 * 验证参数
	 *
	 * 根据 JSON Schema 验证参数值
	 */
	protected validateParams(params: Record<string, unknown>): ValidationError[] {
		const errors: ValidationError[] = [];

		for (const [key, schema] of Object.entries(this.parameters)) {
			const value = params[key];

			// 跳过未定义的可选参数
			if (value === undefined || value === null) {
				continue;
			}

			// 类型验证
			const typeError = this.validateType(key, value, schema);
			if (typeError) {
				errors.push(typeError);
				continue; // 类型错误时跳过后续验证
			}

			// 枚举验证
			if (schema.enum && !schema.enum.includes(value as string)) {
				errors.push({
					param: key,
					message: `值必须是以下之一: ${schema.enum.join(', ')}`,
				});
			}

			// 数值范围验证
			if (schema.type === 'number' || schema.type === 'integer') {
				const numValue = value as number;

				if (schema.minimum !== undefined && numValue < schema.minimum) {
					errors.push({
						param: key,
						message: `值不能小于 ${schema.minimum}`,
					});
				}

				if (schema.maximum !== undefined && numValue > schema.maximum) {
					errors.push({
						param: key,
						message: `值不能大于 ${schema.maximum}`,
					});
				}
			}

			// 字符串长度验证
			if (schema.type === 'string') {
				const strValue = value as string;

				if (schema.minLength !== undefined && strValue.length < schema.minLength) {
					errors.push({
						param: key,
						message: `长度不能少于 ${schema.minLength} 个字符`,
					});
				}

				if (schema.maxLength !== undefined && strValue.length > schema.maxLength) {
					errors.push({
						param: key,
						message: `长度不能超过 ${schema.maxLength} 个字符`,
					});
				}

				// 正则验证
				if (schema.pattern) {
					const regex = new RegExp(schema.pattern);
					if (!regex.test(strValue)) {
						errors.push({
							param: key,
							message: `格式不正确，需要匹配: ${schema.pattern}`,
						});
					}
				}
			}
		}

		return errors;
	}

	/**
	 * 验证参数类型
	 */
	private validateType(key: string, value: unknown, schema: ParameterSchema): ValidationError | null {
		const actualType = Array.isArray(value) ? 'array' : typeof value;

		// 类型映射
		const typeMap: Record<string, string[]> = {
			string: ['string'],
			number: ['number'],
			integer: ['number'],
			boolean: ['boolean'],
			array: ['object'], // Array 的 typeof 是 'object'
			object: ['object'],
		};

		const expectedTypes = typeMap[schema.type] || [];

		// 特殊处理数组
		if (schema.type === 'array') {
			if (!Array.isArray(value)) {
				return {
					param: key,
					message: `期望类型为数组，实际为 ${actualType}`,
				};
			}
			return null;
		}

		// 特殊处理整数
		if (schema.type === 'integer') {
			if (typeof value !== 'number' || !Number.isInteger(value)) {
				return {
					param: key,
					message: `期望类型为整数，实际为 ${actualType}`,
				};
			}
			return null;
		}

		// 特殊处理对象
		if (schema.type === 'object') {
			if (typeof value !== 'object' || Array.isArray(value)) {
				return {
					param: key,
					message: `期望类型为对象，实际为 ${actualType}`,
				};
			}
			return null;
		}

		// 通用类型检查
		if (!expectedTypes.includes(actualType)) {
			return {
				param: key,
				message: `期望类型为 ${schema.type}，实际为 ${actualType}`,
			};
		}

		return null;
	}

	/**
	 * 检查必需参数
	 */
	protected checkRequiredParams(params: Record<string, unknown>): string[] {
		const missing: string[] = [];

		for (const key of this.required || []) {
			if (params[key] === undefined || params[key] === null || params[key] === '') {
				missing.push(key);
			}
		}

		return missing;
	}
}

/**
 * 简单工具创建器
 *
 * 用于快速创建不需要复杂验证的工具
 */
export function createSimpleTool(
	name: string,
	description: string,
	parameters: Record<string, ParameterSchema>,
	execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>,
	required?: string[]
): ToolExecutor {
	return {
		definition: {
			type: 'function',
			function: {
				name,
				description,
				parameters: {
					type: 'object',
					properties: parameters,
					required: required || [],
				},
			},
		},
		execute,
	};
}
