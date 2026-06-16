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

  describe('结构完整性', () => {
    it('zh locale 应包含所有规则编号', () => {
      const { systemPrompt } = socraticPrompt.locales.zh;
      expect(systemPrompt).toContain('1.');
      expect(systemPrompt).toContain('2.');
      expect(systemPrompt).toContain('3.');
      expect(systemPrompt).toContain('4.');
      expect(systemPrompt).toContain('5.');
    });
  });
});
