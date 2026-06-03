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
  basename?: string;
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
  x: number;            // x 坐标
  y: number;            // y 坐标
  angle: number;        // 角度（弧度，用于边的方向）
  distance: number;     // 距离中心的距离（用于边的方向）
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
    description: '创建/修改 Obsidian Canvas 文件。用于构建可视化图表、思维导图、知识图谱。支持导出到 Excalidraw（需要安装 Excalidraw 插件）。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'add_node', 'add_edge', 'get', 'list', 'mindmap', 'export_to_excalidraw'],
          description: 'Action to perform. export_to_excalidraw 将 Canvas 转换为 Excalidraw 文件（需要安装 Excalidraw 插件）'
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
        },
        excalidraw_filename: {
          type: 'string',
          description: 'Output filename for export_to_excalidraw action (without extension). Default: same as canvas filename'
        },
        excalidraw_folder: {
          type: 'string',
          description: 'Output folder for export_to_excalidraw action. Default: DeepReader/Excalidraw'
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
 * 确保目录存在
 */
async function ensureFolderExists(app: any, folderPath: string): Promise<void> {
  const parts = folderPath.split('/');
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folder = app.vault.getAbstractFileByPath(currentPath);

    if (!folder) {
      await app.vault.createFolder(currentPath);
      log('[Canvas] 创建目录:', currentPath);
    }
  }
}

// ============ Mindmap 布局常量和函数 ============

const MINDMAP_COLORS = ['2', '3', '4', '5', '6']; // 分支颜色（1 保留给中心）
const MINDMAP_TOPIC_SIZE = { width: 300, height: 80 };
const MINDMAP_BRANCH_SIZE = { width: 250, height: 60 };
const MINDMAP_CHILD_SIZE = { width: 200, height: 50 };

// 层级半径（每层距离中心的距离）- 更松散的布局
const MINDMAP_LEVEL_RADII = [0, 500, 950, 1400]; // 中心、一级、二级、三级

// 角度间隙（弧度），用于防止节点重叠
const MINDMAP_ANGLE_GAP = 0.15; // 约 8.5 度

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
 * 计算子树需要的角度范围（递归计算）
 * 基于子节点数量和层级
 */
function calculateSubtreeAngle(children: MindmapChildNode[]): number {
  if (!children || children.length === 0) return 0;

  let totalAngle = 0;
  children.forEach((child) => {
    const grandChildren = typeof child === 'string' ? [] : (child.children || []);
    const childSubtreeAngle = calculateSubtreeAngle(grandChildren);
    // 每个节点至少占用一个最小角度
    const nodeAngle = Math.max(MINDMAP_ANGLE_GAP * 2, childSubtreeAngle);
    totalAngle += nodeAngle;
  });

  return totalAngle;
}

/**
 * 计算思维导图的放射状布局
 * 同层级节点在同一圆环上对齐
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
    x: 0,
    y: 0,
    angle: 0,
    distance: 0,
    color: '1'
  });

  // 计算每个分支需要的角度范围
  const branchAngles: number[] = branches.map((branch) => {
    const subtreeAngle = calculateSubtreeAngle(branch.children || []);
    // 每个分支至少占用一定角度
    return Math.max(Math.PI / 4, subtreeAngle); // 最小 45 度
  });

  // 计算总角度并归一化
  const totalAngle = branchAngles.reduce((sum, a) => sum + a, 0);
  const scale = (2 * Math.PI - MINDMAP_ANGLE_GAP * branches.length) / totalAngle;

  // 分配角度范围（从顶部开始，顺时针）
  let currentAngle = -Math.PI / 2; // 从顶部开始

  branches.forEach((branch, branchIndex) => {
    const branchId = generateId();
    const branchColor = MINDMAP_COLORS[branchIndex % MINDMAP_COLORS.length];

    // 分配给这个分支的角度范围
    const branchAngleRange = branchAngles[branchIndex] * scale;
    const branchCenterAngle = currentAngle + branchAngleRange / 2;

    // 一级分支节点（在第一层圆环上）
    const branchRadius = MINDMAP_LEVEL_RADII[1];
    nodes.push({
      id: branchId,
      text: branch.label,
      level: 1,
      branchIndex,
      x: branchRadius * Math.cos(branchCenterAngle),
      y: branchRadius * Math.sin(branchCenterAngle),
      angle: branchCenterAngle,
      distance: branchRadius,
      color: branchColor,
      parentId: topicId
    });

    // 递归处理子节点
    if (branch.children && branch.children.length > 0) {
      layoutRadialChildren(
        nodes,
        branch.children,
        branchId,
        currentAngle,
        branchAngleRange,
        2,
        branchIndex,
        branchColor
      );
    }

    currentAngle += branchAngleRange + MINDMAP_ANGLE_GAP;
  });

  return nodes;
}

/**
 * 递归布局子节点（放射状，同层对齐）
 */
