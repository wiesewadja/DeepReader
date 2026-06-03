/**
 * CORS 安全的 HTTP 请求工具
 *
 * Obsidian 插件运行在 Electron 渲染进程中，原生 `fetch()` 受 CORS 限制。
 * 此模块使用 Obsidian 的 `requestUrl()` 绕过 CORS，同时保持统一的调用接口。
 *
 * 策略：在 Obsidian 环境中，先用原生 fetch 尝试流式请求，
 * 任何网络错误（包括但不限于 CORS）都降级到 requestUrl 非流式请求。
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
	arrayBuffer?: ArrayBuffer;
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

	let json: any = undefined;
	try {
		json = response.json;
	} catch {
		// binary responses (images etc.) cannot be parsed as JSON
	}

	return {
		status: response.status,
		headers: response.headers,
		text: response.text,
		json,
		arrayBuffer: response.arrayBuffer,
	};
}

// ═══════════════════════════════════════════════════════════════
// 流式请求（带 CORS 降级）
// ═══════════════════════════════════════════════════════════════

/**
 * 检测错误是否为网络/CORS 错误（应降级到 requestUrl）
 *
 * fetch 在网络层失败时（DNS、CORS、连接拒绝等）统一抛 TypeError。
 * 某些 Electron 版本也可能抛 DOMException。
 */
function isNetworkError(error: unknown): boolean {
	// CORS / 网络不可达 / DNS 失败等都是 TypeError
	if (error instanceof TypeError) {
		return true;
	}
	// DOMException（某些 Electron 版本的 CORS 错误）
	if (error instanceof DOMException) {
		const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
		return msg.includes('cors') || msg.includes('blocked') || msg.includes('network');
	}
	// 兜底：检查 message
	if (error instanceof Error) {
		const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
		return msg.includes('cors') || msg.includes('blocked') || msg.includes('network');
	}
	return false;
}

/**
 * 提取 RequestInit 中的 headers 为普通对象，分离 Content-Type
 */
function extractHeaders(init: RequestInit): {
	headers: Record<string, string>;
	contentType: string | undefined;
} {
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

	let contentType: string | undefined;
	if (headers['Content-Type']) {
		contentType = headers['Content-Type'];
		delete headers['Content-Type'];
	}

	return { headers, contentType };
}

/**
 * CORS 安全的流式 fetch，带降级策略
 *
 * 1. 先尝试原生 `fetch()`（支持 SSE 流式响应）
 * 2. 如果遇到网络/CORS 错误，降级为 `requestUrl()` 非流式请求
 *    构造一个兼容的 Response 对象，body 为完整响应
 */
export async function fetchWithCorsFallback(
	url: string,
	init: RequestInit,
): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (error) {
		if (!isNetworkError(error)) {
			throw error;
		}

		// 网络/CORS 错误，降级为 requestUrl 非流式
		const { headers, contentType } = extractHeaders(init);

		const resp = await requestUrl({
			url,
			method: (init.method as string) || 'POST',
			contentType,
			headers,
			body: init.body as string,
			throw: false,
		});

		// 构造 SSE 格式的 Response，让下游流式解析器正常工作
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
 * 剥离 `x-stainless-*` 头：OpenAI SDK v6+ 自动注入这些遥测头，
 * 但部分供应商（如 MiniMax）的 CORS 配置未允许它们，导致预检失败。
 * 这些头不影响 API 功能，剥离后即可避免 CORS 问题。
 */
export function createCorsSafeFetch(): (url: RequestInfo, init?: RequestInit) => Promise<Response> {
	return async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
		const cleanedInit = init ? { ...init } : {};
		if (cleanedInit.headers) {
			if (cleanedInit.headers instanceof Headers) {
				const cleaned = new Headers();
				cleanedInit.headers.forEach((v, k) => {
					if (!k.toLowerCase().startsWith('x-stainless-')) {
						cleaned.set(k, v);
					}
				});
				cleanedInit.headers = cleaned;
			} else if (Array.isArray(cleanedInit.headers)) {
				cleanedInit.headers = (cleanedInit.headers as [string, string][]).filter(
					([k]) => !k.toLowerCase().startsWith('x-stainless-')
				);
			} else {
				const record: Record<string, string> = {};
				for (const [k, v] of Object.entries(cleanedInit.headers)) {
					if (!k.toLowerCase().startsWith('x-stainless-')) {
						record[k] = v;
					}
				}
				cleanedInit.headers = record;
			}
		}
		return fetchWithCorsFallback(url.toString(), cleanedInit);
	};
}
