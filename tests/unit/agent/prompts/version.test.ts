// tests/unit/agent/prompts/version.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptVersionManager } from '../../../../src/agent/prompts/version.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

describe('PromptVersionManager', () => {
  let manager: PromptVersionManager;

  beforeEach(() => {
    manager = new PromptVersionManager();
  });

  const mockModule: PromptModule = {
    id: 'test',
    version: '1.0.0',
    name: 'Test',
    metadata: { category: 'core' },
    locales: { zh: { systemPrompt: 'test' } },
  };

  it('should register module version', () => {
    manager.register(mockModule);
    expect(manager.getVersion('test')).toBe('1.0.0');
  });

  it('should get changelog', () => {
    manager.register(mockModule);
    const changelog = manager.getChangelog('test');
    expect(changelog).toHaveLength(1);
    expect(changelog[0].version).toBe('1.0.0');
  });

  it('should compare versions', () => {
    expect(manager.compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(manager.compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(manager.compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('should return unknown for non-existent module', () => {
    expect(manager.getVersion('nonexistent')).toBe('unknown');
  });
});
