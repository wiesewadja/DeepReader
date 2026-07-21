/**
 * CORS 安全的 HTTP 请求工具
 *
 * Obsidian 插件运行在 Electron 渲染进程中，原生 `fetch()` 受 CORS 限制。
 * 此模块使用 Obsidian 的 `requestUrl()` 绕过 CORS，同时保持统一的调用接口。
 *
 * 策略：
 * 1. 桌面端：通过 Electron webRequest 注入 CORS 响应头，让原生 fetch 对已知不支持 CORS 的服务商也能流式工作
 * 2. 移动端（无 Electron remote）：降级到 requestUrl 非流式请求
 */

import { requestUrl } from 'obsidian';
import { nodeHttps } from './node-compat.js';

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

/** 已知不支持浏览器 CORS 的服务商域名（CORS 预检会拒绝 authorization 头）。这些域名走 Node https 模块绕过 CORS。 */
const NO_CORS_FETCH_HOSTS = [
	'ark.cn-beijing.volces.com', // 火山方舟：预检不允许 authorization 头
];

function shouldSkipNativeFetch(url: string): boolean {
	try {
		const host = new URL(url).host;
		return NO_CORS_FETCH_HOSTS.some(h => host === h || host.endsWith('.' + h));
	} catch {
		return false;
	}
}

/**
 * 用 Node https 模块发起请求，返回标准 Response 对象。
 *
 * 桌面端（Electron 有 Node 集成）：天然绕过浏览器 CORS，支持真正的 SSE 流式。
 * 移动端（Capacitor 无 Node https）：抛异常，由调用方降级到 requestUrl。
 */
function nativeHttpsFetch(url: string, init: RequestInit): Promise<Response> {
	const https = nodeHttps();
	const urlObj = new URL(url);

	const { headers } = extractHeaders(init);

	const options = {
		hostname: urlObj.hostname,
		port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
		path: urlObj.pathname + urlObj.search,
		method: (init.method as string) || 'POST',
		headers: { 'Content-Length': init.body ? Buffer.byteLength(init.body as string) : 0, ...headers },
	};

	return new Promise<Response>((resolve, reject) => {
		const req = https.request(options, (res: any) => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					res.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
					res.on('end', () => controller.close());
					res.on('error', (err: Error) => controller.error(err));
				},
				cancel() {
					res.destroy();
				},
			});

			const respHeaders = new Headers();
			const rawHeaders = res.headers || {};
			for (const [key, value] of Object.entries(rawHeaders)) {
				if (typeof value === 'string') respHeaders.set(key, value);
				else if (Array.isArray(value)) value.forEach(v => respHeaders.append(key, v));
			}

			resolve(new Response(stream, {
				status: res.statusCode || 200,
				statusText: res.statusMessage || 'OK',
				headers: respHeaders,
			}));
		});

		req.on('error', reject);
		if (init.signal?.aborted) { req.destroy(); reject(new DOMException('Aborted', 'AbortError')); return; }
		if (init.body) req.write(init.body);
		req.end();
	});
}

/**
 * CORS 安全的流式 fetch，带降级策略
 *
 * 1. NO_CORS 域名：走 Node https 模块（绕过 CORS，支持 SSE 流式）
 * 2. 普通域名：先尝试原生 fetch，CORS 失败则降级
 * 3. 降级路径：requestUrl 非流式（整个响应打包成单事件）
 */
export async function fetchWithCorsFallback(
	url: string,
	init: RequestInit,
): Promise<Response> {
	// NO_CORS 域名：直接走 Node https（绕过 CORS，保留 SSE 流式）
	if (shouldSkipNativeFetch(url)) {
		try {
			return await nativeHttpsFetch(url, init);
		} catch {
			// Node https 不可用（移动端）或请求失败 → 降级到 requestUrl
		}
	} else {
		// 普通域名：先尝试原生 fetch（支持 CORS 的服务商）
		try {
			return await fetch(url, init);
		} catch (error) {
			if (!isNetworkError(error)) {
				throw error;
			}
		}
	}

	// 降级路径：requestUrl 非流式（整个响应打包）
	const { headers, contentType } = extractHeaders(init);
	const resp = await requestUrl({
		url,
		method: (init.method as string) || 'POST',
		contentType,
		headers,
		body: init.body as string,
		throw: false,
	});

	const isStreamRequest = typeof init.body === 'string' && /"stream"\s*:\s*true/.test(init.body);
	const text = resp.text;

	if (!isStreamRequest) {
		return new Response(text, {
			status: resp.status,
			statusText: resp.status >= 400 ? 'Error' : 'OK',
			headers: new Headers({
				'Content-Type': resp.headers['content-type'] || 'application/json',
				...resp.headers,
			}),
		});
	}

	// 流式：构造 SSE 格式
	const isAlreadySse = /^data:/.test(text) || /\ndata:/.test(text);
	const sseBody = isAlreadySse
		? `${text}${text.endsWith('\n') ? '' : '\n'}data: [DONE]\n\n`
		: `data: ${text}\n\ndata: [DONE]\n\n`;
	return new Response(sseBody, {
		status: resp.status,
		statusText: resp.status >= 400 ? 'Error' : 'OK',
		headers: new Headers({
			'Content-Type': 'text/event-stream',
			...resp.headers,
		}),
	});
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
