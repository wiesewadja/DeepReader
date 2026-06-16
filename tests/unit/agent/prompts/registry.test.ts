// tests/unit/agent/prompts/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptRegistryImpl } from '../../../../src/agent/prompts/registry.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

describe('PromptRegistryImpl', () => {
  let registry: PromptRegistryImpl;

  beforeEach(() => {
    registry = new PromptRegistryImpl();
  });

  const mockModule: PromptModule = {
    id: 'test.module',
    version: '1.0.0',
    name: 'Test Module',
    metadata: { category: 'core' },
    locales: {
      zh: { systemPrompt: '中文系统提示' },
      en: { systemPrompt: 'English system prompt' },
    },
  };

  it('should register a module', () => {
    registry.register(mockModule);
    expect(registry.getVersion('test.module')).toBe('1.0.0');
  });

  it('should get prompt by id', () => {
    registry.register(mockModule);
    const result = registry.get('test.module');
    expect(result.systemPrompt).toBe('中文系统提示');
  });

  it('should get prompt with locale override', () => {
    registry.register(mockModule);
    const result = registry.get('test.module', 'en');
    expect(result.systemPrompt).toBe('English system prompt');
  });

  it('should throw when module not found', () => {
    expect(() => registry.get('nonexistent')).toThrow('Module not found');
  });

  it('should list modules by category', () => {
    registry.register(mockModule);
    const result = registry.list({ category: 'core' });
    expect(result).toHaveLength(1);
  });

  it('should list modules by tags', () => {
    const moduleWithTags: PromptModule = {
      ...mockModule,
      metadata: { ...mockModule.metadata, tags: ['routing'] },
    };
    registry.register(moduleWithTags);
    const result = registry.list({ tags: ['routing'] });
    expect(result).toHaveLength(1);
  });
});
