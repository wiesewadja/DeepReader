import { describe, it, expect, vi } from 'vitest';
import { hasDiagramIntent, generateDiagram } from '@/agent/graph/utils/diagram-helper';
import type { ToolContext } from '@/agent/tools/types';

function makeMockCtx(): ToolContext {
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const exists = vi.fn().mockResolvedValue(true);
  return {
    vault: {
      app: {
        vault: {
          adapter: { mkdir, write, exists },
        },
      },
      plugin: {} as any,
    },
    book: {} as any,
  } as unknown as ToolContext;
}

function makeMockModel(response: string) {
  return {
    invoke: vi.fn().mockResolvedValue({ content: response }),
  };
}

describe('hasDiagramIntent', () => {
  it('matches 思维导图', () => {
    expect(hasDiagramIntent('画个思维导图')).toBe(true);
  });

  it('matches 脑图', () => {
    expect(hasDiagramIntent('生成脑图')).toBe(true);
  });

  it('matches 流程图', () => {
    expect(hasDiagramIntent('画一个流程图')).toBe(true);
  });

  it('matches 画...图 pattern', () => {
    expect(hasDiagramIntent('画个结构图')).toBe(true);
    expect(hasDiagramIntent('画一张图')).toBe(true);
  });

  it('matches 可视化', () => {
    expect(hasDiagramIntent('可视化展示')).toBe(true);
  });

  it('matches 知识图谱', () => {
    expect(hasDiagramIntent('生成知识图谱')).toBe(true);
  });

  it('matches infographic', () => {
    expect(hasDiagramIntent('make an infographic')).toBe(true);
  });

  it('does not match normal questions', () => {
    expect(hasDiagramIntent('这本书讲了什么')).toBe(false);
    expect(hasDiagramIntent('解释一下这个概念')).toBe(false);
    expect(hasDiagramIntent('第三章的内容')).toBe(false);
  });

  it('does not match empty string', () => {
    expect(hasDiagramIntent('')).toBe(false);
  });
});

describe('generateDiagram', () => {
  it('returns embed on success', async () => {
    const mockCtx = makeMockCtx();
    const elements = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 },
    ];
    const mockModel = makeMockModel(JSON.stringify({
      filename: 'test-diagram',
      elements,
    }));

    const result = await generateDiagram(
      '画个思维导图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toContain('![[Excalidraw/test-diagram-');
    expect(result).toContain('.excalidraw.md]]');
  });

  it('returns empty when LLM returns non-JSON', async () => {
    const mockCtx = makeMockCtx();
    const mockModel = makeMockModel('这是普通文本，没有JSON');

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toBe('');
  });

  it('returns empty when JSON is missing filename', async () => {
    const mockCtx = makeMockCtx();
    const mockModel = makeMockModel(JSON.stringify({
      elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }],
    }));

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toBe('');
  });

  it('returns empty when JSON is missing elements', async () => {
    const mockCtx = makeMockCtx();
    const mockModel = makeMockModel(JSON.stringify({
      filename: 'test',
    }));

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toBe('');
  });

  it('returns empty when elements is empty array', async () => {
    const mockCtx = makeMockCtx();
    const mockModel = makeMockModel(JSON.stringify({
      filename: 'test',
      elements: [],
    }));

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toBe('');
  });

  it('returns empty when model.invoke throws', async () => {
    const mockCtx = makeMockCtx();
    const mockModel = {
      invoke: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toBe('');
  });

  it('handles JSON wrapped in markdown code block', async () => {
    const mockCtx = makeMockCtx();
    const elements = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 },
    ];
    const mockModel = makeMockModel(
      '```json\n' + JSON.stringify({ filename: 'wrapped', elements }) + '\n```'
    );

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toContain('![[Excalidraw/wrapped-');
    expect(result).toContain('.excalidraw.md]]');
  });

  it('includes pdfName in prompt when provided', async () => {
    const mockCtx = makeMockCtx();
    const elements = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 },
    ];
    const mockModel = makeMockModel(JSON.stringify({
      filename: 'book-diagram',
      elements,
    }));

    await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
      { pdfName: '测试书' },
    );

    const callArgs = mockModel.invoke.mock.calls[0][0];
    const userMsg = callArgs[1].content;
    expect(userMsg).toContain('书籍：测试书');
  });

  it('extracts JSON correctly when string contains braces', async () => {
    const mockCtx = makeMockCtx();
    const elements = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100, text: 'a {b} c' },
    ];
    const mockModel = makeMockModel(
      'Here is the result:\n' +
      JSON.stringify({ filename: 'brace-in-string', elements }) +
      '\nSome trailing text with {extra}.'
    );

    const result = await generateDiagram(
      '画个图',
      '分析内容',
      mockModel,
      mockCtx,
    );

    expect(result).toContain('![[Excalidraw/brace-in-string-');
    expect(result).toContain('.excalidraw.md]]');
  });
});
