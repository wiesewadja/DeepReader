/**
 * Excalidraw Tool - 直接创建和操作 Excalidraw 图形
 *
 * 功能与 Canvas Tool 一致，但使用 ExcalidrawAutomate API
 * 生成可编辑的 Excalidraw 图形文件
 *
 * 依赖: 用户需要安装 Obsidian Excalidraw 插件
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log } from '../../utils/logger.js';
import type {
  ExcalidrawAutomate,
  ConnectionPoint,
  BoxType,
  ExcalidrawStyleObject,
} from '../../types/excalidraw.d.ts';

// Mindmap 类型定义
interface MindmapBranch {
  label: string;
  children?: MindmapChildNode[];
}

type MindmapChildNode = string | { label: string; children?: MindmapChildNode[] };

// 知识图谱类型
interface KnowledgeNode {
  id: string;
  label: string;
  type?: 'concept' | 'entity' | 'topic';
}

interface KnowledgeEdge {
  from: string;
  to: string;
  label?: string;
}

// ============ 美观的配色方案 ============
// 参考 Excalidraw 默认调色板，选择协调的颜色
const BRANCH_COLORS = [
  { stroke: '#1971c2', fill: '#a5d8ff' },   // 蓝色系
  { stroke: '#2f9e44', fill: '#b2f2bb' },   // 绿色系
  { stroke: '#e8590c', fill: '#ffc078' },   // 橙色系
  { stroke: '#9c36b5', fill: '#eebefa' },   // 紫色系
  { stroke: '#c92a2a', fill: '#ffc9c9' },   // 红色系
  { stroke: '#087f5b', fill: '#96f2d7' },   // 青色系
  { stroke: '#5c940d', fill: '#d8f5a2' },   // 黄绿色系
];

// 中心主题样式
const TOPIC_STYLE = {
  stroke: '#1a1a2e',
  fill: '#ffe066',
};

// 节点尺寸配置（统一大小，更美观）
const NODE_SIZES = {
  topic: { width: 280, height: 80 },
  branch: { width: 180, height: 50 },
  child: { width: 140, height: 40 },
  leaf: { width: 120, height: 35 },
};

// 布局半径配置
const LAYOUT_RADII = {
  branch: 350,   // 一级分支到中心距离
  child: 180,    // 二级子节点到分支距离
  leaf: 150,     // 三级叶节点到子节点距离
};

const EXCALIDRAW_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'excalidraw',
    description: '创建 Excalidraw 可视化图形（思维导图、知识图谱等）。需要安装 Excalidraw 插件。生成的图形可以在 Excalidraw 中编辑。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'mindmap', 'knowledge_graph', 'add_node', 'add_edge', 'check'],
          description: 'Action to perform. create=创建空白文件, mindmap=生成思维导图, knowledge_graph=生成知识图谱, add_node=添加节点, add_edge=添加连接, check=检查插件状态'
        },
        filename: {
          type: 'string',
          description: 'Excalidraw 文件名（不含扩展名）'
        },
        folder: {
          type: 'string',
          description: '输出文件夹路径（默认: DeepReader/Excalidraw）'
        },
        // Mindmap 参数
        topic: {
          type: 'string',
          description: '思维导图中心主题（mindmap action 必需）'
        },
        branches: {
          type: 'array',
          description: '思维导图分支（mindmap action 必需）',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '分支标签' },
              children: {
                type: 'array',
                description: '子节点',
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
        // Knowledge graph 参数
        nodes: {
          type: 'array',
          description: '知识图谱节点（knowledge_graph action 必需）',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '节点唯一标识' },
              label: { type: 'string', description: '节点标签' },
              type: { type: 'string', enum: ['concept', 'entity', 'topic'], description: '节点类型' }
            }
          }
        },
        edges: {
          type: 'array',
          description: '知识图谱边（knowledge_graph action 必需）',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: '起始节点 ID' },
              to: { type: 'string', description: '目标节点 ID' },
              label: { type: 'string', description: '边标签' }
            }
          }
        }
      },
      required: ['action']
    }
  }
};

/**
 * 获取 ExcalidrawAutomate API
 */
