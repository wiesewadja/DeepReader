// src/agent/tools/excalidraw-engine/styles.ts
import type {
  GraphSemantic, GraphNode, GraphEdge,
  RenderNode, RenderEdge,
  DiagramStyle, NodeType, NodeImportance, EdgeType, EdgeDirection,
  ConnectionSide,
} from './types.js';

// --- 文本测量工具 ---

const MEASURE_CTX = typeof document !== 'undefined'
  ? document.createElement('canvas').getContext('2d')
  : null;

function fontFamilyName(f: number): string {
  switch (f) {
    case 1: return 'Virgil, Segoe UI Emoji';
    case 2: return 'monospace';
    case 3: return 'Helvetica, Arial, sans-serif';
    case 4: return 'Cascadia, monospace';
    default: return 'sans-serif';
  }
}

function isCJK(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 0x4E00 && code <= 0x9FFF) ||
         (code >= 0x3400 && code <= 0x4DBF) ||
         (code >= 0x3040 && code <= 0x309F) ||
         (code >= 0x30A0 && code <= 0x30FF) ||
         (code >= 0xAC00 && code <= 0xD7AF);
}

export function measureTextWidth(text: string, fontSize: number, fontFamily: number): number {
  if (MEASURE_CTX) {
    MEASURE_CTX.font = `${fontSize}px ${fontFamilyName(fontFamily)}`;
    return MEASURE_CTX.measureText(text).width;
  }
  let width = 0;
  for (const ch of text) {
    width += isCJK(ch) ? fontSize : fontSize * 0.6;
  }
  return width;
}

// --- 尺寸约束（替代固定尺寸） ---

const MINDMAP_SIZE_CONSTRAINTS: Record<string, {
  minWidth: number; maxWidth: number;
  minHeight: number; maxHeight: number;
  paddingH: number; paddingV: number;
}> = {
  topic:  { minWidth: 160, maxWidth: 400, minHeight: 60,  maxHeight: 120, paddingH: 40, paddingV: 20 },
  branch: { minWidth: 120, maxWidth: 320, minHeight: 44,  maxHeight: 80,  paddingH: 28, paddingV: 16 },
  child:  { minWidth: 100, maxWidth: 260, minHeight: 36,  maxHeight: 64,  paddingH: 20, paddingV: 12 },
  leaf:   { minWidth: 80,  maxWidth: 220, minHeight: 32,  maxHeight: 56,  paddingH: 16, paddingV: 10 },
};

const MINDMAP_FONTS: Record<string, { fontSize: number; fontWeight: 'normal' | 'bold' }> = {
  topic:  { fontSize: 20, fontWeight: 'bold' },
  branch: { fontSize: 16, fontWeight: 'normal' },
  child:  { fontSize: 14, fontWeight: 'normal' },
  leaf:   { fontSize: 13, fontWeight: 'normal' },
};

const DEFAULT_FONT_FAMILY = 3;

/** 根据实际文本计算节点尺寸 */
export function computeNodeSize(
  text: string,
  level: 'topic' | 'branch' | 'child' | 'leaf',
  fontFamily: number = DEFAULT_FONT_FAMILY,
): { width: number; height: number } {
  const c = MINDMAP_SIZE_CONSTRAINTS[level];
  const fontSize = MINDMAP_FONTS[level].fontSize;
  const textW = measureTextWidth(text, fontSize, fontFamily);
  const width = Math.max(c.minWidth, Math.min(c.maxWidth, textW + c.paddingH * 2));
  const lines = Math.ceil(textW / Math.max(1, width - c.paddingH * 2)) || 1;
  const lineHeight = fontSize * 1.4;
  const height = Math.max(c.minHeight, Math.min(c.maxHeight, lines * lineHeight + c.paddingV * 2));
  return { width, height };
}

// --- 色彩常量（层次化填充色） ---

