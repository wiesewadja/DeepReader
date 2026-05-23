/**
 * Model Fetcher — 从服务商 API 拉取可用模型列表
 *
 * 使用 Obsidian requestUrl（CORS 安全）+ Promise.race（10s 超时）。
 * 按需获取，不使用缓存。
 * 仅对 supportsModelList: true 的服务商调用。
 */

import type { ProviderType } from './providers';
import type { AIProviderAccount } from './ai-roles';
import { PROVIDER_CONFIGS, normalizeBaseUrl, MINIMAX_TTS_MODELS, XIAOMI_TTS_MODELS } from './providers';
import { safeRequest } from '../utils/safe-request.js';

export interface FetchModelsResult {
	success: boolean;
	models: string[];
	error?: string;
}

export interface TestConnectionResult {
	success: boolean;
	latencyMs: number;
	model?: string;
	error?: string;
}

const TIMEOUT_MS = 10_000;

/**
 * 从服务商 API 获取可用模型列表
 *
 * base URL 通过 normalizeBaseUrl 自动规范化（补 /v1），然后请求 /models。
 * 支持按能力维度（capability）筛选：TTS 角色查询 MiniMax 时返回硬编码的 TTS 模型列表。
 */
export async function fetchModels(
	provider: string,
	account: AIProviderAccount,
	capability?: string,
): Promise<FetchModelsResult> {
	// MiniMax TTS 模型列表：/v1/models 不返回非文本模型
	if (provider === 'minimax' && capability === 'tts') {
		return { success: true, models: [...MINIMAX_TTS_MODELS] };
	}

	// Xiaomi TTS 模型列表：预设音色 + VoiceDesign
	if (provider === 'xiaomi' && capability === 'tts') {
		return { success: true, models: [...XIAOMI_TTS_MODELS] };
	}

	const config = PROVIDER_CONFIGS[provider as ProviderType];

	// 固定服务商检查能力，自定义服务商默认支持
	if (config && !config.supportsModelList) {
		return { success: false, models: [], error: '该服务商不支持模型列表查询' };
	}

	if (!account.apiKey) {
		return { success: false, models: [], error: 'API Key 未配置' };
	}

	const rawBaseUrl = account.baseUrl || config?.baseUrl || '';
	if (!rawBaseUrl) {
		return { success: false, models: [], error: 'Base URL 未配置' };
	}

	const baseUrl = normalizeBaseUrl(rawBaseUrl);

	try {
		const response = await Promise.race([
			safeRequest({
				url: `${baseUrl}/models`,
				method: 'GET',
				contentType: 'application/json',
				headers: { Authorization: `Bearer ${account.apiKey}` },
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('请求超时')), TIMEOUT_MS),
			),
		]);

		if (response.status >= 400) {
			return {
				success: false,
				models: [],
				error: `无法获取模型列表（HTTP ${response.status}），请手动填写模型名称`,
			};
		}

		const data = response.json;
		const models: string[] = (data?.data || [])
			.map((m: { id?: string }) => m.id)
			.filter((id: string | undefined): id is string => typeof id === 'string' && id.length > 0)
			.sort();

		if (models.length === 0) {
			return {
				success: false,
				models: [],
				error: 'API 返回了空模型列表，请手动填写模型名称',
			};
		}

		return { success: true, models };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const isTimeout = message.includes('abort') || message.includes('timeout') || message.includes('超时');

		return {
			success: false,
			models: [],
			error: isTimeout ? '请求超时（10秒），请手动填写模型名称' : `${message}，请手动填写模型名称`,
		};
	}
}

/**
 * 测试 API 连接和模型可用性
 *
 * 发送一个最小的 API 请求，验证 base URL、API Key、模型名是否正确。
 * chat 角色测试 /chat/completions，embedding 角色测试 /embeddings，tts 角色测试 /t2a_v2。
 */
export async function testConnection(
	baseUrl: string,
	apiKey: string,
	model: string,
	endpoint: 'chat' | 'embedding' | 'tts' | 'imagegen' = 'chat',
): Promise<TestConnectionResult> {
	if (!apiKey) return { success: false, latencyMs: 0, error: 'API Key 未配置' };
	if (!model) return { success: false, latencyMs: 0, error: '模型名未填写' };

	const normalizedUrl = normalizeBaseUrl(baseUrl || '');

	const t0 = Date.now();
	try {
		let url: string;
		let body: string;

		if (endpoint === 'tts') {
			const isVoiceDesign = model.includes('voicedesign');
			url = `${normalizedUrl}/chat/completions`;
			const audioConfig: Record<string, string> = { format: 'wav' };
			if (!isVoiceDesign) {
				audioConfig.voice = '冰糖';
			}
			body = JSON.stringify({
				model,
				messages: [
					{ role: 'user', content: isVoiceDesign ? '温柔的女声' : '用自然的语气朗读' },
					{ role: 'assistant', content: '你好' },
				],
				audio: audioConfig,
			});
		} else if (endpoint === 'imagegen') {
			url = `${normalizedUrl}/images/generations`;
			body = JSON.stringify({ model, prompt: 'a red circle', n: 1, size: '2048x2048' });
		} else {
			const isEmbedding = endpoint === 'embedding';
			url = `${normalizedUrl}/${isEmbedding ? 'embeddings' : 'chat/completions'}`;
			body = isEmbedding
				? JSON.stringify({ model, input: 'hello' })
				: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 });
		}

		const response = await Promise.race([
			safeRequest({
				url,
				method: 'POST',
				contentType: 'application/json',
				headers: { Authorization: `Bearer ${apiKey}` },
				body,
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('请求超时（15秒）')), 15_000),
			),
		]);

		const latencyMs = Date.now() - t0;

		if (response.status === 401 || response.status === 403) {
			return { success: false, latencyMs, error: 'API Key 无效或无权限' };
		}

		if (response.status === 404) {
			return { success: false, latencyMs, error: `接口不存在，请检查 Base URL（当前: ${normalizedUrl}）` };
		}

		if (response.status >= 400) {
			const data = response.json;
			const msg = data?.base_resp?.status_msg || data?.error?.message || data?.message || response.text?.slice(0, 200) || `HTTP ${response.status}`;
			return { success: false, latencyMs, error: msg };
		}

		const data = response.json as Record<string, unknown>;
		if (endpoint === 'tts') {
			// Xiaomi TTS: 返回 choices[0].message.audio.data
			const choices = data?.choices as Array<Record<string, unknown>> | undefined;
			const audioData = choices?.[0]?.message && (choices[0].message as Record<string, unknown>)?.audio;
			if (audioData) {
				return { success: true, latencyMs, model };
			}
			return { success: false, latencyMs, error: 'TTS 接口未返回音频数据' };
		}
		return {
			success: true,
			latencyMs,
			model: (data as { model?: string })?.model || model,
		};
	} catch (error) {
		const latencyMs = Date.now() - t0;
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, latencyMs, error: message };
	}
}
