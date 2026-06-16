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
      expect(ttsPrompts.voiceReply.locales.zh.systemPrompt).toContain('语音');
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
      expect(ttsPrompts.system.locales.zh.systemPrompt).toContain('播报');
    });
  });
});
