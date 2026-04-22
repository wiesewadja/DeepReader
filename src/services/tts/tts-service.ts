import { Notice } from 'obsidian';
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

interface CachedAudio {
    blobUrl: string;
    audio: HTMLAudioElement;
}

export class TTSService {
    private state: TTSPlayState = 'idle';
    private client: TTSClient;
    private summarizer: TTSSummarizer;
    private currentMessageId: string | null = null;
    private cache: Map<string, CachedAudio> = new Map();
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

    async play(messageId: string, content: string, userQuestion?: string): Promise<void> {
        // 如果正在播放另一条消息，先停止
        if (this.state !== 'idle' && this.currentMessageId !== messageId) {
            this.stopInternal();
        }

        this.currentMessageId = messageId;

        // 有缓存：直接播放
        const cached = this.cache.get(messageId);
        if (cached) {
            this.listenAudio(cached.audio, messageId);
            this.setState('playing');
            await cached.audio.play();
            return;
        }

        // 无缓存：生成摘要 → 合成 → 播放
        try {
            this.setState('summarizing');
            const summary = await this.summarizer.summarize(content, userQuestion);

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

            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);

            this.cache.set(messageId, { blobUrl, audio });
            this.listenAudio(audio, messageId);

            this.setState('playing');
            await audio.play();

        } catch (err) {
            console.error('[TTS] play failed:', err);
            new Notice(`语音播报失败: ${err instanceof Error ? err.message : String(err)}`);
            this.setState('idle');
        }
    }

    pause(): void {
        if (this.state === 'playing') {
            const cached = this.currentMessageId ? this.cache.get(this.currentMessageId) : null;
            cached?.audio.pause();
            this.setState('paused');
        }
    }

    resume(): void {
        if (this.state === 'paused') {
            const cached = this.currentMessageId ? this.cache.get(this.currentMessageId) : null;
            if (cached) {
                cached.audio.play();
                this.setState('playing');
            }
        }
    }

    stop(): void {
        if (this.currentMessageId) {
            const cached = this.cache.get(this.currentMessageId);
            if (cached) {
                cached.audio.pause();
                cached.audio.currentTime = 0;
            }
        }
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

    /** 释放所有缓存的音频资源 */
    destroy(): void {
        for (const [, cached] of this.cache) {
            cached.audio.pause();
            cached.audio.src = '';
            URL.revokeObjectURL(cached.blobUrl);
        }
        this.cache.clear();
        this.currentMessageId = null;
        this.state = 'idle';
    }

    private stopInternal(): void {
        if (this.currentMessageId) {
            const cached = this.cache.get(this.currentMessageId);
            if (cached) {
                cached.audio.pause();
                cached.audio.currentTime = 0;
            }
        }
        this.currentMessageId = null;
        this.setState('idle');
    }

    private listenAudio(audio: HTMLAudioElement, messageId: string): void {
        audio.onended = () => {
            audio.currentTime = 0;
            if (this.currentMessageId === messageId) {
                this.currentMessageId = null;
                this.setState('idle');
            }
        };
        audio.onerror = () => {
            console.error('[TTS] Audio playback error');
            if (this.currentMessageId === messageId) {
                this.currentMessageId = null;
                this.setState('idle');
            }
        };
    }

    private setState(newState: TTSPlayState): void {
        this.state = newState;
        this.onStateChange?.(this.currentMessageId, newState);
    }
}
