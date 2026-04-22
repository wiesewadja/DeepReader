import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

beforeEach(() => {
    mockPlay.mockClear();
    mockPause.mockClear();
    mockAddEventListener.mockClear();
    global.Audio = vi.fn().mockImplementation(() => ({
        play: mockPlay,
        pause: mockPause,
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
    })) as any;
});

describe('TTSService', () => {
    it('应该从 idle 状态开始', async () => {
        const { TTSService } = await import('../tts-service');
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
        const { TTSService } = await import('../tts-service');
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
        const { TTSService } = await import('../tts-service');
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
        const { TTSService } = await import('../tts-service');
        const service = new TTSService({
            ttsApiKey: 'key',
            ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
            llmApiKey: 'key',
            llmBaseUrl: 'https://api.deepseek.com',
            llmModel: 'deepseek-chat',
            onStateChange,
        });
        service.stop();
        expect(onStateChange).toHaveBeenCalledWith('idle');
    });
});
