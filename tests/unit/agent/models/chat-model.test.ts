import { describe, it, expect } from 'vitest';
import { createChatModels } from '@/agent/models/chat-model';

describe('ChatModel Factory', () => {
  it('should create main model with correct config', () => {
    const models = createChatModels({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });

    expect(models.main).toBeDefined();
    expect(models.fast).toBe(models.main); // 无 fast 配置时 fallback 到 main
  });

  it('should create separate fast model when configured', () => {
    const models = createChatModels(
      {
        apiKey: 'main-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      },
      {
        apiKey: 'fast-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      },
    );

    expect(models.main).toBeDefined();
    expect(models.fast).toBeDefined();
    expect(models.main).not.toBe(models.fast);
  });
});
