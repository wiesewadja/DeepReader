// tests/unit/agent/prompts/core/proactive.test.ts
import { describe, it, expect } from 'vitest';
import { proactivePrompt } from '../../../../../src/agent/prompts/core/proactive.js';

describe('Proactive Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(proactivePrompt.id).toBe('proactive');
    });

    it('应该有版本号', () => {
      expect(proactivePrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(proactivePrompt.locales.zh).toBeDefined();
      expect(proactivePrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('结构完整性', () => {
    it('zh locale 应包含完整的 XML 标签结构', () => {
      const { systemPrompt } = proactivePrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('</rules>');
    });

    it('en locale 也应包含完整标签结构', () => {
      const { systemPrompt } = proactivePrompt.locales.en!;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('</rules>');
    });
  });
});
