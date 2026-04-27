import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEngine, adaptLegacyMindmap, adaptLegacyGraph } from '../index.js';

// Mock ExcalidrawAutomate
const mockCreate = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn();
const mockAddText = vi.fn().mockReturnValue('el-1');
const mockConnectObjects = vi.fn();
const mockAddRect = vi.fn().mockReturnValue('rect-1');

beforeEach(() => {
  vi.stubGlobal('window', {
    ExcalidrawAutomate: {
      create: mockCreate,
      clear: mockClear,
      addText: mockAddText,
      connectObjects: mockConnectObjects,
      addRect: mockAddRect,
      style: {
        strokeColor: '', backgroundColor: '', fillStyle: '',
        strokeWidth: 0, strokeStyle: '', roughness: 0,
        fontFamily: 1, fontSize: 16,
      },
    },
  });
  mockCreate.mockClear();
  mockClear.mockClear();
  mockAddText.mockClear();
  mockConnectObjects.mockClear();
  mockAddRect.mockClear();
});

describe('validateInput', () => {
  it('mindmap 缺少 topic 报错', async () => {
    const result = await runEngine({
      diagramType: 'mindmap',
      data: { topic: '', branches: [{ label: 'A', children: [] }] },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('topic');
  });

  it('mindmap branches 不是数组报错', async () => {
    const result = await runEngine({
      diagramType: 'mindmap',
      data: { topic: 'T', branches: null } as any,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('branches');
  });

  it('knowledge_graph 缺少 nodes 报错', async () => {
    const result = await runEngine({
      diagramType: 'knowledge_graph',
      data: { title: 'T', nodes: [], edges: [] },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('nodes');
  });

  it('knowledge_graph 节点缺 id 报错', async () => {
    const result = await runEngine({
      diagramType: 'knowledge_graph',
      data: { title: 'T', nodes: [{ label: 'A' } as any], edges: [] },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('id');
  });
});

describe('adaptLegacyMindmap', () => {
  it('转换旧格式', () => {
    const result = adaptLegacyMindmap({
      topic: '主题',
      branches: [
        { label: 'A', children: ['子1', { label: '子2', children: ['叶1'] }] },
      ],
    });
    expect(result.topic).toBe('主题');
    expect(result.branches[0].label).toBe('A');
    expect(result.branches[0].children[0].label).toBe('子1');
    expect(result.branches[0].children[1].label).toBe('子2');
    expect(result.branches[0].children[1].children![0].label).toBe('叶1');
  });
});

describe('adaptLegacyGraph', () => {
  it('转换旧格式', () => {
    const result = adaptLegacyGraph({
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'b', label: '关系' }],
    });
    expect(result.nodes[0].importance).toBe('major');
    expect(result.edges[0].type).toBe('association');
    expect(result.edges[0].direction).toBe('directed');
  });
});

describe('runEngine', () => {
  it('正常 mindmap 流程：布局 + 渲染', async () => {
    const result = await runEngine({
      diagramType: 'mindmap',
      data: { topic: 'T', branches: [{ label: 'A', children: [] }] },
      filename: 'test',
    });
    expect(result.success).toBe(true);
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalled();
  });

  it('正常 knowledge_graph 流程', async () => {
    const result = await runEngine({
      diagramType: 'knowledge_graph',
      data: {
        title: 'KG',
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ from: 'a', to: 'b' }],
      },
      filename: 'test-kg',
    });
    expect(result.success).toBe(true);
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
  });
});
