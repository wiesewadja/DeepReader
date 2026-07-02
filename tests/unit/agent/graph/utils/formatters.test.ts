import { describe, it, expect } from 'vitest';
import {
  emptyPreSearchResult,
  formatBlockLines,
  formatVerifiedFullBookBlock,
} from '@/agent/graph/utils/formatters';

describe('emptyPreSearchResult', () => {
  it('returns empty strings and arrays by default', () => {
    const result = emptyPreSearchResult();
    expect(result.validatedScopeNodeIds).toEqual([]);
    expect(result.preSearchBlock).toBe('');
    expect(result.earlyStopContent).toBe('');
    expect(result.toolResultsSnapshot).toEqual([]);
    expect(result.prevSearchedBlockIds).toEqual([]);
    expect(result.verifiedFullBookHits).toEqual([]);
  });

  it('passes through scopeNodeIds', () => {
    const result = emptyPreSearchResult(['node1', 'node2']);
    expect(result.validatedScopeNodeIds).toEqual(['node1', 'node2']);
  });
});

describe('formatBlockLines', () => {
  it('formats hits with pdfName prefix', () => {
    const hits = [
      { title: 'Ch1', file_name: 'ch1.md', matched_blocks: [{ block_id: 'b1', content: 'hello' }] },
    ];
    const lines = formatBlockLines(hits, 'MyBook');
    expect(lines).toEqual(['【MyBook/ch1.md#^b1】\nhello']);
  });

  it('formats hits without pdfName', () => {
    const hits = [
      { title: 'Ch1', file_name: 'ch1.md', matched_blocks: [{ block_id: 'b1', content: 'hello' }] },
    ];
    const lines = formatBlockLines(hits, '');
    expect(lines).toEqual(['【ch1.md#^b1】\nhello']);
  });

  it('flattens multiple blocks across multiple hits', () => {
    const hits = [
      { title: 'Ch1', file_name: 'ch1.md', matched_blocks: [
        { block_id: 'b1', content: 'first' },
        { block_id: 'b2', content: 'second' },
      ]},
      { title: 'Ch2', file_name: 'ch2.md', matched_blocks: [
        { block_id: 'b3', content: 'third' },
      ]},
    ];
    const lines = formatBlockLines(hits, 'Book');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('#^b1');
    expect(lines[2]).toContain('#^b3');
  });
});

describe('formatVerifiedFullBookBlock', () => {
  it('formats L5 hits into prompt block', () => {
    const hits = [
      {
        nodeId: 'n1', title: 'Chapter 1', fileName: 'ch1.md', score: 0.8,
        matchedBlocks: [{ blockId: '^b1', content: 'relevant evidence here' }],
      },
    ];
    const block = formatVerifiedFullBookBlock(hits);
    expect(block).toContain('verified_full_book_hits');
    expect(block).toContain('L5 负向声明自动复核命中');
    expect(block).toContain('Chapter 1');
    expect(block).toContain('relevant evidence here');
  });

  it('truncates content to 200 chars', () => {
    const longContent = 'a'.repeat(300);
    const hits = [
      {
        nodeId: 'n1', title: 'Ch1', fileName: 'ch1.md', score: 0.8,
        matchedBlocks: [{ blockId: 'b1', content: longContent }],
      },
    ];
    const block = formatVerifiedFullBookBlock(hits);
    expect(block).toContain('...');
    expect(block).not.toContain('a'.repeat(201));
  });

  it('limits to 3 hits × 2 blocks each', () => {
    const hits = Array.from({ length: 5 }, (_, i) => ({
      nodeId: `n${i}`, title: `Ch${i}`, fileName: `ch${i}.md`, score: 0.8,
      matchedBlocks: [
        { blockId: `b${i}-1`, content: `content ${i}-1` },
        { blockId: `b${i}-2`, content: `content ${i}-2` },
      ],
    }));
    const block = formatVerifiedFullBookBlock(hits);
    // Should only contain 3 hits max
    expect(block).toContain('Ch0');
    expect(block).toContain('Ch2');
    expect(block).not.toContain('Ch3');
  });

  it('strips leading ^ from blockId', () => {
    const hits = [
      {
        nodeId: 'n1', title: 'Ch1', fileName: 'ch1.md', score: 0.8,
        matchedBlocks: [{ blockId: '^b1', content: 'test' }],
      },
    ];
    const block = formatVerifiedFullBookBlock(hits);
    expect(block).toContain('block_id: b1');
    expect(block).not.toContain('block_id: ^b1');
  });
});
