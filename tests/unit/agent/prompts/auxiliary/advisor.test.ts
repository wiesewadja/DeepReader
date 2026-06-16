// tests/unit/agent/prompts/auxiliary/advisor.test.ts
import { describe, it, expect } from 'vitest';
import { advisorPrompt } from '../../../../../src/agent/prompts/auxiliary/advisor.js';

describe('Advisor Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(advisorPrompt.id).toBe('advisor');
    });

    it('应该有版本号', () => {
      expect(advisorPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(advisorPrompt.locales.zh).toBeDefined();
      expect(advisorPrompt.locales.zh.systemPrompt).toContain('奚童');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = advisorPrompt.locales.zh;
      expect(systemPrompt).toContain('阅读顾问');
      expect(systemPrompt).toContain('工具使用原则');
    });
  });
});
