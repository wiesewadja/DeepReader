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

export class VoiceInputController {
	private asrClient: ASRClient;
	private recorder: AudioRecorder;
	private chatInput: ChatInput;
	private language: string;
	#toggling = false;

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
				await this.stopAndRecognize();
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
			serviceLog.info('[VoiceInput] 开始录音');
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

	private async stopAndRecognize(): Promise<void> {
		this.chatInput.setVoiceState('recognizing');

		try {
			const { audioBase64, mimeType, duration } = await this.recorder.stop();
			serviceLog.info(`[VoiceInput] 录音完成: ${duration}ms, ${audioBase64.length} bytes base64`);

			let fullText = '';
			for await (const chunk of this.asrClient.transcribeStream(audioBase64, mimeType, {
				language: this.language,
			})) {
				fullText += chunk;
				this.chatInput.appendVoiceText(chunk);
			}

			if (fullText) {
				serviceLog.info(`[VoiceInput] 识别完成: "${fullText}"`);
			} else {
				serviceLog.warn('[VoiceInput] 识别结果为空');
				new Notice('未识别到语音内容，请重试');
			}

			this.chatInput.completeVoiceInput();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			serviceLog.error('[VoiceInput] 识别失败:', msg);
			this.chatInput.setVoiceState('idle');
			new Notice(`识别失败: ${msg}`);
		}
	}

	destroy(): void {
		this.recorder.destroy();
	}
}
