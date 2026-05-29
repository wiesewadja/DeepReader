import { describe, it, expect } from 'vitest';
import {
  getRoleConfig,
  setRoleConfig,
  getProviderAccount,
  setProviderAccount,
  validateBaseUrl,
} from '@/settings/helpers';
import type { AIRoles, AIRoleConfig } from '@/config/ai-roles';

function makeRoles(overrides?: Partial<AIRoles>): AIRoles {
  return {
    chat: { provider: 'deepseek', model: 'deepseek-chat' },
    router: { provider: 'deepseek', model: 'deepseek-chat' },
    pageindex: { provider: 'deepseek', model: 'deepseek-chat' },
    proposition: null,
    embedding: null,
    reranker: null,
    tts: null,
    ...overrides,
  };
}

// ==================== getRoleConfig ====================

describe('getRoleConfig', () => {
  it('returns config for required roles', () => {
    const roles = makeRoles();
    expect(getRoleConfig(roles, 'chat')).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
  });

  it('returns null for disabled optional roles', () => {
    const roles = makeRoles();
    expect(getRoleConfig(roles, 'embedding')).toBeNull();
  });

  it('returns config for enabled optional roles', () => {
    const roles = makeRoles({
      embedding: { provider: 'siliconflow', model: 'BAAI/bge-m3' },
    });
    expect(getRoleConfig(roles, 'embedding')).toEqual({ provider: 'siliconflow', model: 'BAAI/bge-m3' });
  });
});

// ==================== setRoleConfig ====================

describe('setRoleConfig', () => {
  it('enables a disabled role with patch', () => {
    const roles = makeRoles();
    setRoleConfig(roles, 'embedding', { provider: 'openai', model: 'text-embedding-3-small' });
    expect(roles.embedding).toEqual({ provider: 'openai', model: 'text-embedding-3-small' });
  });

  it('disables a role by setting null', () => {
    const roles = makeRoles();
    setRoleConfig(roles, 'proposition', null);
    expect(roles.proposition).toBeNull();
  });

  it('merges patch onto existing config', () => {
    const roles = makeRoles();
    setRoleConfig(roles, 'chat', { model: 'deepseek-pro' });
    expect(roles.chat).toEqual({ provider: 'deepseek', model: 'deepseek-pro' });
  });

  it('preserves existing fields when patching', () => {
    const roles = makeRoles({
      reranker: { provider: 'siliconflow', model: 'BAAI/bge-reranker-v2-m3', embeddingBatchSize: 16 },
    });
    setRoleConfig(roles, 'reranker', { model: 'new-model' });
    expect(roles.reranker).toMatchObject({
      provider: 'siliconflow',
      model: 'new-model',
      embeddingBatchSize: 16,
    });
  });
});

// ==================== getProviderAccount ====================

describe('getProviderAccount', () => {
  it('returns account for existing provider', () => {
    const providers: Record<string, unknown> = {
      deepseek: { apiKey: 'sk-test' },
      custom1: { apiKey: '', baseUrl: 'https://example.com', name: 'My API' },
    };
    expect(getProviderAccount(providers, 'deepseek')).toEqual({ apiKey: 'sk-test' });
    expect(getProviderAccount(providers, 'custom1')).toEqual({ apiKey: '', baseUrl: 'https://example.com', name: 'My API' });
  });

  it('returns undefined for missing provider', () => {
    const providers: Record<string, unknown> = {};
    expect(getProviderAccount(providers, 'nonexistent')).toBeUndefined();
  });
});

// ==================== setProviderAccount ====================

describe('setProviderAccount', () => {
  it('creates new provider account', () => {
    const providers: Record<string, unknown> = {};
    setProviderAccount(providers, 'custom-1', { apiKey: 'sk-new', baseUrl: 'https://api.test.com' });
    expect(providers['custom-1']).toEqual({ apiKey: 'sk-new', baseUrl: 'https://api.test.com' });
  });

  it('merges patch onto existing account', () => {
    const providers: Record<string, unknown> = {
      deepseek: { apiKey: 'old-key' },
    };
    setProviderAccount(providers, 'deepseek', { apiKey: 'new-key' });
    expect(providers['deepseek']).toEqual({ apiKey: 'new-key' });
  });

  it('preserves existing fields when patching', () => {
    const providers: Record<string, unknown> = {
      custom: { apiKey: 'sk-test', baseUrl: 'https://a.com', name: 'A' },
    };
    setProviderAccount(providers, 'custom', { name: 'B' });
    expect(providers['custom']).toEqual({ apiKey: 'sk-test', baseUrl: 'https://a.com', name: 'B' });
  });
});

// ==================== validateBaseUrl ====================

describe('validateBaseUrl', () => {
  it('accepts valid https URL', () => {
    expect(validateBaseUrl('https://api.openai.com/v1')).toEqual({ valid: true });
  });

  it('accepts valid http URL', () => {
    expect(validateBaseUrl('http://localhost:8080/v1')).toEqual({ valid: true });
  });

  it('accepts empty string', () => {
    expect(validateBaseUrl('')).toEqual({ valid: true });
  });

  it('accepts whitespace-only string', () => {
    expect(validateBaseUrl('   ')).toEqual({ valid: true });
  });

  it('rejects non-http protocols', () => {
    const result = validateBaseUrl('ftp://files.example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('http');
  });

  it('rejects file:// protocol', () => {
    const result = validateBaseUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
  });

  it('blocks cloud metadata address 169.254.169.254', () => {
    const result = validateBaseUrl('http://169.254.169.254/latest/meta-data');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('链路本地');
  });

  it('rejects malformed URL', () => {
    const result = validateBaseUrl('not a url at all');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('格式无效');
  });

  it('rejects URL with spaces', () => {
    const result = validateBaseUrl('https://api .example.com');
    expect(result.valid).toBe(false);
  });

  it('accepts URL with port', () => {
    expect(validateBaseUrl('https://api.example.com:8443/v1')).toEqual({ valid: true });
  });
});
