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

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = formatterPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('奚童');
    });

    it('系统提示词应该包含规则', () => {
      const { systemPrompt } = formatterPrompt.locales.zh;
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('wiki 链接');
    });
  });
});
