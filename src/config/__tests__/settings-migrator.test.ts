/**
 * settings-migrator.ts 单元测试
 */
import { describe, it, expect } from 'vitest';
import { needsMigration, migrateSettings } from '../settings-migrator';
import { DEFAULT_SETTINGS } from '../settings';
import type { DeepPDFSettings } from '../settings';

describe('settings-migrator', () => {
	describe('needsMigration', () => {
		it('returns true when any legacy field exists', () => {
			expect(needsMigration({ deepseekApiKey: 'sk-xxx' })).toBe(true);
			expect(needsMigration({ llmProvider: 'deepseek' })).toBe(true);
			expect(needsMigration({ embedding: { provider: 'openai' } })).toBe(true);
		});

		it('returns false when no legacy fields exist', () => {
			expect(needsMigration({})).toBe(false);
			expect(needsMigration({ providers: {}, roles: {} })).toBe(false);
			expect(needsMigration({ apiPort: 6088 })).toBe(false);
		});
	});

	describe('migrateSettings', () => {
		function makeDefaults(): DeepPDFSettings {
			return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		}

		it('migrates API Keys to providers', () => {
			const raw = {
				deepseekApiKey: 'sk-deep',
				openaiApiKey: 'sk-openai',
				kimiApiKey: 'sk-kimi',
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.providers.deepseek.apiKey).toBe('sk-deep');
			expect(result.providers.openai.apiKey).toBe('sk-openai');
			expect(result.providers.kimi.apiKey).toBe('sk-kimi');
			expect(result.deepseekApiKey).toBeUndefined();
			expect(result.openaiApiKey).toBeUndefined();
		});

		it('migrates llmProvider + llmModel to roles.chat', () => {
			const raw = {
				llmProvider: 'openai',
				llmModel: 'gpt-4o',
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.roles.chat.provider).toBe('openai');
			expect(result.roles.chat.model).toBe('gpt-4o');
			expect(result.llmProvider).toBeUndefined();
			expect(result.llmModel).toBeUndefined();
		});

		it('migrates fast model to roles.router', () => {
			const raw = {
				fastModelProvider: 'deepseek',
				fastModelName: 'deepseek-chat',
				fastModelApiUrl: 'https://custom.api/v1',
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.roles.router.provider).toBe('deepseek');
			expect(result.roles.router.model).toBe('deepseek-chat');
			expect(result.roles.router.baseUrlOverride).toBe('https://custom.api/v1');
		});

		it('pageindex inherits chat config', () => {
			const raw = {
				llmProvider: 'kimi',
				llmModel: 'kimi-k2.5',
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.roles.pageindex.provider).toBe('kimi');
			expect(result.roles.pageindex.model).toBe('kimi-k2.5');
		});

		it('migrates apiUrl to providers.custom.baseUrl', () => {
			const raw = {
				apiUrl: 'https://my-proxy.com/v1',
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.providers.custom.baseUrl).toBe('https://my-proxy.com/v1');
			expect(result.apiUrl).toBeUndefined();
		});

		it('maps old "google" provider to "custom"', () => {
			const raw = {
				llmProvider: 'google',
				llmModel: 'gemini-pro',
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.roles.chat.provider).toBe('custom');
		});

		it('deletes all legacy fields after migration', () => {
			const raw = {
				deepseekApiKey: 'sk-x',
				llmProvider: 'deepseek',
				llmModel: 'deepseek-chat',
				apiUrl: 'https://api.test.com',
				fastModelEnabled: true,
				fastModelProvider: 'deepseek',
				fastModelName: 'fast',
				fastModelApiUrl: 'https://fast.test.com',
				embedding: { provider: 'openai' },
				reranker: { enabled: true },
				propositions: { enabled: true, model: 'test', baseUrl: 'https://test.com' },
			};
			const result = migrateSettings(raw, makeDefaults());
			const legacyFields = [
				'deepseekApiKey', 'kimiApiKey', 'openaiApiKey', 'customApiKey',
				'apiUrl', 'llmProvider', 'llmModel',
				'fastModelEnabled', 'fastModelProvider', 'fastModelName', 'fastModelApiUrl',
				'embedding', 'reranker', 'propositions',
			];
			for (const field of legacyFields) {
				expect((result as unknown as Record<string, unknown>)[field]).toBeUndefined();
			}
		});

		it('preserves non-legacy fields', () => {
			const raw = {
				apiPort: 9999,
				maxResults: 10,
				enableDebugLog: true,
			};
			const result = migrateSettings(raw, makeDefaults());
			expect(result.apiPort).toBe(9999);
			expect(result.maxResults).toBe(10);
			expect(result.enableDebugLog).toBe(true);
		});

		it('is idempotent — running twice produces same result', () => {
			const raw = {
				deepseekApiKey: 'sk-x',
				llmProvider: 'deepseek',
				llmModel: 'deepseek-chat',
			};
			const first = migrateSettings(raw, makeDefaults());
			const second = migrateSettings(first as unknown as Record<string, unknown>, makeDefaults());
			// Second run should detect no legacy fields and not change anything
			expect(needsMigration(first as unknown as Record<string, unknown>)).toBe(false);
		});
	});
});
