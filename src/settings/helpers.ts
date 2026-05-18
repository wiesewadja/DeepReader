/**
 * Type-safe helpers for accessing role/provider config from settings.
 * Centralizes type casts so callers don't need `as unknown as`.
 */

import type { RoleType } from '../config/types';
import type { AIRoleConfig, AIRoles, AIProviderAccount } from '../config/ai-roles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RolesAny = Record<string, AIRoleConfig | null>;

function asRoles(roles: AIRoles): RolesAny {
  return roles as unknown as RolesAny;
}

function asProviders(providers: Record<string, unknown>): Record<string, AIProviderAccount> {
  return providers as Record<string, AIProviderAccount>;
}

export function getRoleConfig(roles: AIRoles, role: RoleType): AIRoleConfig | null {
  return asRoles(roles)[role] ?? null;
}

export function setRoleConfig(
  roles: AIRoles,
  role: RoleType,
  patch: Partial<AIRoleConfig> | null,
): void {
  if (patch === null) {
    asRoles(roles)[role] = null;
  } else {
    const existing = asRoles(roles)[role];
    asRoles(roles)[role] = { ...(existing as AIRoleConfig), ...patch };
  }
}

export function getProviderAccount(
  providers: Record<string, unknown>,
  providerId: string,
): AIProviderAccount | undefined {
  return asProviders(providers)[providerId];
}

export function setProviderAccount(
  providers: Record<string, unknown>,
  providerId: string,
  patch: Partial<AIProviderAccount>,
): void {
  const existing = asProviders(providers)[providerId];
  asProviders(providers)[providerId] = { ...existing, ...patch };
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
): (this: unknown, ...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (this: unknown, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay: number,
): (this: unknown, ...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<unknown> | null = null;
  return function (this: unknown, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    pending = new Promise(resolve => {
      timer = setTimeout(async () => {
        timer = null;
        pending = null;
        await fn.apply(this, args);
        resolve(undefined);
      }, delay);
    });
  };
}

export function validateBaseUrl(url: string): { valid: boolean; error?: string } {
  if (!url.trim()) return { valid: true };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: '仅支持 http/https 协议' };
    }
    const hostname = parsed.hostname;
    if (hostname === '169.254.169.254') {
      return { valid: false, error: '不允许使用链路本地地址' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }
}
