/**
 * self-verification.ts 现状行为回归测试
 *
 * 目标：固化 self-verification 当前行为（不改实现）。
 * 这是 hot path - 被 formatter + 5 个 S2/S3 节点调用（verifyAndCleanContent）。
 * 关键函数：extractWikiLinks, checkWikiLinkValid, checkBlockIdExists,
 *          removeGhostLinks, removeGhostFileLinks, verifyAndCleanContent
 */

import { describe, it, expect } from 'vitest';
import {
  extractWikiLinks,
  extractBlockIds,
  checkBlockIdExists,
  checkWikiLinkValid,
  removeGhostLinks,
  removeGhostFileLinks,
  verifyAndCleanContent,
} from '@/agent/graph/utils/self-verification';
import type { ToolResultEntry } from '@/agent/graph/utils/self-verification';

function makeEntry(overrides: Partial<ToolResultEntry> = {}): ToolResultEntry {
  return {
    toolName: 'search_book',
    args: {},
    result: '',
    originalResultLength: 0,
    extractedBlockIds: [],
    ...overrides,
  };
}

describe('extractWikiLinks', () => {
  it('extracts links with block_id and alias', () => {
    const content = 'see [[西方史纲/01-序#^b1|序]] for context';
    const links = extractWikiLinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      blockId: 'b1',
      fileName: '01-序',
      bookName: '西方史纲',
    });
  });

  it('extracts links without block_id', () => {
    const content = 'see [[西方史纲/01-序|序]] for context';
    const links = extractWikiLinks(content);
    expect(links).toHaveLength(1);
    expect(links[0].blockId).toBe('');
    expect(links[0].fileName).toBe('01-序');
  });

  it('returns empty array for content with no links', () => {
    expect(extractWikiLinks('plain text without any links')).toEqual([]);
  });

  it('extracts multiple links', () => {
    const content = '[[西方史纲/01-序#^b1|序]] and [[西方史纲/02-论#^b2|论]]';
    const links = extractWikiLinks(content);
    expect(links).toHaveLength(2);
    expect(links[0].blockId).toBe('b1');
    expect(links[1].blockId).toBe('b2');
  });
});

describe('extractBlockIds', () => {
  it('returns list of blockIds only', () => {
    const ids = extractBlockIds('[[a/1#^b1|x]] and [[a/2#^b2|y]]');
    expect(ids).toEqual(['b1', 'b2']);
  });

  it('returns array of empty strings for links without block_id', () => {
    // 现状行为：extractBlockIds 返回所有 link 的 blockId，无 block_id 时为空字符串
    expect(extractBlockIds('[[a/1|x]] and [[a/2|y]]')).toEqual(['', '']);
  });
});

describe('checkBlockIdExists', () => {
  it('returns "found" when block_id is in result', () => {
    const results = [makeEntry({ result: 'content with ^b1 reference' })];
    expect(checkBlockIdExists('b1', results)).toBe('found');
  });

  it('uses word boundary to avoid p1 matching p10', () => {
    const results = [makeEntry({ result: 'content with ^p10 reference' })];
    expect(checkBlockIdExists('p1', results)).toBe('ghost');
  });

  it('returns "ghost" when block_id is not in results', () => {
    const results = [makeEntry({ result: 'content with ^other reference' })];
    expect(checkBlockIdExists('missing', results)).toBe('ghost');
  });

  it('checks extractedBlockIds when result is truncated', () => {
    const results = [makeEntry({
      result: 'truncated...',
      originalResultLength: 5000, // > MAX_TOOL_RESULT_LENGTH
      extractedBlockIds: ['b1'],
    })];
    expect(checkBlockIdExists('b1', results)).toBe('found');
  });
});

describe('checkWikiLinkValid', () => {
  it('returns "valid" when both block_id and filename found', () => {
    const results = [makeEntry({ result: 'has ^b1 and mentions 01-序' })];
    expect(checkWikiLinkValid('b1', '01-序', results)).toBe('valid');
  });

  it('returns "invalid-file" when block_id found but filename missing', () => {
    const results = [makeEntry({ result: 'has ^b1 but no filename' })];
    expect(checkWikiLinkValid('b1', 'missing', results)).toBe('invalid-file');
  });

  it('returns "valid" when no block_id and filename found', () => {
    const results = [makeEntry({ result: 'mentions 01-序' })];
    expect(checkWikiLinkValid('', '01-序', results)).toBe('valid');
  });

  it('returns "ghost" when nothing found', () => {
    const results = [makeEntry({ result: 'unrelated content' })];
    expect(checkWikiLinkValid('b1', '01-序', results)).toBe('ghost');
  });
});

describe('removeGhostLinks', () => {
  it('downgrades ghost block_id links to file-level links', () => {
    const content = 'see [[西方史纲/01-序#^ghost|序]] for context';
    const result = removeGhostLinks(content, new Set(['ghost']));
    expect(result).toBe('see [[西方史纲/01-序|序]] for context');
  });

  it('keeps non-ghost block_id links unchanged', () => {
    const content = 'see [[西方史纲/01-序#^b1|序]]';
    const result = removeGhostLinks(content, new Set(['ghost']));
    expect(result).toBe(content);
  });

  it('returns content unchanged when ghost set is empty', () => {
    const content = 'see [[西方史纲/01-序#^ghost|序]]';
    expect(removeGhostLinks(content, new Set())).toBe(content);
  });
});

describe('removeGhostFileLinks', () => {
  it('does NOT delete ghost file links (current behavior is to preserve)', () => {
    const content = 'see [[西方史纲/01-序|序]]';
    const result = removeGhostFileLinks(content, new Set(['01-序']));
    // 当前实现是 no-op（保留链接，让 formatter 兜底处理）
    expect(result).toBe(content);
  });
});

describe('verifyAndCleanContent', () => {
  it('returns content unchanged when no wiki links', async () => {
    const result = await verifyAndCleanContent('plain text', []);
    expect(result.content).toBe('plain text');
    expect(result.totalRefs).toBe(0);
    expect(result.ghostRefs).toBe(0);
  });

  it('removes ghost block_id links but keeps ghost file links', async () => {
    const results = [makeEntry({ result: 'has ^b1 and mentions 01-序' })];
    const content = '[[a/01-序#^b1|good]] and [[a/02-论#^ghost|bad-block]] and [[a/03-论|bad-file]]';
    const result = await verifyAndCleanContent(content, results);
    // 好的保留, ghost-block 降级, ghost-file 当前保留（removeGhostFileLinks 是 no-op）
    expect(result.content).toContain('[[a/01-序#^b1|good]]');
    expect(result.content).toContain('[[a/02-论|bad-block]]'); // 降级（去掉 #^ghost）
    expect(result.content).toContain('[[a/03-论|bad-file]]'); // 保留（no-op）
    // 现状行为：ghostCount = ghostIds.size + ghostFiles.size = 1 + 1 = 2
    expect(result.ghostRefs).toBe(2);
  });

  it('returns valid file content unchanged', async () => {
    const results = [makeEntry({ result: 'has ^b1 and mentions 01-序' })];
    const content = 'see [[西方史纲/01-序#^b1|序]]';
    const result = await verifyAndCleanContent(content, results);
    expect(result.content).toBe(content);
    expect(result.ghostRefs).toBe(0);
  });
});