function getAPI(): ExcalidrawAutomate | null {
  return window.ExcalidrawAutomate || null;
}

/**
 * 检查 API 是否可用
 */
function checkAPI(): { available: boolean; message: string } {
  const ea = getAPI();
  if (!ea) {
    return {
      available: false,
      message: 'Excalidraw 插件未安装。请在社区插件市场安装 Excalidraw 插件后重试。'
    };
  }
  return {
    available: true,
    message: `Excalidraw 插件已就绪 (版本: ${ea.version || '未知'})`
  };
}

/**
 * 根据角度获取连接边
 */
function getSideFromAngle(angle: number): ConnectionPoint {
  const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (normalized >= Math.PI * 7 / 4 || normalized < Math.PI / 4) return 'right';
  if (normalized >= Math.PI / 4 && normalized < Math.PI * 3 / 4) return 'bottom';
  if (normalized >= Math.PI * 3 / 4 && normalized < Math.PI * 5 / 4) return 'left';
  return 'top';
}

/**
 * 获取对边
 */
function getOppositeSide(side: ConnectionPoint): ConnectionPoint {
  const map: Record<ConnectionPoint, ConnectionPoint> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  return map[side];
}

/**
 * 根据节点类型获取形状
 */
function getBoxTypeForNodeType(type?: string): BoxType {
  switch (type) {
    case 'topic':
      return 'ellipse';
    case 'entity':
      return 'diamond';
    case 'concept':
    default:
      return 'box';
  }
}

/**
 * 创建思维导图（放射状布局，美观样式）
 */
