// tests/unit/agent/prompts/auxiliary/diagram.test.ts
import { describe, it, expect } from 'vitest';
import { diagramPrompt } from '../../../../../src/agent/prompts/auxiliary/diagram.js';

describe('Diagram Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(diagramPrompt.id).toBe('diagram.excalidraw');
    });

    it('应该有版本号', () => {
      expect(diagramPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(diagramPrompt.locales.zh).toBeDefined();
      expect(diagramPrompt.locales.zh.systemPrompt).toContain('Excalidraw');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含设计原则', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('设计原则');
      expect(systemPrompt).toContain('论证而非展示');
    });

    it('系统提示词应该包含布局选项', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('语义布局');
      expect(systemPrompt).toContain('书卷审美');
    });

    it('系统提示词应该包含输出格式', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('输出格式');
      expect(systemPrompt).toContain('JSON');
    });
  });
});
