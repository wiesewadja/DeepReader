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
    /** 句子级朗读进度回调：当前读到第几个句子（0-based），总共多少句 */
    onSentenceChange?: (messageId: string, sentenceIndex: number, totalSentences: number) => void;
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

/**
 * 清理文本中的 wiki link，仅保留别名用于 TTS 朗读
 * [[note]] → note
 * [[note|alias]] → alias
 * [[path/to/note|alias]] → alias
 */
function stripWikiLinksForTTS(text: string): string {
    return text.replace(/\[\[([^\]]+)\]\]/g, (_match, content: string) => {
        const parts = content.split('|');
        if (parts.length > 1) {
            // 有别名，使用别名
            return parts[1].trim();
        }
        // 无别名，使用路径最后一部分（文件名）
        const pathParts = parts[0].trim().split('/');
        return pathParts[pathParts.length - 1];
    });
}

/**
 * 将文本按中文/英文句子切分，返回句子数组
 * 保留原始文本中的空格和换行，以便后续映射回 DOM
 */
export function splitIntoSentences(text: string): string[] {
    const sentences: string[] = [];
    // 匹配句子结束符：中文句号/问号/感叹号/省略号，或英文句号/问号/感叹号
    const regex = /[^。！？…\.\!\?]+[。！？…\.\!\?]+/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
        sentences.push(match[0]);
        lastIndex = regex.lastIndex;
    }

    // 处理最后没有结束符的残留文本
    const tail = text.slice(lastIndex).trim();
    if (tail) {
        sentences.push(tail);
    }

    return sentences.length > 0 ? sentences : [text];
}

export class TTSService {
    private state: TTSPlayState = 'idle';
    private client: TTSClient;
    private summarizer: TTSSummarizer;
    private currentMessageId: string | null = null;
    private cache: Map<string, CachedAudio> = new Map();
    private streamPlayer: PCMStreamPlayer | null = null;
    private onStateChange?: (messageId: string | null, state: TTSPlayState) => void;
    private onSentenceChange?: (messageId: string, sentenceIndex: number, totalSentences: number) => void;

