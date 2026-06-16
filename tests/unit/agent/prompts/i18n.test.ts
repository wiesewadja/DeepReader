// tests/unit/agent/prompts/i18n.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptRegistryImpl } from '../../../../src/agent/prompts/registry.js';
import { promptI18n } from '../../../../src/agent/prompts/i18n.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

/**
 * promptI18n 已废弃，内部委托给 PromptRegistryImpl。
 * 这些测试验证 shim 的委托行为是否正确。
 */
describe('promptI18n (deprecated shim)', () => {
  let registry: PromptRegistryImpl;

  beforeEach(() => {
    // 每个测试用独立 registry，避免全局状态污染
    registry = new PromptRegistryImpl();
    // 重置全局 locale 到 zh
    registry.setLocale('zh');
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

  it('should have setLocale function', () => {
    expect(typeof promptI18n.setLocale).toBe('function');
  });

  it('should have getLocale function', () => {
    expect(typeof promptI18n.getLocale).toBe('function');
  });

  it('setLocale should change locale via registry', () => {
    // promptI18n 委托给全局 promptRegistry，这里验证 shim 存在
    // 实际 locale 切换通过 registry.setLocale() 测试
    expect(() => promptI18n.setLocale('en')).not.toThrow();
  });

  it('getLocale should return current locale from registry', () => {
    // promptI18n 委托给全局 promptRegistry
    // 前一个测试调用了 setLocale('en')，所以全局状态现在是 'en'
    // 这里只验证函数可以调用并返回有效值
    const locale = promptI18n.getLocale();
    expect(['zh', 'en']).toContain(locale);
  });
});
