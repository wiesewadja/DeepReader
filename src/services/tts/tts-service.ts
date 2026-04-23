import { Notice } from 'obsidian';
import { TTSClient } from './tts-client.js';
import { TTSSummarizer, type TTSContext } from './tts-summarizer.js';
import { PCMStreamPlayer } from './pcm-stream-player.js';

export type TTSPlayState = 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused';

export interface TTSServiceConfig {
    ttsApiKey: string;
    ttsBaseUrl: string;
    ttsModel?: string;
    llmApiKey: string;
    llmBaseUrl: string;
    llmModel: string;
    onStateChange?: (messageId: string | null, state: TTSPlayState) => void;
}

interface CachedAudio {
    blobUrl: string;
    audio: HTMLAudioElement;
}

const SENTENCE_END_RE = /[。！？!?]/;

function splitFirstSentence(buffer: string): [string | null, string] {
    const match = buffer.search(SENTENCE_END_RE);
    if (match === -1) return [null, buffer];
    const end = match + 1;
    return [buffer.slice(0, end), buffer.slice(end)];
}

export class TTSService {
    private state: TTSPlayState = 'idle';
    private client: TTSClient;
    private summarizer: TTSSummarizer;
    private currentMessageId: string | null = null;
    private cache: Map<string, CachedAudio> = new Map();
    private streamPlayer: PCMStreamPlayer | null = null;
    private onStateChange?: (messageId: string | null, state: TTSPlayState) => void;