async function createMindmap(
  ea: ExcalidrawAutomate,
  topic: string,
  branches: MindmapBranch[],
  filename: string,
  folder: string
): Promise<string> {
  // 创建新文件
  await ea.create({
    filename,
    foldername: folder,
  });
  ea.clear();

  // 设置全局样式（手绘风格，适度的粗糙感）
  const style = (ea as any).style;
  if (style) {
    style.roughness = 1;  // 0=精确, 1=架构图风格, 2=手绘
    style.strokeStyle = 'solid';
    style.strokeWidth = 2;
  }

  // 中心节点 - 使用醒目的颜色
  const centerX = 500;
  const centerY = 400;

  // 设置中心主题样式
  if (style) {
    style.strokeColor = TOPIC_STYLE.stroke;
    style.backgroundColor = TOPIC_STYLE.fill;
  }

  const centerId = ea.addText(
    centerX - NODE_SIZES.topic.width / 2,
    centerY - NODE_SIZES.topic.height / 2,
    topic,
    {
      width: NODE_SIZES.topic.width,
      height: NODE_SIZES.topic.height,
      textAlign: 'center',
      verticalAlign: 'middle',
      box: 'ellipse',
      boxPadding: 15,
    }
  );

  // 布局分支（放射状）
  const branchCount = branches.length;
  const radius = 350;  // 分支到中心的距离
  let nodeCount = 1;
  let edgeCount = 0;

  branches.forEach((branch, index) => {
    const angle = (2 * Math.PI * index) / branchCount - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);

    // 为每个分支选择协调的颜色
    const colorScheme = BRANCH_COLORS[index % BRANCH_COLORS.length];

    // 设置分支样式
    if (style) {
      style.strokeColor = colorScheme.stroke;
      style.backgroundColor = colorScheme.fill;
    }

    // 创建分支节点
    const branchId = ea.addText(
      x - NODE_SIZES.branch.width / 2,
      y - NODE_SIZES.branch.height / 2,
      branch.label,
      {
        width: NODE_SIZES.branch.width,
        height: NODE_SIZES.branch.height,
        textAlign: 'center',
        verticalAlign: 'middle',
        box: 'box',
        boxPadding: 10,
      }
    );
    nodeCount++;

    // 连接到中心（使用匹配的颜色）
    const fromSide = getSideFromAngle(angle);
    const toSide = getOppositeSide(fromSide);
    ea.connectObjects(centerId, fromSide, branchId, toSide, {
      numberOfPoints: 0,
      startArrowHead: 'none',
      endArrowHead: 'arrow',
      padding: 5,
    });
    edgeCount++;

    // 处理子节点 - 基于方向的树状布局
    // 子节点沿垂直于分支方向的直线排列，避免拥挤
    if (branch.children && branch.children.length > 0) {
      const childCount = branch.children.length;

      // 确定布局方向：基于分支相对于中心的位置
      // 上方/下方分支 -> 子节点水平排列
      // 左侧/右侧分支 -> 子节点垂直排列
      const isVerticalLayout = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)); // 左右分支用垂直布局

      // 子节点之间的间距（中心点距离 = 节点尺寸 + 间隙）
      // 确保间距足够大，避免节点重叠
      const gap = 30;  // 节点之间的空隙
      const childSpacing = isVerticalLayout
        ? NODE_SIZES.child.height + gap   // 垂直布局：基于高度
        : NODE_SIZES.child.width + gap;   // 水平布局：基于宽度

      // 子节点到分支的距离
      const childDistance = 180;

      branch.children.forEach((child, childIndex) => {
        const childText = typeof child === 'string' ? child : child.label;

        let childX: number, childY: number;
        let connectFromSide: ConnectionPoint, connectToSide: ConnectionPoint;

        if (isVerticalLayout) {
          // 垂直布局：子节点在分支的右侧或左侧，沿Y轴排列
          const offsetY = (childIndex - (childCount - 1) / 2) * childSpacing;
          if (Math.cos(angle) > 0) {
            // 分支在右侧，子节点在更右边
            childX = x + NODE_SIZES.branch.width / 2 + childDistance;
            childY = y + NODE_SIZES.branch.height / 2 + offsetY;
            connectFromSide = 'right';
            connectToSide = 'left';
          } else {
            // 分支在左侧，子节点在更左边
            childX = x - childDistance - NODE_SIZES.child.width;
            childY = y + NODE_SIZES.branch.height / 2 + offsetY;
            connectFromSide = 'left';
            connectToSide = 'right';
          }
        } else {
          // 水平布局：子节点在分支的上方或下方，沿X轴排列
          const offsetX = (childIndex - (childCount - 1) / 2) * childSpacing;
          if (Math.sin(angle) < 0) {
            // 分支在上方，子节点在更上面
            childX = x + NODE_SIZES.branch.width / 2 + offsetX - NODE_SIZES.child.width / 2;
            childY = y - childDistance - NODE_SIZES.child.height;
            connectFromSide = 'top';
            connectToSide = 'bottom';
          } else {
            // 分支在下方，子节点在更下面
            childX = x + NODE_SIZES.branch.width / 2 + offsetX - NODE_SIZES.child.width / 2;
            childY = y + NODE_SIZES.branch.height + childDistance;
            connectFromSide = 'bottom';
            connectToSide = 'top';
          }
        }

        // 子节点使用更浅的颜色
        if (style) {
          style.strokeColor = colorScheme.stroke;
          style.backgroundColor = colorScheme.fill + 'cc';  // 添加透明度
        }

        const childId = ea.addText(
          childX,
          childY,
          childText,
          {
            width: NODE_SIZES.child.width,
            height: NODE_SIZES.child.height,
            textAlign: 'center',
            verticalAlign: 'middle',
            box: 'box',
            boxPadding: 8,
          }
        );
        nodeCount++;

        // 连接子节点到分支
        ea.connectObjects(branchId, connectFromSide, childId, connectToSide, {
          numberOfPoints: 0,
          startArrowHead: 'none',
          endArrowHead: 'arrow',
        });
        edgeCount++;
      });
    }
  });

  // 显式保存以确保内容写入文件
  if (typeof ea.save === 'function') {
    try {
      await ea.save();
      log('[Excalidraw] 保存成功');
    } catch (e) {
      log('[Excalidraw] 保存失败:', e);
    }
  }

  const filePath = `${folder}/${filename}.excalidraw.md`;
  return `Created Excalidraw mindmap: ${filePath}
- Topic: ${topic}
- Branches: ${branchCount}
- Total nodes: ${nodeCount}
- Total edges: ${edgeCount}`;
}

/**
 * 创建知识图谱（网格布局）
 */