const BRANCH_PALETTES = [
  { stroke: '#1971c2', fills: { branch: '#a5d8ff', child: '#d0ebff', leaf: '#e7f5ff' } },
  { stroke: '#2f9e44', fills: { branch: '#b2f2bb', child: '#d3f9d8', leaf: '#ebfbee' } },
  { stroke: '#e8590c', fills: { branch: '#ffc078', child: '#ffe8cc', leaf: '#fff4e6' } },
  { stroke: '#9c36b5', fills: { branch: '#eebefa', child: '#f3d9fa', leaf: '#f8f0fc' } },
  { stroke: '#c92a2a', fills: { branch: '#ffc9c9', child: '#ffe3e3', leaf: '#fff5f5' } },
  { stroke: '#087f5b', fills: { branch: '#96f2d7', child: '#c3fae8', leaf: '#e6fcf5' } },
  { stroke: '#5c940d', fills: { branch: '#d8f5a2', child: '#ebfbee', leaf: '#f4fce3' } },
];

const TOPIC_STYLE = { stroke: '#1a1a2e', fill: '#ffe066' };

const GROUP_COLORS = [
  { fill: '#dbe4ff', stroke: '#1971c2' },
  { fill: '#d3f9d8', stroke: '#2f9e44' },
  { fill: '#fff4e6', stroke: '#e8590c' },
  { fill: '#f3d9fa', stroke: '#9c36b5' },
  { fill: '#ffe3e3', stroke: '#c92a2a' },
  { fill: '#c3fae8', stroke: '#087f5b' },
  { fill: '#ebfbee', stroke: '#5c940d' },
];

// --- 知识图谱尺寸（保持不变） ---

const GRAPH_SIZES: Record<NodeImportance, { width: number; height: number }> = {
  core: { width: 200, height: 60 },
  major: { width: 160, height: 50 },
  minor: { width: 120, height: 40 },
};

const GRAPH_FONTS: Record<NodeImportance, { fontSize: number; fontWeight: 'normal' | 'bold' }> = {
  core:  { fontSize: 16, fontWeight: 'bold' },
  major: { fontSize: 14, fontWeight: 'normal' },
  minor: { fontSize: 13, fontWeight: 'normal' },
};

const NODE_TYPE_SHAPES: Record<NodeType, 'box' | 'ellipse' | 'diamond'> = {
  concept: 'box',
  person: 'ellipse',
  event: 'diamond',
  book: 'box',
  theme: 'box',
};

const STYLE_ROUGHNESS: Record<DiagramStyle, number> = {
  precise: 0,
  handdrawn: 1,
  sketch: 2,
};

// --- 公共接口 ---

/** 获取思维导图节点样式 */
export function getMindmapNodeStyle(
  level: 'topic' | 'branch' | 'child' | 'leaf',
  branchIndex: number,
  style?: DiagramStyle,
  size?: { width: number; height: number },
): Pick<RenderNode, 'width' | 'height' | 'fontSize' | 'fontWeight' | 'fontFamily' | 'shape' | 'strokeColor' | 'fillColor' | 'fillOpacity' | 'strokeWidth' | 'roughness'> {
  const roughness = STYLE_ROUGHNESS[style ?? 'handdrawn'];
  const constraints = MINDMAP_SIZE_CONSTRAINTS[level];
  const w = size?.width ?? constraints.minWidth;
  const h = size?.height ?? constraints.minHeight;
  const font = MINDMAP_FONTS[level];

  if (level === 'topic') {
    return {
      width: w, height: h,
      ...font,
      fontFamily: DEFAULT_FONT_FAMILY,
      shape: 'ellipse',
      strokeColor: TOPIC_STYLE.stroke,
      fillColor: TOPIC_STYLE.fill,
      fillOpacity: 1,
      strokeWidth: 3.5,
      roughness,
    };
  }

  const palette = BRANCH_PALETTES[branchIndex % BRANCH_PALETTES.length];
  const fillKey = level === 'branch' ? 'branch' : level === 'child' ? 'child' : 'leaf';

  return {
    width: w, height: h,
    ...font,
    fontFamily: DEFAULT_FONT_FAMILY,
    shape: 'box',
    strokeColor: palette.stroke,
    fillColor: palette.fills[fillKey],
    fillOpacity: 1,
    strokeWidth: level === 'branch' ? 2.5 : 1.5,
    roughness,
  };
}

