import { AudioRecorder } from './asr/audio-recorder.js';
import { ASRClient } from './asr/asr-client.js';
import { VoiceRewriter, type BookContext } from './voice-rewriter.js';
import type { ChatInput } from '../components/chat-input/chat-input.js';

export type PushToTalkState = 'idle' | 'listening' | 'recognizing' | 'rewriting' | 'done';

export interface PushToTalkConfig {
	asrApiKey: string;
	asrBaseUrl: string;
	llmApiKey: string;
	llmBaseUrl: string;
	language?: string;
}

export interface PushToTalkCallbacks {
	onStateChange: (state: PushToTalkState) => void;
	onTextReady: (text: string) => void;
	onError: (error: Error) => void;
}

export class PushToTalkController {
	private state: PushToTalkState = 'idle';
	private recorder: AudioRecorder;
	private asrClient: ASRClient;
	private rewriter: VoiceRewriter;
	private chatInput: ChatInput;
	private callbacks: PushToTalkCallbacks;
	private incrementalTimer: ReturnType<typeof setInterval> | null = null;
	private lastIncrementalText = '';
	private cancelled = false;
	private abortCtrl: AbortController | null = null;
	private rewriteTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
	private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
	private config: PushToTalkConfig;

	constructor(
		chatInput: ChatInput,
		config: PushToTalkConfig,
		callbacks: PushToTalkCallbacks,
	) {
		this.chatInput = chatInput;
		this.config = config;
		this.callbacks = callbacks;
		this.recorder = new AudioRecorder();
		this.asrClient = new ASRClient({
			apiKey: config.asrApiKey,
			baseUrl: config.asrBaseUrl,
		});
		this.rewriter = new VoiceRewriter({
			apiKey: config.llmApiKey,
			baseUrl: config.llmBaseUrl,
		});
	}

	getState(): PushToTalkState {
		return this.state;
	}

	async start(): Promise<void> {
		if (this.state !== 'idle') return;
		this.setState('listening');
		this.lastIncrementalText = '';
		// 清除上一次会话残留的取消标志（cancel 后若未经过 stop 消费点，标志会残留，
		// 会导致本次 stop 被误判为取消而丢弃结果）
		this.cancelled = false;

		try {
			await this.recorder.start();
			this.chatInput.setVoiceState('recording');
			this.startIncrementalRecognition();

			this.maxDurationTimer = setTimeout(() => {
				if (this.state === 'listening') {
					this.stop().catch(() => {});
				}
			}, 60000);
		} catch (error) {
			this.handleError(error as Error);
		}
	}

	async stop(bookContext?: BookContext): Promise<void> {
		if (this.state !== 'listening') return;
		this.stopIncrementalRecognition();
		this.setState('recognizing');
		this.chatInput.setVoiceState('recognizing');

		try {
			const { audioBase64, mimeType } = await this.recorder.stop();
			if (this.cancelled) {
				this.cancelled = false;
				this.reset();
				return;
			}

			const finalText = await this.asrClient.transcribe(audioBase64, mimeType, {
				language: this.config.language,
			});
			if (this.cancelled) {
				this.cancelled = false;
				this.reset();
				return;
			}

			const recognizedText = finalText || this.lastIncrementalText;
			if (!recognizedText) {
				this.reset();
				return;
			}

			// 直接使用 ASR 识别结果，跳过 LLM 重写
			this.callbacks.onTextReady(recognizedText);
			this.chatInput.setValue(recognizedText);
			// 调用 completeVoiceInput 让 ChatInput 处理发送逻辑，然后重置 state 回 idle
			this.chatInput.completeVoiceInput();
			this.reset();
		} catch (error) {
			this.handleError(error as Error);
		}
	}

	cancel(): void {
		this.cancelled = true;
		this.stopIncrementalRecognition();
		this.abortCtrl?.abort();
		this.recorder.cancel();
		// 清除可能已写入的递增识别文字
		if (this.chatInput) {
			this.chatInput.setValue('');
		}
		this.reset();
	}

	destroy(): void {
		this.cancel();
		this.recorder.destroy();
	}

	private setState(state: PushToTalkState): void {
		this.state = state;
		this.callbacks.onStateChange(state);
	}

	private reset(): void {
		this.state = 'idle';
		this.lastIncrementalText = '';
		if (this.rewriteTimeoutTimer) {
			clearTimeout(this.rewriteTimeoutTimer);
			this.rewriteTimeoutTimer = null;
		}
		if (this.maxDurationTimer) {
			clearTimeout(this.maxDurationTimer);
			this.maxDurationTimer = null;
		}
		this.abortCtrl = null;
		this.chatInput.setVoiceState('idle');
		this.callbacks.onStateChange('idle');
	}

	private handleError(error: Error): void {
		this.reset();
		this.callbacks.onError(error);
	}

	private startIncrementalRecognition(): void {
		this.incrementalTimer = setInterval(async () => {
			if (this.state !== 'listening' || this.cancelled) return;
			try {
				const { audioBase64, mimeType } = await this.recorder.getAccumulatedAudio();
				if (this.state !== 'listening' || this.cancelled) return;
				let text = '';
				for await (const chunk of this.asrClient.transcribeStream(audioBase64, mimeType, {
					language: this.config.language,
				})) {
					text += chunk;
				}
				if (this.state !== 'listening' || this.cancelled) return;

				if (text) {
					this.lastIncrementalText = text;
					this.chatInput.replaceVoiceText(text);
				}
			} catch {
				// 递增识别失败不中断录音
			}
		}, 3000);
	}

	private stopIncrementalRecognition(): void {
		if (this.incrementalTimer) {
			clearInterval(this.incrementalTimer);
			this.incrementalTimer = null;
		}
	}
}
