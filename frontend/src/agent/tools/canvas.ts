/**
 * Canvas Tool - 创建和操作 Obsidian Canvas 文件
 *
 * 支持的操作：
 * - create: 创建新的 Canvas 文件
 * - add_node: 向现有 Canvas 添加节点
 * - add_edge: 向现有 Canvas 添加边
 * - get: 读取 Canvas 内容
 * - list: 列出所有 Canvas 文件
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log } from '../../utils/logger.js';

// TFile 类型定义（避免直接导入 obsidian）
interface TFileLike {
  path: string;
  extension: string;
}

// 检查是否是 TFile
function isTFile(file: any): file is TFileLike {
  return file && typeof file.path === 'string' && typeof file.extension === 'string';
}

// Canvas 数据类型定义
interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
  label?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  color?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const CANVAS_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'canvas',
    description: 'Create or modify Obsidian Canvas files. Use this to create visual diagrams, mind maps, or knowledge graphs.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'add_node', 'add_edge', 'get', 'list'],
          description: 'Action to perform'
        },
        path: {
          type: 'string',
          description: 'Canvas file path (e.g., "Canvas/mind-map.canvas")'
        },
        nodes: {
          type: 'array',
          description: 'Nodes to add (for create/add_node)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['text', 'file', 'link', 'group'] },
              text: { type: 'string', description: 'Text content (for text nodes)' },
              file: { type: 'string', description: 'File path (for file nodes)' },
              url: { type: 'string', description: 'URL (for link nodes)' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number', default: 250 },
              height: { type: 'number', default: 60 },
              color: { type: 'string', description: 'Node color (1-6)' }
            }
          }
        },
        edges: {
          type: 'array',
          description: 'Edges to add (for create/add_edge)',
          items: {
            type: 'object',
            properties: {
              fromNode: { type: 'string', description: 'Source node ID' },
              toNode: { type: 'string', description: 'Target node ID' },
              fromSide: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
              toSide: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
              label: { type: 'string', description: 'Edge label' },
              color: { type: 'string' }
            }
          }
        }
      },
      required: ['action']
    }
  }
};

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * 创建 Canvas Tool
 */
export function createCanvasTool(app: any): ToolExecutor {
  return {
    definition: CANVAS_DEFINITION,

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
      const { action, path, nodes, edges } = args;

      log('[Canvas] 执行:', action);

      switch (action) {
        case 'create': {
          if (!path) {
            return 'Error: path is required for create action';
          }

          try {
            // 处理节点：添加 ID 和默认值
            const processedNodes: CanvasNode[] = ((nodes as any[]) || []).map((node, index) => ({
              id: node.id || generateId(),
              type: node.type || 'text',
              x: node.x ?? 0,
              y: node.y ?? 0,
              width: node.width ?? 250,
              height: node.height ?? 60,
              ...(node.text && { text: node.text }),
              ...(node.file && { file: node.file }),
              ...(node.url && { url: node.url }),
              ...(node.color && { color: node.color }),
              ...(node.label && { label: node.label })
            }));

            // 处理边：添加 ID
            const processedEdges: CanvasEdge[] = ((edges as any[]) || []).map((edge) => ({
              id: edge.id || generateId(),
              fromNode: edge.fromNode,
              toNode: edge.toNode,
              ...(edge.fromSide && { fromSide: edge.fromSide }),
              ...(edge.toSide && { toSide: edge.toSide }),
              ...(edge.label && { label: edge.label }),
              ...(edge.color && { color: edge.color })
            }));

            const canvasData: CanvasData = {
              nodes: processedNodes,
              edges: processedEdges
            };

            const file = await app.vault.create(path, JSON.stringify(canvasData, null, 2));
            log('[Canvas] 创建成功:', file.path);
            return `Created canvas: ${file.path}`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            log('[Canvas] 创建失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }

        case 'add_node': {
          if (!path) {
            return 'Error: path is required for add_node action';
          }
          if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
            return 'Error: nodes array is required for add_node action';
          }

          const file = app.vault.getAbstractFileByPath(path);
          if (!file || !isTFile(file)) {
            return `Error: Canvas file not found: ${path}`;
          }

          try {
            const content = await app.vault.read(file);
            const canvasData: CanvasData = JSON.parse(content);

            // 计算新节点的起始位置（在现有节点之后）
            const maxX = Math.max(0, ...canvasData.nodes.map(n => n.x + n.width));
            const defaultX = canvasData.nodes.length > 0 ? maxX + 30 : 0;

            // 添加新节点
            const newNodes: CanvasNode[] = nodes.map((node: any, index: number) => ({
              id: node.id || generateId(),
              type: node.type || 'text',
              x: node.x ?? defaultX,
              y: node.y ?? (index * 100),
              width: node.width ?? 250,
              height: node.height ?? 60,
              ...(node.text && { text: node.text }),
              ...(node.file && { file: node.file }),
              ...(node.url && { url: node.url }),
              ...(node.color && { color: node.color }),
              ...(node.label && { label: node.label })
            }));

            canvasData.nodes.push(...newNodes);
            await app.vault.modify(file, JSON.stringify(canvasData, null, 2));

            log('[Canvas] 添加节点:', newNodes.length);
            return `Added ${newNodes.length} nodes to ${path}`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            return `Error: ${errorMsg}`;
          }
        }

        case 'add_edge': {
          if (!path) {
            return 'Error: path is required for add_edge action';
          }
          if (!edges || !Array.isArray(edges) || edges.length === 0) {
            return 'Error: edges array is required for add_edge action';
          }

          const file = app.vault.getAbstractFileByPath(path);
          if (!file || !isTFile(file)) {
            return `Error: Canvas file not found: ${path}`;
          }

          try {
            const content = await app.vault.read(file);
            const canvasData: CanvasData = JSON.parse(content);

            // 添加新边
            const newEdges: CanvasEdge[] = edges.map((edge: any) => ({
              id: edge.id || generateId(),
              fromNode: edge.fromNode,
              toNode: edge.toNode,
              ...(edge.fromSide && { fromSide: edge.fromSide }),
              ...(edge.toSide && { toSide: edge.toSide }),
              ...(edge.label && { label: edge.label }),
              ...(edge.color && { color: edge.color })
            }));

            canvasData.edges.push(...newEdges);
            await app.vault.modify(file, JSON.stringify(canvasData, null, 2));

            log('[Canvas] 添加边:', newEdges.length);
            return `Added ${newEdges.length} edges to ${path}`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            return `Error: ${errorMsg}`;
          }
        }

        case 'get': {
          if (!path) {
            return 'Error: path is required for get action';
          }

          const file = app.vault.getAbstractFileByPath(path);
          if (!file || !isTFile(file)) {
            return `Error: Canvas file not found: ${path}`;
          }

          try {
            const content = await app.vault.read(file);
            return content;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            return `Error: ${errorMsg}`;
          }
        }

        case 'list': {
          try {
            const files = app.vault.getFiles();
            const canvasFiles = files
              .filter((f: any) => isTFile(f) && f.extension === 'canvas')
              .map((f: any) => f.path);

            if (canvasFiles.length === 0) {
              return 'Canvas files:\n(none found)';
            }

            return `Canvas files:\n${canvasFiles.map((p: string) => `- ${p}`).join('\n')}`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            return `Error: ${errorMsg}`;
          }
        }

        default:
          return `Error: Unknown action: ${action}`;
      }
    }
  };
}
