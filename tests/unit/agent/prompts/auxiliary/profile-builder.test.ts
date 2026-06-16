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
      expect(profileBuilderPrompts.extract.locales.zh.systemPrompt).toContain('具体事实');
    });

    it('zh locale 应包含分类维度和注意规则', () => {
      const { systemPrompt } = profileBuilderPrompts.extract.locales.zh;
      expect(systemPrompt).toContain('按以下维度分类输出');
      expect(systemPrompt).toContain('保留用户说过的原话');
    });

    it('en locale 也应包含核心内容', () => {
      const { systemPrompt } = profileBuilderPrompts.extract.locales.en!;
      expect(systemPrompt).toContain('specific facts');
      expect(systemPrompt).toContain('organized by dimensions');
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
      expect(profileBuilderPrompts.wereadExtract.locales.zh.systemPrompt).toContain('阅读画像');
    });

    it('zh locale 应包含分析维度', () => {
      const { systemPrompt } = profileBuilderPrompts.wereadExtract.locales.zh;
      expect(systemPrompt).toContain('领域、主题偏好');
      expect(systemPrompt).toContain('划线内容');
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

    it('zh locale 应包含输出维度结构', () => {
      const { systemPrompt } = profileBuilderPrompts.synthesize.locales.zh;
      expect(systemPrompt).toContain('## 身份与阶段');
      expect(systemPrompt).toContain('## 阅读画像');
    });
  });
});
