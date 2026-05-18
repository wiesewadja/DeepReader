import { Notice } from 'obsidian';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TTSClient, type ITTSSynthesizer, type TTSVoiceOptions, type TTSOptions } from './tts-client.js';
import { MiniMaxTTSClient } from './minimax-tts-client.js';
import { TTSSummarizer, type TTSContext } from './tts-summarizer.js';
import { PCMStreamPlayer } from './pcm-stream-player.js';
import { BookGenreDetector } from './book-genre-detector.js';
import { ExpressivePreprocessor } from './expressive-preprocessor.js';
import { resolveVoiceProfile, getDefaultVoiceProfile, type VoiceProfile } from './voice-profile.js';
import type { BookGenre } from './book-genre-detector.js';
import { safeRequest } from '../../utils/safe-request.js';

export type TTSPlayState = 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused';

export interface TTSServiceConfig {
    ttsApiKey: string;
    ttsBaseUrl: string;
    ttsModel?: string;
    ttsProvider: string;
    llmApiKey: string;
    llmBaseUrl: string;
    llmModel: string;
    /** Vault 根目录路径，用于 BookGenreDetector 读取 tree.json */
    vaultPath?: string;
    onStateChange?: (messageId: string | null, state: TTSPlayState) => void;
    /** TTS 播放进度回调：0-100 的进度值，每 200ms 更新一次 */
    onProgressChange?: (messageId: string, progress: number) => void;
}

interface CachedAudio {
    blobUrl: string;
    audio: HTMLAudioElement;
    /** true = 完整音频，可即时重播 */
    isFull?: boolean;
}

interface ManifestEntry {
    textHash: string;
    voice: string;
    wavFile: string;
    createdAt: number;
}

interface DiskManifest {
    entries: ManifestEntry[];
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

export class TTSService {
    private state: TTSPlayState = 'idle';
    private client: ITTSSynthesizer;
    private summarizer: TTSSummarizer;
    private genreDetector: BookGenreDetector | null = null;
    private expressivePreprocessor: ExpressivePreprocessor;
    private currentMessageId: string | null = null;
    private currentGenre: BookGenre | null = null;
    private cache: Map<string, CachedAudio> = new Map();
    private static readonly MAX_CACHE_ENTRIES = 20;
    /** 全量口语化改写缓存：messageId → 改写后的文本 */
    private rewrittenCache: Map<string, string> = new Map();
    /** 正在进行的全量改写：messageId → Promise */
    private pendingRewrites: Map<string, Promise<string>> = new Map();
    /** 预览音频原始 buffer，用于与分段音频合并为完整缓存 */
    private previewBuffers: Map<string, ArrayBuffer> = new Map();
    /** 磁盘缓存目录（空=禁用磁盘缓存） */
    private diskCacheDir: string = '';
    private static readonly MAX_DISK_ENTRIES = 10;
    /** manifest 串行写锁，防止并发覆盖 */
    private manifestLock: Promise<void> = Promise.resolve();
    private streamPlayer: PCMStreamPlayer | null = null;
    private onStateChange?: (messageId: string | null, state: TTSPlayState) => void;
    private onProgressChange?: (messageId: string, progress: number) => void;
    private progressTimer: ReturnType<typeof setInterval> | null = null;
    /** resolve 函数，resume() 调用时唤醒 waitIfPaused */
    private resumeResolver: (() => void) | null = null;
    /** 当前正在播放的音频元素引用（pause/stop 直接操作，无需查 cache） */
    private currentAudio: HTMLAudioElement | null = null;
    /** 用于在 stop 时 reject 挂起的 playAudioAndWait promise，避免异步链泄漏 */
    private playbackReject: ((err: Error) => void) | null = null;
    /** TTS 提供商 ID，用于决定音色选择策略 */
    private ttsProvider: string;

