import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScopeInterceptor } from '../../cognitive-engine/interceptor/scope-interceptor';

describe('createScopeInterceptor', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('should inject scopeNodeIds into search_markdown_text calls', () => {
    const interceptor = createScopeInterceptor(['node_c4', 'node_c5']);

    const result = interceptor('search_markdown_text', { query: 'MECE' });

    expect(result.scopeNodeIds).toEqual(['node_c4', 'node_c5']);
    expect(result.query).toBe('MECE');
  });

  it('should preserve existing scopeNodeIds if already set', () => {
    const interceptor = createScopeInterceptor(['node_c4']);

    const result = interceptor('search_markdown_text', {
      query: 'test',
      scopeNodeIds: ['node_c1']
    });

    // Interceptor should override with locked scope
    expect(result.scopeNodeIds).toEqual(['node_c4']);
  });

  it('should warn when read_markdown_section called with out-of-scope node_id', () => {
    const interceptor = createScopeInterceptor(['node_c4', 'node_c5']);

    const result = interceptor('read_markdown_section', { node_id: 'node_c1' });

    expect(result._error).toBeDefined();
    expect(result._error).toContain('node_c1');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('should allow read_markdown_section with in-scope node_id', () => {
    const interceptor = createScopeInterceptor(['node_c4', 'node_c5']);

    const result = interceptor('read_markdown_section', { node_id: 'node_c4' });

    expect(result._error).toBeUndefined();
    expect(result.node_id).toBe('node_c4');
  });

  it('should pass through unknown tools unchanged', () => {
    const interceptor = createScopeInterceptor(['node_c4']);

    const result = interceptor('unknown_tool', { foo: 'bar' });

    expect(result).toEqual({ foo: 'bar' });
  });
});