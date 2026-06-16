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

  describe('结构完整性', () => {
    it('zh locale 应包含角色定义', () => {
      const { systemPrompt } = advisorPrompt.locales.zh;
      expect(systemPrompt).toContain('阅读顾问');
      expect(systemPrompt).toContain('工具使用原则');
    });

    it('zh locale 应包含输出规范和阅读方法论', () => {
      const { systemPrompt } = advisorPrompt.locales.zh;
      expect(systemPrompt).toContain('输出规范');
      expect(systemPrompt).toContain('四个层次');
    });

    it('en locale 也应包含核心内容', () => {
      const { systemPrompt } = advisorPrompt.locales.en!;
      expect(systemPrompt).toContain('reading advisor');
      expect(systemPrompt).toContain('Four Levels of Reading');
    });
  });
});
