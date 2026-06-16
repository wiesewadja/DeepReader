// tests/unit/agent/prompts/core/syntopical.test.ts
import { describe, it, expect } from 'vitest';
import { syntopicalPrompt } from '../../../../../src/agent/prompts/core/syntopical.js';

describe('Syntopical Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(syntopicalPrompt.id).toBe('syntopical.s3');
    });

    it('应该有版本号', () => {
      expect(syntopicalPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(syntopicalPrompt.locales.zh).toBeDefined();
      expect(syntopicalPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('结构完整性', () => {
    it('zh locale 应包含完整的 XML 标签结构', () => {
      const { systemPrompt } = syntopicalPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<methodology>');
      expect(systemPrompt).toContain('</methodology>');
      expect(systemPrompt).toContain('<output_rules>');
      expect(systemPrompt).toContain('</output_rules>');
    });

    it('en locale 也应包含完整标签结构', () => {
      const { systemPrompt } = syntopicalPrompt.locales.en!;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<methodology>');
      expect(systemPrompt).toContain('</methodology>');
      expect(systemPrompt).toContain('<output_rules>');
      expect(systemPrompt).toContain('</output_rules>');
    });
  });
});
