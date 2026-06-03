/**
 * Canvas Tool 测试
 *
 * TDD RED Phase: 这些测试描述了 Canvas Tool 应该具有的行为
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock obsidian module BEFORE importing anything
vi.mock('obsidian', () => ({
  TFile: class TFile {
    path: string;
    extension: string;
    constructor(path: string) {
      this.path = path;
      this.extension = path.split('.').pop() || '';
    }
  },
  normalizePath: (p: string) => p.replace(/\\/g, '/'),
}));

import { createCanvasTool } from '@/agent/tools/canvas';
import type { ToolExecutor, ToolContext } from '@/agent/tools/types';

// Mock Obsidian App
const createMockApp = () => ({
  vault: {
    create: vi.fn(),
    read: vi.fn(),
    modify: vi.fn(),
    createFolder: vi.fn().mockResolvedValue(undefined),
    getAbstractFileByPath: vi.fn(),
    getFiles: vi.fn(() => []),
  },
});

type MockApp = ReturnType<typeof createMockApp>;

describe('Canvas Tool', () => {
  let mockApp: MockApp;
  let canvasTool: ToolExecutor;
  let context: ToolContext;

  beforeEach(() => {
    mockApp = createMockApp();
    canvasTool = createCanvasTool(mockApp as any);
    context = { vault: {} as any, book: {} as any } as ToolContext;
  });

  describe('definition', () => {
    it('should have correct tool name', () => {
      expect(canvasTool.definition.function.name).toBe('canvas');
    });

    it('should have required action parameter', () => {
      const params = canvasTool.definition.function.parameters;
      expect(params.required).toContain('action');
    });

    it('should support create, add_node, add_edge, get, list, mindmap actions', () => {
      const actionEnum = canvasTool.definition.function.parameters.properties.action.enum;
      expect(actionEnum).toEqual(['create', 'add_node', 'add_edge', 'get', 'list', 'mindmap', 'export_to_excalidraw']);
    });
  });

  describe('create action', () => {
    it('should create canvas file with nodes and edges', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      const result = await canvasTool.execute({
        action: 'create',
        path: 'Canvas/test.canvas',
        nodes: [
          { type: 'text', text: 'Hello', x: 0, y: 0 }
        ],
        edges: []
      }, context);

      expect(mockApp.vault.create).toHaveBeenCalledWith(
        'Canvas/test.canvas',
        expect.stringContaining('"nodes"')
      );
      expect(result).toContain('Created canvas');
    });

    it('should return error when path is missing', async () => {
      const result = await canvasTool.execute({
        action: 'create',
        nodes: []
      }, context);

      expect(result).toContain('Error');
      expect(result).toContain('path is required');
    });

    it('should generate node IDs if not provided', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'create',
        path: 'Canvas/test.canvas',
        nodes: [
          { type: 'text', text: 'No ID' }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);

      expect(canvasData.nodes[0].id).toBeDefined();
      expect(typeof canvasData.nodes[0].id).toBe('string');
    });

    it('should set default width and height', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'create',
        path: 'Canvas/test.canvas',
        nodes: [
          { type: 'text', text: 'Test' }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);

      expect(canvasData.nodes[0].width).toBe(250);
      expect(canvasData.nodes[0].height).toBe(60);
    });
  });

  describe('add_node action', () => {
    it('should add nodes to existing canvas', async () => {
      const existingData = {
        nodes: [{ id: 'node-1', type: 'text', text: 'Existing', x: 0, y: 0, width: 250, height: 60 }],
        edges: []
      };
      const mockFile = { path: 'Canvas/test.canvas', extension: 'canvas' };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.vault.read.mockResolvedValue(JSON.stringify(existingData));

      const result = await canvasTool.execute({
        action: 'add_node',
        path: 'Canvas/test.canvas',
        nodes: [
          { type: 'text', text: 'New Node' }
        ]
      }, context);

      expect(mockApp.vault.modify).toHaveBeenCalled();
      expect(result).toContain('Added 1 nodes');
    });

    it('should return error when canvas file not found', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await canvasTool.execute({
        action: 'add_node',
        path: 'Canvas/nonexistent.canvas',
        nodes: []
      }, context);

      expect(result).toContain('Error');
    });

    it('should auto-calculate position if not provided', async () => {
      const existingData = {
        nodes: [
          { id: 'node-1', type: 'text', text: 'Node 1', x: 0, y: 0, width: 250, height: 60 },
          { id: 'node-2', type: 'text', text: 'Node 2', x: 280, y: 0, width: 250, height: 60 }
        ],
        edges: []
      };
      const mockFile = { path: 'Canvas/test.canvas', extension: 'canvas' };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.vault.read.mockResolvedValue(JSON.stringify(existingData));

      await canvasTool.execute({
        action: 'add_node',
        path: 'Canvas/test.canvas',
        nodes: [
          { type: 'text', text: 'Auto positioned' }
        ]
      }, context);

      const modifyCall = mockApp.vault.modify.mock.calls[0];
      const canvasData = JSON.parse(modifyCall[1]);
      const newNode = canvasData.nodes[2];

      // Should be positioned after existing nodes (280 + 250 + 30 = 560)
      expect(newNode.x).toBe(560);
    });

    it('should return error when nodes array is empty', async () => {
      const result = await canvasTool.execute({
        action: 'add_node',
        path: 'Canvas/test.canvas',
        nodes: []
      }, context);

      expect(result).toContain('Error');
    });
  });

  describe('add_edge action', () => {
    it('should add edges to existing canvas', async () => {
      const existingData = {
        nodes: [
          { id: 'node-1', type: 'text', text: 'A', x: 0, y: 0, width: 250, height: 60 },
          { id: 'node-2', type: 'text', text: 'B', x: 280, y: 0, width: 250, height: 60 }
        ],
        edges: []
      };
      const mockFile = { path: 'Canvas/test.canvas', extension: 'canvas' };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.vault.read.mockResolvedValue(JSON.stringify(existingData));

      const result = await canvasTool.execute({
        action: 'add_edge',
        path: 'Canvas/test.canvas',
        edges: [
          { fromNode: 'node-1', toNode: 'node-2', label: 'connects' }
        ]
      }, context);

      expect(mockApp.vault.modify).toHaveBeenCalled();
      expect(result).toContain('Added 1 edges');
    });

    it('should generate edge IDs', async () => {
      const existingData = { nodes: [], edges: [] };
      const mockFile = { path: 'Canvas/test.canvas', extension: 'canvas' };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.vault.read.mockResolvedValue(JSON.stringify(existingData));

      await canvasTool.execute({
        action: 'add_edge',
        path: 'Canvas/test.canvas',
        edges: [
          { fromNode: 'a', toNode: 'b' }
        ]
      }, context);

      const modifyCall = mockApp.vault.modify.mock.calls[0];
      const canvasData = JSON.parse(modifyCall[1]);

      expect(canvasData.edges[0].id).toBeDefined();
    });

    it('should return error when edges array is empty', async () => {
      const result = await canvasTool.execute({
        action: 'add_edge',
        path: 'Canvas/test.canvas',
        edges: []
      }, context);

      expect(result).toContain('Error');
    });
  });

  describe('get action', () => {
    it('should return canvas content as JSON string', async () => {
      const canvasContent = JSON.stringify({
        nodes: [{ id: 'node-1', type: 'text', text: 'Test', x: 0, y: 0, width: 250, height: 60 }],
        edges: []
      });
      const mockFile = { path: 'Canvas/test.canvas', extension: 'canvas' };
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.vault.read.mockResolvedValue(canvasContent);

      const result = await canvasTool.execute({
        action: 'get',
        path: 'Canvas/test.canvas'
      }, context);

      expect(result).toContain('"nodes"');
    });

    it('should return error when file not found', async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await canvasTool.execute({
        action: 'get',
        path: 'Canvas/nonexistent.canvas'
      }, context);

      expect(result).toContain('Error');
    });
  });

  describe('list action', () => {
    it('should list all canvas files in vault', async () => {
      mockApp.vault.getFiles.mockReturnValue([
        { path: 'Canvas/graph1.canvas', extension: 'canvas' },
        { path: 'Canvas/graph2.canvas', extension: 'canvas' },
        { path: 'Notes/note.md', extension: 'md' }
      ]);

      const result = await canvasTool.execute({
        action: 'list'
      }, context);

      expect(result).toContain('Canvas/graph1.canvas');
      expect(result).toContain('Canvas/graph2.canvas');
      expect(result).not.toContain('note.md');
    });

    it('should return message when no canvas files found', async () => {
      mockApp.vault.getFiles.mockReturnValue([]);

      const result = await canvasTool.execute({
        action: 'list'
      }, context);

      expect(result).toContain('Canvas files');
      expect(result).toContain('none found');
    });
  });

  describe('error handling', () => {
    it('should return error for unknown action', async () => {
      const result = await canvasTool.execute({
        action: 'unknown_action'
      }, context);

      expect(result).toContain('Error');
      expect(result).toContain('Unknown action');
    });
  });

  describe('mindmap action', () => {
    it('should create mindmap with topic and branches', async () => {
      const mockFile = { path: 'Canvas/test-mindmap.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      const result = await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test-mindmap.canvas',
        topic: 'Test Topic',
        branches: [
          { label: 'Branch 1', children: ['Child 1', 'Child 2'] },
          { label: 'Branch 2', children: [] }
        ]
      }, context);

      expect(mockApp.vault.create).toHaveBeenCalledWith(
        'Canvas/test-mindmap.canvas',
        expect.stringContaining('"nodes"')
      );
      expect(result).toContain('Created mindmap');
      expect(result).toContain('Test Topic');
      expect(result).toContain('Branches: 2');
    });

    it('should return error when path is missing', async () => {
      const result = await canvasTool.execute({
        action: 'mindmap',
        topic: 'Test Topic',
        branches: []
      }, context);

      expect(result).toContain('Error');
      expect(result).toContain('path is required');
    });

    it('should return error when topic is missing', async () => {
      const result = await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        branches: []
      }, context);

      expect(result).toContain('Error');
      expect(result).toContain('topic is required');
    });

    it('should create center node with color 1', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [{ label: 'B1' }]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const centerNode = canvasData.nodes.find((n: any) => n.text === 'Center');

      expect(centerNode).toBeDefined();
      expect(centerNode.color).toBe('1');
    });

    it('should assign different colors to branches', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Branch 1' },
          { label: 'Branch 2' },
          { label: 'Branch 3' }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const branchNodes = canvasData.nodes.filter((n: any) =>
        n.type === 'text' && n.text.startsWith('Branch')
      );

      const colors = branchNodes.map((n: any) => n.color);
      expect(new Set(colors).size).toBeGreaterThan(1); // 至少有两种不同颜色
    });

    it('should create edges connecting nodes', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Branch 1', children: ['Child 1'] }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);

      // 1 中心 + 1 分支 + 1 子节点 = 3 个节点
      // 2 条边（中心-分支，分支-子节点）
      expect(canvasData.edges.length).toBe(2);
    });

    it('should create group nodes for branches', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Branch 1', children: ['Child 1'] },
          { label: 'Branch 2', children: [] }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const groupNodes = canvasData.nodes.filter((n: any) => n.type === 'group');

      expect(groupNodes.length).toBe(2); // 每个分支一个 group
    });

    it('should handle nested children', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          {
            label: 'Branch 1',
            children: [
              'Child 1',
              { label: 'Child 2', children: ['Grandchild'] }
            ]
          }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const textNodes = canvasData.nodes.filter((n: any) => n.type === 'text');

      // 1 中心 + 1 分支 + 2 子节点 + 1 孙节点 = 5
      expect(textNodes.length).toBe(5);
    });

    it('should set correct fromSide and toSide based on angle', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Right' },  // 角度 ~0，应该在右侧
          { label: 'Bottom' }, // 角度 ~π/2，应该在下方
          { label: 'Left' },   // 角度 ~π，应该在左侧
          { label: 'Top' }     // 角度 ~3π/2，应该在上方
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const edges = canvasData.edges;

      // 检查边的方向是否合理
      const fromSides = new Set(edges.map((e: any) => e.fromSide));
      const toSides = new Set(edges.map((e: any) => e.toSide));

      expect(fromSides.size).toBeGreaterThan(1); // 应该有多个不同方向
    });
  });
});
