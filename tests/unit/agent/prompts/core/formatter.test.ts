// tests/unit/agent/prompts/core/formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatterPrompt } from '../../../../../src/agent/prompts/core/formatter.js';

describe('Formatter Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(formatterPrompt.id).toBe('formatter.s4');
    });

    it('应该有版本号', () => {
      expect(formatterPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(formatterPrompt.locales.zh).toBeDefined();
      expect(formatterPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('结构完整性', () => {
    it('zh locale 应包含完整的 XML 标签结构', () => {
      const { systemPrompt } = formatterPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('</rules>');
    });

    it('en locale 也应包含完整标签结构', () => {
      const { systemPrompt } = formatterPrompt.locales.en!;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('</rules>');
    });
  });
});
