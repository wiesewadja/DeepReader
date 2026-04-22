import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TTSClient', () => {
    let client: any;
    const mockApiKey = 'test-mimo-key';

    beforeEach(async () => {
        global.fetch = vi.fn();
        const { TTSClient } = await import('../tts-client');
        client = new TTSClient({
            apiKey: mockApiKey,
            baseUrl: 'https://api.xiaomimimo.com/v1',
        });
    });

    it('应该正确构造请求', async () => {
        const mockAudio = new ArrayBuffer(8);
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(mockAudio),
        });

        await client.synthesize('你好');

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.xiaomimimo.com/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': `Bearer ${mockApiKey}`,
                    'Content-Type': 'application/json',
                }),
            })
        );

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.model).toBe('mimo-v2-tts');
        expect(body.messages[0].content).toBe('你好');
        expect(body.voice).toBe('default_zh');
    });

    it('应该支持自定义 voice', async () => {
        const mockAudio = new ArrayBuffer(8);
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(mockAudio),
        });

        await client.synthesize('hello', { voice: 'default_en' });

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.voice).toBe('default_en');
    });

    it('应该在 API 错误时抛出异常', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: () => Promise.resolve('Invalid API key'),
        });

        await expect(client.synthesize('test')).rejects.toThrow('TTS API error: 401');
    });
});
