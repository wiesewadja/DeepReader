import { TTSClient } from './tts-client.js';
import { TTSSummarizer } from './tts-summarizer.js';

export type TTSPlayState = 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused';

export interface TTSServiceConfig {
    ttsApiKey: string;
    ttsBaseUrl: string;
    llmApiKey: string;
    llmBaseUrl: string;
    llmModel: string;
    onStateChange?: (messageId: string | null, state: TTSPlayState) => void;
}

export class TTSService {
    private state: TTSPlayState = 'idle';
    private client: TTSClient;
    private summarizer: TTSSummarizer;
    private audio: HTMLAudioElement | null = null;
    private currentMessageId: string | null = null;
    private blobUrl: string | null = null;
    private onStateChange?: (messageId: string | null, state: TTSPlayState) => void;

    constructor(config: TTSServiceConfig) {
        this.client = new TTSClient({
            apiKey: config.ttsApiKey,
            baseUrl: config.ttsBaseUrl,
        });
        this.summarizer = new TTSSummarizer({
            apiKey: config.llmApiKey,
            baseUrl: config.llmBaseUrl,
            model: config.llmModel,
        });
        this.onStateChange = config.onStateChange;
    }

    getState(): TTSPlayState {
        return this.state;
    }

    getCurrentMessageId(): string | null {
        return this.currentMessageId;
    }

    async play(messageId: string, content: string): Promise<void> {
        if (this.state !== 'idle') {
            this.stop();
        }

        this.currentMessageId = messageId;

        try {
            this.setState('summarizing');
            const summary = await this.summarizer.summarize(content);

            if (this.currentMessageId !== messageId) {
                this.setState('idle');
                return;
            }

            this.setState('tts_loading');
            const audioBuffer = await this.client.synthesize(summary);

            if (this.currentMessageId !== messageId) {
                this.setState('idle');
                return;
            }

            this.revokeBlobUrl();
            const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            this.blobUrl = url;
            this.audio = new Audio(url);
            this.audio.addEventListener('ended', () => {
                this.setState('idle');
                URL.revokeObjectURL(url);
            });
            this.audio.addEventListener('error', () => {
                console.error('[TTS] Audio playback error');
                this.setState('idle');
                URL.revokeObjectURL(url);
            });

            this.setState('playing');
            await this.audio.play();

        } catch (err) {
            console.error('[TTS] play failed:', err);
            this.setState('idle');
        }
    }

    pause(): void {
        if (this.state === 'playing' && this.audio) {
            this.audio.pause();
            this.setState('paused');
        }
    }

    resume(): void {
        if (this.state === 'paused' && this.audio) {
            this.audio.play();
            this.setState('playing');
        }
    }

    stop(): void {
        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
            this.audio = null;
        }
        this.revokeBlobUrl();
        this.currentMessageId = null;
        this.setState('idle');
    }

    togglePauseResume(): void {
        if (this.state === 'playing') {
            this.pause();
        } else if (this.state === 'paused') {
            this.resume();
        }
    }

    private setState(newState: TTSPlayState): void {
        this.state = newState;
        this.onStateChange?.(this.currentMessageId, newState);
    }

    private revokeBlobUrl(): void {
        if (this.blobUrl) {
            URL.revokeObjectURL(this.blobUrl);
            this.blobUrl = null;
        }
    }
}
