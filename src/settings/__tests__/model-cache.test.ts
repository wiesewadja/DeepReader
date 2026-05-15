import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must import after mocking if needed, but these are module-level state
// so we re-import for each test to get fresh module state
describe('role-card model cache', () => {
  // Dynamic import to get fresh module state per test
  let cache: typeof import('../components/role-card');

  beforeEach(async () => {
    // Reset module registry to get fresh module-level Map
    vi.resetModules();
    cache = await import('../components/role-card');
  });

  describe('getCachedModels', () => {
    it('returns undefined when no cache exists', () => {
      expect(cache.getCachedModels('deepseek')).toBeUndefined();
    });

    it('returns cached models after setting via clearModelCache is NOT used', () => {
      // getCachedModels reads from modelListCache which is populated by the UI refresh flow
      // We can only test the public API: getCachedModels returns undefined for uncached providers
      expect(cache.getCachedModels('nonexistent')).toBeUndefined();
    });
  });

  describe('clearModelCache', () => {
    it('does not throw when clearing non-existent provider', () => {
      expect(() => cache.clearModelCache('nonexistent')).not.toThrow();
    });

    it('does not throw when clearing all caches', () => {
      expect(() => cache.clearModelCache()).not.toThrow();
    });
  });
});
