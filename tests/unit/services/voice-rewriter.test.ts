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
    const chunks = [
      'data: {"choices":[{"delta":{"content":"请"}}]}\n',
      'data: {"choices":[{"delta":{"content":"总结"}}]}\n',
      'data: {"choices":[{"delta":{"content":"本书的核心观点"}}]}\n',
      'data: [DONE]\n',
    ];
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[0]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[1]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[2]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[3]) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: mockBody,
    } as unknown as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    const result: string[] = [];
    for await (const chunk of rewriter.rewrite('这本书讲的啥')) {
      result.push(chunk);
    }

    expect(result.join('')).toBe('请总结本书的核心观点');
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
    const chunks = [
      'data: {"choices":[{"delta":{"content":"《深度阅读》"}}]}\n',
      'data: [DONE]\n',
    ];
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[0]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[1]) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: mockBody,
    } as unknown as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    const result: string[] = [];
    for await (const chunk of rewriter.rewrite('总结一下', {
      title: '深度阅读',
      description: '一本关于阅读方法的书',
    })) {
      result.push(chunk);
    }

    expect(result.join('')).toBe('《深度阅读》');
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('深度阅读');
  });

  it('rewrite 失败时抛出错误', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    await expect(rewriter.rewrite('test').next()).rejects.toThrow('VoiceRewriter failed: 500');
  });

  it('rewrite 使用自定义 model 参数', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"测试"}}]}\n',
      'data: [DONE]\n',
    ];
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[0]) })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunks[1]) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: mockBody,
    } as unknown as Response);

    const rewriter = new VoiceRewriter({ ...mockConfig, model: 'custom-model' });
    const result: string[] = [];
    for await (const chunk of rewriter.rewrite('test')) {
      result.push(chunk);
    }

    expect(result.join('')).toBe('测试');
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe('custom-model');
  });
});
