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

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = inspectionalPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('图书管理员');
    });

    it('系统提示词应该包含任务分支', () => {
      const { systemPrompt } = inspectionalPrompt.locales.zh;
      expect(systemPrompt).toContain('task_branch');
      expect(systemPrompt).toContain('宏观检视');
      expect(systemPrompt).toContain('圈定战区');
    });

    it('系统提示词应该包含输出格式', () => {
      const { systemPrompt } = inspectionalPrompt.locales.zh;
      expect(systemPrompt).toContain('output_format');
      expect(systemPrompt).toContain('JSON');
    });
  });
});
