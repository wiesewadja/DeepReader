// tests/unit/agent/prompts/core/router.test.ts
import { describe, it, expect } from 'vitest';
import { routerPrompt } from '../../../../../src/agent/prompts/core/router.js';

describe('Router Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(routerPrompt.id).toBe('router.s0');
    });

    it('应该有版本号', () => {
      expect(routerPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(routerPrompt.locales.zh).toBeDefined();
      expect(routerPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = routerPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
    });

    it('系统提示词应该包含意图类型', () => {
      const { systemPrompt } = routerPrompt.locales.zh;
      expect(systemPrompt).toContain('intent_types');
      expect(systemPrompt).toContain('depth');
    });

    it('系统提示词应该包含输出格式', () => {
      const { systemPrompt } = routerPrompt.locales.zh;
      expect(systemPrompt).toContain('output_format');
      expect(systemPrompt).toContain('JSON');
    });
  });
});
