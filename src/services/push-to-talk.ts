import { AudioRecorder } from './asr/audio-recorder.js';
import { ASRClient } from './asr/asr-client.js';
import { VoiceRewriter, type BookContext } from './voice-rewriter.js';
import type { ChatInput } from '../components/chat-input/chat-input.js';

export type PushToTalkState = 'idle' | 'listening' | 'recognizing' | 'rewriting';

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
			const finalText = await this.asrClient.transcribe(audioBase64, mimeType, {
				language: this.config.language,
			});

			const textToRewrite = finalText || this.lastIncrementalText;
			if (!textToRewrite) {
				this.reset();
				return;
			}

			this.setState('rewriting');
			this.chatInput.setVoiceState('recognizing');

			let rewritten = '';
			for await (const chunk of this.rewriter.rewrite(textToRewrite, bookContext)) {
				rewritten += chunk;
			}

			if (rewritten) {
				this.callbacks.onTextReady(rewritten);
				this.chatInput.setValue(rewritten);
			}
			this.reset();
		} catch (error) {
			this.handleError(error as Error);
		}
	}

	cancel(): void {
		this.stopIncrementalRecognition();
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
		this.chatInput.setVoiceState('idle');
		this.callbacks.onStateChange('idle');
	}

	private handleError(error: Error): void {
		this.reset();
		this.callbacks.onError(error);
	}

	private startIncrementalRecognition(): void {
		this.incrementalTimer = setInterval(async () => {
			try {
				const { audioBase64, mimeType } = await this.recorder.getAccumulatedAudio();
				let text = '';
				for await (const chunk of this.asrClient.transcribeStream(audioBase64, mimeType, {
					language: this.config.language,
				})) {
					text += chunk;
				}

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
