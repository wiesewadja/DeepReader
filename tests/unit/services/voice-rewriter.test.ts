import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceRewriter } from '../../../src/services/voice-rewriter.js';

describe('VoiceRewriter', () => {
  const mockConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v1',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrite 将口语转为书面语', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '请总结本书的核心观点' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    const result = await rewriter.rewrite('这本书讲的啥');

    expect(result).toBe('请总结本书的核心观点');
    expect(fetch).toHaveBeenCalledWith(
      `${mockConfig.baseUrl}/chat/completions`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': `Bearer ${mockConfig.apiKey}`,
        }),
      })
    );
  });

  it('rewrite 带书籍上下文', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '《深度阅读》的核心观点是...' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    const result = await rewriter.rewrite('总结一下', {
      title: '深度阅读',
      description: '一本关于阅读方法的书',
    });

    expect(result).toBe('《深度阅读》的核心观点是...');
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('深度阅读');
  });

  it('rewrite 失败时抛出错误', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    await expect(rewriter.rewrite('test')).rejects.toThrow('VoiceRewriter failed: 500');
  });
});
