/**
 * 火山方舟豆包 TTS 客户端（Agent Plan · HTTP 端点）
 *
 * 实测可用配置（见 spec/volc-tts-adapter.md）：
 *   POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional
 *   Header: X-Api-Key: <ark key>, X-Api-Resource-Id: seed-tts-2.0
 *   Body:   { user:{uid}, namespace:"BidirectionalTTS",
 *             req_params:{ text, speaker, audio_params:{format,sample_rate,speech_rate} } }
 *   Resp:   NDJSON — {"code":0,"data":"<base64_chunk>"}, ... ,{"code":20000000,"message":"OK","data":null}
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

/**
 * 用 OfflineAudioContext 把 MP3（或其它编码格式）解码为 PCM16 Int16Array
 * 供 PCMStreamPlayer 直接使用
 */
async function decodeToPcm16(encoded: ArrayBuffer, targetSampleRate: number): Promise<ArrayBuffer> {
	const ctx = new OfflineAudioContext(1, 1, targetSampleRate);
	const audioBuffer = await ctx.decodeAudioData(encoded);
	const channel = audioBuffer.getChannelData(0);
	let float32: Float32Array;
	if (audioBuffer.sampleRate !== targetSampleRate) {
		const offline = new OfflineAudioContext(1, Math.ceil(channel.length * targetSampleRate / audioBuffer.sampleRate), targetSampleRate);
		const source = offline.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(offline.destination);
		source.start();
		const rendered = await offline.startRendering();
		float32 = rendered.getChannelData(0);
	} else {
		float32 = channel;
	}
	const pcm16 = new Int16Array(float32.length);
	for (let i = 0; i < float32.length; i++) {
		const s = float32[i];
		pcm16[i] = s < 0 ? Math.max(-32768, Math.round(s * 32768)) : Math.min(32767, Math.round(s * 32767));
	}
	return pcm16.buffer;
}

/** PCMStreamPlayer 期望的采样率 */
const PCM_PLAYER_SAMPLE_RATE = 24000;

/** 火山 seed-tts-2.0 默认音色（中文女声 warm） */
const DEFAULT_SPEAKER = 'zh_female_vv_uranus_bigtts';

/** 火山 TTS HTTP 端点（Agent Plan） */
const VOLC_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';

/** NDJSON 结束标记 code（火山 V3 协议：SessionFinished 的成功码） */
const NDJSON_END_MARKER = 20000000;

interface VolcLine {
	code: number;
	message?: string;
	data?: string | null;
}

export class VolcTTSClient implements ITTSSynthesizer {
	#apiKey: string;
	private model: string;

	constructor(options: TTSClientOptions) {
		this.#apiKey = options.apiKey;
		this.model = options.model || 'doubao-seed-tts-2.0';
	}

	async synthesize(text: string, options: TTSOptions, signal?: AbortSignal): Promise<ArrayBuffer> {
		if (signal?.aborted) throw new Error('VolcTTS: aborted before request');

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

		let respText: string;
		if (resp.arrayBuffer && resp.arrayBuffer.byteLength > 0) {
			respText = new TextDecoder().decode(new Uint8Array(resp.arrayBuffer));
		} else {
			respText = resp.text;
		}

		const lines = respText.split('\n').filter(l => l.trim());
		const b64Chunks: string[] = [];
		let parseError: unknown;
		for (const line of lines) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line) as VolcLine;
			} catch (e) {
				parseError = e;
				continue;
			}
			if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
				const rec = parsed as VolcLine;
				if (rec.code === 0 && typeof rec.data === 'string') {
					b64Chunks.push(rec.data);
				} else if (rec.code !== NDJSON_END_MARKER && rec.code !== 0) {
					serviceLog.error('[VolcTTS] 服务端错误', { code: rec.code, message: rec.message });
					throw new Error(`VolcTTS server error: code ${rec.code} — ${rec.message ?? 'unknown'}`);
				}
			}
		}

		if (b64Chunks.length === 0) {
			const detail = parseError
				? `JSON parse failed: ${parseError}`
				: 'no audio data line found';
			serviceLog.error('[VolcTTS] 响应解析失败', {
				textLen: respText.length,
				textHead: respText.slice(0, 120),
				textTail: respText.length > 200 ? respText.slice(respText.length - 80) : '(short)',
				arrayBufferLen: resp.arrayBuffer?.byteLength ?? 0,
				textLenFallback: resp.text.length,
				lines: lines.length,
				chunks: b64Chunks.length,
				detail,
			});
			throw new Error(`VolcTTS: 响应解析失败 (lines=${lines.length}) — ${respText.slice(0, 100)}`);
		}

		// 合并所有 base64 音频片段。
		// 火山 NDJSON 每个 chunk 是独立的 base64 段，不含中间 padding（=），
		// 所以直接拼接即可得到完整的 base64 编码音频。
		const audioB64 = b64Chunks.join('');
		serviceLog.info('[VolcTTS] 合成成功', { audioBytes: Math.round(audioB64.length * 0.75), chunks: b64Chunks.length });
		return base64ToArrayBuffer(audioB64);
	}

	async *synthesizeStream(text: string, options: TTSOptions, signal?: AbortSignal): AsyncGenerator<ArrayBuffer> {
		if (signal?.aborted) return;
		const audio = await this.synthesize(text, options, signal);
		if (signal?.aborted) return;
		serviceLog.info('[VolcTTS] MP3 合成完成，开始解码', { mp3Bytes: audio.byteLength });
		try {
			const pcm16 = await decodeToPcm16(audio, PCM_PLAYER_SAMPLE_RATE);
			serviceLog.info('[VolcTTS] MP3→PCM16 解码成功', {
				pcm16Bytes: pcm16.byteLength,
				pcm16Samples: pcm16.byteLength / 2,
				durationSec: Math.round((pcm16.byteLength / 2 / PCM_PLAYER_SAMPLE_RATE) * 100) / 100,
			});
			if (!signal?.aborted) yield pcm16;
		} catch (e) {
			serviceLog.error('[VolcTTS] MP3→PCM16 解码失败，回退到原始 MP3（可能无声）', {
				err: String(e),
				mp3Bytes: audio.byteLength,
			});
			if (!signal?.aborted) yield audio;
		}
	}

	/** 解析音色：voiceProfile.voice 若形如火山 speaker ID（有合理长度和命名格式）则直接用，否则用默认 */
	private resolveSpeaker(options: TTSOptions): string {
		const v = options.voiceProfile?.voice;
		// 火山 speaker ID 形如 zh_female_xxx_bigtts / BV001_streaming / volc.xxx
		// 加长度守卫：防止 "zh" 或 "en" 等短字符串误匹配
		if (v && v.length >= 5 && /^(zh_|en_|BV|volc\.)/.test(v)) return v;
		return DEFAULT_SPEAKER;
	}
}
