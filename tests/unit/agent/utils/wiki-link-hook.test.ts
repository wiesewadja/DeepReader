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

describe('validateWikiLinks - metrics (T1.1)', () => {
  it('returns metrics field with totalLinks/validLinks/deadLinksRemoved/autoCorrectedLinks', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const result = await validateWikiLinks('[[西方史纲/01-序|序]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    // metrics 字段必须存在
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalLinks).toBe(1);
    expect(result.metrics.validLinks).toBe(1);
    expect(result.metrics.deadLinksRemoved).toBe(0);
    expect(result.metrics.autoCorrectedLinks).toBe(0);
  });

  it('metrics.totalLinks counts all wiki links', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const result = await validateWikiLinks('[[西方史纲/01-序|序]] and [[西方史纲/02-论|论]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    expect(result.metrics.totalLinks).toBe(2);
    expect(result.metrics.validLinks).toBe(2);
  });

  it('metrics.autoCorrectedLinks counts links that got corrected', async () => {
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (path: string) => {
        // book 目录存在
        if (path.endsWith('西方史纲')) return true;
        // 目标文件存在，模糊匹配候选
        if (path.endsWith('08-八、抗议.md')) return true;
        return false;
      }),
      list: vi.fn().mockResolvedValue({
        files: ['/vault/DeepReader/西方史纲/08-八、抗议.md'],
        folders: [],
      }),
    });
    const result = await validateWikiLinks('[[西方史纲/07-八、抗议|七、抗议]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    // 模糊匹配应触发自动纠正
    expect(result.metrics.autoCorrectedLinks).toBeGreaterThanOrEqual(1);
  });
});

describe('validateWikiLinks - batch cache (T1.1)', () => {
  it('calls list() once per book even with multiple links in same book', async () => {
    const listFn = vi.fn().mockResolvedValue({
      files: [
        '/vault/DeepReader/西方史纲/01-序.md',
        '/vault/DeepReader/西方史纲/02-论.md',
      ],
      folders: [],
    });
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes('西方史纲/01-序')) return true;
        if (path.includes('西方史纲/02-论')) return true;
        return false;
      }),
      list: listFn,
    });
    // 多个错误链接，触发同一本书的多次模糊匹配
    const content = '[[西方史纲/07-八、抗议|七]] and [[西方史纲/08-九|九]]';
    await validateWikiLinks(content, {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    // 优化后：同一本书只 list 一次
    const listCalls = listFn.mock.calls.filter(([path]) => path.includes('西方史纲'));
    expect(listCalls.length).toBeLessThanOrEqual(1);
  });
});

describe('validateWikiLinks - file existence checked BEFORE issue detection (T1.1)', () => {
  it('checks app.vault.adapter.exists for every link, not only when issue detected', async () => {
    const existsFn = vi.fn().mockResolvedValue(true);
    const app = createMockApp({ exists: existsFn });
    const content = '[[西方史纲/01-序|序]]';
    await validateWikiLinks(content, {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    // exists 至少被调用一次（验证文件存在）
    expect(existsFn).toHaveBeenCalled();
    // 至少包含 01-序 的路径
    const calledPaths = existsFn.mock.calls.map(c => c[0]).join('|');
    expect(calledPaths).toContain('01-序');
  });
});
