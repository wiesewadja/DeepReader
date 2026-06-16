// tests/unit/agent/prompts/core/pre-search.test.ts
import { describe, it, expect } from 'vitest';
import { preSearchPrompt } from '../../../../../src/agent/prompts/core/pre-search.js';

describe('PreSearch Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(preSearchPrompt.id).toBe('pre-search.s2-pre');
    });

    it('应该有版本号', () => {
      expect(preSearchPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(preSearchPrompt.locales.zh).toBeDefined();
      expect(preSearchPrompt.locales.zh.systemPrompt).toContain('检索结果');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含早停逻辑', () => {
      const { systemPrompt } = preSearchPrompt.locales.zh;
      expect(systemPrompt).toContain('检索结果');
      expect(systemPrompt).toContain('wiki 链接');
    });
  });
});