/** 获取思维导图连线样式 */
export function getMindmapEdgeStyle(
  level: 'topic-branch' | 'branch-child' | 'child-leaf',
  branchIndex: number,
): Pick<RenderEdge, 'strokeColor' | 'strokeWidth' | 'strokeStyle' | 'startArrow' | 'endArrow'> {
  const palette = BRANCH_PALETTES[branchIndex % BRANCH_PALETTES.length];
  const widthMap = { 'topic-branch': 3, 'branch-child': 2, 'child-leaf': 1.5 };
  return {
    strokeColor: palette.stroke,
    strokeWidth: widthMap[level],
    strokeStyle: 'solid',
    startArrow: 'none',
    endArrow: 'arrow',
  };
}

/** 获取知识图谱节点样式 */
export function getGraphNodeStyle(
  node: GraphNode,
  groupIndex: number,
  style?: DiagramStyle,
): Pick<RenderNode, 'width' | 'height' | 'fontSize' | 'fontWeight' | 'fontFamily' | 'shape' | 'strokeColor' | 'fillColor' | 'fillOpacity' | 'strokeWidth' | 'roughness'> {
  const importance = node.importance ?? 'major';
  const size = GRAPH_SIZES[importance];
  const font = GRAPH_FONTS[importance];
  const shape = NODE_TYPE_SHAPES[node.type ?? 'concept'];
  const palette = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
  const roughness = STYLE_ROUGHNESS[style ?? 'handdrawn'];

  return {
    ...size,
    ...font,
    fontFamily: DEFAULT_FONT_FAMILY,
    shape,
    strokeColor: palette.stroke,
    fillColor: palette.fill,
    fillOpacity: 1,
    strokeWidth: importance === 'core' ? 2.5 : importance === 'major' ? 2 : 1.5,
    roughness,
  };
}

/** 获取知识图谱连线样式 */
export function getGraphEdgeStyle(edge: GraphEdge): Pick<RenderEdge, 'strokeColor' | 'strokeWidth' | 'strokeStyle' | 'startArrow' | 'endArrow' | 'numberOfPoints'> {
  const type = edge.type ?? 'association';
  const dir = edge.direction ?? 'directed';

  const base = {
    strokeColor: '#868e96',
    numberOfPoints: 0,
  };

  switch (type) {
    case 'causal':
      return { ...base, strokeWidth: 2.5, strokeStyle: 'solid', startArrow: 'none', endArrow: 'arrow' };
    case 'comparison':
      return { ...base, strokeWidth: 1.5, strokeStyle: 'dashed', startArrow: dir === 'bidirectional' ? 'arrow' : 'none', endArrow: 'arrow' };
    case 'temporal':
      return { ...base, strokeWidth: 1.5, strokeStyle: 'dotted', startArrow: 'none', endArrow: 'arrow' };
    case 'hierarchy':
      return { ...base, strokeWidth: 2, strokeStyle: 'solid', startArrow: 'none', endArrow: 'arrow' };
    case 'association':
    default:
      return { ...base, strokeWidth: 1, strokeStyle: 'solid', startArrow: 'none', endArrow: dir === 'undirected' ? 'none' : 'arrow' };
  }
}

/** 获取分组容器样式 */
export function getGroupStyle(groupIndex: number): { fillColor: string; strokeColor: string } {
  const palette = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
  return { fillColor: palette.fill, strokeColor: palette.stroke };
}

/** 根据两个节点坐标确定最优连接方向 */
export function getOptimalConnectionSide(fromX: number, fromY: number, toX: number, toY: number): { fromSide: ConnectionSide; toSide: ConnectionSide } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { fromSide: 'right', toSide: 'left' }
      : { fromSide: 'left', toSide: 'right' };
  } else {
    return dy > 0
      ? { fromSide: 'bottom', toSide: 'top' }
      : { fromSide: 'top', toSide: 'bottom' };
  }
}

/** annotation 字号和颜色 */
export const ANNOTATION_STYLE = { fontSize: 11, color: '#868e96' };

/** edge label 字号和背景色 */
export const EDGE_LABEL_STYLE = { fontSize: 11, bgColor: '#ffffff', padding: 4 };
