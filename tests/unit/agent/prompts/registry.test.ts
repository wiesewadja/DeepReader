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

  // ===== 基本 CRUD =====

  it('should register a module', () => {
    registry.register(mockModule);
    expect(registry.getVersion('test.module')).toBe('1.0.0');
  });

  it('should get prompt by id (default locale zh)', () => {
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

  it('should overwrite module with warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.register(mockModule);
    registry.register({ ...mockModule, version: '2.0.0' });
    expect(registry.getVersion('test.module')).toBe('2.0.0');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Overwriting module: test.module')
    );
    warnSpy.mockRestore();
  });

  // ===== Locale 管理 =====

  it('should default locale to zh', () => {
    expect(registry.getLocale()).toBe('zh');
  });

  it('should set and get locale', () => {
    registry.setLocale('en');
    expect(registry.getLocale()).toBe('en');
  });

  it('should use global locale when no override', () => {
    registry.register(mockModule);
    registry.setLocale('en');
    const result = registry.get('test.module');
    expect(result.systemPrompt).toBe('English system prompt');
  });

  it('should fallback to zh when requested locale missing', () => {
    const zhOnly: PromptModule = {
      ...mockModule,
      locales: { zh: { systemPrompt: '仅中文' } },
    };
    registry.register(zhOnly);
    const result = registry.get(zhOnly.id, 'en');
    expect(result.systemPrompt).toBe('仅中文');
  });

  // ===== List / Filter =====

  it('should list all modules', () => {
    registry.register(mockModule);
    registry.register({ ...mockModule, id: 'test.module2', name: 'Test 2' });
    expect(registry.list()).toHaveLength(2);
  });

  it('should list modules by category', () => {
    registry.register(mockModule);
    registry.register({
      ...mockModule,
      id: 'aux.module',
      metadata: { category: 'auxiliary' },
    });
    expect(registry.list({ category: 'core' })).toHaveLength(1);
    expect(registry.list({ category: 'auxiliary' })).toHaveLength(1);
  });

  it('should list modules by tags', () => {
    registry.register({
      ...mockModule,
      metadata: { category: 'core', tags: ['routing', 'intent'] },
    });
    registry.register({
      ...mockModule,
      id: 'other',
      metadata: { category: 'core', tags: ['formatting'] },
    });
    expect(registry.list({ tags: ['routing'] })).toHaveLength(1);
    expect(registry.list({ tags: ['formatting'] })).toHaveLength(1);
  });

  it('should return empty list for non-matching filter', () => {
    registry.register(mockModule);
    expect(registry.list({ category: 'evaluation' })).toHaveLength(0);
  });
});
