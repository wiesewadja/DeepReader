// tests/unit/agent/prompts/core/socratic.test.ts
import { describe, it, expect } from 'vitest';
import { socraticPrompt } from '../../../../../src/agent/prompts/core/socratic.js';

describe('Socratic Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(socraticPrompt.id).toBe('socratic');
    });

    it('应该有版本号', () => {
      expect(socraticPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(socraticPrompt.locales.zh).toBeDefined();
      expect(socraticPrompt.locales.zh.systemPrompt).toContain('阅读分析拆分器');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含拆分规则', () => {
      const { systemPrompt } = socraticPrompt.locales.zh;
      expect(systemPrompt).toContain('facts');
      expect(systemPrompt).toContain('question');
      expect(systemPrompt).toContain('conclusion');
    });
  });
});