async function createKnowledgeGraph(
  ea: ExcalidrawAutomate,
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  filename: string,
  folder: string
): Promise<string> {
  // 创建新文件
  await ea.create({
    filename,
    foldername: folder,
  });
  ea.clear();

  // 计算网格布局
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const spacing = 250;
  const startX = 100;
  const startY = 100;

  const idMap = new Map<string, string>();

  // 创建节点
  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * spacing;
    const y = startY + row * spacing;

    const boxType = getBoxTypeForNodeType(node.type);
    const excalId = ea.addText(x, y, node.label, {
      width: 150,
      height: 50,
      textAlign: 'center',
      box: boxType,
    });
    idMap.set(node.id, excalId);
  });

  // 创建边
  let edgeCount = 0;
  edges.forEach((edge) => {
    const fromId = idMap.get(edge.from);
    const toId = idMap.get(edge.to);

    if (fromId && toId) {
      ea.connectObjects(fromId, 'right', toId, 'left', {
        numberOfPoints: 0,
        endArrowHead: 'arrow',
      });
      edgeCount++;
    }
  });

  // 显式保存以确保内容写入文件
  if (typeof ea.save === 'function') {
    try {
      await ea.save();
      log('[Excalidraw] 知识图谱保存成功');
    } catch (e) {
      log('[Excalidraw] 知识图谱保存失败:', e);
    }
  }

  const filePath = `${folder}/${filename}.excalidraw.md`;
  return `Created Excalidraw knowledge graph: ${filePath}
- Nodes: ${nodes.length}
- Edges: ${edgeCount}`;
}

/**
 * 创建 Excalidraw Tool
 */
export function createExcalidrawTool(): ToolExecutor {
  return {
    definition: EXCALIDRAW_DEFINITION,

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
      const { action } = args;

      log('[Excalidraw] 执行:', action);

      switch (action) {
        case 'check': {
          const status = checkAPI();
          return status.message;
        }

        case 'create': {
          const status = checkAPI();
          if (!status.available) {
            return `Error: ${status.message}`;
          }

          const ea = getAPI()!;
          const filename = (args.filename as string) || 'untitled';
          const folder = (args.folder as string) || 'DeepReader/Excalidraw';

          try {
            await ea.create({
              filename,
              foldername: folder,
            });

            return `Created empty Excalidraw file: ${folder}/${filename}.excalidraw.md`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            return `Error: ${errorMsg}`;
          }
        }

        case 'mindmap': {
          const status = checkAPI();
          if (!status.available) {
            return `Error: ${status.message}`;
          }

          const topic = args.topic as string;
          const branches = (args.branches as MindmapBranch[]) || [];
          const filename = (args.filename as string) || 'mindmap';
          const folder = (args.folder as string) || 'DeepReader/Excalidraw';

          // 调试日志：显示实际收到的参数
          log('[Excalidraw] mindmap 参数:', JSON.stringify({ topic, branches, filename, folder }, null, 2));

          if (!topic) {
            return 'Error: topic is required for mindmap action';
          }

          if (branches.length === 0) {
            return 'Error: branches is required for mindmap action';
          }

          try {
            const ea = getAPI()!;
            return await createMindmap(ea, topic, branches, filename, folder);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            log('[Excalidraw] Mindmap 创建失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }

        case 'knowledge_graph': {
          const status = checkAPI();
          if (!status.available) {
            return `Error: ${status.message}`;
          }

          const nodes = (args.nodes as KnowledgeNode[]) || [];
          const edges = (args.edges as KnowledgeEdge[]) || [];
          const filename = (args.filename as string) || 'knowledge-graph';
          const folder = (args.folder as string) || 'DeepReader/Excalidraw';

          if (nodes.length === 0) {
            return 'Error: nodes is required for knowledge_graph action';
          }

          try {
            const ea = getAPI()!;
            return await createKnowledgeGraph(ea, nodes, edges, filename, folder);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            log('[Excalidraw] Knowledge graph 创建失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }

        case 'add_node':
        case 'add_edge': {
          return 'Error: add_node and add_edge actions require an active Excalidraw file. Please use mindmap or knowledge_graph action to create a new file first.';
        }

        default:
          return `Error: Unknown action: ${action}`;
      }
    }
  };
}
