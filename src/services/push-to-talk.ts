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

			const textToRewrite = finalText || this.lastIncrementalText;
			if (!textToRewrite) {
				this.reset();
				return;
			}

			this.setState('rewriting');
			this.chatInput.setVoiceState('recognizing');

			this.abortCtrl = new AbortController();
			this.rewriteTimeoutTimer = setTimeout(() => this.abortCtrl?.abort(), 30000);
			let rewritten = '';
			try {
				for await (const chunk of this.rewriter.rewrite(textToRewrite, bookContext, this.abortCtrl.signal)) {
					if (this.cancelled) {
						this.cancelled = false;
						this.reset();
						return;
					}
					rewritten += chunk;
				}
			} finally {
				if (this.rewriteTimeoutTimer) {
					clearTimeout(this.rewriteTimeoutTimer);
					this.rewriteTimeoutTimer = null;
				}
			}

			if (this.cancelled) {
				this.cancelled = false;
				this.reset();
				return;
			}

			if (rewritten) {
				this.callbacks.onTextReady(rewritten);
				this.chatInput.setValue(rewritten);
			}
			this.setState('done');
			this.reset();
		} catch (error) {
			if (this.cancelled) {
				// 主动取消（cancel 触发 abort 抛 AbortError）：cancel() 已 reset，静默返回
				this.cancelled = false;
				return;
			}
			const e = error as Error;
			const friendly = e.name === 'AbortError' ? new Error('语音优化超时，请重试') : e;
			this.handleError(friendly);
		}
	}

	cancel(): void {
		this.cancelled = true;
		this.stopIncrementalRecognition();
		this.abortCtrl?.abort();
		this.recorder.cancel();
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