    /** 当前播放的句子数组和进度 */
    private currentSentences: string[] = [];
    private currentSentenceIndex: number = -1;
    private sentenceTimer: ReturnType<typeof setInterval> | null = null;

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
        this.onSentenceChange = config.onSentenceChange;
    }

    getState(): TTSPlayState {
        return this.state;
    }

    getCurrentMessageId(): string | null {
        return this.currentMessageId;
    }

    async play(messageId: string, content: string, userQuestion?: string, context?: TTSContext, options?: { rawText?: boolean }): Promise<void> {
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
            // 初始化句子追踪并播放缓存音频
            this.currentSentences = splitIntoSentences(content);
            this.currentSentenceIndex = -1;
            this.listenAudioWithSentenceTracking(cached.audio, messageId, content);
            this.setState('playing');
            await cached.audio.play();
            return;
        }

        // 清理 wiki link，仅保留别名用于 TTS 朗读
        const cleanContent = stripWikiLinksForTTS(content);

        // 直接朗读原文模式（跳过 Summarizer）
        if (options?.rawText) {
            try {
                await this.playStream(messageId, cleanContent);
            } catch (err) {
                console.error('[TTS] raw text play failed:', err);
                new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
                this.currentMessageId = null;
                this.setState('idle');
            }
            return;
        }

        try {
            await this.streamSummaryToAudio(messageId, cleanContent, userQuestion, context);
        } catch {
            console.warn('[TTS] Streaming pipeline failed, falling back');
            try {
                this.setState('summarizing');
                const summary = await this.summarizer.summarize(cleanContent, userQuestion, context);

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

    /**
     * 非流式合成语音音频（用于语音对话气泡）
     * 返回完整的 WAV ArrayBuffer 和时长（秒）
     */
    async generateVoiceBlob(
        content: string,
        userQuestion?: string,
        context?: TTSContext,
    ): Promise<{ audioBuffer: ArrayBuffer; duration: number }> {
        const cleanContent = stripWikiLinksForTTS(content);
        const summary = await this.summarizer.summarize(cleanContent, userQuestion, context);
        const audioBuffer = await this.client.synthesize(summary);
        const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
        return { audioBuffer, duration };
    }

    /**
     * 直接合成原文朗读（用于信封展开后的喇叭按钮，不经过 Summarizer）
     */
    async synthesizeRawText(text: string): Promise<{ audioBuffer: ArrayBuffer; duration: number }> {
        const cleanText = stripWikiLinksForTTS(text);
        const audioBuffer = await this.client.synthesize(cleanText);
        const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
        return { audioBuffer, duration };
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

    /**
     * 合并多个 WAV 音频片段为完整音频
     * 所有片段必须是相同格式：16bit mono 24000Hz
     */
    static mergeAudioChunks(chunks: ArrayBuffer[]): ArrayBuffer {
        if (chunks.length === 0) {
            throw new Error('No audio chunks to merge');
        }
        if (chunks.length === 1) {
            return chunks[0];
        }

        // WAV 头部大小
        const WAV_HEADER_SIZE = 44;
        
        // 验证所有片段格式一致
        const firstView = new DataView(chunks[0]);
        const sampleRate = firstView.getUint32(24, true);
        const bitsPerSample = firstView.getUint16(34, true);
        const numChannels = firstView.getUint16(22, true);
        
        // 收集所有 PCM 数据
        const pcmChunks: ArrayBuffer[] = [];
        for (const chunk of chunks) {
            const view = new DataView(chunk);
            // 验证格式
            const chunkSampleRate = view.getUint32(24, true);
            const chunkBits = view.getUint16(34, true);
            const chunkChannels = view.getUint16(22, true);
            
            if (chunkSampleRate !== sampleRate || chunkBits !== bitsPerSample || chunkChannels !== numChannels) {
                console.warn('[TTS] Audio format mismatch, skipping chunk');
                continue;
            }
            
            // 提取 PCM 数据（跳过 44 字节头部）
            const pcmData = chunk.slice(WAV_HEADER_SIZE);
            pcmChunks.push(pcmData);
        }

        if (pcmChunks.length === 0) {
            return chunks[0];
        }

        // 计算总 PCM 数据大小
        const totalPcmSize = pcmChunks.reduce((sum, c) => sum + c.byteLength, 0);
        
        // 创建新的 WAV 文件
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataSize = totalPcmSize;
        const fileSize = WAV_HEADER_SIZE + dataSize;
        
        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);
        
        // 写入 WAV 头部
        // "RIFF" chunk descriptor
        writeString(view, 0, 'RIFF');
        view.setUint32(4, fileSize - 8, true);
        writeString(view, 8, 'WAVE');
        
        // "fmt " sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);  // sub-chunk size
        view.setUint16(20, 1, true);   // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);  // byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        
        // "data" sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        
        // 复制 PCM 数据
        let offset = WAV_HEADER_SIZE;
        for (const pcm of pcmChunks) {
            const uint8 = new Uint8Array(buffer, offset, pcm.byteLength);
            uint8.set(new Uint8Array(pcm));
            offset += pcm.byteLength;
        }
        
        return buffer;
    }

    /**
     * 流式播放：边生成边播放（用于实时语音播报）
     */
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

    /**
     * 流式播放：直接播放 TTS 合成的音频（用于原文朗读）
     */
    private async playStream(messageId: string, text: string): Promise<void> {
        const player = new PCMStreamPlayer(24000);
        this.streamPlayer = player;
        this.setState('playing');

        // 初始化句子追踪
        this.currentSentences = splitIntoSentences(text);
        this.currentSentenceIndex = -1;
        const totalChars = text.length;

        // 计算每个句子的字符累积位置
        const sentenceEndPositions: number[] = [];
        let charCount = 0;
        for (const sentence of this.currentSentences) {
            charCount += sentence.length;
            sentenceEndPositions.push(charCount);
        }

        // PCMStreamPlayer 进度追踪定时器
        const playbackStartTime = player.currentTime;
        let streamProgressTimer: ReturnType<typeof setInterval> | null = null;

        const startProgressTracking = () => {
            if (streamProgressTimer) clearInterval(streamProgressTimer);
            streamProgressTimer = setInterval(() => {
                if (this.currentMessageId !== messageId) {
                    if (streamProgressTimer) { clearInterval(streamProgressTimer); streamProgressTimer = null; }
                    return;
                }

                const current = player.currentTime;
                const end = player.endTime;
                if (end <= playbackStartTime) return;

                const progress = Math.min(1, Math.max(0, (current - playbackStartTime) / (end - playbackStartTime)));
                const currentCharPos = Math.floor(progress * totalChars);

                let newIndex = 0;
                for (let i = 0; i < sentenceEndPositions.length; i++) {
                    if (currentCharPos <= sentenceEndPositions[i]) {
                        newIndex = i;
                        break;
                    }
                    newIndex = i + 1;
                }
                if (newIndex >= this.currentSentences.length) newIndex = this.currentSentences.length - 1;

                if (newIndex !== this.currentSentenceIndex) {
                    this.currentSentenceIndex = newIndex;
                    this.onSentenceChange?.(messageId, newIndex, this.currentSentences.length);
                }
            }, 200);
        };

        try {
            for await (const chunk of this.client.synthesizeStream(text)) {
                if (this.currentMessageId !== messageId) return;
                player.enqueue(chunk);
                // 首次收到 chunk 时启动进度追踪
                if (!streamProgressTimer) {
                    startProgressTracking();
                }
            }

            if (this.currentMessageId !== messageId) return;

            player.seal();
            await player.waitForEnd();

            if (streamProgressTimer) {
                clearInterval(streamProgressTimer);
                streamProgressTimer = null;
            }

            const wavBlob = player.assembleWav();
            const blobUrl = URL.createObjectURL(wavBlob);
            const audio = new Audio(blobUrl);
            this.cache.set(messageId, { blobUrl, audio });
            this.listenAudio(audio, messageId);

            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
                this.currentSentenceIndex = -1;
            }
        } finally {
            if (streamProgressTimer) {
                clearInterval(streamProgressTimer);
                streamProgressTimer = null;
            }
            player.stop();
            if (this.streamPlayer === player) {
                this.streamPlayer = null;
            }
        }
    }

    /**
     * 非流式播放：等待完整音频生成后播放（降级方案）
     */
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

        // 切分句子，用于进度追踪
        this.currentSentences = splitIntoSentences(text);
        this.currentSentenceIndex = -1;

        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);

        this.cache.set(messageId, { blobUrl, audio });
        this.listenAudioWithSentenceTracking(audio, messageId, text);

        this.setState('playing');
        await audio.play();
    }

    private stopInternal(): void {
        this.stopStreamPlayer();
        if (this.sentenceTimer) {
            clearInterval(this.sentenceTimer);
            this.sentenceTimer = null;
        }
        if (this.currentMessageId) {
            const cached = this.cache.get(this.currentMessageId);
            if (cached) {
                cached.audio.pause();
                cached.audio.currentTime = 0;
            }
            this.setState('idle');
            this.currentMessageId = null;
            this.currentSentenceIndex = -1;
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

    /**
     * 监听音频播放并追踪句子进度
     */
    private listenAudioWithSentenceTracking(audio: HTMLAudioElement, messageId: string, originalText: string): void {
        const sentences = this.currentSentences;
        const totalChars = originalText.length;

        // 计算每个句子的字符累积位置（用于比例映射）
        const sentenceEndPositions: number[] = [];
        let charCount = 0;
        for (const sentence of sentences) {
            charCount += sentence.length;
            sentenceEndPositions.push(charCount);
        }

        // 清理旧定时器
        if (this.sentenceTimer) {
            clearInterval(this.sentenceTimer);
            this.sentenceTimer = null;
        }

        // 定时检查播放进度
        this.sentenceTimer = setInterval(() => {
            if (this.currentMessageId !== messageId || audio.paused) return;

            const duration = audio.duration || 1;
            const currentTime = audio.currentTime;
            const progressRatio = currentTime / duration;
            const currentCharPos = Math.floor(progressRatio * totalChars);

            // 查找当前字符位置属于哪个句子
            let newIndex = 0;
            for (let i = 0; i < sentenceEndPositions.length; i++) {
                if (currentCharPos <= sentenceEndPositions[i]) {
                    newIndex = i;
                    break;
                }
                newIndex = i + 1;
            }
            if (newIndex >= sentences.length) newIndex = sentences.length - 1;

            if (newIndex !== this.currentSentenceIndex) {
                this.currentSentenceIndex = newIndex;
                this.onSentenceChange?.(messageId, newIndex, sentences.length);
            }
        }, 200); // 每 200ms 检查一次

        audio.onended = () => {
            if (this.sentenceTimer) {
                clearInterval(this.sentenceTimer);
                this.sentenceTimer = null;
            }
            audio.currentTime = 0;
            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
                this.currentSentenceIndex = -1;
            }
        };

        audio.onerror = () => {
            if (this.sentenceTimer) {
                clearInterval(this.sentenceTimer);
                this.sentenceTimer = null;
            }
            console.error('[TTS] Audio playback error');
            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
                this.currentSentenceIndex = -1;
            }
        };
    }

    private setState(newState: TTSPlayState): void {
        this.state = newState;
        this.onStateChange?.(this.currentMessageId, newState);
    }
}

/**
 * WAV 文件头部写入字符串的辅助函数
 */
function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
