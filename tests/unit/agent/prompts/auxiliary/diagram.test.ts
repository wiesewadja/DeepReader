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

  describe('结构完整性', () => {
    it('zh locale 应包含设计原则', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('设计原则');
      expect(systemPrompt).toContain('论证而非展示');
    });

    it('zh locale 应包含语义布局选项', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('语义布局选择');
      expect(systemPrompt).toContain('mind-map');
      expect(systemPrompt).toContain('flow-horizontal');
    });

    it('zh locale 应包含色板和审美设置', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('书卷审美色板');
      expect(systemPrompt).toContain('roughness');
      expect(systemPrompt).toContain('roundness');
    });

    it('zh locale 应包含输出格式', () => {
      const { systemPrompt } = diagramPrompt.locales.zh;
      expect(systemPrompt).toContain('输出格式');
      expect(systemPrompt).toContain('JSON');
    });

    it('en locale 也应包含核心内容', () => {
      const { systemPrompt } = diagramPrompt.locales.en!;
      expect(systemPrompt).toContain('Design Principles');
      expect(systemPrompt).toContain('Scholarly Color Palette');
      expect(systemPrompt).toContain('Output Format');
    });
  });
});
