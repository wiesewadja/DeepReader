// tests/unit/agent/prompts/core/inspectional.test.ts
import { describe, it, expect } from 'vitest';
import { inspectionalPrompt } from '../../../../../src/agent/prompts/core/inspectional.js';

describe('Inspectional Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(inspectionalPrompt.id).toBe('inspectional.s1');
    });

    it('应该有版本号', () => {
      expect(inspectionalPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(inspectionalPrompt.locales.zh).toBeDefined();
      expect(inspectionalPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('结构完整性', () => {
    it('zh locale 应包含完整的 XML 标签结构', () => {
      const { systemPrompt } = inspectionalPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<task_branch');
      expect(systemPrompt).toContain('<output_format>');
      expect(systemPrompt).toContain('JSON');
    });

    it('en locale 也应包含核心标签结构', () => {
      const { systemPrompt } = inspectionalPrompt.locales.en!;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
      expect(systemPrompt).toContain('<task_branch');
      expect(systemPrompt).toContain('<output_format>');
    });
  });
});
