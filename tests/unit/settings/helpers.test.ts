import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getRoleConfig,
  setRoleConfig,
  getProviderAccount,
  setProviderAccount,
  debounce,
  debounceAsync,
  validateBaseUrl,
} from '@/settings/helpers';

describe('getRoleConfig', () => {
  it('should return role config when exists', () => {
    const roles = { 'analyst': { name: 'Analyst', systemPrompt: 'test' } } as any;
    expect(getRoleConfig(roles, 'analyst')).toEqual({ name: 'Analyst', systemPrompt: 'test' });
  });

  it('should return null when role does not exist', () => {
    const roles = {} as any;
    expect(getRoleConfig(roles, 'analyst')).toBeNull();
  });
});

describe('setRoleConfig', () => {
  it('should set role config', () => {
    const roles = {} as any;
    setRoleConfig(roles, 'analyst', { name: 'Analyst', systemPrompt: 'test' });
    expect(roles.analyst).toEqual({ name: 'Analyst', systemPrompt: 'test' });
  });

  it('should merge with existing config', () => {
    const roles = { 'analyst': { name: 'Old', systemPrompt: 'old' } } as any;
    setRoleConfig(roles, 'analyst', { name: 'New' });
    expect(roles.analyst).toEqual({ name: 'New', systemPrompt: 'old' });
  });

  it('should delete role when patch is null', () => {
    const roles = { 'analyst': { name: 'Analyst' } } as any;
    setRoleConfig(roles, 'analyst', null);
    expect(roles.analyst).toBeNull();
  });
});

describe('getProviderAccount', () => {
  it('should return provider account when exists', () => {
    const providers = { 'openai': { apiKey: 'sk-123', baseUrl: '' } } as any;
    expect(getProviderAccount(providers, 'openai')).toEqual({ apiKey: 'sk-123', baseUrl: '' });
  });

  it('should return undefined when provider does not exist', () => {
    const providers = {} as any;
    expect(getProviderAccount(providers, 'openai')).toBeUndefined();
  });
});

describe('setProviderAccount', () => {
  it('should set provider account', () => {
    const providers = {} as any;
    setProviderAccount(providers, 'openai', { apiKey: 'sk-123', baseUrl: '' });
    expect(providers.openai).toEqual({ apiKey: 'sk-123', baseUrl: '' });
  });

  it('should merge with existing account', () => {
    const providers = { 'openai': { apiKey: 'old', baseUrl: '' } } as any;
    setProviderAccount(providers, 'openai', { apiKey: 'new' });
    expect(providers.openai).toEqual({ apiKey: 'new', baseUrl: '' });
  });
});

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on repeated calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('validateBaseUrl', () => {
  it('should accept valid https url', () => {
    expect(validateBaseUrl('https://api.openai.com')).toEqual({ valid: true });
  });

  it('should accept valid http url', () => {
    expect(validateBaseUrl('http://localhost:3000')).toEqual({ valid: true });
  });

  it('should accept empty string', () => {
    expect(validateBaseUrl('')).toEqual({ valid: true });
  });

  it('should accept whitespace-only string', () => {
    expect(validateBaseUrl('   ')).toEqual({ valid: true });
  });

  it('should reject invalid url format', () => {
    const result = validateBaseUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('URL 格式无效');
  });

  it('should reject non-http protocol', () => {
    const result = validateBaseUrl('ftp://example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('http/https');
  });

  it('should reject link-local address', () => {
    const result = validateBaseUrl('http://169.254.169.254/metadata');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('链路本地地址');
  });
});
