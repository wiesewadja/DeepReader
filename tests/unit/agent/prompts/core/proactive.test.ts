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

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = proactivePrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('阅读伙伴');
    });

    it('系统提示词应该包含引导规则', () => {
      const { systemPrompt } = proactivePrompt.locales.zh;
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('追问');
    });
  });
});
