import { describe, it, expect, vi } from 'vitest';
import { createLangChainTools } from '../../tools/index.js';
import type { ToolContext } from '../../tools/types.js';

// 最小 ToolContext mock
const mockContext: ToolContext = {
  vault: {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/test-vault',
          exists: vi.fn().mockResolvedValue(true),
          read: vi.fn().mockResolvedValue('test content'),
          write: vi.fn().mockResolvedValue(undefined),
          create: vi.fn().mockResolvedValue(undefined),
          getAbstractFileByPath: vi.fn().mockReturnValue(null),
        },
        read: vi.fn().mockResolvedValue('test content'),
        create: vi.fn().mockResolvedValue(undefined),
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({ frontmatter: {} }),
      },
    } as any,
    plugin: { settings: { embedding: null } } as any,
  },
  book: {
    indexId: 'test-book-id',
    pdfName: 'test-book.pdf',
  },
};

describe('LangChain Tools Migration', () => {
  it('should create all tools without errors', () => {
    const tools = createLangChainTools(mockContext);
    expect(tools.length).toBeGreaterThanOrEqual(9);

    const names = tools.map((t) => t.name);
    expect(names).toContain('search_book');
    expect(names).toContain('read_book_section');
    expect(names).toContain('write_note');
    expect(names).toContain('save_memory');
    expect(names).toContain('search_memory');
    expect(names).toContain('update_profile');
    expect(names).toContain('search_read_books');
    expect(names).toContain('excalidraw');
    expect(names).toContain('canvas');
  });

  it('each tool should have name, description, and schema', () => {
    const tools = createLangChainTools(mockContext);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.schema).toBeDefined();
    }
  });

  it('should exclude canvas when app is not available', () => {
    const noAppContext = { ...mockContext, vault: { ...mockContext.vault, app: undefined } };
    const tools = createLangChainTools(noAppContext as any);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('canvas');
    // excalidraw 不依赖 app，应该存在
    expect(names).toContain('excalidraw');
  });
});
