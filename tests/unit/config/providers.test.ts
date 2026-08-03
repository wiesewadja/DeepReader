/**
 * providers.ts 单元测试
 */
import { describe, it, expect } from 'vitest';
import { resolveRoleConfig, getAvailableProvidersForRole, PROVIDER_CONFIGS, normalizeBaseUrl, getProviderName } from '@/config/providers';
import { ROLE_CAPABILITY } from '@/config/ai-roles';
import type { DeepPDFSettings } from '@/config/settings';
import { DEFAULT_SETTINGS } from '@/config/settings';

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

	it('has exactly 9 providers', () => {
		expect(Object.keys(PROVIDER_CONFIGS)).toHaveLength(9);
	});
});

describe('xiaomi provider + tts role', () => {
	it('xiaomi 应该在 PROVIDER_CONFIGS 中有 tts capability', () => {
		expect(PROVIDER_CONFIGS.xiaomi.capabilities.tts).toBe(true);
		expect(PROVIDER_CONFIGS.xiaomi.capabilities.chat).toBe(true);
	});

	it('tts 角色应该映射到 tts capability', () => {
		expect(ROLE_CAPABILITY.tts).toBe('tts');
	});

	it('resolveRoleConfig 对 tts 角色返回 null 当未配置时', () => {
		const settings = { ...DEFAULT_SETTINGS };
		settings.roles = { ...DEFAULT_SETTINGS.roles, tts: null };
		expect(resolveRoleConfig('tts', settings)).toBeNull();
	});

	it('resolveRoleConfig 对 tts 角色返回配置当已配置时', () => {
		const settings = { ...DEFAULT_SETTINGS };
		settings.providers = { ...DEFAULT_SETTINGS.providers, xiaomi: { apiKey: 'test-key' } };
		settings.roles = { ...DEFAULT_SETTINGS.roles, tts: { provider: 'xiaomi', model: 'mimo-v2.5-tts' } };
		const result = resolveRoleConfig('tts', settings);
		expect(result).not.toBeNull();
		expect(result!.apiKey).toBe('test-key');
		expect(result!.model).toBe('mimo-v2.5-tts');
		expect(result!.baseUrl).toBe('https://token-plan-cn.xiaomimimo.com/v1');
	});

	it('getAvailableProvidersForRole 过滤 tts 角色', () => {
		const settings = { ...DEFAULT_SETTINGS };
		settings.providers = { ...DEFAULT_SETTINGS.providers, xiaomi: { apiKey: 'test-key' } };
		const providers = getAvailableProvidersForRole('tts', settings);
		expect(providers).toContain('xiaomi');
		expect(providers).not.toContain('deepseek');
	});
});

describe('normalizeBaseUrl', () => {
	it('returns empty for empty string', () => {
		expect(normalizeBaseUrl('')).toBe('');
	});

	it('appends /v1 when no version path', () => {
		expect(normalizeBaseUrl('https://example.com/proxy')).toBe('https://example.com/proxy/v1');
	});

	it('strips trailing slashes and appends /v1', () => {
		expect(normalizeBaseUrl('https://example.com/proxy/')).toBe('https://example.com/proxy/v1');
		expect(normalizeBaseUrl('https://example.com/proxy///')).toBe('https://example.com/proxy/v1');
	});

	it('keeps existing /v1', () => {
		expect(normalizeBaseUrl('https://example.com/proxy/v1')).toBe('https://example.com/proxy/v1');
	});

	it('keeps existing /v2 or other versions', () => {
		expect(normalizeBaseUrl('https://example.com/proxy/v2')).toBe('https://example.com/proxy/v2');
	});

	it('strips trailing slash from /v1/', () => {
		expect(normalizeBaseUrl('https://example.com/proxy/v1/')).toBe('https://example.com/proxy/v1');
	});
});

describe('getProviderName', () => {
	it('returns label for built-in provider', () => {
		const settings = { ...DEFAULT_SETTINGS };
		expect(getProviderName('deepseek', settings)).toBe('DeepSeek');
		expect(getProviderName('xiaomi', settings)).toBe('小米 MIMO');
		expect(getProviderName('openai', settings)).toBe('OpenAI');
	});

	it('returns custom name from settings for custom provider', () => {
		const settings = { ...DEFAULT_SETTINGS };
		settings.providers.mycorp = { apiKey: 'sk-test', name: 'My Corp' };
		expect(getProviderName('mycorp', settings)).toBe('My Corp');
	});

	it('returns id when no label and no custom name', () => {
		const settings = { ...DEFAULT_SETTINGS };
		expect(getProviderName('unknown-provider', settings)).toBe('unknown-provider');
	});
});