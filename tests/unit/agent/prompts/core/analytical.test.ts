// tests/unit/agent/prompts/core/analytical.test.ts
import { describe, it, expect } from 'vitest';
import { analyticalPrompt } from '../../../../../src/agent/prompts/core/analytical.js';

describe('Analytical Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(analyticalPrompt.id).toBe('analytical.s2');
    });

    it('应该有版本号', () => {
      expect(analyticalPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(analyticalPrompt.locales.zh).toBeDefined();
      expect(analyticalPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('结构完整性', () => {
    it('zh locale 应包含完整的 XML 标签结构', () => {
      const { systemPrompt } = analyticalPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<constraints>');
      expect(systemPrompt).toContain('</constraints>');
      expect(systemPrompt).toContain('<workflow>');
      expect(systemPrompt).toContain('</workflow>');
      expect(systemPrompt).toContain('<output_rules>');
      expect(systemPrompt).toContain('</output_rules>');
    });

    it('en locale 也应包含完整的 XML 标签结构', () => {
      const { systemPrompt } = analyticalPrompt.locales.en!;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<constraints>');
      expect(systemPrompt).toContain('</constraints>');
      expect(systemPrompt).toContain('<workflow>');
      expect(systemPrompt).toContain('</workflow>');
      expect(systemPrompt).toContain('<output_rules>');
      expect(systemPrompt).toContain('</output_rules>');
    });
  });
});
