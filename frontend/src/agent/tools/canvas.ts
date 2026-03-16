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

// Mindmap 类型定义
interface MindmapBranch {
  label: string;
  children?: MindmapChildNode[];
}

type MindmapChildNode = string | { label: string; children?: MindmapChildNode[] };

interface MindmapInput {
  action: 'mindmap';
  path: string;
  topic: string;
  branches: MindmapBranch[];
}

// 布局计算用的内部节点
interface LayoutNode {
  id: string;
  text: string;
  level: number;        // 0=中心, 1=一级分支, 2+=子节点
  branchIndex: number;  // 所属分支索引（-1 表示中心）
  angle: number;        // 角度（弧度）
  distance: number;     // 距离中心的距离
  color: string;
  parentId?: string;
}

// Mindmap 参数中的分支类型（用于递归处理）
interface MindmapChildObj {
  label: string;
  children?: MindmapChildNode[];
}

const CANVAS_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'canvas',
    description: '创建/修改 Obsidian Canvas 文件。用于构建可视化图表、思维导图、知识图谱。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'add_node', 'add_edge', 'get', 'list', 'mindmap'],
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
        },
        topic: {
          type: 'string',
          description: 'Central topic for mindmap (required for mindmap action)'
        },
        branches: {
          type: 'array',
          description: 'Branches for mindmap (required for mindmap action)',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Branch label' },
              children: {
                type: 'array',
                description: 'Child nodes (supports nested structure)',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    children: { type: 'array' }
                  }
                }
              }
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

// ============ Mindmap 布局常量和函数 ============

const MINDMAP_COLORS = ['2', '3', '4', '5', '6']; // 分支颜色（1 保留给中心）
const MINDMAP_TOPIC_SIZE = { width: 300, height: 80 };
const MINDMAP_BRANCH_SIZE = { width: 250, height: 60 };
const MINDMAP_CHILD_SIZE = { width: 200, height: 50 };
const MINDMAP_BRANCH_RADIUS = 350;  // 一级分支距离中心
const MINDMAP_CHILD_SPACING = 220;  // 子节点层间距

/**
 * 根据角度确定连接线的 fromSide/toSide
 */
function getSideFromAngle(angle: number): { fromSide: 'top' | 'right' | 'bottom' | 'left'; toSide: 'top' | 'right' | 'bottom' | 'left' } {
  // 标准化角度到 [0, 2π)
  const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // 判断方向（右、下、左、上）
  if (normalized >= Math.PI * 7 / 4 || normalized < Math.PI / 4) {
    return { fromSide: 'right', toSide: 'left' };
  } else if (normalized >= Math.PI / 4 && normalized < Math.PI * 3 / 4) {
    return { fromSide: 'bottom', toSide: 'top' };
  } else if (normalized >= Math.PI * 3 / 4 && normalized < Math.PI * 5 / 4) {
    return { fromSide: 'left', toSide: 'right' };
  } else {
    return { fromSide: 'top', toSide: 'bottom' };
  }
}

/**
 * 计算思维导图的布局
 * 返回所有节点的布局信息
 */
function calculateMindmapLayout(topic: string, branches: MindmapBranch[]): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const topicId = generateId();

  // 中心节点
  nodes.push({
    id: topicId,
    text: topic,
    level: 0,
    branchIndex: -1,
    angle: 0,
    distance: 0,
    color: '1' // 中心使用醒目颜色
  });

  // 计算每个分支的角度
  const branchCount = branches.length;
  const branchAngleStep = (2 * Math.PI) / branchCount;

  // 处理每个分支
  branches.forEach((branch, branchIndex) => {
    const branchAngle = branchIndex * branchAngleStep - Math.PI / 2; // 从顶部开始
    const branchId = generateId();
    const branchColor = MINDMAP_COLORS[branchIndex % MINDMAP_COLORS.length];

    // 一级分支节点
    nodes.push({
      id: branchId,
      text: branch.label,
      level: 1,
      branchIndex,
      angle: branchAngle,
      distance: MINDMAP_BRANCH_RADIUS,
      color: branchColor,
      parentId: topicId
    });

    // 递归处理子节点
    if (branch.children && branch.children.length > 0) {
      processChildren(
        nodes,
        branch.children,
        branchId,
        branchAngle,
        MINDMAP_BRANCH_RADIUS + MINDMAP_CHILD_SPACING,
        2,
        branchIndex,
        branchColor
      );
    }
  });

  return nodes;
}

/**
 * 递归处理子节点
 */
