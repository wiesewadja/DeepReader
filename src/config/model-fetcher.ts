/**
 * Model Fetcher — 从服务商 API 拉取可用模型列表
 *
 * 使用浏览器原生 fetch + AbortController（10s 超时）。
 * 按需获取，不使用缓存。
 * 仅对 supportsModelList: true 的服务商调用。
 */

import type { ProviderType } from './providers';
import type { AIProviderAccount } from './ai-roles';
import { PROVIDER_CONFIGS } from './providers';

export interface FetchModelsResult {
	success: boolean;
	models: string[];
	error?: string;
}

const TIMEOUT_MS = 10_000;

/**
 * 从服务商 API 获取可用模型列表
 *
 * @param provider 服务商类型
 * @param account  服务商账号（apiKey 必须）
 * @returns FetchModelsResult
 */
export async function fetchModels(
	provider: string,
	account: AIProviderAccount,
): Promise<FetchModelsResult> {
	const config = PROVIDER_CONFIGS[provider as ProviderType];

	// 固定服务商检查能力，自定义服务商默认支持
	if (config && !config.supportsModelList) {
		return { success: false, models: [], error: '该服务商不支持模型列表查询' };
	}

	if (!account.apiKey) {
		return { success: false, models: [], error: 'API Key 未配置' };
	}

	const baseUrl = account.baseUrl || config?.baseUrl || '';
	const url = `${baseUrl}/models`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${account.apiKey}`,
				'Content-Type': 'application/json',
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			return {
				success: false,
				models: [],
				error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
			};
		}

		const data = await response.json();

		// OpenAI 兼容格式: { data: [{ id: "model-name", ... }] }
		const models: string[] = (data?.data || [])
			.map((m: { id?: string }) => m.id)
			.filter((id: string | undefined): id is string => typeof id === 'string' && id.length > 0)
			.sort();

		if (models.length === 0) {
			return {
				success: false,
				models: [],
				error: 'API 返回了空模型列表',
			};
		}

		return { success: true, models };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const isTimeout = message.includes('abort') || message.includes('timeout');

		return {
			success: false,
			models: [],
			error: isTimeout ? '请求超时（10秒）' : message,
		};
	}
}
