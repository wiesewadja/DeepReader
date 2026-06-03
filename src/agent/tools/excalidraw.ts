/**
 * Excalidraw Tool - 轻量调度器
 *
 * 将 mindmap / knowledge_graph / draw 操作委托给 excalidraw-engine 引擎，
 * 本文件仅负责 action 路由和简单的 check / create 操作。
 *
 * 依赖: 用户需要安装 Obsidian Excalidraw 插件
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log } from '../../utils/logger.js';
import type { ExcalidrawAutomate } from '../../types/excalidraw.d.ts';
import { runEngine, adaptLegacyMindmap, adaptLegacyGraph } from './excalidraw-engine/index.js';

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
          enum: ['create', 'mindmap', 'knowledge_graph', 'draw', 'check'],
          description: 'Action to perform. create=创建空白文件, mindmap=生成思维导图, knowledge_graph=生成知识图谱, draw=自定义图形, check=检查插件状态'
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
          description: '思维导图分支（mindmap action 必需）。children 子节点可以是字符串数组，如 ["子项1", "子项2"]，或对象数组',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '分支标签' },
              children: {
                type: 'array',
                description: '子节点数组。可以是字符串（如"子项1"）或对象（如{"label":"子项1"}）',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    children: { type: 'array' }
                  }
                }
              }
            },
            required: ['label']
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

/** 获取 ExcalidrawAutomate API */
function getAPI(): ExcalidrawAutomate | null {
  return window.ExcalidrawAutomate || null;
}

/** 检查 API 是否可用 */
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

/** 根据当前书籍名称生成输出文件夹 */
function getOutputFolder(context: ToolContext): string {
  const bookName = context.book.pdfName?.replace(/[<>:"/\\|?*]/g, '').trim();
  return bookName
    ? `DeepReader/Excalidraw/${bookName}`
    : 'DeepReader/Excalidraw';
}

/** 格式化引擎输出为用户可读字符串 */
function formatResult(result: import('./excalidraw-engine/types.js').EngineOutput, label: string): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }
  return `Created Excalidraw ${label}: ${result.filePath}\n` +
    `- Nodes: ${result.nodeCount}\n` +
    `- Edges: ${result.edgeCount}`;
}

/**
 * 创建 Excalidraw Tool
 */
export function createExcalidrawTool(): ToolExecutor {
  return {
    definition: EXCALIDRAW_DEFINITION,

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const { action } = args;

      log('[Excalidraw] 执行:', action);

      switch (action) {
        case 'check': {
          return checkAPI().message;
        }

        case 'create': {
          const status = checkAPI();
          if (!status.available) {
            return `Error: ${status.message}`;
          }

          const ea = getAPI()!;
          const filename = (args.filename as string) || 'untitled';
          const folder = (args.folder as string) || getOutputFolder(context);

          try {
            await ea.create({ filename, foldername: folder });
            return `Created empty Excalidraw file: ${folder}/${filename}.excalidraw.md`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            return `Error: ${errorMsg}`;
          }
        }

        case 'mindmap': {
          const topic = args.topic as string;
          const branches = args.branches as Array<{ label: string; children?: any[] }>;

          if (!topic) return 'Error: topic is required for mindmap action';
          if (!branches?.length) return 'Error: branches is required for mindmap action';

          const data = adaptLegacyMindmap({ topic, branches });
          const result = await runEngine({
            diagramType: 'mindmap',
            data,
            filename: (args.filename as string) || 'mindmap',
            folder: (args.folder as string) || getOutputFolder(context),
          });
          return formatResult(result, 'mindmap');
        }

        case 'knowledge_graph': {
          const nodes = args.nodes as Array<{ id: string; label: string; type?: string }>;
          const edges = args.edges as Array<{ from: string; to: string; label?: string }>;

          if (!nodes?.length) return 'Error: nodes is required for knowledge_graph action';

          const data = adaptLegacyGraph({ nodes, edges: edges || [] });
          const result = await runEngine({
            diagramType: 'knowledge_graph',
            data,
            filename: (args.filename as string) || 'knowledge-graph',
            folder: (args.folder as string) || getOutputFolder(context),
          });
          return formatResult(result, 'knowledge graph');
        }

        case 'draw': {
          if (!args.diagramType || !args.data) {
            return 'Error: diagramType and data are required for draw action';
          }
          const result = await runEngine({
            diagramType: args.diagramType as any,
            data: args.data as any,
            filename: args.filename as string | undefined,
            folder: (args.folder as string) || getOutputFolder(context),
            style: args.style as any,
          });
          return formatResult(result, args.diagramType as string);
        }

        default:
          return `Error: Unknown action: ${action}`;
      }
    }
  };
}