function processChildren(
  nodes: LayoutNode[],
  children: MindmapChildNode[],
  parentId: string,
  parentAngle: number,
  startDistance: number,
  level: number,
  branchIndex: number,
  color: string
): void {
  const childCount = children.length;
  // 子节点在父节点方向上分布，角度有小幅偏移
  const angleSpread = Math.PI / 6; // 子节点角度展开范围
  const angleStep = childCount > 1 ? angleSpread / (childCount - 1) : 0;
  const startAngle = parentAngle - angleSpread / 2;

  children.forEach((child, index) => {
    const childAngle = childCount > 1 ? startAngle + index * angleStep : parentAngle;
    const childId = generateId();

    // 解析子节点
    const childText = typeof child === 'string' ? child : child.label;
    const grandChildren = typeof child === 'string' ? undefined : child.children;

    // 添加子节点
    nodes.push({
      id: childId,
      text: childText,
      level,
      branchIndex,
      angle: childAngle,
      distance: startDistance,
      color,
      parentId
    });

    // 递归处理孙节点
    if (grandChildren && grandChildren.length > 0) {
      processChildren(
        nodes,
        grandChildren,
        childId,
        childAngle,
        startDistance + MINDMAP_CHILD_SPACING,
        level + 1,
        branchIndex,
        color
      );
    }
  });
}

/**
 * 根据布局节点构建 Canvas 节点和边
 */
function buildMindmapCanvas(
  layoutNodes: LayoutNode[]
): { nodes: CanvasNode[]; edges: CanvasEdge[]; groups: CanvasNode[] } {
  const canvasNodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const groups: CanvasNode[] = [];
  const branchGroups: Map<number, { minX: number; minY: number; maxX: number; maxY: number }> = new Map();

  // 创建节点
  layoutNodes.forEach((node) => {
    // 根据层级确定尺寸
    let width: number, height: number;
    if (node.level === 0) {
      width = MINDMAP_TOPIC_SIZE.width;
      height = MINDMAP_TOPIC_SIZE.height;
    } else if (node.level === 1) {
      width = MINDMAP_BRANCH_SIZE.width;
      height = MINDMAP_BRANCH_SIZE.height;
    } else {
      width = MINDMAP_CHILD_SIZE.width;
      height = MINDMAP_CHILD_SIZE.height;
    }

    // 计算位置（节点中心在 distance 处）
    const x = Math.round(node.distance * Math.cos(node.angle) - width / 2);
    const y = Math.round(node.distance * Math.sin(node.angle) - height / 2);

    canvasNodes.push({
      id: node.id,
      type: 'text',
      text: node.text,
      x,
      y,
      width,
      height,
      color: node.color
    });

    // 记录分支边界（用于 group）
    if (node.level >= 1 && node.branchIndex >= 0) {
      const bounds = branchGroups.get(node.branchIndex) || {
        minX: x,
        minY: y,
        maxX: x + width,
        maxY: y + height
      };
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x + width);
      bounds.maxY = Math.max(bounds.maxY, y + height);
      branchGroups.set(node.branchIndex, bounds);
    }

    // 创建边（连接到父节点）
    if (node.parentId) {
      const sideInfo = getSideFromAngle(node.angle);
      edges.push({
        id: generateId(),
        fromNode: node.parentId,
        toNode: node.id,
        fromSide: sideInfo.fromSide,
        toSide: sideInfo.toSide,
        color: node.color
      });
    }
  });

  // 创建分组
  branchGroups.forEach((bounds, branchIndex) => {
    const padding = 20;
    groups.push({
      id: `group-${branchIndex}`,
      type: 'group',
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      width: bounds.maxX - bounds.minX + padding * 2,
      height: bounds.maxY - bounds.minY + padding * 2,
      color: MINDMAP_COLORS[branchIndex % MINDMAP_COLORS.length],
      label: layoutNodes.find(n => n.level === 1 && n.branchIndex === branchIndex)?.text || ''
    });
  });

  return { nodes: canvasNodes, edges, groups };
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

        case 'mindmap': {
          if (!path) {
            return 'Error: path is required for mindmap action';
          }
          const topic = args.topic as string;
          const branches = (args.branches as MindmapBranch[]) || [];

          if (!topic) {
            return 'Error: topic is required for mindmap action';
          }

          try {
            // 计算布局
            const layoutNodes = calculateMindmapLayout(topic, branches);

            // 构建 canvas 节点和边
            const { nodes: canvasNodes, edges: canvasEdges, groups } = buildMindmapCanvas(layoutNodes);

            // 组合所有节点（group 在底层，普通节点在上层）
            const allNodes = [...groups, ...canvasNodes];

            const canvasData: CanvasData = {
              nodes: allNodes,
              edges: canvasEdges
            };

            const file = await app.vault.create(path, JSON.stringify(canvasData, null, 2));
            log('[Canvas] Mindmap 创建成功:', file.path);

            // 统计信息
            const branchCount = branches.length;
            const totalNodes = canvasNodes.length;
            const totalEdges = canvasEdges.length;

            return `Created mindmap: ${file.path}
- Topic: ${topic}
- Branches: ${branchCount}
- Total nodes: ${totalNodes}
- Total edges: ${totalEdges}`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            log('[Canvas] Mindmap 创建失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }

        default:
          return `Error: Unknown action: ${action}`;
      }
    }
  };
}
