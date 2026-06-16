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
      expect(memoryPrompts.consolidation.locales.zh.systemPrompt).toContain('对话');
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
      expect(memoryPrompts.compression.locales.zh.systemPrompt).toContain('压缩');
    });
  });
});
