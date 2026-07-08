import { nodeFs } from '../../utils/node-fs.js';
import { serviceLog } from '../../utils/logger.js';
import { vaultRead, vaultReadBinary, vaultExists, vaultMkdir, vaultRemove, vaultWrite, vaultWriteBinary, joinPath } from '../../utils/mobile-fs.js';
import type { App } from 'obsidian';

export interface CachedAudio {
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

export interface TTSCacheConfig {
    /** Obsidian App instance for mobile-compatible file access */
    app?: App;
    /** Vault root path (desktop only) */
    vaultPath?: string;
    /** Plugin ID for isolating cache directories */
    pluginId: string;
}

export const MAX_CACHE_ENTRIES = 20;
export const MAX_DISK_ENTRIES = 10;

export class TTSCacheManager {
    private cache: Map<string, CachedAudio> = new Map();
    private diskCacheDir: string = '';
    private app?: App;
    private manifestLock: Promise<void> = Promise.resolve();

    constructor(config: TTSCacheConfig) {
        this.app = config.app;
        if (config.vaultPath || config.app) {
            const rel = `.obsidian/plugins/${config.pluginId}/tts-cache`;
            this.diskCacheDir = config.app
                ? rel
                : require('path').join(config.vaultPath!, rel);
        }
    }

    /**
     * 构建带音色指纹的缓存 key
     */
    buildCacheKey(messageId: string, voiceProfile: { voice: string; voiceDesignPrompt?: string }): string {
        const prefix = voiceProfile.voiceDesignPrompt ? 'vd_' : '';
        const voiceId = voiceProfile.voiceDesignPrompt ? 'voicedesign' : voiceProfile.voice;
        return `${prefix}${messageId}_${voiceId}`;
    }

    /** 原文内容哈希（djb2），用于磁盘缓存的稳定 key */
    getTextHash(text: string): string {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0x7fffffff;
        }
        return hash.toString(16);
    }

    /** 写入内存缓存，超出上限时淘汰最旧条目并释放 Blob URL */
    setCache(key: string, entry: CachedAudio): void {
        if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                const old = this.cache.get(oldest)!;
                URL.revokeObjectURL(old.blobUrl);
                this.cache.delete(oldest);
            }
        }
        this.cache.set(key, entry);
    }

    /** 读取内存缓存 */
    getCache(key: string): CachedAudio | undefined {
        return this.cache.get(key);
    }

    /** 检查内存缓存是否存在 */
    hasCache(key: string): boolean {
        return this.cache.has(key);
    }

    /** 从内存缓存中删除 */
    deleteCache(key: string): boolean {
        return this.cache.delete(key);
    }

    /** 内存缓存大小 */
    get cacheSize(): number {
        return this.cache.size;
    }

    /** 从磁盘缓存加载音频，未命中返回 null */
    async loadFromDiskCache(textHash: string, voice: string): Promise<CachedAudio | null> {
        if (!this.diskCacheDir) return null;
        try {
            const wavFile = `${textHash}_${voice}.wav`;
            const wavPath = this.app
                ? joinPath(this.diskCacheDir, wavFile)
                : require('path').join(this.diskCacheDir, wavFile);
            let audioBuffer: ArrayBuffer;
            if (this.app) {
                audioBuffer = await vaultReadBinary(this.app, wavPath);
            } else {
                const buffer = await nodeFs().readFile(wavPath);
                audioBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            }
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);
            return { blobUrl, audio, isFull: true };
        } catch {
            return null;
        }
    }

    /** 将合并后的音频写入磁盘缓存，淘汰超过上限的旧条目 */
    async saveToDiskCache(textHash: string, voice: string, audioBuffer: ArrayBuffer): Promise<void> {
        if (!this.diskCacheDir) return;
        // manifest 写锁：序列化并发写入，防止 read→write 竞争
        this.manifestLock = this.manifestLock.then(async () => {
            try {
                await this.ensureDiskCacheDir();
                const wavFile = `${textHash}_${voice}.wav`;
                const wavPath = this.app
                    ? joinPath(this.diskCacheDir, wavFile)
                    : require('path').join(this.diskCacheDir, wavFile);
                if (this.app) {
                    await vaultWriteBinary(this.app, wavPath, audioBuffer);
                } else {
                    await nodeFs().writeFile(wavPath, Buffer.from(audioBuffer));
                }

                let entries = await this.readDiskManifest();
                entries = entries.filter(e => !(e.textHash === textHash && e.voice === voice));
                entries.push({ textHash, voice, wavFile, createdAt: Date.now() });

                entries.sort((a, b) => b.createdAt - a.createdAt);
                const removed = entries.splice(MAX_DISK_ENTRIES);
                for (const r of removed) {
                    try {
                        const removePath = this.app
                            ? joinPath(this.diskCacheDir, r.wavFile)
                            : require('path').join(this.diskCacheDir, r.wavFile);
                        if (this.app) {
                            await vaultRemove(this.app, removePath);
                        } else {
                            await nodeFs().unlink(removePath);
                        }
                    } catch { }
                }

                await this.writeDiskManifest(entries);
                serviceLog.info(`[TTS] Disk cache saved: ${wavFile} (${entries.length} entries)`);
            } catch (err) {
                serviceLog.warn('[TTS] Disk cache save failed:', err);
            }
        });
        await this.manifestLock;
    }

    private async ensureDiskCacheDir(): Promise<void> {
        if (!this.diskCacheDir) return;
        if (this.app) {
            if (!(await vaultExists(this.app, this.diskCacheDir))) {
                await vaultMkdir(this.app, this.diskCacheDir);
            }
        } else {
            await nodeFs().mkdir(this.diskCacheDir, { recursive: true });
        }
    }

    private async readDiskManifest(): Promise<ManifestEntry[]> {
        if (!this.diskCacheDir) return [];
        try {
            const manifestPath = this.app
                ? joinPath(this.diskCacheDir, 'manifest.json')
                : require('path').join(this.diskCacheDir, 'manifest.json');
            const data = this.app
                ? await vaultRead(this.app, manifestPath)
                : await nodeFs().readFile(manifestPath, 'utf-8');
            return (JSON.parse(data) as DiskManifest).entries ?? [];
        } catch {
            return [];
        }
    }

    private async writeDiskManifest(entries: ManifestEntry[]): Promise<void> {
        if (!this.diskCacheDir) return;
        await this.ensureDiskCacheDir();
        const manifestPath = this.app
            ? joinPath(this.diskCacheDir, 'manifest.json')
            : require('path').join(this.diskCacheDir, 'manifest.json');
        const content = JSON.stringify({ entries }, null, 2);
        if (this.app) {
            await vaultWrite(this.app, manifestPath, content);
        } else {
            await nodeFs().writeFile(manifestPath, content);
        }
    }

    /** 清理所有缓存（内存 + 释放 Blob URL） */
    clearAll(): void {
        for (const [, cached] of this.cache) {
            cached.audio.pause();
            cached.audio.src = '';
            URL.revokeObjectURL(cached.blobUrl);
        }
        this.cache.clear();
    }
}
