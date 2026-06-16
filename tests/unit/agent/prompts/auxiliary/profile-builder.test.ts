// tests/unit/agent/prompts/auxiliary/profile-builder.test.ts
import { describe, it, expect } from 'vitest';
import { profileBuilderPrompts } from '../../../../../src/agent/prompts/auxiliary/profile-builder.js';

describe('Profile Builder Prompt Modules', () => {
  describe('EXTRACT_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(profileBuilderPrompts.extract.id).toBe('profile.extract');
    });

    it('应该有版本号', () => {
      expect(profileBuilderPrompts.extract.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(profileBuilderPrompts.extract.locales.zh).toBeDefined();
      expect(profileBuilderPrompts.extract.locales.zh.systemPrompt).toContain('观察');
    });
  });

  describe('WEREAD_EXTRACT_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(profileBuilderPrompts.wereadExtract.id).toBe('profile.weread-extract');
    });

    it('应该有版本号', () => {
      expect(profileBuilderPrompts.wereadExtract.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(profileBuilderPrompts.wereadExtract.locales.zh).toBeDefined();
      expect(profileBuilderPrompts.wereadExtract.locales.zh.systemPrompt).toContain('微信读书');
    });
  });

  describe('SYNTHESIZE_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(profileBuilderPrompts.synthesize.id).toBe('profile.synthesize');
    });

    it('应该有版本号', () => {
      expect(profileBuilderPrompts.synthesize.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(profileBuilderPrompts.synthesize.locales.zh).toBeDefined();
      expect(profileBuilderPrompts.synthesize.locales.zh.systemPrompt).toContain('老朋友');
    });
  });
});
