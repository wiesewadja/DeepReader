/**
 * 火山方舟豆包 TTS 客户端（Agent Plan · HTTP 端点）
 *
 * 实测可用配置（见 spec/volc-tts-adapter.md）：
 *   POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional
 *   Header: X-Api-Key: <ark key>, X-Api-Resource-Id: seed-tts-2.0
 *   Body:   { user:{uid}, namespace:"BidirectionalTTS",
 *             req_params:{ text, speaker, audio_params:{format,sample_rate,speech_rate} } }
 *   Resp:   { code:0, message:"", data:"<base64 mp3>" }
 *
 * ark key（Agent Plan）可直接用于此端点，无需火山语音 console 的 app_id/access_token。
 * 后续优化：接 WebSocket 双向流式（wss://...bidirection）做边生成边播。
 */

import { serviceLog } from '../../utils/logger.js';
import { safeRequest, type SafeResponse } from '../../utils/safe-request.js';
import type { ITTSSynthesizer, TTSOptions, TTSClientOptions } from './tts-client.js';

/** base64 字符串 → ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

/** 火山 seed-tts-2.0 默认音色（中文女声 warm） */
const DEFAULT_SPEAKER = 'zh_female_vv_uranus_bigtts';

/** 火山 TTS HTTP 端点（Agent Plan） */
const VOLC_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';

export class VolcTTSClient implements ITTSSynthesizer {
	#apiKey: string;
	private model: string;

	constructor(options: TTSClientOptions) {
		this.#apiKey = options.apiKey;
		this.model = options.model || 'doubao-seed-tts-2.0';
	}

	async synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer> {
		const speaker = this.resolveSpeaker(options);
		const body = {
			user: { uid: 'deepreader' },
			namespace: 'BidirectionalTTS',
			req_params: {
				text,
				speaker,
				audio_params: {
					format: 'mp3',
					sample_rate: 24000,
					speech_rate: 0,
				},
			},
		};

		serviceLog.info('[VolcTTS] 请求合成', { textLen: text.length, speaker, model: this.model });

		const resp: SafeResponse = await safeRequest({
			url: VOLC_TTS_ENDPOINT,
			method: 'POST',
			contentType: 'application/json',
			headers: {
				'X-Api-Key': this.#apiKey,
				'X-Api-Resource-Id': 'seed-tts-2.0',
				'X-Api-Request-Id': `dr-${Date.now()}`,
				'X-Api-Connect-Id': `dr-conn-${Date.now()}`,
			},
			body: JSON.stringify(body),
			throw: false,
		});

		if (resp.status !== 200) {
			const detail = resp.json?.message || resp.text.slice(0, 200);
			serviceLog.error('[VolcTTS] HTTP 失败', { status: resp.status, detail });
			throw new Error(`VolcTTS error: ${resp.status} — ${detail}`);
		}

		// 返回格式：{ code:0, message:"", data:"<base64 mp3>" }
		const code = resp.json?.code;
		if (code !== 0) {
			const msg = resp.json?.message || 'unknown';
			serviceLog.error('[VolcTTS] 业务错误', { code, message: msg });
			throw new Error(`VolcTTS code ${code}: ${msg}`);
		}

		const audioB64 = resp.json?.data;
		if (!audioB64) {
			throw new Error('VolcTTS: 响应中无音频数据');
		}

		serviceLog.info('[VolcTTS] 合成成功', { audioBytes: Math.round(audioB64.length * 0.75) });
		return base64ToArrayBuffer(audioB64);
	}

	async *synthesizeStream(text: string, options: TTSOptions, signal?: AbortSignal): AsyncGenerator<ArrayBuffer> {
		// 首版伪流式：一次性合成后整段返回。后续接 WebSocket 双向流式做真流式。
		if (signal?.aborted) return;
		const audio = await this.synthesize(text, options);
		if (signal?.aborted) return;
		yield audio;
	}

	/** 解析音色：voiceProfile.voice 若形如火山 speaker ID 则直接用，否则用默认 */
	private resolveSpeaker(options: TTSOptions): string {
		const v = options.voiceProfile?.voice;
		// 火山 speaker ID 形如 zh_female_xxx_bigtts / BV001_streaming；其他（冰糖/茉莉/mimo_default）用默认
		if (v && /^(zh_|en_|BV|volc\.)/.test(v)) return v;
		return DEFAULT_SPEAKER;
	}
}
