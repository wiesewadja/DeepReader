import { describe, it, expect } from 'vitest';
import { applyPreset } from '@/config/providers';
import type { DeepPDFSettings } from '@/config/settings';
import { DEFAULT_SETTINGS } from '@/config/settings';

function createTestSettings(): DeepPDFSettings {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

describe('applyPreset', () => {
	it('should throw for unknown preset', () => {
		const settings = createTestSettings();
		expect(() => applyPreset('nonexistent', 'sk-test', settings)).toThrow('Unknown preset');
	});

	it('should set primary API key for xitong preset', () => {
		const settings = createTestSettings();
		applyPreset('xitong', 'sk-mimo-key', settings);
		expect(settings.providers.xiaomi.apiKey).toBe('sk-mimo-key');
	});

	it('should set secondary API key when provided', () => {
		const settings = createTestSettings();
		applyPreset('xitong', 'sk-mimo', settings, 'sk-sf');
		expect(settings.providers.xiaomi.apiKey).toBe('sk-mimo');
		expect(settings.providers.siliconflow.apiKey).toBe('sk-sf');
	});

	it('should assign all 7 roles when both keys provided', () => {
		const settings = createTestSettings();
		applyPreset('xitong', 'sk-mimo', settings, 'sk-sf');
		// Primary roles
		expect(settings.roles.chat.provider).toBe('xiaomi');
		expect(settings.roles.chat.model).toBe('mimo-v2.5');
		expect(settings.roles.pageindex.provider).toBe('xiaomi');
		expect(settings.roles.proposition.provider).toBe('xiaomi');
		expect(settings.roles.tts.provider).toBe('xiaomi');
		// Secondary roles
		expect(settings.roles.router.provider).toBe('siliconflow');
		expect(settings.roles.router.model).toBe('deepseek-ai/DeepSeek-V4-Flash');
		expect(settings.roles.embedding!.provider).toBe('siliconflow');
		expect(settings.roles.embedding!.model).toBe('Qwen/Qwen3-Embedding-0.6B');
		expect(settings.roles.reranker!.provider).toBe('siliconflow');
		expect(settings.roles.reranker!.model).toBe('Qwen/Qwen3-Reranker-0.6B');
	});

	it('should degrade secondary roles when no SF key provided', () => {
		const settings = createTestSettings();
		applyPreset('xitong', 'sk-mimo', settings);
		// Primary roles still assigned
		expect(settings.roles.chat.provider).toBe('xiaomi');
		// Router degrades to xiaomi
		expect(settings.roles.router.provider).toBe('xiaomi');
		expect(settings.roles.router.model).toBe('mimo-v2.5');
		// Embedding and reranker disabled
		expect(settings.roles.embedding).toBeNull();
		expect(settings.roles.reranker).toBeNull();
	});

	it('should not overwrite secondary key if not provided', () => {
		const settings = createTestSettings();
		settings.providers.siliconflow.apiKey = 'existing-sf-key';
		applyPreset('xitong', 'sk-mimo', settings);
		// SF key should remain unchanged when secondaryApiKey not passed
		expect(settings.providers.siliconflow.apiKey).toBe('existing-sf-key');
		// But roles are still degraded because secondaryApiKey was not passed
		expect(settings.roles.embedding).toBeNull();
	});

	it('should overwrite existing provider key', () => {
		const settings = createTestSettings();
		settings.providers.xiaomi.apiKey = 'old-key';
		applyPreset('xitong', 'new-key', settings, 'sk-sf');
		expect(settings.providers.xiaomi.apiKey).toBe('new-key');
	});
});
