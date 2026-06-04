/**
 * wiki-link-hook.ts 现状行为回归测试
 *
 * 目标：固化 wiki-link-hook 当前行为（不改实现）。
 * 当前 0 调用方（dead code），但具备真实 vault.adapter.exists 校验，
 * 是 Phase 2 接入 formatter 的目标。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/logger.js', () => ({
  agentLog: vi.fn(),
}));

import { validateWikiLinks } from '@/agent/utils/wiki-link-hook';
import type { ToolResultEntry } from '@/agent/graph/utils/self-verification';
import type { App } from 'obsidian';

function createMockApp(adapterOverrides: Record<string, any> = {}) {
  return {
    vault: {
      adapter: {
        exists: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
        ...adapterOverrides,
      },
    },
  } as unknown as App;
}

function createToolResults(entries: Partial<ToolResultEntry>[] = []): ToolResultEntry[] {
  return entries.map(e => ({
    toolName: 'search_book',
    args: {},
    result: '',
    originalResultLength: 0,
    extractedBlockIds: [],
    ...e,
  }));
}

describe('validateWikiLinks - parsing', () => {
  it('keeps valid link unchanged when file exists and no block_id', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = '[[西方史纲/01-序|序]]';
    const result = await validateWikiLinks(content, {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    expect(result.correctionsApplied).toBe(0);
    expect(result.correctedContent).toBe(content);
    expect(result.issues).toHaveLength(0);
  });

  it('flags wrong_book issue when link has different bookName', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(false),
    });
    const result = await validateWikiLinks('[[另一本书/01-序|序]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    const wrongBookIssue = result.issues.find(i => i.issueType === 'wrong_book');
    expect(wrongBookIssue).toBeDefined();
  });

  it('flags file_not_found and suggests correction via fuzzy match', async () => {
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('08-八、抗议.md')) return true;
        return false;
      }),
    });
    const result = await validateWikiLinks('[[西方史纲/07-八、抗议|七、抗议]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    const fileNotFound = result.issues.find(i => i.issueType === 'file_not_found');
    expect(fileNotFound).toBeDefined();
  });
});

describe('validateWikiLinks - block_id validation', () => {
  it('keeps block_id link when block_id exists in tool results', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const toolResults = createToolResults([
      { toolName: 'search_book', result: '...content with ^b1 reference...' },
    ]);
    const content = '[[西方史纲/01-序#^b1|序]]';
    const result = await validateWikiLinks(content, {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults,
    });
    expect(result.correctionsApplied).toBe(0);
  });

  it('flags block_not_found when block_id not in tool results', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const toolResults = createToolResults([
      { toolName: 'search_book', result: '...content with ^b999 reference...' },
    ]);
    const result = await validateWikiLinks('[[西方史纲/01-序#^b1|序]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults,
    });
    const blockIssue = result.issues.find(i => i.issueType === 'block_not_found');
    expect(blockIssue).toBeDefined();
  });
});

describe('validateWikiLinks - multi-link content', () => {
  it('processes multiple links in one content', async () => {
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes('西方史纲/01-序')) return true;
        if (path.includes('西方史纲/02-论')) return true;
        return false;
      }),
    });
    const content = '[[西方史纲/01-序|序]] and [[西方史纲/02-论|论]]';
    const result = await validateWikiLinks(content, {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    expect(result.issues).toHaveLength(0);
    expect(result.correctionsApplied).toBe(0);
  });

  it('returns 0 corrections when no issues', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const result = await validateWikiLinks('[[西方史纲/01-序|序]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    expect(result.correctionsApplied).toBe(0);
  });
});
