import { Notice } from 'obsidian';
import { ASRClient } from './asr-client.js';
import { AudioRecorder } from './audio-recorder.js';
import { serviceLog } from '../../utils/logger.js';
import type { ChatInput, VoiceState } from '../../components/chat-input/chat-input.js';

export interface VoiceInputConfig {
	apiKey: string;
	baseUrl: string;
	model?: string;
	language?: string;
}

/** 递增识别间隔（毫秒） */
const INCREMENTAL_INTERVAL_MS = 3000;

export class VoiceInputController {
	private asrClient: ASRClient;
	private recorder: AudioRecorder;
	private chatInput: ChatInput;
	private language: string;
	#toggling = false;

	/** 递增识别定时器 */
	private incrementalTimer: ReturnType<typeof setInterval> | null = null;
	/** 当前是否有递增识别正在进行 */
	private incrementalInProgress = false;
	/** 是否已获得首次识别文本（用于区分追加/替换） */
	private hasIncrementalResult = false;
	/** 递增识别最后文本 */
	private lastIncrementalText = '';

	constructor(chatInput: ChatInput, config: VoiceInputConfig) {
		this.chatInput = chatInput;
		this.language = config.language || 'auto';
		this.asrClient = new ASRClient({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			model: config.model || 'mimo-v2.5-asr',
		});
		this.recorder = new AudioRecorder({ maxDuration: 60000 });
	}

	async toggle(): Promise<void> {
		if (this.#toggling) return;
		this.#toggling = true;
		try {
			if (this.recorder.getState() === 'recording') {
				await this.stopAndFinalRecognize();
			} else {
				await this.startRecording();
			}
		} finally {
			this.#toggling = false;
		}
	}

	private async startRecording(): Promise<void> {
		try {
			await this.recorder.start();
			this.chatInput.setVoiceState('recording');
			this.hasIncrementalResult = false;
			this.lastIncrementalText = '';
			serviceLog.info('[VoiceInput] 开始录音（递增识别模式）');

			// 首次识别延迟 3 秒，之后每 3 秒
			this.incrementalTimer = setInterval(() => {
				this.runIncrementalRecognition();
			}, INCREMENTAL_INTERVAL_MS);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			serviceLog.error('[VoiceInput] 录音启动失败:', msg);
			this.chatInput.setVoiceState('idle');
			if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
				new Notice('需要麦克风权限，请在系统设置中允许');
			} else {
				new Notice(`录音失败: ${msg}`);
			}
		}
	}

	/** 递增识别：取当前累积音频 → ASR → 替换文本 */
	private async runIncrementalRecognition(): Promise<void> {
		if (this.incrementalInProgress) return;
		if (this.recorder.getState() !== 'recording') return;

		this.incrementalInProgress = true;
		try {
			const { audioBase64 } = await this.recorder.getAccumulatedAudio();

			let text = '';
			for await (const chunk of this.asrClient.transcribeStream(audioBase64, 'audio/wav', {
				language: this.language,
			})) {
				text += chunk;
			}

			if (text) {
				this.lastIncrementalText = text;
				this.chatInput.replaceVoiceText(text);
				this.hasIncrementalResult = true;
				serviceLog.info(`[VoiceInput] 递增识别: "${text}"`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			serviceLog.warn('[VoiceInput] 递增识别失败（非致命）:', msg);
		} finally {
			this.incrementalInProgress = false;
		}
	}

	/** 用户点击停止 → 直接使用最后一次递增结果 */
	private async stopAndFinalRecognize(): Promise<void> {
		// 停止递增识别定时器
		if (this.incrementalTimer) {
			clearInterval(this.incrementalTimer);
			this.incrementalTimer = null;
		}

		// 等待可能正在进行的递增识别完成（最多 5 秒）
		const deadline = Date.now() + 5000;
		while (this.incrementalInProgress && Date.now() < deadline) {
			await new Promise(r => setTimeout(r, 100));
		}

		// 停止录音（释放麦克风）
		if (this.recorder.getState() === 'recording') {
			this.recorder.cancel();
		}

		if (this.hasIncrementalResult && this.lastIncrementalText) {
			// 已有递增结果，直接使用
			serviceLog.info(`[VoiceInput] 停止录音，使用递增结果: "${this.lastIncrementalText}"`);
			this.chatInput.completeVoiceInput();
		} else {
			// 录音太短，没有递增结果
			serviceLog.warn('[VoiceInput] 录音时间过短，无识别结果');
			this.chatInput.setVoiceState('idle');
			new Notice('录音时间过短，请重试');
		}
	}

	destroy(): void {
		if (this.incrementalTimer) {
			clearInterval(this.incrementalTimer);
			this.incrementalTimer = null;
		}
		this.recorder.destroy();
	}
}