function layoutRadialChildren(
  nodes: LayoutNode[],
  children: MindmapChildNode[],
  parentId: string,
  startAngle: number,
  angleRange: number,
  level: number,
  branchIndex: number,
  color: string
): void {
  if (level > 3) return; // 最多支持 3 层子节点

  const childCount = children.length;
  if (childCount === 0) return;

  // 计算每个子节点需要的角度
  const childAngles: number[] = children.map((child) => {
    const grandChildren = typeof child === 'string' ? [] : (child.children || []);
    return calculateSubtreeAngle(grandChildren);
  });

  const totalChildAngle = childAngles.reduce((sum, a) => sum + a, 0);
  const childScale = totalChildAngle > 0
    ? (angleRange - MINDMAP_ANGLE_GAP * (childCount - 1)) / totalChildAngle
    : 1;

  // 当前层级半径
  const levelRadius = MINDMAP_LEVEL_RADII[Math.min(level, 3)];
  let currentAngle = startAngle;

  children.forEach((child, index) => {
    const childId = generateId();
    const childText = typeof child === 'string' ? child : child.label;
    const grandChildren = typeof child === 'string' ? undefined : child.children;

    // 分配给这个子节点的角度范围
    const childAngleRange = Math.max(
      MINDMAP_ANGLE_GAP * 2,
      childAngles[index] * childScale
    );
    const childCenterAngle = currentAngle + childAngleRange / 2;

    // 子节点位置（在当前层级的圆环上）
    nodes.push({
      id: childId,
      text: childText,
      level,
      branchIndex,
      x: levelRadius * Math.cos(childCenterAngle),
      y: levelRadius * Math.sin(childCenterAngle),
      angle: childCenterAngle,
      distance: levelRadius,
      color,
      parentId
    });

    // 递归处理孙节点
    if (grandChildren && grandChildren.length > 0) {
      layoutRadialChildren(
        nodes,
        grandChildren,
        childId,
        currentAngle,
        childAngleRange,
        level + 1,
        branchIndex,
        color
      );
    }

    currentAngle += childAngleRange + MINDMAP_ANGLE_GAP;
  });
}

/**
 * 根据布局节点构建 Canvas 节点和边
 */
function buildMindmapCanvas(
  layoutNodes: LayoutNode[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const canvasNodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const branchGroups: Map<number, { minX: number; minY: number; maxX: number; maxY: number; label: string; color: string }> = new Map();

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

    // 使用预计算的 x, y 坐标（节点左上角）
    const x = Math.round(node.x - width / 2);
    const y = Math.round(node.y - height / 2);

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

    // 记录分支边界（用于 group）- 只记录非中心节点
    if (node.level >= 1 && node.branchIndex >= 0) {
      const bounds = branchGroups.get(node.branchIndex) || {
        minX: x,
        minY: y,
        maxX: x + width,
        maxY: y + height,
        label: node.level === 1 ? node.text : '',
        color: node.color
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

  // 创建分组（为每个分支创建一个 group）
  const groups: CanvasNode[] = [];
  branchGroups.forEach((bounds, branchIndex) => {
    const padding = 30;
    groups.push({
      id: `group-${branchIndex}`,
      type: 'group',
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      width: bounds.maxX - bounds.minX + padding * 2,
      height: bounds.maxY - bounds.minY + padding * 2,
      color: bounds.color,
      label: bounds.label
    });
  });

  // 组合所有节点（group 在底层，普通节点在上层）
  const allNodes = [...groups, ...canvasNodes];

  return { nodes: allNodes, edges };
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
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
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
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
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
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
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
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
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
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
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
            // 确保目录存在
            const folderPath = (path as string).substring(0, (path as string).lastIndexOf('/'));
            if (folderPath) {
              await ensureFolderExists(app, folderPath);
            }

            // 计算布局
            const layoutNodes = calculateMindmapLayout(topic, branches);

            // 构建 canvas 节点和边
            const { nodes: canvasNodes, edges: canvasEdges } = buildMindmapCanvas(layoutNodes);

            const canvasData: CanvasData = {
              nodes: canvasNodes,
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
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
            log('[Canvas] Mindmap 创建失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }

        case 'export_to_excalidraw': {
          if (!path) {
            return 'Error: path is required for export_to_excalidraw action (Canvas file to convert)';
          }

          // 检查 Excalidraw 插件是否可用
          const ea = window.ExcalidrawAutomate;
          if (!ea) {
            return 'Error: Excalidraw 插件未安装。请在社区插件市场安装 Excalidraw 插件后重试。';
          }

          try {
            // 读取 Canvas 文件
            const canvasFile = app.vault.getAbstractFileByPath(path as string);
            if (!canvasFile || !isTFile(canvasFile)) {
              return `Error: Canvas 文件不存在: ${path}`;
            }

            const content = await app.vault.read(canvasFile);
            const canvasData: CanvasData = JSON.parse(content);

            // 确定输出文件名和文件夹
            const outputFilename = (args.excalidraw_filename as string) || canvasFile.basename || 'converted';
            const outputFolder = (args.excalidraw_folder as string) || 'DeepReader/Excalidraw';

            // 动态导入 ExcalidrawService
            const { ExcalidrawService } = await import('../../services/excalidraw-service.js');
            const excalidrawService = new ExcalidrawService({
              app,
              defaultFolder: outputFolder,
            });

            // 转换
            const result = await excalidrawService.convertCanvasToExcalidraw(
              canvasData,
              outputFilename,
              outputFolder
            );

            if (result.success) {
              log('[Canvas] 导出 Excalidraw 成功:', result.filePath);
              return `Exported to Excalidraw: ${result.filePath}
- Nodes: ${result.nodeCount}
- Edges: ${result.edgeCount}`;
            } else {
              return `Error: ${result.error}`;
            }
          } catch (e) {
            const errorMsg = e instanceof Error ? (e instanceof Error ? e.message : String(e)) : String(e);
            log('[Canvas] 导出 Excalidraw 失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }

        default:
          return `Error: Unknown action: ${action}`;
      }
    }
  };
}