    constructor(config: TTSServiceConfig) {
        this.client = config.ttsProvider === 'minimax'
            ? new MiniMaxTTSClient({
                apiKey: config.ttsApiKey,
                baseUrl: config.ttsBaseUrl,
                model: config.ttsModel,
            })
            : new TTSClient({
                apiKey: config.ttsApiKey,
                baseUrl: config.ttsBaseUrl,
                model: config.ttsModel,
            });
        this.ttsProvider = config.ttsProvider;
        this.summarizer = new TTSSummarizer({
            apiKey: config.llmApiKey,
            baseUrl: config.llmBaseUrl,
            model: config.llmModel,
        });
        // 初始化 BookGenreDetector（需要 vaultPath）
        if (config.vaultPath) {
            this.genreDetector = new BookGenreDetector({
                vaultPath: config.vaultPath,
                llmClient: {
                    complete: async (prompt: string) => {
                        const response = await safeRequest({
                            url: `${config.llmBaseUrl}/chat/completions`,
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${config.llmApiKey}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                model: config.llmModel,
                                messages: [{ role: 'user', content: prompt }],
                                temperature: 0.3,
                                max_tokens: 500,
                            }),
                        });
                        return response.json?.choices?.[0]?.message?.content || '';
                    },
                },
            });
        }
        this.expressivePreprocessor = new ExpressivePreprocessor();
        this.onStateChange = config.onStateChange;
        this.onProgressChange = config.onProgressChange;
        if (config.vaultPath) {
            this.diskCacheDir = path.join(config.vaultPath, '.obsidian/plugins/deepreader/tts-cache');
        }
    }

    getState(): TTSPlayState {
        return this.state;
    }

    getCurrentMessageId(): string | null {
        return this.currentMessageId;
    }

    async play(messageId: string, content: string, userQuestion?: string, context?: TTSContext, options?: { rawText?: boolean }): Promise<void> {
        // 同一消息：loading 时停止，playing/paused 时切换
        if (this.state !== 'idle' && this.currentMessageId === messageId) {
            if (this.state === 'tts_loading' || this.state === 'summarizing') {
                this.stopInternal();
            } else {
                this.togglePauseResume();
            }
            return;
        }

        // 不同消息或正在准备：停止当前并切换到新消息
        if (this.state !== 'idle') {
            this.stopInternal();
        }

        this.currentMessageId = messageId;
        this.setState('tts_loading'); // 立即锁定，防止并发

        // Step 1: 推测书籍类型（基于 tree.json）
        let genre: BookGenre | undefined;
        if (context?.bookId && this.genreDetector) {
            try {
                genre = await this.genreDetector.detect(context.bookId);
                this.currentGenre = genre;
            } catch (err) {
                console.warn('[TTS] Genre detection failed:', err);
            }
        }

        // Step 2: 解析音色配置
        const voiceProfile = genre ? resolveVoiceProfile(genre, this.ttsProvider) : getDefaultVoiceProfile(this.ttsProvider);

        // Step 3: 构建缓存 key（包含音色指纹）
        const cacheKey = this.buildCacheKey(messageId, voiceProfile);
        let cached = this.cache.get(cacheKey);

        // 清理 wiki link，仅保留别名用于 TTS 朗读
        const cleanContent = stripWikiLinksForTTS(content);
        const textHash = this.getTextHash(cleanContent);

        // 内存 miss → 查磁盘缓存
        if (!cached) {
            const diskCached = await this.loadFromDiskCache(textHash, voiceProfile.voice);
            if (diskCached) {
                this.setCache(cacheKey, diskCached);
                cached = diskCached;
                console.log(`[TTS] Disk cache hit: ${textHash}_${voiceProfile.voice}`);
            }
        }

        // 直接朗读原文模式：口语化改写 + 朗读
        if (options?.rawText) {
            try {
                await this.playWithOralRewrite(messageId, cleanContent, voiceProfile, cached, textHash);
            } catch (err) {
                // 用户主动停止 → 静默处理（state 已由 stopInternal 清理）
                if (err instanceof Error && err.message === 'STOPPED') return;
                console.error('[TTS] oral rewrite play failed:', err);
                new Notice(`朗读失败: ${err instanceof Error ? err.message : String(err)}`);
                this.currentMessageId = null;
                this.currentGenre = null;
                this.setState('idle');
            }
            return;
        }

        try {
            await this.streamSummaryToAudio(messageId, cleanContent, userQuestion, context, voiceProfile);
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
                    await this.playStream(messageId, summary, voiceProfile);
                } catch {
                    await this.playNonStream(messageId, summary, voiceProfile);
                }
            } catch (err) {
                console.error('[TTS] play failed:', err);
                new Notice(`语音播报失败: ${err instanceof Error ? err.message : String(err)}`);
                this.currentMessageId = null;
                this.currentGenre = null;
                this.setState('idle');
            }
        }
    }

    /**
     * 异步预生成前 100 字符的语音
     *
     * 在 AI 回复收到 100 字符后调用，让用户点击朗读时能立即播放。
     * - 异步执行，不阻塞 UI
     * - 只预生成前 100 字符（约 10 秒语音）
     * - 预生成使用正确的音色（基于书籍类型）
     * - 如果用户不点击，预生成的语音保留在缓存中
     */
    async preloadPreview(messageId: string, content: string, context?: TTSContext): Promise<void> {
        try {
            // 1. 推测书籍类型（不写 this.currentGenre，避免与 play() 竞争）
            let genre: BookGenre | undefined;
            if (context?.bookId && this.genreDetector) {
                try {
                    genre = await this.genreDetector.detect(context.bookId);
                } catch (err) {
                    console.warn('[TTS] Preload genre detection failed:', err);
                }
            }

            // 2. 解析音色配置
            const voiceProfile = genre ? resolveVoiceProfile(genre, this.ttsProvider) : getDefaultVoiceProfile(this.ttsProvider);

            // 3. 检查缓存是否已存在
            const cacheKey = this.buildCacheKey(messageId, voiceProfile);
            if (this.cache.has(cacheKey)) {
                return;
            }

            // 4. 截取前 250 字符
            const cleanContent = stripWikiLinksForTTS(content);
            const previewText = cleanContent.slice(0, 250);

            // 5. 口语化改写（LLM 把书面语转成奚童口吻）
            let textToRead = previewText;
            try {
                textToRead = await this.summarizer.oralRewrite(previewText);
            } catch (err) {
                console.warn('[TTS] Oral rewrite failed, using original text:', err);
            }

            // 6. Markdown 清洗 + 数字归一化
            try {
                textToRead = await this.expressivePreprocessor.preprocess(textToRead, {
                    enableMarks: false,
                });
            } catch {}

            // 7. 构建 TTS 选项 + 合成语音
            const ttsOptions = this.buildTTSOptions(voiceProfile);
            const audioBuffer = await this.client.synthesize(textToRead, ttsOptions);

            // 8. 缓存
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);
            this.setCache(cacheKey, { blobUrl, audio });
            this.previewBuffers.set(cacheKey, audioBuffer);

            console.log(`[TTS] Preloaded oral preview for message ${messageId} (${previewText.length} chars)`);

            // 9. 后台启动全量改写（利用用户阅读的 3-10 秒空白）
            if (cleanContent.length > 250 && !this.rewrittenCache.has(messageId) && !this.pendingRewrites.has(messageId)) {
                this.startFullRewrite(messageId, cleanContent);
            }
        } catch (err) {
            console.warn('[TTS] Preload preview failed:', err);
        }
    }

    /**
     * 后台全量口语化改写，结果存入 rewrittenCache
     */
    private startFullRewrite(messageId: string, content: string): void {
        const promise = this.summarizer.oralRewrite(content)
            .then(rewritten => {
                this.rewrittenCache.set(messageId, rewritten);
                this.pendingRewrites.delete(messageId);
                console.log(`[TTS] Full oral rewrite completed for ${messageId} (${content.length} → ${rewritten.length} chars)`);
                return rewritten;
            })
            .catch(err => {
                console.warn('[TTS] Full oral rewrite failed:', err);
                this.pendingRewrites.delete(messageId);
                return '';
            });

        this.pendingRewrites.set(messageId, promise);
    }

    /**
     * 口语化改写 + 朗读（rawText 路径）
     *
     * 流程：
     * 1. 有预缓存 → 播放缓存（已是口语化版本）
     * 2. 查全量改写缓存 → 有则走预取流水线（流畅无间隙）
     * 3. 全量改写进行中 → 等待完成后走预取流水线
     * 4. 都没有 → 降级 playSegmented 原文朗读
     */
    private async playWithOralRewrite(
        messageId: string,
        fullContent: string,
        voiceProfile: VoiceProfile,
        cached?: CachedAudio,
        diskSaveKey?: string,
    ): Promise<void> {
        const totalChars = fullContent.length;

        // 已有完整音频缓存（第二次点击）→ 直接播放
        if (cached?.isFull) {
            this.setState('playing');
            cached.audio.currentTime = 0;
            this.startMappedProgressTracking(messageId, cached.audio, {
                segmentStart: 0,
                segmentEnd: 1,
            });
            await this.playAudioAndWait(messageId, cached.audio);
            if (this.currentMessageId === messageId) {
                this.onProgressChange?.(messageId, 100);
                this.setState('idle');
                this.currentMessageId = null;
            }
            return;
        }

        // 1. 播放预缓存（前 250 字符的口语化音频）
        let playedChars = 0;
        if (cached) {
            this.setState('playing');
            const previewChars = Math.min(250, totalChars);
            const previewRatio = previewChars / totalChars;
            this.startMappedProgressTracking(messageId, cached.audio, {
                segmentStart: 0,
                segmentEnd: previewRatio,
            });
            await this.playAudioAndWait(messageId, cached.audio);
            playedChars = previewChars;
        }

        if (this.currentMessageId !== messageId) return;

        // 2. 获取改写后的文本：仅查缓存，不等 LLM 现场改写（延迟优化）
        let rewrittenText: string | undefined;

        if (this.rewrittenCache.has(messageId)) {
            rewrittenText = this.rewrittenCache.get(messageId);
        } else if (this.pendingRewrites.has(messageId)) {
            rewrittenText = await this.pendingRewrites.get(messageId)!;
            if (this.currentMessageId !== messageId) return;
        }
        // 无缓存时直接用原文，不等 oralRewrite

        if (this.currentMessageId !== messageId) return;

        // 3. 有改写文本 → 截取剩余部分，走预取流水线
        if (rewrittenText) {
            // 预缓存已播放前 playedChars 原文字符对应的改写内容
            // 粗略估算：改写文本长度 ≈ 原文长度，按比例截取
            const skipRatio = playedChars / totalChars;
            const skipChars = Math.floor(rewrittenText.length * skipRatio);
            const remainingRewritten = rewrittenText.slice(skipChars);

            if (remainingRewritten.trim()) {
                // 预处理改写后的文本
                let textToRead = remainingRewritten;
                try {
                    textToRead = await this.expressivePreprocessor.preprocess(remainingRewritten, {
                        enableMarks: false,
                    });
                } catch {}

                if (textToRead && this.currentMessageId === messageId) {
                    await this.playSegmented(messageId, textToRead, voiceProfile, {
                        originalOffset: playedChars,
                        originalTotal: totalChars,
                    }, diskSaveKey);
                }
                return;
            }
        }

        // 4. 降级：原文分段朗读
        const remaining = fullContent.slice(playedChars);
        if (remaining.trim()) {
            await this.playSegmented(messageId, remaining, voiceProfile, {
                originalOffset: playedChars,
                originalTotal: totalChars,
            }, diskSaveKey);
        } else if (this.currentMessageId === messageId) {
            this.onProgressChange?.(messageId, 100);
            this.setState('idle');
            this.currentMessageId = null;
        }
    }

    /**
     * 分段朗读：将长文本切分为多个段落，按顺序播放
     *
     * 好处：
     * 1. 每段文本短（200-500 字符），TTS 不容易"胡说八道"
     * 2. 可以为每段设置不同的风格标签（规则引擎）
     * 3. 进度追踪更精确（按分段映射）
     * 4. 首段预生成，用户点击即播
     */
    /** 并发合成池的最大同时请求数 */
    private static readonly SYNTHESIS_CONCURRENCY = 3;

    private async playSegmented(
        messageId: string,
        fullContent: string,
        voiceProfile: VoiceProfile,
        /** 进度映射到原文的坐标（缺省则用改写文本自身坐标） */
        progressMap?: { originalOffset: number; originalTotal: number },
        /** 磁盘缓存 key（textHash），传入则在合并后写磁盘 */
        diskSaveKey?: string,
    ): Promise<void> {
        const segments = this.splitTextIntoSegments(fullContent, 300);
        const totalSegments = segments.length;
        if (totalSegments === 0) return;

        const totalChars = fullContent.length;
        const pOffset = progressMap?.originalOffset ?? 0;
        const pTotal = progressMap?.originalTotal ?? totalChars;
        const rangeStart = pOffset / pTotal;
        const rangeEnd = 1.0;

        let currentCharOffset = 0;
        const audioBuffers: ArrayBuffer[] = [];

        // 并发合成池：维护 SYNTHESIS_CONCURRENCY 个并行合成任务
        const pendingSynthesis = new Map<number, Promise<{ audio: HTMLAudioElement; buffer: ArrayBuffer }>>();
        let nextSynthIndex = 0;

        const launchSynthesis = (index: number) => {
            if (index >= totalSegments || pendingSynthesis.has(index)) return;
            pendingSynthesis.set(index, this.synthesizeSegment(segments[index], voiceProfile));
        };

        // 预启动合成池（首段 + 后续段并行）
        const initialBatch = Math.min(totalSegments, TTSService.SYNTHESIS_CONCURRENCY);
        for (let i = 0; i < initialBatch; i++) {
            launchSynthesis(i);
        }
        nextSynthIndex = initialBatch;

        for (let i = 0; i < totalSegments; i++) {
            if (this.currentMessageId !== messageId) return;

            const segmentText = segments[i];
            const segLocalStart = currentCharOffset / totalChars;
            const segLocalEnd = (currentCharOffset + segmentText.length) / totalChars;
            const segmentStart = rangeStart + segLocalStart * (rangeEnd - rangeStart);
            const segmentEnd = rangeStart + segLocalEnd * (rangeEnd - rangeStart);

            // 等待当前段合成完成
            const synthPromise = pendingSynthesis.get(i);
            pendingSynthesis.delete(i);
            let segResult: { audio: HTMLAudioElement; buffer: ArrayBuffer };
            try {
                segResult = await synthPromise!;
            } catch (err) {
                console.warn(`[TTS] Segment ${i} synthesis failed, skipping:`, err);
                currentCharOffset += segmentText.length;
                // 补充并发池
                if (nextSynthIndex < totalSegments) {
                    launchSynthesis(nextSynthIndex++);
                }
                continue;
            }

            if (this.currentMessageId !== messageId) return;

            audioBuffers.push(segResult.buffer);
            this.setState('playing');

            // 补充并发池：保持 SYNTHESIS_CONCURRENCY 个任务并行
            while (pendingSynthesis.size < TTSService.SYNTHESIS_CONCURRENCY && nextSynthIndex < totalSegments) {
                launchSynthesis(nextSynthIndex++);
            }

            if (!await this.waitIfPaused(messageId)) return;

            this.startMappedProgressTracking(messageId, segResult.audio, {
                segmentStart,
                segmentEnd,
            });

            try {
                await this.playAudioAndWait(messageId, segResult.audio);
            } catch (err) {
                if (err instanceof Error && err.message === 'STOPPED') throw err;
                console.warn(`[TTS] Segment ${i} playback failed:`, err);
            }

            currentCharOffset += segmentText.length;
        }

        // 播放完毕：合并所有段音频为完整 WAV，供下次即时重播
        if (this.currentMessageId === messageId && audioBuffers.length > 0) {
            try {
                const cacheKey = this.buildCacheKey(messageId, voiceProfile);
                const previewBuffer = this.previewBuffers.get(cacheKey);
                const chunks = previewBuffer ? [previewBuffer, ...audioBuffers] : audioBuffers;
                const merged = TTSService.mergeAudioChunks(chunks);
                const blob = new Blob([merged], { type: 'audio/wav' });
                const blobUrl = URL.createObjectURL(blob);
                const fullAudio = new Audio(blobUrl);
                const old = this.cache.get(cacheKey);
                if (old) {
                    old.audio.pause();
                    old.audio.src = '';
                    URL.revokeObjectURL(old.blobUrl);
                }
                this.setCache(cacheKey, { blobUrl, audio: fullAudio, isFull: true });
                this.previewBuffers.delete(cacheKey);

                // 异步写入磁盘缓存（不阻塞播放结束）
                if (diskSaveKey) {
                    this.saveToDiskCache(diskSaveKey, voiceProfile.voice, merged).catch(err => console.warn('[TTS] Async disk save failed:', err));
                }
            } catch (err) {
                console.warn('[TTS] Failed to cache merged audio:', err);
            }

            this.onProgressChange?.(messageId, 100);
            this.setState('idle');
            this.currentMessageId = null;
        }
    }

    /**
     * 将文本切分为多个段落
     *
     * 切分策略：
     * 1. 优先按段落（\n\n）切分
     * 2. 段落过长时按句子切分
     * 3. 每段目标长度：targetChars（默认 300 字符）
     */
    private splitTextIntoSegments(text: string, targetChars: number = 300): string[] {
        // 先按段落切分
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
        const segments: string[] = [];
        let currentSegment = '';

        for (const para of paragraphs) {
            // 如果当前段落加上已有内容不超过目标，合并
            if (currentSegment.length + para.length <= targetChars) {
                currentSegment = currentSegment ? `${currentSegment}\n\n${para}` : para;
                continue;
            }

            // 如果当前段落已有内容，先保存
            if (currentSegment) {
                segments.push(currentSegment);
                currentSegment = '';
            }

            // 单个段落超过目标长度，按句子切分
            if (para.length > targetChars) {
                const sentences = para.split(/([。！？.!?])/);
                let sentenceSegment = '';

                for (let i = 0; i < sentences.length; i++) {
                    const piece = sentences[i];
                    if (sentenceSegment.length + piece.length <= targetChars) {
                        sentenceSegment += piece;
                    } else {
                        if (sentenceSegment) segments.push(sentenceSegment);
                        sentenceSegment = piece;
                    }
                }
                if (sentenceSegment) currentSegment = sentenceSegment;
            } else {
                currentSegment = para;
            }
        }

        // 最后一段
        if (currentSegment) {
            segments.push(currentSegment);
        }

        return segments;
    }

    /**
     * 先播放预生成缓存，然后分段朗读剩余内容
     *
     * 流程：
     * 1. 立即播放预生成的缓存（前 100 字符）
     * 2. 分段朗读剩余内容（每段 300 字符）
     * 3. 进度追踪按分段映射，实现高亮同步
     */
    private async playSegmentedWithCache(
        messageId: string,
        fullContent: string,
        voiceProfile: VoiceProfile,
        cached: CachedAudio,
    ): Promise<void> {
        const totalChars = fullContent.length;
        const previewChars = Math.min(100, totalChars);
        const previewRatio = previewChars / totalChars;

        // 1. 播放预生成缓存（前 100 字符）
        this.setState('playing');

        // 在播放缓存的同时，提前合成剩余的第一段
        const remainingContent = fullContent.slice(previewChars);
        const segments = remainingContent.length > 0
            ? this.splitTextIntoSegments(remainingContent, 300)
            : [];
        let nextResult: Promise<{ audio: HTMLAudioElement; buffer: ArrayBuffer }> | null = segments.length > 0
            ? this.synthesizeSegment(segments[0], voiceProfile)
            : null;

        this.startMappedProgressTracking(messageId, cached.audio, {
            segmentStart: 0,
            segmentEnd: previewRatio,
        });

        await this.playAudioAndWait(messageId, cached.audio);

        if (this.currentMessageId !== messageId) return;

        // 2. 分段朗读剩余内容（带预取）
        let currentCharOffset = previewChars;

        for (let i = 0; i < segments.length; i++) {
            if (this.currentMessageId !== messageId) return;

            const segmentText = segments[i];
            const segmentStart = currentCharOffset / totalChars;
            const segmentEnd = (currentCharOffset + segmentText.length) / totalChars;

            const { audio } = await nextResult!;

            if (this.currentMessageId !== messageId) return;

            nextResult = i + 1 < segments.length
                ? this.synthesizeSegment(segments[i + 1], voiceProfile)
                : null;

            this.startMappedProgressTracking(messageId, audio, {
                segmentStart,
                segmentEnd,
            });

            await this.playAudioAndWait(messageId, audio);

            currentCharOffset += segmentText.length;
        }

        // 3. 播放完毕
        if (this.currentMessageId === messageId) {
            this.onProgressChange?.(messageId, 100);
            this.setState('idle');
            this.currentMessageId = null;
        }
    }

    /**
     * 带映射的进度追踪
     *
     * 将音频的本地进度（0-100%）映射到全局进度（segmentStart → segmentEnd）
     * 供 highlightTTSProgress 使用，实现段落级高亮同步
     */
    private startMappedProgressTracking(
        messageId: string,
        audio: HTMLAudioElement,
        range: { segmentStart: number; segmentEnd: number },
    ): void {
        this.clearProgressTimer();
        let lastSentProgress = -1;

        this.progressTimer = setInterval(() => {
            if (this.currentMessageId !== messageId || audio.paused) return;
            const duration = audio.duration || 1;
            const currentTime = audio.currentTime;

            // 本地进度 0-1
            const localRatio = Math.min(1, Math.max(0, currentTime / duration));
            // 全局进度 0-100
            const globalProgress = Math.round(
                (range.segmentStart + localRatio * (range.segmentEnd - range.segmentStart)) * 100
            );

            if (globalProgress !== lastSentProgress) {
                lastSentProgress = globalProgress;
                this.onProgressChange?.(messageId, globalProgress);
            }
        }, 200);
    }

    /**
     * 合成单段音频（预处理 + TTS），返回 Audio 元素和原始 buffer
     */
    private async synthesizeSegment(
        segmentText: string,
        voiceProfile: VoiceProfile,
    ): Promise<{ audio: HTMLAudioElement; buffer: ArrayBuffer }> {
        let textToRead = segmentText;
        if (this.currentGenre) {
            try {
                textToRead = await this.expressivePreprocessor.preprocess(segmentText, {
                    enableMarks: false,
                });
            } catch {}
        }
        // V2.5: audioTag 前置到 assistant content，控制整体朗读风格
        textToRead = this.withAudioTag(textToRead, voiceProfile);
        const ttsOptions = this.buildTTSOptions(voiceProfile);
        const audioBuffer = await this.client.synthesize(textToRead, ttsOptions);
        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        return { audio: new Audio(blobUrl), buffer: audioBuffer };
    }

    /**
     * 播放单个音频并等待结束，支持中断检查
     * stop 时通过 playbackReject 释放挂起的 promise
     */
    private playAudioAndWait(messageId: string, audio: HTMLAudioElement): Promise<void> {
        this.currentAudio = audio;
        return new Promise<void>((resolve, reject) => {
            this.playbackReject = reject;
            const cleanup = () => {
                this.currentAudio = null;
                this.playbackReject = null;
            };
            audio.onended = () => { cleanup(); resolve(); };
            audio.onerror = () => { cleanup(); reject(new Error('Audio play error')); };
            audio.play().catch((err) => { cleanup(); reject(err); });
        });
    }

    /**
     * 暂停期间阻塞，等用户恢复或停止
     * 返回 false 表示已被停止，调用方应退出
     */
    private async waitIfPaused(messageId: string): Promise<boolean> {
        if (this.state !== 'paused' || this.currentMessageId !== messageId) {
            return this.currentMessageId === messageId;
        }
        await new Promise<void>(resolve => {
            this.resumeResolver = resolve;
        });
        return this.currentMessageId === messageId;
    }

    /**
     * 构建带音色指纹的缓存 key
     */
    private buildCacheKey(messageId: string, voiceProfile: VoiceProfile): string {
        return `${messageId}_${voiceProfile.voice}`;
    }

    /** 原文内容哈希（djb2），用于磁盘缓存的稳定 key */
    private getTextHash(text: string): string {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0x7fffffff;
        }
        return hash.toString(16);
    }

    private async ensureDiskCacheDir(): Promise<void> {
        if (!this.diskCacheDir) return;
        await fs.mkdir(this.diskCacheDir, { recursive: true });
    }

    private async readDiskManifest(): Promise<ManifestEntry[]> {
        if (!this.diskCacheDir) return [];
        try {
            const data = await fs.readFile(path.join(this.diskCacheDir, 'manifest.json'), 'utf-8');
            return (JSON.parse(data) as DiskManifest).entries ?? [];
        } catch {
            return [];
        }
    }

    private async writeDiskManifest(entries: ManifestEntry[]): Promise<void> {
        if (!this.diskCacheDir) return;
        await this.ensureDiskCacheDir();
        await fs.writeFile(
            path.join(this.diskCacheDir, 'manifest.json'),
            JSON.stringify({ entries }, null, 2),
        );
    }

    /** 将合并后的音频写入磁盘缓存，淘汰超过上限的旧条目 */
    private async saveToDiskCache(textHash: string, voice: string, audioBuffer: ArrayBuffer): Promise<void> {
        if (!this.diskCacheDir) return;
        // manifest 写锁：序列化并发写入，防止 read→write 竞争
        this.manifestLock = this.manifestLock.then(async () => {
            try {
                await this.ensureDiskCacheDir();
                const wavFile = `${textHash}_${voice}.wav`;
                const wavPath = path.join(this.diskCacheDir, wavFile);
                await fs.writeFile(wavPath, Buffer.from(audioBuffer));

                let entries = await this.readDiskManifest();
                entries = entries.filter(e => !(e.textHash === textHash && e.voice === voice));
                entries.push({ textHash, voice, wavFile, createdAt: Date.now() });

                entries.sort((a, b) => b.createdAt - a.createdAt);
                const removed = entries.splice(TTSService.MAX_DISK_ENTRIES);
                for (const r of removed) {
                    try { await fs.unlink(path.join(this.diskCacheDir, r.wavFile)); } catch {}
                }

                await this.writeDiskManifest(entries);
                console.log(`[TTS] Disk cache saved: ${wavFile} (${entries.length} entries)`);
            } catch (err) {
                console.warn('[TTS] Disk cache save failed:', err);
            }
        });
        await this.manifestLock;
    }

    /** 写入内存缓存，超出上限时淘汰最旧条目并释放 Blob URL */
    private setCache(key: string, entry: CachedAudio): void {
        if (this.cache.size >= TTSService.MAX_CACHE_ENTRIES && !this.cache.has(key)) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                const old = this.cache.get(oldest)!;
                URL.revokeObjectURL(old.blobUrl);
                this.cache.delete(oldest);
            }
        }
        this.cache.set(key, entry);
    }

    /** 从磁盘缓存加载音频，未命中返回 null */
    private async loadFromDiskCache(textHash: string, voice: string): Promise<CachedAudio | null> {
        if (!this.diskCacheDir) return null;
        try {
            const wavFile = `${textHash}_${voice}.wav`;
            const wavPath = path.join(this.diskCacheDir, wavFile);
            const buffer = await fs.readFile(wavPath);
            const audioBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);
            return { blobUrl, audio, isFull: true };
        } catch {
            return null;
        }
    }

    /**
     * 构建 V2.5 导演模式提示词（放入 user message）
     * 格式：角色 / 场景 / 指导 三维度
     */
    private buildStyleText(genre: BookGenre | null, voiceProfile: VoiceProfile): string {
        const genreHint = genre?.subGenre
            ? `，这是一本「${genre.subGenre}」类型的书籍`
            : '';

        return `角色：你叫奚童，是用户的伴读书童，像一位聪明伶俐的小师妹。你年轻活泼，爱读书，声音清亮温润，带着书卷气和少女的灵动。你不是冷冰冰的AI，而是一个有温度的朗读伙伴。称呼用户时，偶尔说"你看呀""你说是不是""你想想"这样拉近距离的话。

场景：你正在为用户朗读书籍内容${genreHint}，就像坐在用户旁边，翻开书页一起读。

指导：${voiceProfile.speedHint}${voiceProfile.moodHint}像和朋友分享读书心得一样自然，不要机械念稿。具体要求：
- 语气要像聊天，不要像念课文
- 关键概念处稍微加重，就像在说"你注意听这里哦"
- 金句和引用处放缓语速，留出回味空间
- 段落之间自然过渡，不要生硬跳转
- 遇到疑问句时带一点好奇的语气
- 遇到感叹句时带一点惊喜`;
    }

    pause(): void {
        if (this.state === 'playing') {
            if (this.streamPlayer) {
                this.streamPlayer.pause();
            } else if (this.currentAudio) {
                this.currentAudio.pause();
            }
            this.setState('paused');
        }
    }

    async resume(): Promise<void> {
        if (this.state === 'paused') {
            if (this.streamPlayer) {
                this.streamPlayer.resume();
            } else if (this.currentAudio) {
                await this.currentAudio.play();
            }
            this.setState('playing');
            // 唤醒 waitIfPaused 中的阻塞
            this.resumeResolver?.();
            this.resumeResolver = null;
        }
    }

    stop(): void {
        this.stopStreamPlayer();
        this.clearProgressTimer();
        // 唤醒 waitIfPaused 中的阻塞
        this.resumeResolver?.();
        this.resumeResolver = null;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
        // 释放挂起的 playAudioAndWait promise
        if (this.playbackReject) {
            this.playbackReject(new Error('STOPPED'));
            this.playbackReject = null;
        }
        this.setState('idle');
        this.currentMessageId = null;
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
        const defaultProfile = getDefaultVoiceProfile(this.ttsProvider);
        const audioBuffer = await this.client.synthesize(summary, this.buildTTSOptions(defaultProfile));
        const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
        return { audioBuffer, duration };
    }

    /**
     * 直接合成原文朗读（用于信封展开后的喇叭按钮，不经过 Summarizer）
     */
    async synthesizeRawText(text: string): Promise<{ audioBuffer: ArrayBuffer; duration: number }> {
        const cleanText = stripWikiLinksForTTS(text);
        const defaultProfile = getDefaultVoiceProfile(this.ttsProvider);
        const audioBuffer = await this.client.synthesize(cleanText, this.buildTTSOptions(defaultProfile));
        const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
        return { audioBuffer, duration };
    }

    destroy(): void {
        this.stopStreamPlayer();
        this.clearProgressTimer();
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (this.playbackReject) {
            this.playbackReject(new Error('STOPPED'));
            this.playbackReject = null;
        }
        for (const [, cached] of this.cache) {
            cached.audio.pause();
            cached.audio.src = '';
            URL.revokeObjectURL(cached.blobUrl);
        }
        this.cache.clear();
        this.rewrittenCache.clear();
        this.pendingRewrites.clear();
        this.previewBuffers.clear();
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
        voiceProfile?: VoiceProfile,
    ): Promise<void> {
        const player = new PCMStreamPlayer(24000);
        this.streamPlayer = player;
        this.setState('summarizing');

        let buffer = '';
        let fullSummary = '';
        let ttsStarted = false;

        const ttsOptions = this.buildTTSOptions(voiceProfile || getDefaultVoiceProfile(this.ttsProvider));
        let firstSentence = true;

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

                    const tagged = firstSentence ? this.withAudioTag(sentence, voiceProfile) : sentence;
                    firstSentence = false;
                    for await (const chunk of this.client.synthesizeStream(tagged, ttsOptions)) {
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
                for await (const chunk of this.client.synthesizeStream(tail, ttsOptions)) {
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
                const cacheKey = voiceProfile
                    ? this.buildCacheKey(messageId, voiceProfile)
                    : messageId;
                this.setCache(cacheKey, { blobUrl, audio });
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
     *
     * 进度追踪策略：
     * - 所有 chunk 入队前（seal 前）：分母不确定，等待，进度保持 0
     * - seal 后：使用精确的总时长计算进度，每步最多涨 5% 平滑过渡
     */
    private async playStream(messageId: string, text: string, voiceProfile?: VoiceProfile): Promise<void> {
        const player = new PCMStreamPlayer(24000);
        this.streamPlayer = player;
        this.setState('playing');

        let sealedEndTime = 0;
        let sealDone = false;
        let lastSentProgress = -1;

        const ttsOptions = this.buildTTSOptions(voiceProfile || getDefaultVoiceProfile(this.ttsProvider));
        const taggedText = this.withAudioTag(text, voiceProfile);

        const startProgressTracking = () => {
            if (this.progressTimer) clearInterval(this.progressTimer);
            this.progressTimer = setInterval(() => {
                if (this.currentMessageId !== messageId) {
                    this.clearProgressTimer();
                    return;
                }

                if (!sealDone) {
                    // seal 之前：进度保持 0
                    if (lastSentProgress !== 0) {
                        lastSentProgress = 0;
                        this.onProgressChange?.(messageId, 0);
                    }
                    return;
                }

                // seal 之后：计算精确进度
                if (sealedEndTime <= player.startTime) return;

                const current = player.currentTime;
                const rawProgress = Math.min(100, Math.max(0, Math.round(((current - player.startTime) / (sealedEndTime - player.startTime)) * 100)));

                // 平滑追赶实际进度，每 200ms 最多涨 5%
                const cappedProgress = Math.min(rawProgress, lastSentProgress < 0 ? 0 : lastSentProgress + 5);
                if (cappedProgress !== lastSentProgress) {
                    lastSentProgress = cappedProgress;
                    this.onProgressChange?.(messageId, cappedProgress);
                }
            }, 200);
        };

        startProgressTracking();

        try {
            for await (const chunk of this.client.synthesizeStream(taggedText, ttsOptions)) {
                if (this.currentMessageId !== messageId) return;
                player.enqueue(chunk);
            }

            if (this.currentMessageId !== messageId) return;

            // seal：记录固定总时长，立即开始精确追踪
            player.seal();
            sealedEndTime = player.endTime;
            lastSentProgress = -1; // 重置，让 seal 后的第一个进度值从 0 开始追赶
            sealDone = true;

            await player.waitForEnd();
            this.clearProgressTimer();

            const wavBlob = player.assembleWav();
            const blobUrl = URL.createObjectURL(wavBlob);
            const audio = new Audio(blobUrl);
            const cacheKey = voiceProfile
                ? this.buildCacheKey(messageId, voiceProfile)
                : messageId;
            this.setCache(cacheKey, { blobUrl, audio });
            this.listenAudio(audio, messageId);

            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
            }
        } finally {
            this.clearProgressTimer();
            player.stop();
            if (this.streamPlayer === player) {
                this.streamPlayer = null;
            }
        }
    }

    /**
     * 非流式播放：等待完整音频生成后播放（降级方案）
     */
    private async playNonStream(messageId: string, text: string, voiceProfile?: VoiceProfile): Promise<void> {
        if (this.currentMessageId !== messageId) {
            this.setState('idle');
            return;
        }

        this.setState('tts_loading');

        const ttsOptions = this.buildTTSOptions(voiceProfile || getDefaultVoiceProfile(this.ttsProvider));
        const audioBuffer = await this.client.synthesize(this.withAudioTag(text, voiceProfile), ttsOptions);

        if (this.currentMessageId !== messageId) {
            this.setState('idle');
            return;
        }

        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);

        const cacheKey = voiceProfile
            ? this.buildCacheKey(messageId, voiceProfile)
            : messageId;
        this.setCache(cacheKey, { blobUrl, audio });
        this.listenAudioWithProgress(audio, messageId);

        this.setState('playing');
        await audio.play();
    }

    private stopInternal(): void {
        this.stopStreamPlayer();
        this.clearProgressTimer();
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
        // 释放挂起的 playAudioAndWait promise
        if (this.playbackReject) {
            this.playbackReject(new Error('STOPPED'));
            this.playbackReject = null;
        }
        this.setState('idle');
        this.currentMessageId = null;
        this.currentGenre = null;
    }

    /**
     * 将 VoiceProfile 转换为 TTSClient 的 TTSVoiceOptions
     * 注意：emotion/scene 仅用于内部音色选择，不发送给 API
     */
    private toTTSVoiceOptions(profile: VoiceProfile): TTSVoiceOptions {
        return { voice: profile.voice };
    }

    /**
     * 构建 TTSOptions（含 styleText），供所有播放方法复用
     */
    private buildTTSOptions(voiceProfile: VoiceProfile): TTSOptions {
        return {
            voiceProfile: this.toTTSVoiceOptions(voiceProfile),
            styleText: this.buildStyleText(this.currentGenre, voiceProfile),
        };
    }

    /** 将 V2.5 audioTag 前置到文本 */
    private withAudioTag(text: string, voiceProfile: VoiceProfile | undefined): string {
        const tag = voiceProfile?.audioTag;
        return tag ? `${tag}${text}` : text;
    }

    private clearProgressTimer(): void {
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
    }

    /**
     * 监听音频播放并发送进度
     */
    private listenAudioWithProgress(audio: HTMLAudioElement, messageId: string): void {
        // 清理旧定时器
        this.clearProgressTimer();

        // 定时检查播放进度
        this.progressTimer = setInterval(() => {
            if (this.currentMessageId !== messageId || audio.paused) return;
            const duration = audio.duration || 1;
            const currentTime = audio.currentTime;
            const progress = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
            this.onProgressChange?.(messageId, progress);
        }, 200);

        audio.onended = () => {
            this.clearProgressTimer();
            audio.currentTime = 0;
            if (this.currentMessageId === messageId) {
                this.onProgressChange?.(messageId, 100);
                this.setState('idle');
                this.currentMessageId = null;
            }
        };

        audio.onerror = () => {
            this.clearProgressTimer();
            console.error('[TTS] Audio playback error');
            if (this.currentMessageId === messageId) {
                this.setState('idle');
                this.currentMessageId = null;
            }
        };
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

/**
 * WAV 文件头部写入字符串的辅助函数
 */
function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
