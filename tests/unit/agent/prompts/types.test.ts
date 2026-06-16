// tests/unit/agent/prompts/types.test.ts
import { describe, it, expect } from 'vitest';

describe('PromptModule Types', () => {
  it('should define PromptLocale interface', () => {
    // This is a type-only test - just verify the types compile
    const locale: import('../../../../src/agent/prompts/types.js').PromptLocale = {
      systemPrompt: 'test',
    };
    expect(locale.systemPrompt).toBe('test');
  });

  it('should define PromptMetadata interface', () => {
    const metadata: import('../../../../src/agent/prompts/types.js').PromptMetadata = {
      category: 'core',
    };
    expect(metadata.category).toBe('core');
  });

  it('should define PromptModule interface', () => {
    const module: import('../../../../src/agent/prompts/types.js').PromptModule = {
      id: 'test',
      version: '1.0.0',
      name: 'Test',
      metadata: { category: 'core' },
      locales: {
        zh: { systemPrompt: 'test' },
      },
    };
    expect(module.id).toBe('test');
  });
});
