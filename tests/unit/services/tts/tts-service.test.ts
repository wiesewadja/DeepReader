import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();

beforeEach(() => {
    mockPlay.mockClear();
    mockPause.mockClear();
    global.Audio = vi.fn().mockImplementation(() => ({
        play: mockPlay,
        pause: mockPause,
        currentTime: 0,
        src: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as any;
});

describe('TTSService', () => {
    it('应该从 idle 状态开始', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        expect(service.getState()).toBe('idle');
    });

    it('stop 应该回到 idle', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        service.stop();
        expect(service.getState()).toBe('idle');
    });

    it('getCurrentMessageId 初始为 null', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        expect(service.getCurrentMessageId()).toBeNull();
    });

    it('onStateChange 回调被正确调用', async () => {
        const onStateChange = vi.fn();
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
            onStateChange,
        });
        service.stop();
        expect(onStateChange).toHaveBeenCalledWith(null, 'idle');
    });

    it('destroy 应该清理缓存', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        service.destroy();
        expect(service.getState()).toBe('idle');
        expect(service.getCurrentMessageId()).toBeNull();
    });
});

describe('TTSService - Screen Wake Lock', () => {
    let mockRelease: any;
    let mockRequest: any;
    let visibilityHandlers: (() => void)[] = [];
    let originalNavigator: any;
    let originalDocument: any;

    beforeEach(() => {
        originalNavigator = global.navigator;
        originalDocument = global.document;

        mockRelease = vi.fn().mockResolvedValue(undefined);
        mockRequest = vi.fn().mockImplementation(async () => {
            const sentinel = {
                released: false,
                type: 'screen',
                onrelease: null as (() => void) | null,
                release: mockRelease
            };
            return sentinel;
        });

        // Mock navigator
        Object.defineProperty(global, 'navigator', {
            value: {
                wakeLock: {
                    request: mockRequest
                }
            },
            writable: true,
            configurable: true
        });

        visibilityHandlers = [];
        
        // Mock document
        Object.defineProperty(global, 'document', {
            value: {
                visibilityState: 'visible',
                addEventListener: vi.fn((event, handler) => {
                    if (event === 'visibilitychange') {
                        visibilityHandlers.push(handler);
                    }
                }),
                removeEventListener: vi.fn((event, handler) => {
                    if (event === 'visibilitychange') {
                        visibilityHandlers = visibilityHandlers.filter(h => h !== handler);
                    }
                })
            },
            writable: true,
            configurable: true
        });
    });

    afterEach(() => {
        Object.defineProperty(global, 'navigator', { value: originalNavigator, writable: true, configurable: true });
        Object.defineProperty(global, 'document', { value: originalDocument, writable: true, configurable: true });
    });

    it('如果不支持 wakeLock，不应报错且朗读正常', async () => {
        Object.defineProperty(global.navigator, 'wakeLock', { value: undefined, configurable: true });
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        // Trigger setState('playing') via private/internal call
        (service as any).setState('playing');
        expect(service.getState()).toBe('playing');
    });

    it('进入 playing 状态应该请求 wakeLock', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRequest).toHaveBeenCalledWith('screen');
    });

    it('进入 paused 状态应该释放 wakeLock', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRequest).toHaveBeenCalledTimes(1);

        (service as any).setState('paused');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('进入 idle 状态也应该释放 wakeLock', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        (service as any).setState('idle');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('调用 destroy 应该释放 wakeLock 并取消事件监听', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        service.destroy();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRelease).toHaveBeenCalledTimes(1);
        expect(visibilityHandlers.length).toBe(0);
    });

    it('切后台后回到前台（visibilitychange→visible）且正处于 playing 时应当重新获取 wakeLock', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRequest).toHaveBeenCalledTimes(1);

        // Simulate platform automatically releasing wake lock on visibilitychange/background
        const sentinel = (service as any).wakeLockSentinel;
        if (sentinel && sentinel.onrelease) {
            sentinel.onrelease();
        }
        expect((service as any).wakeLockSentinel).toBeNull();

        // Simulate switching to foreground
        (global.document as any).visibilityState = 'visible';
        for (const handler of visibilityHandlers) {
            handler();
        }

        // Wait a microtask
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('回到前台但处于 paused 时不重新获取 wakeLock', async () => {
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        (service as any).setState('paused');
        await new Promise(resolve => setTimeout(resolve, 0));
        mockRequest.mockClear();

        // Simulate switching to foreground
        (global.document as any).visibilityState = 'visible';
        for (const handler of visibilityHandlers) {
            handler();
        }

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('当 wakeLock 申请抛出异常时应当能容错且不影响状态变化', async () => {
        mockRequest.mockRejectedValue(new Error('Permission Denied'));
        const { TTSService } = await import('@/services/tts/tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
        });
        
        (service as any).setState('playing');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(service.getState()).toBe('playing');
        expect((service as any).wakeLockSentinel).toBeNull();
    });
});
