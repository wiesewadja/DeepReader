import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TTSCacheManager, MAX_CACHE_ENTRIES, MAX_DISK_ENTRIES } from '@/services/tts/tts-cache';
import type { CachedAudio } from '@/services/tts/tts-cache';

// Mock URL.revokeObjectURL / URL.createObjectURL for vitest (no browser APIs)
const revokeObjectURLMock = vi.fn();
const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/mock');
vi.stubGlobal('URL', {
    revokeObjectURL: revokeObjectURLMock,
    createObjectURL: createObjectURLMock,
});

// Mock node-fs
vi.mock('@/utils/node-fs', () => ({
    nodeFs: vi.fn(() => ({
        mkdir: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn(),
        writeFile: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
    })),
}));

// Mock mobile-fs
vi.mock('@/utils/mobile-fs', () => ({
    vaultRead: vi.fn(),
    vaultReadBinary: vi.fn(),
    vaultExists: vi.fn().mockResolvedValue(false),
    vaultMkdir: vi.fn().mockResolvedValue(undefined),
    vaultRemove: vi.fn().mockResolvedValue(undefined),
    vaultWrite: vi.fn().mockResolvedValue(undefined),
    vaultWriteBinary: vi.fn().mockResolvedValue(undefined),
    joinPath: vi.fn((...parts: string[]) => parts.join('/')),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
    serviceLog: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

function createMockAudio(): HTMLAudioElement {
    return {
        pause: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
        src: '',
        currentTime: 0,
        duration: 10,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    } as unknown as HTMLAudioElement;
}

function createCachedAudio(overrides?: Partial<CachedAudio>): CachedAudio {
    return {
        blobUrl: 'blob:http://localhost/test',
        audio: createMockAudio(),
        ...overrides,
    };
}

describe('TTSCacheManager', () => {
    let manager: TTSCacheManager;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new TTSCacheManager({ pluginId: 'deepreader-dev' });
    });

    describe('buildCacheKey', () => {
        it('普通音色返回 messageId_voice 格式', () => {
            const key = manager.buildCacheKey('msg-1', { voice: 'alloy' });
            expect(key).toBe('msg-1_alloy');
        });

        it('VoiceDesign 音色返回 vd_ 前缀', () => {
            const key = manager.buildCacheKey('msg-1', { voice: 'default', voiceDesignPrompt: 'warm female' });
            expect(key).toBe('vd_msg-1_voicedesign');
        });
    });

    describe('getTextHash', () => {
        it('相同文本产生相同哈希', () => {
            const h1 = manager.getTextHash('hello world');
            const h2 = manager.getTextHash('hello world');
            expect(h1).toBe(h2);
        });

        it('不同文本产生不同哈希', () => {
            const h1 = manager.getTextHash('hello');
            const h2 = manager.getTextHash('world');
            expect(h1).not.toBe(h2);
        });

        it('返回十六进制字符串', () => {
            const hash = manager.getTextHash('test');
            expect(hash).toMatch(/^[0-9a-f]+$/);
        });
    });

    describe('内存缓存', () => {
        it('setCache/getCache 基本读写', () => {
            const entry = createCachedAudio();
            manager.setCache('key-1', entry);
            expect(manager.getCache('key-1')).toBe(entry);
        });

        it('hasCache 检查是否存在', () => {
            expect(manager.hasCache('key-1')).toBe(false);
            manager.setCache('key-1', createCachedAudio());
            expect(manager.hasCache('key-1')).toBe(true);
        });

        it('deleteCache 删除条目', () => {
            manager.setCache('key-1', createCachedAudio());
            expect(manager.deleteCache('key-1')).toBe(true);
            expect(manager.hasCache('key-1')).toBe(false);
        });

        it('deleteCache 不存在的 key 返回 false', () => {
            expect(manager.deleteCache('nonexistent')).toBe(false);
        });

        it('cacheSize 返回当前缓存条目数', () => {
            expect(manager.cacheSize).toBe(0);
            manager.setCache('a', createCachedAudio());
            manager.setCache('b', createCachedAudio());
            expect(manager.cacheSize).toBe(2);
        });

        it('超过上限时淘汰最旧条目', () => {
            // 填满缓存
            for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
                manager.setCache(`key-${i}`, createCachedAudio({ blobUrl: `blob://url-${i}` }));
            }
            expect(manager.cacheSize).toBe(MAX_CACHE_ENTRIES);

            // 添加新条目，应淘汰最旧的 key-0
            manager.setCache('key-new', createCachedAudio({ blobUrl: 'blob://new' }));
            expect(manager.cacheSize).toBe(MAX_CACHE_ENTRIES);
            expect(manager.hasCache('key-0')).toBe(false);
            expect(manager.hasCache('key-new')).toBe(true);
        });

        it('已存在的 key 不触发淘汰', () => {
            for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
                manager.setCache(`key-${i}`, createCachedAudio());
            }
            // 更新已存在的 key
            manager.setCache('key-5', createCachedAudio({ blobUrl: 'blob://updated' }));
            expect(manager.cacheSize).toBe(MAX_CACHE_ENTRIES);
            expect(manager.hasCache('key-0')).toBe(true); // 最旧未被淘汰
        });

        it('clearAll 释放所有 Blob URL 并清空缓存', () => {
            const audio1 = createMockAudio();
            const audio2 = createMockAudio();
            manager.setCache('a', { blobUrl: 'blob://a', audio: audio1 });
            manager.setCache('b', { blobUrl: 'blob://b', audio: audio2 });

            manager.clearAll();

            expect(manager.cacheSize).toBe(0);
            expect(audio1.pause).toHaveBeenCalled();
            expect(audio2.pause).toHaveBeenCalled();
        });
    });

    describe('磁盘缓存（无 app，Node.js 桌面路径）', () => {
        it('无 diskCacheDir 时 loadFromDiskCache 返回 null', async () => {
            // 无 vaultPath 且无 app → diskCacheDir 为空
            const result = await manager.loadFromDiskCache('hash', 'voice');
            expect(result).toBeNull();
        });

        it('无 diskCacheDir 时 saveToDiskCache 不执行写入', async () => {
            // 不应抛错
            await manager.saveToDiskCache('hash', 'voice', new ArrayBuffer(100));
        });
    });

    describe('磁盘缓存（有 app，移动端路径）', () => {
        let appManager: TTSCacheManager;
        const mockApp = {} as any;

        beforeEach(async () => {
            appManager = new TTSCacheManager({ pluginId: 'deepreader-dev', app: mockApp });

            // Mock vaultRead 返回空 manifest
            const { vaultRead } = await import('@/utils/mobile-fs');
            vi.mocked(vaultRead).mockResolvedValue(JSON.stringify({ entries: [] }));
        });

        it('loadFromDiskCache 通过 app 读取', async () => {
            const { vaultReadBinary } = await import('@/utils/mobile-fs');
            const wavBuffer = new ArrayBuffer(100);
            vi.mocked(vaultReadBinary).mockResolvedValue(wavBuffer);

            const result = await appManager.loadFromDiskCache('abc123', 'alloy');
            expect(result).not.toBeNull();
            expect(result!.isFull).toBe(true);
            expect(result!.blobUrl).toMatch(/^blob:/);
        });

        it('loadFromDiskCache 读取失败返回 null', async () => {
            const { vaultReadBinary } = await import('@/utils/mobile-fs');
            vi.mocked(vaultReadBinary).mockRejectedValue(new Error('not found'));

            const result = await appManager.loadFromDiskCache('abc123', 'alloy');
            expect(result).toBeNull();
        });
    });

    describe('常量', () => {
        it('MAX_CACHE_ENTRIES 为正整数', () => {
            expect(MAX_CACHE_ENTRIES).toBeGreaterThan(0);
            expect(Number.isInteger(MAX_CACHE_ENTRIES)).toBe(true);
        });

        it('MAX_DISK_ENTRIES 为正整数', () => {
            expect(MAX_DISK_ENTRIES).toBeGreaterThan(0);
            expect(Number.isInteger(MAX_DISK_ENTRIES)).toBe(true);
        });

        it('MAX_DISK_ENTRIES 不大于 MAX_CACHE_ENTRIES', () => {
            expect(MAX_DISK_ENTRIES).toBeLessThanOrEqual(MAX_CACHE_ENTRIES);
        });
    });
});
