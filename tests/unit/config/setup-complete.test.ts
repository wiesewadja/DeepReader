/**
 * detectSetupComplete 单元测试
 */
import { describe, it, expect } from 'vitest';
import { detectSetupComplete, DEFAULT_SETTINGS } from '@/config/settings';
import type { DeepPDFSettings } from '@/config/settings';

function makeSettings(overrides: Partial<DeepPDFSettings> = {}): DeepPDFSettings {
	return { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ...overrides };
}

describe('detectSetupComplete', () => {
	it('returns false and does nothing when setupComplete is already defined', () => {
		const settings = makeSettings();
		settings.setupComplete = true;
		const needsSave = detectSetupComplete(settings);
		expect(needsSave).toBe(false);
		expect(settings.setupComplete).toBe(true);
	});

	it('sets setupComplete to true when providers have apiKey', () => {
		const settings = makeSettings();
		delete (settings as any).setupComplete;
		settings.providers.deepseek = { apiKey: 'sk-test' };
		const needsSave = detectSetupComplete(settings);
		expect(needsSave).toBe(true);
		expect(settings.setupComplete).toBe(true);
	});

	it('sets setupComplete to false when no providers have apiKey', () => {
		const settings = makeSettings();
		delete (settings as any).setupComplete;
		// all apiKeys are empty by default
		const needsSave = detectSetupComplete(settings);
		expect(needsSave).toBe(false);
		expect(settings.setupComplete).toBe(false);
	});

	it('only triggers once (second call returns false)', () => {
		const settings = makeSettings();
		delete (settings as any).setupComplete;
		settings.providers.openai = { apiKey: 'sk-test' };
		expect(detectSetupComplete(settings)).toBe(true);
		expect(detectSetupComplete(settings)).toBe(false); // already defined
	});
});
