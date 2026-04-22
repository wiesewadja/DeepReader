import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock safeRequest
vi.mock('../../../utils/safe-request.js', () => ({
    safeRequest: vi.fn(),
}));

describe('TTSSummarizer', () => {
    let summarizer: any;
    let safeRequest: any;

    beforeEach(async () => {
        safeRequest = (await import('../../../utils/safe-request.js')).safeRequest;
        safeRequest.mockReset();

        const { TTSSummarizer } = await import('../tts-summarizer');
        summarizer = new TTSSummarizer({
            apiKey: 'test-key',
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
        });
    });

    it('应该调用 LLM 并返回摘要文本', async () => {
        safeRequest.mockResolvedValueOnce({
            status: 200,
            headers: {},
            text: '',
            json: {
                choices: [{ message: { content: '<style>亲切</style>这本书讲了阅读方法。' } }],
            },
        });

        const result = await summarizer.summarize('这是一段很长的 AI 回答内容...');
        expect(result).toContain('<style>');
        expect(safeRequest).toHaveBeenCalled();
    });

    it('应该在 LLM 失败时抛出异常', async () => {
        safeRequest.mockRejectedValueOnce(new Error('Request failed'));

        await expect(summarizer.summarize('test')).rejects.toThrow();
    });

    it('应该在空响应时抛出异常', async () => {
        safeRequest.mockResolvedValueOnce({
            status: 200,
            headers: {},
            text: '',
            json: {
                choices: [{ message: { content: '' } }],
            },
        });

        await expect(summarizer.summarize('test')).rejects.toThrow('empty response');
    });
});
