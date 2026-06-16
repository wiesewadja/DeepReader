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

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = analyticalPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('阅读分析师');
    });

    it('系统提示词应该包含工作流程', () => {
      const { systemPrompt } = analyticalPrompt.locales.zh;
      expect(systemPrompt).toContain('workflow');
      expect(systemPrompt).toContain('搜索');
      expect(systemPrompt).toContain('精读');
    });

    it('系统提示词应该包含输出规则', () => {
      const { systemPrompt } = analyticalPrompt.locales.zh;
      expect(systemPrompt).toContain('output_rules');
      expect(systemPrompt).toContain('wiki 链接');
    });
  });
});
