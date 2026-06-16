// tests/unit/agent/prompts/auxiliary/tts.test.ts
import { describe, it, expect } from 'vitest';
import { ttsPrompts } from '../../../../../src/agent/prompts/auxiliary/tts.js';

describe('TTS Prompt Modules', () => {
  describe('ORAL_REWRITE_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(ttsPrompts.oralRewrite.id).toBe('tts.oral-rewrite');
    });

    it('应该有版本号', () => {
      expect(ttsPrompts.oralRewrite.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(ttsPrompts.oralRewrite.locales.zh).toBeDefined();
      expect(ttsPrompts.oralRewrite.locales.zh.systemPrompt).toContain('伴读书童');
    });

    it('zh locale 应包含口语化规则', () => {
      const { systemPrompt } = ttsPrompts.oralRewrite.locales.zh;
      expect(systemPrompt).toContain('保留原文全部内容');
      expect(systemPrompt).toContain('禁止 Markdown 格式');
    });

    it('en locale 也应包含核心规则', () => {
      const { systemPrompt } = ttsPrompts.oralRewrite.locales.en!;
      expect(systemPrompt).toContain('conversational tone');
      expect(systemPrompt).toContain('no Markdown formatting');
    });
  });

  describe('VOICE_REPLY_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(ttsPrompts.voiceReply.id).toBe('tts.voice-reply');
    });

    it('应该有版本号', () => {
      expect(ttsPrompts.voiceReply.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(ttsPrompts.voiceReply.locales.zh).toBeDefined();
      expect(ttsPrompts.voiceReply.locales.zh.systemPrompt).toContain('简短回答');
    });

    it('zh locale 应包含身份规则和回答规则', () => {
      const { systemPrompt } = ttsPrompts.voiceReply.locales.zh;
      expect(systemPrompt).toContain('自然温暖');
      expect(systemPrompt).toContain('300字以内');
    });
  });

  describe('SYSTEM_PROMPT', () => {
    it('应该有正确的 id', () => {
      expect(ttsPrompts.system.id).toBe('tts.system');
    });

    it('应该有版本号', () => {
      expect(ttsPrompts.system.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(ttsPrompts.system.locales.zh).toBeDefined();
      expect(ttsPrompts.system.locales.zh.systemPrompt).toContain('播报结构');
    });

    it('zh locale 应包含播报结构和情感标记', () => {
      const { systemPrompt } = ttsPrompts.system.locales.zh;
      expect(systemPrompt).toContain('关键身份规则');
      expect(systemPrompt).toContain('音频情感标记');
      expect(systemPrompt).toContain('(轻笑)');
      expect(systemPrompt).toContain('(停顿)');
    });
  });
});
