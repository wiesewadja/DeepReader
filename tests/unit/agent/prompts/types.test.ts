// tests/unit/agent/prompts/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  PromptLocale,
  PromptMetadata,
  PromptModule,
  RouterBuildContext,
} from '../../../../src/agent/prompts/types.js';

describe('PromptModule Types', () => {
  it('should define PromptLocale interface', () => {
    const locale: PromptLocale = {
      systemPrompt: 'test',
    };
    expect(locale.systemPrompt).toBe('test');
  });

  it('should define PromptLocale with userMessage function', () => {
    const locale: PromptLocale = {
      systemPrompt: 'test',
      userMessage: (ctx) => `Hello ${ctx.name}`,
    };
    expect(typeof locale.userMessage).toBe('function');
  });

  it('should define PromptMetadata interface', () => {
    const metadata: PromptMetadata = {
      category: 'core',
      node: 'router',
      tokenEstimate: 800,
      tags: ['routing'],
    };
    expect(metadata.category).toBe('core');
    expect(metadata.node).toBe('router');
  });

  it('should define PromptModule interface', () => {
    const module: PromptModule = {
      id: 'test',
      version: '1.0.0',
      name: 'Test',
      metadata: { category: 'core' },
      locales: {
        zh: { systemPrompt: 'test' },
      },
    };
    expect(module.id).toBe('test');
  });

  it('should define RouterBuildContext interface', () => {
    const ctx: RouterBuildContext = {
      rawQuery: '什么是预测？',
      chatHistory: [{ role: 'user', content: 'hi' }],
      bookName: '思考，快与慢',
      docDescription: '一本关于判断与决策的书',
      locale: 'zh',
    };
    expect(ctx.rawQuery).toBe('什么是预测？');
    expect(ctx.locale).toBe('zh');
  });

  it('should define RouterBuildContext with optional fields', () => {
    const ctx: RouterBuildContext = {
      rawQuery: 'test',
      chatHistory: [],
    };
    expect(ctx.bookName).toBeUndefined();
    expect(ctx.locale).toBeUndefined();
  });
});
