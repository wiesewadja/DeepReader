import { describe, it, expect, beforeEach } from 'vitest';
import { InspectionalState } from '../../cognitive-engine/states/inspectional';
import { createSharedContext } from '../../cognitive-engine/context';
import type { SharedContext } from '../../cognitive-engine/types';
import { formatTreeStructure, buildInspectionalSystemPrompt } from '../../cognitive-engine/prompts/inspectional-prompt';
import type { OutlineNode } from '../../tools/local/types';

describe('InspectionalState', () => {
  let inspectionalState: InspectionalState;
  let ctx: SharedContext;

  beforeEach(() => {
    inspectionalState = new InspectionalState();
    ctx = createSharedContext({
      indexId: 'test',
      pdfName: 'Test Book',
      rawUserQuery: '什么是MECE？',
    });
    ctx.standaloneQuery = '什么是MECE？';
  });

  it('should have correct metadata', () => {
    expect(inspectionalState.name).toBe('Inspectional');
    expect(inspectionalState.model).toBe('fast');
    // S1 no longer needs tools - tree is embedded in prompt
    expect(inspectionalState.tools).toEqual([]);
  });

  it('should NOT have search_markdown_text tool', () => {
    // Critical: S1 should NOT have search_markdown_text to prevent LLM from reading body
    expect(inspectionalState.tools).not.toContain('search_markdown_text');
  });

  it('should NOT have get_document_outline in tools (tree is embedded in prompt)', () => {
    // S1 now embeds tree in prompt, no tool call needed
    expect(inspectionalState.tools).not.toContain('get_document_outline');
  });

  it('should build correct system prompt', () => {
    const prompt = inspectionalState.buildSystemPrompt(ctx);

    // Prompt should contain inspectional reading concepts
    expect(prompt).toContain('scopeNodeIds');
    expect(prompt).toContain('检视阅读');
  });

  it('should include docDescription in system prompt when available', () => {
    // 设置全书摘要
    ctx.docDescription = '这是一本关于结构化思维方法的书籍，系统介绍了MECE原则、金字塔原理等核心概念。';

    const prompt = inspectionalState.buildSystemPrompt(ctx);

    // 提示词应包含全书摘要
    expect(prompt).toContain('book_summary');
    expect(prompt).toContain('MECE原则');
  });

  it('should not include book_summary section when docDescription is empty', () => {
    ctx.docDescription = undefined;

    const prompt = inspectionalState.buildSystemPrompt(ctx);

    // 提示词不应包含 book_summary 标签
    expect(prompt).not.toContain('<book_summary>');
  });

  it('should mark state as executed after execution', async () => {
    await inspectionalState.execute(ctx);

    expect(ctx.executedStates.has('Inspectional')).toBe(true);
  });
});

describe('formatTreeStructure', () => {
  it('should format simple tree correctly', () => {
    const nodes: OutlineNode[] = [
      {
        node_id: '0001',
        heading: '第一章 绪论',
        level: 1,
        line: 1,
        summary: '介绍基本概念',
      },
      {
        node_id: '0002',
        heading: '第二章 方法论',
        level: 1,
        line: 1,
        summary: '核心方法介绍',
      },
    ];

    const result = formatTreeStructure(nodes);

    expect(result).toContain('第一章 绪论 (node_id: 0001)');
    expect(result).toContain('摘要: 介绍基本概念');
    expect(result).toContain('第二章 方法论 (node_id: 0002)');
  });

  it('should format tree with children correctly', () => {
    const nodes: OutlineNode[] = [
      {
        node_id: '0001',
        heading: '第一章 绪论',
        level: 1,
        line: 1,
        summary: '介绍基本概念',
        children: [
          {
            node_id: '0002',
            heading: '1.1 背景',
            level: 2,
            line: 1,
            summary: '研究背景',
          },
          {
            node_id: '0003',
            heading: '1.2 目的',
            level: 2,
            line: 1,
          },
        ],
      },
    ];

    const result = formatTreeStructure(nodes);

    expect(result).toContain('第一章 绪论 (node_id: 0001)');
    expect(result).toContain('├── 1.1 背景 (node_id: 0002)');
    expect(result).toContain('└── 1.2 目的 (node_id: 0003)');
  });

  it('should truncate long summaries', () => {
    const longSummary = '这是一个非常长的摘要'.repeat(20);
    const nodes: OutlineNode[] = [
      {
        node_id: '0001',
        heading: '第一章',
        level: 1,
        line: 1,
        summary: longSummary,
      },
    ];

    const result = formatTreeStructure(nodes, 0, 50);

    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longSummary.length + 100);
  });
});

describe('buildInspectionalSystemPrompt', () => {
  it('should include tree text in prompt', () => {
    const treeText = '├── 第一章 (node_id: 0001)\n│   摘要: 介绍...';
    const prompt = buildInspectionalSystemPrompt(treeText, 'Test Book', 2);

    expect(prompt).toContain('Test Book');
    expect(prompt).toContain(treeText);
    expect(prompt).toContain('目录树:');
    expect(prompt).toContain('深度 2');
  });

  it('should include docDescription when provided', () => {
    const treeText = '├── 第一章 (node_id: 0001)';
    const prompt = buildInspectionalSystemPrompt(
      treeText,
      'Test Book',
      2,
      '这是一本关于思维方法的书籍。'
    );

    expect(prompt).toContain('book_summary');
    expect(prompt).toContain('这是一本关于思维方法的书籍');
  });

  it('should not include book_summary when docDescription is empty', () => {
    const treeText = '├── 第一章 (node_id: 0001)';
    const prompt = buildInspectionalSystemPrompt(treeText, 'Test Book', 1);

    expect(prompt).not.toContain('<book_summary>');
  });

  it('should show macro inspection branch for depth 1', () => {
    const treeText = '├── 第一章 (node_id: 0001)';
    const prompt = buildInspectionalSystemPrompt(treeText, 'Test Book', 1);

    expect(prompt).toContain('宏观检视');
    expect(prompt).toContain('structural_analysis');
  });

  it('should show scope locking branch for depth 2', () => {
    const treeText = '├── 第一章 (node_id: 0001)';
    const prompt = buildInspectionalSystemPrompt(treeText, 'Test Book', 2);

    expect(prompt).toContain('圈定战区');
    expect(prompt).toContain('把答题的任务留给下一阶段');
  });
});