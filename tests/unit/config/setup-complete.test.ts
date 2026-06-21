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
		expect(detectSetupComplete(settings)).toBe(false); // already true
	});

	// 回归锁：daily vault 真实场景 —— loadSettings 的 Object.assign 让 setupComplete
	// 永远是 DEFAULT 的 false（不是 undefined），早期 `!== undefined` 判断使推断成死代码，
	// 导致已配 key 的用户每次 onload 都被判定为未完成、反复弹出设置引导。
	it('marks setupComplete=true when it is false (DEFAULT merged) but providers have apiKey', () => {
		const settings = makeSettings(); // setupComplete = false（DEFAULT 铺底，不 delete）
		settings.providers.deepseek = { apiKey: 'sk-test' };
		const needsSave = detectSetupComplete(settings);
		expect(needsSave).toBe(true);
		expect(settings.setupComplete).toBe(true);
	});
});
