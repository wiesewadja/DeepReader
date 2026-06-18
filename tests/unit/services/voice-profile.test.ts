import { describe, it, expect } from 'vitest';
import {
	resolveVoiceProfile,
	getDefaultVoiceProfile,
	DEFAULT_VOICE_DESIGN_PROMPT,
	type VoiceProfile,
} from '@/services/tts/voice-profile.js';
import type { BookGenre } from '@/services/tts/book-genre-detector.js';

const neutralGenre: BookGenre = { mainGenre: '文学', subGenre: '散文', mood: 'neutral' };

describe('VoiceProfile — VoiceDesign 模式', () => {
	it('resolveVoiceProfile 在 VoiceDesign 模式下返回空 voice + voiceDesignPrompt', () => {
		const profile = resolveVoiceProfile(neutralGenre, 'xiaomi', true);
		expect(profile.voice).toBe('');
		expect(profile.voiceDesignPrompt).toBe(DEFAULT_VOICE_DESIGN_PROMPT);
		expect(profile.audioTag).toBeTruthy();
	});

	it('resolveVoiceProfile 在非 VoiceDesign 模式下返回预置音色冰糖', () => {
		const profile = resolveVoiceProfile(neutralGenre, 'xiaomi', false);
		expect(profile.voice).toBe('冰糖');
		expect(profile.voiceDesignPrompt).toBeUndefined();
	});

	it('getDefaultVoiceProfile 在 VoiceDesign 模式下返回空 voice + voiceDesignPrompt', () => {
		const profile = getDefaultVoiceProfile('xiaomi', true);
		expect(profile.voice).toBe('');
		expect(profile.voiceDesignPrompt).toBe(DEFAULT_VOICE_DESIGN_PROMPT);
	});

	it('getDefaultVoiceProfile 在非 VoiceDesign 模式下返回预置音色', () => {
		const profile = getDefaultVoiceProfile('xiaomi', false);
		expect(profile.voice).toBe('冰糖');
	});

	it('DEFAULT_VOICE_DESIGN_PROMPT 包含关键音色描述', () => {
		expect(DEFAULT_VOICE_DESIGN_PROMPT).toContain('年轻女性');
		expect(DEFAULT_VOICE_DESIGN_PROMPT).toContain('清亮柔和');
		expect(DEFAULT_VOICE_DESIGN_PROMPT).toContain('温柔治愈');
	});

	it('VoiceDesign profile 的 audioTag 根据书籍 mood 变化', () => {
		const warmGenre: BookGenre = { mainGenre: '文学', subGenre: '小说', mood: 'warm' };
		const profile = resolveVoiceProfile(warmGenre, 'xiaomi', true);
		expect(profile.audioTag).toContain('温暖');
	});
});
