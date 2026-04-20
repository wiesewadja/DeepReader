/**
 * CORS 安全的 HTTP 请求工具
 *
 * Obsidian 插件运行在 Electron 渲染进程中，原生 `fetch()` 受 CORS 限制。
 * 此模块使用 Obsidian 的 `requestUrl()` 绕过 CORS，同时保持统一的调用接口。
 *
 * 两种模式：
 * 1. `safeRequest()` — 非流式请求，完全使用 requestUrl()
 * 2. `fetchWithCorsFallback()` — 流式请求，先尝试 fetch()，CORS 失败时降级
 */

import { requestUrl } from 'obsidian';

// ═══════════════════════════════════════════════════════════════
// 非流式请求
// ═══════════════════════════════════════════════════════════════

export interface SafeRequestOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	contentType?: string;
	/** 是否在 HTTP 错误时抛出异常（默认 false，由调用方处理） */
	throw?: boolean;
}

export interface SafeResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	json: any;
}

/**
 * CORS 安全的非流式 HTTP 请求
 *
 * 内部使用 Obsidian `requestUrl()`，通过 Electron 主进程发送请求，
 * 完全绕过浏览器的 CORS 限制。
 */
export async function safeRequest(options: SafeRequestOptions): Promise<SafeResponse> {
	const response = await requestUrl({
		url: options.url,
		method: options.method || 'GET',
		contentType: options.contentType,
		headers: options.headers,
		body: options.body,
		throw: options.throw ?? false,
	});

	return {
		status: response.status,
		headers: response.headers,
		text: response.text,
		json: response.json,
	};
}

// ═══════════════════════════════════════════════════════════════
// 流式请求（带 CORS 降级）
// ═══════════════════════════════════════════════════════════════

/**
 * 检测错误是否为 CORS 相关
 */
function isCorsError(error: unknown): boolean {
	if (error instanceof TypeError) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes('cors') ||
			msg.includes('network request failed') ||
			msg.includes('failed to fetch') ||
			msg.includes('networkerror')
		);
	}
	return false;
}

/**
 * CORS 安全的流式 fetch，带降级策略
 *
 * 1. 先尝试原生 `fetch()`（支持 SSE 流式响应）
 * 2. 如果遇到 CORS 错误，降级为 `requestUrl()` 非流式请求
 *    构造一个兼容的 Response 对象，body 为完整响应
 *
 * @returns Response 对象（流式时是真正的流，降级时是包装的完整响应）
 */
export async function fetchWithCorsFallback(
	url: string,
	init: RequestInit,
): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (error) {
		if (!isCorsError(error)) {
			throw error;
		}

		// CORS 失败，降级为 requestUrl 非流式
		const body = init.body as string;
		const headers: Record<string, string> = {};
		if (init.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((v, k) => { headers[k] = v; });
			} else if (Array.isArray(init.headers)) {
				for (const [k, v] of init.headers) { headers[k] = v; }
			} else {
				Object.assign(headers, init.headers);
			}
		}

		// 提取 Content-Type
		let contentType: string | undefined;
		if (headers['Content-Type']) {
			contentType = headers['Content-Type'];
			delete headers['Content-Type'];
		}

		const resp = await requestUrl({
			url,
			method: (init.method as string) || 'POST',
			contentType,
			headers,
			body,
			throw: false,
		});

		// 构造 SSE 格式的 Response，让下游流式解析器正常工作
		// requestUrl 返回完整 JSON，模拟 OpenAI SSE 格式：
		//   data: {"id":"...","choices":[{"delta":{"content":"完整内容"},"finish_reason":"stop"}]}
		//   data: [DONE]
		const sseBody = `data: ${resp.text}\n\ndata: [DONE]\n\n`;
		return new Response(sseBody, {
			status: resp.status,
			statusText: resp.status >= 400 ? 'Error' : 'OK',
			headers: new Headers({
				'Content-Type': 'text/event-stream',
				...resp.headers,
			}),
		});
	}
}

/**
 * 为 LangChain/OpenAI SDK 创建 CORS 安全的 fetch 函数
 *
 * OpenAI SDK 支持注入自定义 fetch 函数，此函数在 CORS 失败时
 * 用 requestUrl 构造兼容的 Response 对象。
 */
export function createCorsSafeFetch(): (url: RequestInfo, init?: RequestInit) => Promise<Response> {
	return async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
		return fetchWithCorsFallback(url.toString(), init || {});
	};
}