    constructor(config: TTSServiceConfig) {
        this.client = new TTSClient({
            apiKey: config.ttsApiKey,
            baseUrl: config.ttsBaseUrl,
            model: config.ttsModel,
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

    async play(messageId: string, content: string, userQuestion?: string, context?: TTSContext): Promise<void> {
        if (this.state !== 'idle' && this.currentMessageId === messageId) {
            this.togglePauseResume();
            return;
        }

        if (this.state !== 'idle') {
            this.stopInternal();
        }

        this.currentMessageId = messageId;

        const cached = this.cache.get(messageId);
        if (cached) {
            this.listenAudio(cached.audio, messageId);
            this.setState('playing');
            await cached.audio.play();
            return;
        }

        try {
            await this.streamSummaryToAudio(messageId, content, userQuestion, context);
        } catch {
            console.warn('[TTS] Streaming pipeline failed, falling back');
            try {
                this.setState('summarizing');
                const summary = await this.summarizer.summarize(content, userQuestion, context);

                if (this.currentMessageId !== messageId) {
                    this.setState('idle');
                    return;
                }

                try {
                    await this.playStream(messageId, summary);
                } catch {
                    await this.playNonStream(messageId, summary);
                }
            } catch (err) {
                console.error('[TTS] play failed:', err);
                new Notice(`语音播报失败: ${err instanceof Error ? err.message : String(err)}`);
                this.currentMessageId = null;
                this.setState('idle');
            }
        }
    }

    pause(): void {
        if (this.state === 'playing') {
            if (this.streamPlayer) {
                this.streamPlayer.pause();
            } else if (this.currentMessageId) {
                const cached = this.cache.get(this.currentMessageId);
                cached?.audio.pause();
            }
            this.setState('paused');
        }
    }

    async resume(): Promise<void> {
        if (this.state === 'paused') {
            if (this.streamPlayer) {
                this.streamPlayer.resume();
            } else if (this.currentMessageId) {
                const cached = this.cache.get(this.currentMessageId);
                if (cached) await cached.audio.play();
            }
            this.setState('playing');
        }
    }

    stop(): void {
        this.stopStreamPlayer();
        if (this.currentMessageId) {
            const cached = this.cache.get(this.currentMessageId);
            if (cached) {
                cached.audio.pause();
                cached.audio.currentTime = 0;
            }
            this.setState('idle');
            this.currentMessageId = null;
        } else {
            this.setState('idle');
        }
    }

    togglePauseResume(): void {
        if (this.state === 'playing') {
            this.pause();
        } else if (this.state === 'paused') {
            this.resume();
        }
    }

    destroy(): void {
        this.stopStreamPlayer();
        for (const [, cached] of this.cache) {
            cached.audio.pause();
            cached.audio.src = '';
            URL.revokeObjectURL(cached.blobUrl);
        }
        this.cache.clear();
        this.currentMessageId = null;
        this.state = 'idle';
    }

    private async streamSummaryToAudio(
        messageId: string,
        content: string,
        userQuestion?: string,
        context?: TTSContext,
    ): Promise<void> {
        const player = new PCMStreamPlayer(24000);
        this.streamPlayer = player;
        this.setState('summarizing');

        let buffer = '';
        let fullSummary = '';
        let ttsStarted = false;

        try {
            for await (const delta of this.summarizer.summarizeStream(content, userQuestion, context)) {
                if (this.currentMessageId !== messageId) return;

                buffer += delta;

                while (true) {
                    const [sentence, remaining] = splitFirstSentence(buffer);
                    if (!sentence) break;
                    buffer = remaining;
                    fullSummary += sentence;

                    if (!ttsStarted) {
                        this.setState('playing');
                        ttsStarted = true;
                    }

                    for await (const chunk of this.client.synthesizeStream(sentence)) {
                        if (this.currentMessageId !== messageId) return;
                        player.enqueue(chunk);
                    }
                }
            }

            const tail = buffer.trim();
            if (tail) {
                fullSummary += tail;
                if (!ttsStarted) {
                    this.setState('playing');
                    ttsStarted = true;
                }
                for await (const chunk of this.client.synthesizeStream(tail)) {
                    if (this.currentMessageId !== messageId) return;
                    player.enqueue(chunk);
                }
            }

            if (this.currentMessageId !== messageId) return;

            // 标记不会再有新 chunk，等最后一个 source 播完
            player.seal();
            await player.waitForEnd();

            // 缓存 WAV 供重播
            if (fullSummary) {
                const wavBlob = player.assembleWav();
                const blobUrl = URL.createObjectURL(wavBlob);
                const audio = new Audio(blobUrl);
                this.cache.set(messageId, { blobUrl, audio });
                this.listenAudio(audio, messageId);
            }

            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
            }
        } finally {
            player.stop();
            if (this.streamPlayer === player) {
                this.streamPlayer = null;
            }
        }
    }

    private async playStream(messageId: string, text: string): Promise<void> {
        const player = new PCMStreamPlayer(24000);
        this.streamPlayer = player;
        this.setState('playing');

        try {
            for await (const chunk of this.client.synthesizeStream(text)) {
                if (this.currentMessageId !== messageId) return;
                player.enqueue(chunk);
            }

            if (this.currentMessageId !== messageId) return;

            player.seal();
            await player.waitForEnd();

            const wavBlob = player.assembleWav();
            const blobUrl = URL.createObjectURL(wavBlob);
            const audio = new Audio(blobUrl);
            this.cache.set(messageId, { blobUrl, audio });
            this.listenAudio(audio, messageId);

            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
            }
        } finally {
            player.stop();
            if (this.streamPlayer === player) {
                this.streamPlayer = null;
            }
        }
    }

    private async playNonStream(messageId: string, text: string): Promise<void> {
        if (this.currentMessageId !== messageId) {
            this.setState('idle');
            return;
        }

        this.setState('tts_loading');
        const audioBuffer = await this.client.synthesize(text);

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
    }

    private stopInternal(): void {
        this.stopStreamPlayer();
        if (this.currentMessageId) {
            const cached = this.cache.get(this.currentMessageId);
            if (cached) {
                cached.audio.pause();
                cached.audio.currentTime = 0;
            }
            this.setState('idle');
            this.currentMessageId = null;
        }
    }

    private stopStreamPlayer(): void {
        if (this.streamPlayer) {
            this.streamPlayer.stop();
            this.streamPlayer = null;
        }
    }

    private listenAudio(audio: HTMLAudioElement, messageId: string): void {
        audio.onended = () => {
            audio.currentTime = 0;
            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
            }
        };
        audio.onerror = () => {
            console.error('[TTS] Audio playback error');
            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
            }
        };
    }

    private setState(newState: TTSPlayState): void {
        this.state = newState;
        this.onStateChange?.(this.currentMessageId, newState);
    }
}
