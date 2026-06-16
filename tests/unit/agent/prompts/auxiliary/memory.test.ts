// tests/unit/agent/prompts/auxiliary/memory.test.ts
import { describe, it, expect } from 'vitest';
import { memoryPrompts } from '../../../../../src/agent/prompts/auxiliary/memory.js';

describe('Memory Prompt Modules', () => {
  describe('CONSOLIDATION_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(memoryPrompts.consolidation.id).toBe('memory.consolidation');
    });

    it('应该有版本号', () => {
      expect(memoryPrompts.consolidation.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(memoryPrompts.consolidation.locales.zh).toBeDefined();
      expect(memoryPrompts.consolidation.locales.zh.systemPrompt).toContain('分析要点');
    });

    it('zh locale 应包含分析维度和输出要求', () => {
      const { systemPrompt } = memoryPrompts.consolidation.locales.zh;
      expect(systemPrompt).toContain('讨论主题');
      expect(systemPrompt).toContain('用户画像推理');
      expect(systemPrompt).toContain('save_memory');
    });

    it('en locale 也应包含核心内容', () => {
      const { systemPrompt } = memoryPrompts.consolidation.locales.en!;
      expect(systemPrompt).toContain('Analysis Points');
      expect(systemPrompt).toContain('User Profile Inference');
    });
  });

  describe('COMPRESSION_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(memoryPrompts.compression.id).toBe('memory.compression');
    });

    it('应该有版本号', () => {
      expect(memoryPrompts.compression.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(memoryPrompts.compression.locales.zh).toBeDefined();
      expect(memoryPrompts.compression.locales.zh.systemPrompt).toContain('压缩规则');
    });

    it('zh locale 应包含压缩规则', () => {
      const { systemPrompt } = memoryPrompts.compression.locales.zh;
      expect(systemPrompt).toContain('激进合并');
      expect(systemPrompt).toContain('删除冗余');
      expect(systemPrompt).toContain('输出格式');
    });
  });
});
