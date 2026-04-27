// src/agent/tools/excalidraw-engine/types.ts

/** 思维导图语义结构 — LLM 输出 */
export interface MindmapSemantic {
  topic: string;
  summary?: string;
  branches: MindmapBranch[];
  style?: DiagramStyle;
}

export interface MindmapBranch {
  label: string;
  annotation?: string;
  importance?: 'high' | 'medium' | 'low';
  children: MindmapNode[];
}

export interface MindmapNode {
  label: string;
  annotation?: string;
  importance?: 'high' | 'medium' | 'low';
  link?: string;
  children?: MindmapNode[];
}

/** 知识图谱语义结构 — LLM 输出 */
export interface GraphSemantic {
  title: string;
  groups?: GraphGroup[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  style?: DiagramStyle;
}

export interface GraphGroup {
  id: string;
  label: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type?: NodeType;
  group?: string;
  importance?: NodeImportance;
  annotation?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  type?: EdgeType;
  direction?: EdgeDirection;
}

/** 枚举类型 */
export type DiagramType = 'mindmap' | 'knowledge_graph';
export type DiagramStyle = 'precise' | 'handdrawn' | 'sketch';
export type NodeType = 'concept' | 'person' | 'event' | 'book' | 'theme';
export type NodeImportance = 'core' | 'major' | 'minor';
export type EdgeType = 'hierarchy' | 'causal' | 'comparison' | 'temporal' | 'association';
export type EdgeDirection = 'directed' | 'undirected' | 'bidirectional';

/** 引擎内部类型 — 布局 + 样式合并后的渲染单元 */
export interface RenderNode {
  id: string;
  text: string;
  annotation?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'box' | 'ellipse' | 'diamond';
  strokeColor: string;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontFamily: number;
  roughness: number;
  link?: string;
}

export interface RenderEdge {
  fromId: string;
  fromSide: ConnectionSide;
  toId: string;
  toSide: ConnectionSide;
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  startArrow: 'none' | 'arrow' | 'dot' | 'bar';
  endArrow: 'none' | 'arrow' | 'dot' | 'bar';
  label?: string;
  numberOfPoints?: number;
  labelPos?: { x: number; y: number };
}

export interface RenderGroup {
  id: string;
  label: string;
  nodeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
}

export type ConnectionSide = 'top' | 'bottom' | 'left' | 'right';

/** 布局中间节点 — 尺寸已知、位置待计算 */
export interface LayoutNode {
  id: string;
  text: string;
  annotation?: string;
  level: 'topic' | 'branch' | 'child' | 'leaf';
  branchIndex: number;
  width: number;
  height: number;
  link?: string;
  children: LayoutNode[];
}

/** 子树边界框 — 用于角度分配和碰撞检测 */
export interface SubtreeBounds {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** 布局结果 */
export interface LayoutResult {
  nodes: RenderNode[];
  edges: RenderEdge[];
  groups: RenderGroup[];
}

/** 引擎输入 */
export interface EngineInput {
  diagramType: DiagramType;
  data: MindmapSemantic | GraphSemantic;
  filename?: string;
  folder?: string;
  style?: DiagramStyle;
}

/** 引擎输出 */
export interface EngineOutput {
  success: boolean;
  filePath?: string;
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
}
