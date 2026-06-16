// tests/unit/agent/prompts/i18n.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptI18n } from '../../../../src/agent/prompts/i18n.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

describe('PromptI18n', () => {
  let i18n: PromptI18n;

  beforeEach(() => {
    i18n = new PromptI18n({
      defaultLocale: 'zh',
      fallbackLocale: 'zh',
      supportedLocales: ['zh', 'en'],
    });
  });

  const mockModule: PromptModule = {
    id: 'test',
    version: '1.0.0',
    name: 'Test',
    metadata: { category: 'core' },
    locales: {
      zh: { systemPrompt: '中文' },
      en: { systemPrompt: 'English' },
    },
  };

  it('should get default locale', () => {
    expect(i18n.getLocale()).toBe('zh');
  });

  it('should set locale', () => {
    i18n.setLocale('en');
    expect(i18n.getLocale()).toBe('en');
  });

  it('should get prompt content with current locale', () => {
    const result = i18n.getPromptContent(mockModule);
    expect(result.systemPrompt).toBe('中文');
  });

  it('should get prompt content with locale override', () => {
    const result = i18n.getPromptContent(mockModule, 'en');
    expect(result.systemPrompt).toBe('English');
  });

  it('should fallback to zh when locale not found', () => {
    const moduleWithoutEn: PromptModule = {
      ...mockModule,
      locales: { zh: { systemPrompt: '中文' } },
    };
    const result = i18n.getPromptContent(moduleWithoutEn, 'en');
    expect(result.systemPrompt).toBe('中文');
  });
});
