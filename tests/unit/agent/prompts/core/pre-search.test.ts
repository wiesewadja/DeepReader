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

  describe('结构完整性', () => {
    it('zh locale 应包含 wiki 链接格式要求', () => {
      const { systemPrompt } = preSearchPrompt.locales.zh;
      expect(systemPrompt).toContain('[[');
      expect(systemPrompt).toContain('block_id');
      expect(systemPrompt).toContain('检索结果');
    });
  });
});
