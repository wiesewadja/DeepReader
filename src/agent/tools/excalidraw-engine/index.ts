// src/agent/tools/excalidraw-engine/index.ts
import type { EngineInput, EngineOutput, MindmapSemantic, GraphSemantic } from './types.js';
import { layoutMindmap } from './layout-mindmap.js';
import { layoutGraph } from './layout-graph.js';
import { render } from './renderer.js';
import { toolsLog as log } from '../../../utils/logger.js';

/** 旧接口适配：将旧 mindmap schema 转为 MindmapSemantic */
export function adaptLegacyMindmap(args: {
  topic: string;
  branches: Array<{ label: string; children?: Array<string | { label: string; children?: any[] }> }>;
}): MindmapSemantic {
  return {
    topic: args.topic,
    branches: args.branches.map(b => ({
      label: b.label,
      children: (b.children ?? []).map(c => {
        if (typeof c === 'string') return { label: c };
        return adaptLegacyNode(c);
      }),
    })),
  };
}

function adaptLegacyNode(node: { label: string; children?: any[] }): any {
  return {
    label: node.label,
    children: (node.children ?? []).map((c: any) => {
      if (typeof c === 'string') return { label: c };
      return adaptLegacyNode(c);
    }),
  };
}

/** 旧接口适配：将旧 knowledge_graph schema 转为 GraphSemantic */
export function adaptLegacyGraph(args: {
  nodes: Array<{ id: string; label: string; type?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}): GraphSemantic {
  return {
    title: 'Knowledge Graph',
    nodes: args.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: (n.type as any) ?? 'concept',
      importance: 'major' as const,
    })),
    edges: args.edges.map(e => ({
      from: e.from,
      to: e.to,
      label: e.label,
      type: 'association' as const,
      direction: 'directed' as const,
    })),
  };
}

function validateInput(input: EngineInput): void {
  const { diagramType, data } = input;
  if (diagramType !== 'mindmap' && diagramType !== 'knowledge_graph') {
    throw new Error(`不支持的图表类型: ${diagramType}`);
  }
  if (diagramType === 'mindmap') {
    const d = data as MindmapSemantic;
    if (!d.topic || typeof d.topic !== 'string') throw new Error('mindmap 需要 topic 字符串');
    if (!Array.isArray(d.branches)) throw new Error('mindmap 需要 branches 数组');
  } else {
    const d = data as GraphSemantic;
    if (!Array.isArray(d.nodes) || d.nodes.length === 0) throw new Error('knowledge_graph 需要 nodes 数组');
    for (const n of d.nodes) {
      if (!n.id || !n.label) throw new Error(`节点缺少 id 或 label: ${JSON.stringify(n)}`);
    }
    if (!Array.isArray(d.edges)) throw new Error('knowledge_graph 需要 edges 数组');
  }
}

/** 引擎主入口 */
export async function runEngine(input: EngineInput): Promise<EngineOutput> {
  try {
    validateInput(input);
    const { diagramType, data, filename, style } = input;

    const dataWithStyle = style ? { ...data, style } : data;

    const layout = diagramType === 'mindmap'
      ? layoutMindmap(dataWithStyle as MindmapSemantic)
      : layoutGraph(dataWithStyle as GraphSemantic);

    log('engine', `布局完成: ${layout.nodes.length} 节点, ${layout.edges.length} 边`);

    const name = filename || generateFilename(diagramType, data);
    const result = await render(layout, name, input.folder);

    return {
      success: true,
      filePath: result.filePath,
      nodeCount: result.nodeCount,
      edgeCount: result.edgeCount,
    };
  } catch (err: any) {
    log('engine', `引擎错误: ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

function generateFilename(diagramType: string, data: any): string {
  const title = diagramType === 'mindmap'
    ? (data as MindmapSemantic).topic
    : (data as GraphSemantic).title;
  const sanitized = title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  return sanitized || `${diagramType}_${Date.now()}`;
}
