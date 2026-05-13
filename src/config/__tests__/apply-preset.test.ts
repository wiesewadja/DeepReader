import { describe, it, expect } from 'vitest';
import { applyPreset } from '../providers';
import type { DeepPDFSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

function createTestSettings(): DeepPDFSettings {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

describe('applyPreset', () => {
	it('should throw for unknown preset', () => {
		const settings = createTestSettings();
		expect(() => applyPreset('nonexistent', 'sk-test', settings)).toThrow('Unknown preset');
	});

	it('should set API key for siliconflow preset', () => {
		const settings = createTestSettings();
		applyPreset('siliconflow-all', 'sk-test-key', settings);
		expect(settings.providers.siliconflow.apiKey).toBe('sk-test-key');
	});

	it('should assign chat, router, pageindex roles for siliconflow preset', () => {
		const settings = createTestSettings();
		applyPreset('siliconflow-all', 'sk-test', settings);
		expect(settings.roles.chat.provider).toBe('siliconflow');
		expect(settings.roles.chat.model).toBe('Qwen/Qwen3-8B');
		expect(settings.roles.router.provider).toBe('siliconflow');
		expect(settings.roles.pageindex.provider).toBe('siliconflow');
	});

	it('should assign embedding and reranker for siliconflow preset', () => {
		const settings = createTestSettings();
		applyPreset('siliconflow-all', 'sk-test', settings);
		expect(settings.roles.embedding).not.toBeNull();
		expect(settings.roles.embedding!.provider).toBe('siliconflow');
		expect(settings.roles.embedding!.model).toBe('BAAI/bge-m3');
		expect(settings.roles.reranker).not.toBeNull();
	});

	it('should not assign embedding for deepseek preset', () => {
		const settings = createTestSettings();
		applyPreset('deepseek-economy', 'sk-test', settings);
		expect(settings.providers.deepseek.apiKey).toBe('sk-test');
		expect(settings.roles.chat.provider).toBe('deepseek');
		// tts should remain untouched (not in preset)
		expect(settings.roles.tts).toBeNull();
	});

	it('should overwrite existing provider key', () => {
		const settings = createTestSettings();
		settings.providers.siliconflow.apiKey = 'old-key';
		applyPreset('siliconflow-all', 'new-key', settings);
		expect(settings.providers.siliconflow.apiKey).toBe('new-key');
	});
});
