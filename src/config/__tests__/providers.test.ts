/**
 * providers.ts 单元测试
 */
import { describe, it, expect } from 'vitest';
import { resolveRoleConfig, getAvailableProvidersForRole, PROVIDER_CONFIGS } from '../providers';
import type { DeepPDFSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';

describe('resolveRoleConfig', () => {
	function makeSettings(overrides: Partial<DeepPDFSettings> = {}): DeepPDFSettings {
		return { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ...overrides };
	}

	it('returns null for null role (optional role disabled)', () => {
		const settings = makeSettings();
		settings.roles.embedding = null;
		expect(resolveRoleConfig('embedding', settings)).toBeNull();
	});

	it('returns null when provider account is missing apiKey', () => {
		const settings = makeSettings();
		settings.roles.chat = { provider: 'deepseek', model: 'deepseek-chat' };
		settings.providers.deepseek = { apiKey: '' };
		expect(resolveRoleConfig('chat', settings)).toBeNull();
	});

	it('resolves chat role with correct config', () => {
		const settings = makeSettings();
		settings.roles.chat = { provider: 'deepseek', model: 'deepseek-chat' };
		settings.providers.deepseek = { apiKey: 'sk-test' };
		const result = resolveRoleConfig('chat', settings);
		expect(result).not.toBeNull();
		expect(result!.apiKey).toBe('sk-test');
		expect(result!.baseUrl).toBe('https://api.deepseek.com');
		expect(result!.model).toBe('deepseek-chat');
		expect(result!.provider).toBe('deepseek');
	});

	it('uses baseUrlOverride when set', () => {
		const settings = makeSettings();
		settings.roles.router = { provider: 'deepseek', model: 'deepseek-chat', baseUrlOverride: 'https://proxy.com/v1' };
		settings.providers.deepseek = { apiKey: 'sk-test' };
		const result = resolveRoleConfig('router', settings);
		expect(result!.baseUrl).toBe('https://proxy.com/v1');
	});

	it('falls back to provider default model when model is empty', () => {
		const settings = makeSettings();
		settings.roles.chat = { provider: 'openai', model: '' };
		settings.providers.openai = { apiKey: 'sk-test' };
		const result = resolveRoleConfig('chat', settings);
		expect(result!.model).toBe('gpt-4o'); // openai defaultModel
	});
});

describe('getAvailableProvidersForRole', () => {
	function makeSettings(overrides: Partial<DeepPDFSettings> = {}): DeepPDFSettings {
		return { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ...overrides };
	}

	it('returns empty array when no providers have keys', () => {
		const settings = makeSettings();
		expect(getAvailableProvidersForRole('chat', settings)).toEqual([]);
	});

	it('filters by capability — only returns providers with chat capability', () => {
		const settings = makeSettings();
		settings.providers.deepseek = { apiKey: 'sk-test' };
		settings.providers.siliconflow = { apiKey: 'sk-test' };
		// deepseek has chat=true, siliconflow has chat=true
		const chatProviders = getAvailableProvidersForRole('chat', settings);
		expect(chatProviders).toContain('deepseek');
		expect(chatProviders).toContain('siliconflow');
	});

	it('filters by capability — embedding only returns providers with embedding=true', () => {
		const settings = makeSettings();
		settings.providers.deepseek = { apiKey: 'sk-test' };
		settings.providers.siliconflow = { apiKey: 'sk-test' };
		// deepseek has embedding=false, siliconflow has embedding=true
		const embeddingProviders = getAvailableProvidersForRole('embedding', settings);
		expect(embeddingProviders).not.toContain('deepseek');
		expect(embeddingProviders).toContain('siliconflow');
	});

	it('does not include providers with empty apiKey', () => {
		const settings = makeSettings();
		settings.providers.deepseek = { apiKey: '' };
		const result = getAvailableProvidersForRole('chat', settings);
		expect(result).not.toContain('deepseek');
	});
});

describe('PROVIDER_CONFIGS', () => {
	it('all providers have required fields', () => {
		for (const [key, config] of Object.entries(PROVIDER_CONFIGS)) {
			expect(config.baseUrl).toBeDefined();
			expect(config.defaultModel).toBeDefined();
			expect(config.capabilities).toBeDefined();
			expect(config.capabilities.chat).toBeDefined();
			expect(config.capabilities.embedding).toBeDefined();
			expect(config.capabilities.reranker).toBeDefined();
		}
	});

	it('has exactly 7 providers', () => {
		expect(Object.keys(PROVIDER_CONFIGS)).toHaveLength(7);
	});
});
