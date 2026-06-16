// tests/unit/agent/prompts/core/router.test.ts
import { describe, it, expect } from 'vitest';
import { routerPrompt } from '../../../../../src/agent/prompts/core/router.js';
import type { RouterBuildContext } from '../../../../../src/agent/prompts/types.js';

describe('Router Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(routerPrompt.id).toBe('router.s0');
    });

    it('应该有版本号', () => {
      expect(routerPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文和英文 locale', () => {
      expect(routerPrompt.locales.zh).toBeDefined();
      expect(routerPrompt.locales.en).toBeDefined();
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

    it('英文 locale 也应该包含角色定义', () => {
      const { systemPrompt } = routerPrompt.locales.en!;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('router');
    });
  });

  describe('buildUserMessage', () => {
    const baseCtx: RouterBuildContext = {
      rawQuery: '什么是双系统理论？',
      chatHistory: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮你的？' },
      ],
      bookName: '思考，快与慢',
      docDescription: '丹尼尔·卡尼曼关于判断与决策的经典著作',
    };

    it('应该生成包含 current_query 的消息', () => {
      const msg = routerPrompt.buildUserMessage!(baseCtx as Record<string, unknown>);
      expect(msg).toContain('<current_query>');
      expect(msg).toContain('什么是双系统理论？');
      expect(msg).toContain('</current_query>');
    });

    it('中文 locale 应包含中文标签', () => {
      const msg = routerPrompt.buildUserMessage!({
        ...baseCtx,
        locale: 'zh',
      } as Record<string, unknown>);
      expect(msg).toContain('用户:');
      expect(msg).toContain('当前阅读的书籍是');
    });

    it('英文 locale 应包含英文标签', () => {
      const msg = routerPrompt.buildUserMessage!({
        ...baseCtx,
        locale: 'en',
      } as Record<string, unknown>);
      expect(msg).toContain('User:');
      expect(msg).toContain('The current book is');
    });

    it('默认 locale 为中文', () => {
      const msg = routerPrompt.buildUserMessage!(baseCtx as Record<string, unknown>);
      expect(msg).toContain('用户:');
    });

    it('应该截断过长的聊天历史', () => {
      const longContent = 'x'.repeat(600);
      const ctx: RouterBuildContext = {
        rawQuery: 'test',
        chatHistory: [{ role: 'user', content: longContent }],
      };
      const msg = routerPrompt.buildUserMessage!(ctx as Record<string, unknown>);
      expect(msg).toContain('...');
    });

    it('无书籍信息时不应包含 bookContext', () => {
      const ctx: RouterBuildContext = {
        rawQuery: 'test',
        chatHistory: [],
      };
      const msg = routerPrompt.buildUserMessage!(ctx as Record<string, unknown>);
      expect(msg).not.toContain('<current_book>');
    });
  });
});
