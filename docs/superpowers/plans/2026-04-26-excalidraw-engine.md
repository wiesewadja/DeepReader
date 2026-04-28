# Excalidraw 专业图示引擎 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Excalidraw 工具从简单的画图工具升级为专业图示引擎，支持思维导图和知识图谱两种精品图形，具备专业级视觉品质和多场景触发能力。

**Architecture:** 引擎采用三层分离：语义接口（LLM 输出）→ 布局算法（坐标计算）→ 渲染器（ExcalidrawAutomate API）。工具层精简为分发器。按钮触发走 subagent 机制。

**Tech Stack:** TypeScript, ExcalidrawAutomate API (Obsidian Excalidraw Plugin), Zod, LangChain Tools, SubagentManager

**Spec:** `docs/superpowers/specs/2026-04-26-excalidraw-engine-design.md`

## 三期迭代计划

| 迭代 | 范围 | Chunk | 交付物 |
|------|------|-------|--------|
| **P1: 引擎核心** | 类型 + 样式 + 布局算法 + 渲染器 + 工具分发器 + Zod schema | Chunk 1-3 (Task 1-8) | 新引擎可工作，自然语言/Skill 触发的绘图走新引擎，专业视觉品质 |
| **P2: UI 入口** | 消息按钮 + SidebarView 回调 + subagent 绘图流程 | Chunk 4 (Task 9-10) | AI 消息上的"生成图形"按钮可用，subagent 可补充搜索后绘图 |
| **P3: Skill + 路由 + 测试** | skill 改造 + 路由扩展 + 单元测试 + 集成验证 | Chunk 5-6 (Task 11-14) | 完整多场景覆盖，测试通过，可手动验证 |

---

## Chunk 1: 引擎基础（类型 + 样式 + 渲染器）

### Task 1: 引擎类型定义

**Files:**
- Create: `src/agent/tools/excalidraw-engine/types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
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
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npx tsc --noEmit src/agent/tools/excalidraw-engine/types.ts 2>&1 | head -20`
Expected: 无错误或仅 import 路径相关警告

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/types.ts
git commit -m "feat(engine): add excalidraw engine type definitions"
```

---

### Task 2: 专业样式系统

**Files:**
- Create: `src/agent/tools/excalidraw-engine/styles.ts`
- Reference: `src/agent/tools/excalidraw-engine/types.ts`

- [ ] **Step 1: 创建样式系统**

```typescript
// src/agent/tools/excalidraw-engine/styles.ts
import type {
  MindmapSemantic, MindmapBranch, MindmapNode,
  GraphSemantic, GraphNode, GraphEdge, GraphGroup,
  RenderNode, RenderEdge, RenderGroup,
  DiagramStyle, NodeType, NodeImportance, EdgeType, EdgeDirection,
  ConnectionSide,
} from './types.js';

// --- 色彩常量 ---

const BRANCH_PALETTES = [
  { stroke: '#1971c2', fill: '#a5d8ff' }, // 蓝色
  { stroke: '#2f9e44', fill: '#b2f2bb' }, // 绿色
  { stroke: '#e8590c', fill: '#ffc078' }, // 橙色
  { stroke: '#9c36b5', fill: '#eebefa' }, // 紫色
  { stroke: '#c92a2a', fill: '#ffc9c9' }, // 红色
  { stroke: '#087f5b', fill: '#96f2d7' }, // 青色
  { stroke: '#5c940d', fill: '#d8f5a2' }, // 黄绿
];

const TOPIC_STYLE = { stroke: '#1a1a2e', fill: '#ffe066' };

const GROUP_COLORS = [
  { fill: '#dbe4ff', stroke: '#1971c2' }, // 蓝色系
  { fill: '#d3f9d8', stroke: '#2f9e44' }, // 绿色系
  { fill: '#fff4e6', stroke: '#e8590c' }, // 橙色系
  { fill: '#f3d9fa', stroke: '#9c36b5' }, // 紫色系
  { fill: '#ffe3e3', stroke: '#c92a2a' }, // 红色系
  { fill: '#c3fae8', stroke: '#087f5b' }, // 青色系
  { fill: '#ebfbee', stroke: '#5c940d' }, // 黄绿系
];

// --- 尺寸映射 ---

const MINDMAP_SIZES = {
  topic:     { width: 280, height: 80 },
  branch:    { width: 200, height: 55 },
  child:     { width: 160, height: 45 },
  leaf:      { width: 130, height: 38 },
} as const;

const MINDMAP_FONTS = {
  topic:  { size: 20, weight: 'bold' as const },
  branch: { size: 16, weight: 'normal' as const },
  child:  { size: 14, weight: 'normal' as const },
  leaf:   { size: 13, weight: 'normal' as const },
};

const GRAPH_SIZES: Record<NodeImportance, { width: number; height: number }> = {
  core: { width: 200, height: 60 },
  major: { width: 160, height: 50 },
  minor: { width: 120, height: 40 },
};

const GRAPH_FONTS: Record<NodeImportance, { size: number; weight: 'normal' | 'bold' }> = {
  core:  { size: 16, weight: 'bold' },
  major: { size: 14, weight: 'normal' },
  minor: { size: 13, weight: 'normal' },
};

// --- 形状映射 ---

const NODE_TYPE_SHAPES: Record<NodeType, 'box' | 'ellipse' | 'diamond'> = {
  concept: 'box',
  person: 'ellipse',
  event: 'diamond',
  book: 'box',
  theme: 'box',
};

// --- 透明度层级 ---

function fillWithOpacity(hex: string, opacity: number): string {
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return hex + alpha;
}

// --- Roughness 映射 ---

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
): Pick<RenderNode, 'width' | 'height' | 'fontSize' | 'fontWeight' | 'shape' | 'strokeColor' | 'fillColor' | 'fillOpacity' | 'strokeWidth' | 'roughness'> {
  const roughness = STYLE_ROUGHNESS[style ?? 'handdrawn'];
  const size = MINDMAP_SIZES[level];
  const font = MINDMAP_FONTS[level];

  if (level === 'topic') {
    return {
      ...size,
      ...font,
      shape: 'ellipse',
      strokeColor: TOPIC_STYLE.stroke,
      fillColor: TOPIC_STYLE.fill,
      fillOpacity: 1,
      strokeWidth: 2.5,
      roughness,
    };
  }

  const palette = BRANCH_PALETTES[branchIndex % BRANCH_PALETTES.length];
  const opacity = level === 'branch' ? 1 : level === 'child' ? 0.75 : 0.5;

  return {
    ...size,
    ...font,
    shape: 'box',
    strokeColor: palette.stroke,
    fillColor: palette.fill,
    fillOpacity: opacity,
    strokeWidth: level === 'branch' ? 2 : 1.5,
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
): Pick<RenderNode, 'width' | 'height' | 'fontSize' | 'fontWeight' | 'shape' | 'strokeColor' | 'fillColor' | 'fillOpacity' | 'strokeWidth' | 'roughness'> {
  const importance = node.importance ?? 'major';
  const size = GRAPH_SIZES[importance];
  const font = GRAPH_FONTS[importance];
  const shape = NODE_TYPE_SHAPES[node.type ?? 'concept'];
  const palette = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
  const roughness = STYLE_ROUGHNESS[style ?? 'handdrawn'];

  return {
    ...size,
    ...font,
    shape,
    strokeColor: palette.stroke,
    fillColor: palette.fill,
    fillOpacity: importance === 'core' ? 1 : importance === 'major' ? 0.8 : 0.6,
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
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npx tsc --noEmit src/agent/tools/excalidraw-engine/styles.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/styles.ts
git commit -m "feat(engine): add professional style system"
```

---

### Task 3: 渲染器

**Files:**
- Create: `src/agent/tools/excalidraw-engine/renderer.ts`
- Reference: `src/types/excalidraw.d.ts` (ExcalidrawAutomate API)

- [ ] **Step 1: 创建渲染器**

```typescript
// src/agent/tools/excalidraw-engine/renderer.ts
import type { ExcalidrawAutomate } from '../../../types/excalidraw.js';
import type { LayoutResult, RenderNode, RenderEdge, RenderGroup } from './types.js';
import { ANNOTATION_STYLE, EDGE_LABEL_STYLE } from './styles.js';
import { toolsLog as log } from '../../../utils/logger.js';

const DEFAULT_FOLDER = 'DeepReader/Excalidraw';

function getAPI(): ExcalidrawAutomate | null {
  return window.ExcalidrawAutomate ?? null;
}

function checkAPI(): ExcalidrawAutomate {
  const ea = getAPI();
  if (!ea) throw new Error('Excalidraw 插件未安装或未启用');
  return ea;
}

/** 设置 ea.style 为指定节点的样式 */
function applyNodeStyle(ea: ExcalidrawAutomate, node: RenderNode): void {
  (ea as any).style.strokeColor = node.strokeColor;
  (ea as any).style.backgroundColor = node.fillColor;
  (ea as any).style.fillStyle = 'solid'; // hachure would be 'hachure'
  (ea as any).style.strokeWidth = node.strokeWidth;
  (ea as any).style.strokeStyle = 'solid';
  (ea as any).style.roughness = node.roughness;
  (ea as any).style.fontFamily = 1; // 1 = normal (non-handwritten)
  (ea as any).style.fontSize = node.fontSize;
}

/** 根据形状类型创建节点，返回元素 ID */
function addNode(ea: ExcalidrawAutomate, node: RenderNode): string {
  const { x, y, width, height, text, shape, fontWeight, annotation, link } = node;
  const boxPadding = shape === 'ellipse' ? 15 : 10;

  applyNodeStyle(ea, node);

  let nodeId: string;
  if (shape === 'ellipse') {
    nodeId = ea.addText(
      x - width / 2, y - height / 2, text,
      {
        wrapAt: width,
        width,
        height,
        textAlign: 'center',
        verticalAlign: 'middle',
        box: 'ellipse',
        boxPadding,
      },
    );
  } else if (shape === 'diamond') {
    // 先画菱形背景，再叠加文字
    const diamondId = ea.addDiamond(x - width / 2, y - height / 2, width, height);
    nodeId = ea.addText(x - width / 2, y - height / 2, text, {
      wrapAt: width - 10,
      width: width - 10,
      height,
      textAlign: 'center',
      verticalAlign: 'middle',
    });
    // 将文字放在菱形上层（通过 addToGroup 关联）
    ea.addToGroup([diamondId, nodeId]);
  } else {
    nodeId = ea.addText(
      x - width / 2, y - height / 2, text,
      {
        wrapAt: width,
        width,
        height,
        textAlign: 'center',
        verticalAlign: 'middle',
        box: 'box',
        boxPadding,
      },
    );
  }

  // annotation 渲染为节点下方的无框小字
  if (annotation) {
    const annY = y + height / 2 + 6;
    (ea as any).style.strokeColor = ANNOTATION_STYLE.color;
    (ea as any).style.backgroundColor = 'transparent';
    (ea as any).style.fontSize = ANNOTATION_STYLE.fontSize;
    (ea as any).style.fontFamily = 1;
    ea.addText(x - width / 2, annY, annotation, {
      wrapAt: width + 40,
      textAlign: 'center',
    });
  }

  return nodeId;
}

/** 渲染一条边 */
function addEdge(ea: ExcalidrawAutomate, edge: RenderEdge): void {
  const formatting: any = {
    startArrowHead: edge.startArrow,
    endArrowHead: edge.endArrow,
    numberOfPoints: edge.numberOfPoints ?? 0,
  };

  (ea as any).style.strokeColor = edge.strokeColor;
  (ea as any).style.strokeWidth = edge.strokeWidth;
  (ea as any).style.strokeStyle = edge.strokeStyle;

  ea.connectObjects(
    edge.fromId, edge.fromSide,
    edge.toId, edge.toSide,
    formatting,
  );

  // edge label 渲染
  if (edge.label) {
    addEdgeLabel(ea, edge);
  }
}

/** 渲染边标签（addRect 白底 + addText） */
function addEdgeLabel(ea: ExcalidrawAutomate, edge: RenderEdge): void {
  // label 定位需要知道 from/to 节点坐标，这里用简单估算
  // 精确计算由布局层在构建 RenderEdge 时预设 labelX/labelY
  // fallback: 使用边的起点和终点中点
  // 注意：此方法在 connectObjects 之后调用，标签坐标由布局层计算好存在 edge 上
  const labelPos = (edge as any)._labelPos as { x: number; y: number } | undefined;
  if (!labelPos) return;

  const textLen = edge.label!.length;
  const bgWidth = textLen * EDGE_LABEL_STYLE.fontSize * 0.6 + EDGE_LABEL_STYLE.padding * 2;
  const bgHeight = EDGE_LABEL_STYLE.fontSize + EDGE_LABEL_STYLE.padding * 2;

  // 白色背景矩形
  (ea as any).style.strokeColor = 'transparent';
  (ea as any).style.backgroundColor = EDGE_LABEL_STYLE.bgColor;
  (ea as any).style.fillStyle = 'solid';
  (ea as any).style.strokeWidth = 0;
  ea.addRect(
    labelPos.x - bgWidth / 2,
    labelPos.y - bgHeight / 2,
    bgWidth,
    bgHeight,
  );

  // 标签文字
  (ea as any).style.strokeColor = '#495057';
  (ea as any).style.backgroundColor = 'transparent';
  (ea as any).style.fontSize = EDGE_LABEL_STYLE.fontSize;
  ea.addText(
    labelPos.x - bgWidth / 2 + EDGE_LABEL_STYLE.padding,
    labelPos.y - bgHeight / 2 + EDGE_LABEL_STYLE.padding,
    edge.label!,
  );
}

/** 渲染分组容器 */
function addGroup(ea: ExcalidrawAutomate, group: RenderGroup): void {
  // 背景矩形
  (ea as any).style.strokeColor = group.strokeColor;
  (ea as any).style.backgroundColor = group.fillColor;
  (ea as any).style.fillStyle = 'solid';
  (ea as any).style.strokeWidth = 1;
  (ea as any).style.strokeStyle = 'dashed';
  (ea as any).style.roughness = 0;
  const rectId = ea.addRect(group.x, group.y, group.width, group.height);

  // 标题文字
  (ea as any).style.strokeColor = group.strokeColor;
  (ea as any).style.backgroundColor = 'transparent';
  (ea as any).style.fontSize = 14;
  (ea as any).style.fontFamily = 1;
  const titleId = ea.addText(group.x + 10, group.y + 8, group.label);

  // 将背景和标题组成一组
  ea.addToGroup([rectId, titleId]);
}

/** 主渲染函数 */
export async function render(layout: LayoutResult, filename: string, folder?: string): Promise<{ filePath: string; nodeCount: number; edgeCount: number }> {
  const ea = checkAPI();
  ea.clear();

  log('renderer', `开始渲染: ${layout.nodes.length} 节点, ${layout.edges.length} 边, ${layout.groups.length} 分组`);

  // 1. 先渲染分组（背景层）
  for (const group of layout.groups) {
    addGroup(ea, group);
  }

  // 2. 渲染节点（收集 ID 用于连线）
  const nodeIdMap = new Map<string, string>();
  for (const node of layout.nodes) {
    const elementId = addNode(ea, node);
    nodeIdMap.set(node.id, elementId);
  }

  // 3. 渲染边（用节点元素 ID 连接）
  for (const edge of layout.edges) {
    const fromElId = nodeIdMap.get(edge.fromId);
    const toElId = nodeIdMap.get(edge.toId);
    if (!fromElId || !toElId) {
      log('renderer', `跳过边: ${edge.fromId} → ${edge.toId}（节点不存在）`);
      continue;
    }
    // 替换 ID 为实际元素 ID
    const resolvedEdge: RenderEdge = { ...edge, fromId: fromElId, toId: toElId };
    addEdge(ea, resolvedEdge);
  }

  // 4. 保存文件
  const targetFolder = folder || DEFAULT_FOLDER;
  await ea.create({ filename, foldername: targetFolder, silent: true });

  log('renderer', `渲染完成: ${filename}.excalidraw.md`);

  return {
    filePath: `${targetFolder}/${filename}.excalidraw.md`,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
  };
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npx tsc --noEmit src/agent/tools/excalidraw-engine/renderer.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/renderer.ts
git commit -m "feat(engine): add excalidraw renderer"
```

---

## Chunk 2: 布局算法 + 引擎入口

### Task 4: 思维导图布局算法

**Files:**
- Create: `src/agent/tools/excalidraw-engine/layout-mindmap.ts`

- [ ] **Step 1: 创建思维导图布局算法**

```typescript
// src/agent/tools/excalidraw-engine/layout-mindmap.ts
import type {
  MindmapSemantic, MindmapBranch, MindmapNode,
  RenderNode, RenderEdge, LayoutResult, ConnectionSide,
} from './types.js';
import { getMindmapNodeStyle, getMindmapEdgeStyle, getOptimalConnectionSide } from './styles.js';

const CENTER_X = 500;
const CENTER_Y = 400;
const BRANCH_RADIUS = 350;
const CHILD_DISTANCE = 220;
const LEAF_DISTANCE = 160;
const ANGLE_GAP = 0.15; // 最小角度间隙
const CHILD_GAP = 50; // 同级节点间距
const LEAF_GAP = 40;

/** 计算子树的总角度需求 */
function subtreeAngle(node: MindmapNode | MindmapBranch): number {
  const children = node.children ?? [];
  if (children.length === 0) return ANGLE_GAP * 2;
  let total = 0;
  for (const child of children) {
    total += subtreeAngle(child);
  }
  return Math.max(total, ANGLE_GAP * 2);
}

/** 递归布局子节点 */
function layoutChildren(
  parentId: string,
  parentX: number,
  parentY: number,
  children: MindmapNode[],
  startAngle: number,
  angleRange: number,
  level: 'child' | 'leaf',
  branchIndex: number,
  branchAngle: number,
  nodes: RenderNode[],
  edges: RenderEdge[],
): void {
  if (children.length === 0) return;

  const isLeaf = level === 'leaf';
  const distance = isLeaf ? LEAF_DISTANCE : CHILD_DISTANCE;
  const gap = isLeaf ? LEAF_GAP : CHILD_GAP;

  // 判断方向：左/右分支 → 纵向展开；上/下分支 → 横向展开
  const isHorizontal = Math.abs(Math.cos(branchAngle)) > Math.abs(Math.sin(branchAngle));

  if (isHorizontal) {
    // 纵向展开
    const totalHeight = children.reduce((sum, _, i) => {
      const sz = getMindmapNodeStyle(level, branchIndex);
      return sum + sz.height + (i > 0 ? gap : 0);
    }, 0);
    let currentY = parentY - totalHeight / 2;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const style = getMindmapNodeStyle(level, branchIndex);
      const dx = Math.cos(branchAngle) > 0 ? distance : -distance;
      const childX = parentX + dx;
      const childY = currentY + style.height / 2;
      const childId = `${parentId}-${i}`;

      nodes.push({
        id: childId,
        text: child.label,
        annotation: child.annotation,
        x: childX,
        y: childY,
        ...style,
        link: child.link,
      });

      const { fromSide, toSide } = getOptimalConnectionSide(parentX, parentY, childX, childY);
      const edgeStyle = getMindmapEdgeStyle(
        isLeaf ? 'child-leaf' : 'branch-child',
        branchIndex,
      );
      edges.push({
        fromId: parentId,
        fromSide,
        toId: childId,
        toSide,
        ...edgeStyle,
      });

      currentY += style.height + gap;

      // 递归处理更深层级
      if (child.children && child.children.length > 0 && !isLeaf) {
        layoutChildren(
          childId, childX, childY,
          child.children,
          startAngle, angleRange,
          'leaf', branchIndex, branchAngle,
          nodes, edges,
        );
      }
    }
  } else {
    // 横向展开
    const totalWidth = children.reduce((sum, _, i) => {
      const sz = getMindmapNodeStyle(level, branchIndex);
      return sum + sz.width + (i > 0 ? gap : 0);
    }, 0);
    let currentX = parentX - totalWidth / 2;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const style = getMindmapNodeStyle(level, branchIndex);
      const dy = Math.sin(branchAngle) > 0 ? distance : -distance;
      const childX = currentX + style.width / 2;
      const childY = parentY + dy;
      const childId = `${parentId}-${i}`;

      nodes.push({
        id: childId,
        text: child.label,
        annotation: child.annotation,
        x: childX,
        y: childY,
        ...style,
        link: child.link,
      });

      const { fromSide, toSide } = getOptimalConnectionSide(parentX, parentY, childX, childY);
      const edgeStyle = getMindmapEdgeStyle(
        isLeaf ? 'child-leaf' : 'branch-child',
        branchIndex,
      );
      edges.push({
        fromId: parentId,
        fromSide,
        toId: childId,
        toSide,
        ...edgeStyle,
      });

      currentX += style.width + gap;

      if (child.children && child.children.length > 0 && !isLeaf) {
        layoutChildren(
          childId, childX, childY,
          child.children,
          startAngle, angleRange,
          'leaf', branchIndex, branchAngle,
          nodes, edges,
        );
      }
    }
  }
}

/** 碰撞检测后处理：检查节点重叠并外移 */
function resolveCollisions(nodes: RenderNode[]): void {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const overlapX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
        const overlapY = (a.height + b.height) / 2 - Math.abs(a.y - b.y);

        if (overlapX > 0 && overlapY > 0) {
          // 沿远离中心方向外移距离较小的节点
          const distA = Math.hypot(a.x - CENTER_X, a.y - CENTER_Y);
          const distB = Math.hypot(b.x - CENTER_X, b.y - CENTER_Y);
          const target = distA < distB ? a : b;
          const dx = target.x - CENTER_X;
          const dy = target.y - CENTER_Y;
          const len = Math.hypot(dx, dy) || 1;

          if (overlapX < overlapY) {
            target.x += (dx / len) * overlapX;
          } else {
            target.y += (dy / len) * overlapY;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/** 主布局函数 */
export function layoutMindmap(data: MindmapSemantic): LayoutResult {
  const nodes: RenderNode[] = [];
  const edges: RenderEdge[] = [];
  const style = data.style;

  // 1. 中心节点
  const topicStyle = getMindmapNodeStyle('topic', 0, style);
  nodes.push({
    id: 'topic',
    text: data.topic,
    annotation: data.summary,
    x: CENTER_X,
    y: CENTER_Y,
    ...topicStyle,
  });

  // 2. 计算分支角度
  const branches = data.branches;
  const totalWeight = branches.reduce((sum, b) => sum + subtreeAngle(b), 0);
  let currentAngle = -Math.PI / 2; // 从正上方开始

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const weight = subtreeAngle(branch);
    const minAngle = Math.PI / 4;
    const angle = Math.max((weight / totalWeight) * 2 * Math.PI, minAngle);
    const midAngle = currentAngle + angle / 2;

    // 分支节点
    const branchStyle = getMindmapNodeStyle('branch', i, style);
    const bx = CENTER_X + BRANCH_RADIUS * Math.cos(midAngle);
    const by = CENTER_Y + BRANCH_RADIUS * Math.sin(midAngle);
    const branchId = `branch-${i}`;

    nodes.push({
      id: branchId,
      text: branch.label,
      annotation: branch.annotation,
      x: bx,
      y: by,
      ...branchStyle,
    });

    // 中心→分支连线
    const { fromSide, toSide } = getOptimalConnectionSide(CENTER_X, CENTER_Y, bx, by);
    const edgeStyle = getMindmapEdgeStyle('topic-branch', i);
    edges.push({
      fromId: 'topic',
      fromSide,
      toId: branchId,
      toSide,
      ...edgeStyle,
    });

    // 子节点布局
    if (branch.children.length > 0) {
      layoutChildren(
        branchId, bx, by,
        branch.children,
        currentAngle, angle,
        'child', i, midAngle,
        nodes, edges,
      );
    }

    currentAngle += angle;
  }

  // 3. 碰撞检测
  resolveCollisions(nodes);

  return { nodes, edges, groups: [] };
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npx tsc --noEmit src/agent/tools/excalidraw-engine/layout-mindmap.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/layout-mindmap.ts
git commit -m "feat(engine): add mindmap layout with subtree angle budgeting"
```

---

### Task 5: 知识图谱布局算法

**Files:**
- Create: `src/agent/tools/excalidraw-engine/layout-graph.ts`

- [ ] **Step 1: 创建知识图谱布局算法**

```typescript
// src/agent/tools/excalidraw-engine/layout-graph.ts
import type {
  GraphSemantic, GraphNode, GraphEdge, GraphGroup,
  RenderNode, RenderEdge, RenderGroup, LayoutResult,
} from './types.js';
import { getGraphNodeStyle, getGraphEdgeStyle, getGroupStyle, getOptimalConnectionSide } from './styles.js';

const START_X = 200;
const START_Y = 200;
const GROUP_SPACING_X = 600;
const GROUP_SPACING_Y = 500;
const INNER_RADIUS_MAJOR = 200;
const INNER_RADIUS_MINOR = 400;
const NO_GROUP_RADIUS_CORE = 0;
const NO_GROUP_RADIUS_MAJOR = 300;
const NO_GROUP_RADIUS_MINOR = 550;
const GROUP_PADDING = 30;

/** 按 group 分组节点 */
function groupNodes(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = node.group ?? '__ungrouped__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(node);
  }
  return map;
}

/** 按 importance 排序：core → major → minor */
function sortByImportance(nodes: GraphNode[]): { core: GraphNode[]; major: GraphNode[]; minor: GraphNode[] } {
  const core: GraphNode[] = [];
  const major: GraphNode[] = [];
  const minor: GraphNode[] = [];
  for (const n of nodes) {
    const imp = n.importance ?? 'major';
    if (imp === 'core') core.push(n);
    else if (imp === 'major') major.push(n);
    else minor.push(n);
  }
  return { core, major, minor };
}

/** 计算一组节点的包络矩形 */
function boundingBox(positions: { x: number; y: number; width: number; height: number }[]): { x: number; y: number; width: number; height: number } {
  if (positions.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x - p.width / 2);
    minY = Math.min(minY, p.y - p.height / 2);
    maxX = Math.max(maxX, p.x + p.width / 2);
    maxY = Math.max(maxY, p.y + p.height / 2);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 在同心环上分布节点 */
function ringLayout(
  nodes: GraphNode[],
  centerX: number,
  centerY: number,
  radius: number,
  groupIndex: number,
  style?: string,
): { node: RenderNode; position: { x: number; y: number; width: number; height: number } }[] {
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    const s = getGraphNodeStyle(n, groupIndex, style as any);
    return {
      node: { id: n.id, text: n.label, annotation: n.annotation, x, y, ...s },
      position: { x, y, width: s.width, height: s.height },
    };
  });
}

/** 主布局函数 */
export function layoutGraph(data: GraphSemantic): LayoutResult {
  const renderNodes: RenderNode[] = [];
  const renderEdges: RenderEdge[] = [];
  const renderGroups: RenderGroup[] = [];
  const style = data.style;

  const groups = data.groups ?? [];
  const nodeGroups = groupNodes(data.nodes);

  // 建立 node id → RenderNode 映射（用于边连线）
  const nodePositions = new Map<string, { x: number; y: number }>();

  if (groups.length > 0) {
    // 有分组布局
    const cols = groups.length <= 3 ? groups.length : Math.ceil(groups.length / 2);
    const rows = groups.length <= 3 ? 1 : 2;

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const col = gi % cols;
      const row = Math.floor(gi / cols);
      const gcx = START_X + col * GROUP_SPACING_X;
      const gcy = START_Y + row * GROUP_SPACING_Y;

      const groupNodesList = nodeGroups.get(group.id) ?? [];
      const { core, major, minor } = sortByImportance(groupNodesList);
      const positions: { x: number; y: number; width: number; height: number }[] = [];

      // core 节点在中心
      for (const n of core) {
        const s = getGraphNodeStyle(n, gi, style);
        renderNodes.push({ id: n.id, text: n.label, annotation: n.annotation, x: gcx, y: gcy, ...s });
        positions.push({ x: gcx, y: gcy, width: s.width, height: s.height });
        nodePositions.set(n.id, { x: gcx, y: gcy });
      }

      // major 节点在第一环
      for (const { node, position } of ringLayout(major, gcx, gcy, INNER_RADIUS_MAJOR, gi, style)) {
        renderNodes.push(node);
        positions.push(position);
        nodePositions.set(node.id, { x: node.x, y: node.y });
      }

      // minor 节点在第二环
      for (const { node, position } of ringLayout(minor, gcx, gcy, INNER_RADIUS_MINOR, gi, style)) {
        renderNodes.push(node);
        positions.push(position);
        nodePositions.set(node.id, { x: node.x, y: node.y });
      }

      // 计算分组容器
      const box = boundingBox(positions);
      const gStyle = getGroupStyle(gi);
      renderGroups.push({
        id: `group-${group.id}`,
        label: group.label,
        nodeIds: groupNodesList.map(n => n.id),
        x: box.x - GROUP_PADDING,
        y: box.y - GROUP_PADDING - 25, // 标题空间
        width: box.width + GROUP_PADDING * 2,
        height: box.height + GROUP_PADDING * 2 + 25,
        fillColor: gStyle.fillColor,
        strokeColor: gStyle.strokeColor,
      });
    }

    // 处理未分组的节点
    const ungrouped = nodeGroups.get('__ungrouped__') ?? [];
    if (ungrouped.length > 0) {
      const offsetX = START_X + cols * GROUP_SPACING_X + 200;
      for (let i = 0; i < ungrouped.length; i++) {
        const n = ungrouped[i];
        const s = getGraphNodeStyle(n, 0, style);
        const x = offsetX;
        const y = START_Y + i * 100;
        renderNodes.push({ id: n.id, text: n.label, annotation: n.annotation, x, y, ...s });
        nodePositions.set(n.id, { x, y });
      }
    }
  } else {
    // 无分组布局 — 按 importance 分三层同心环
    const { core, major, minor } = sortByImportance(data.nodes);
    const cx = 500;
    const cy = 400;

    for (const n of core) {
      const s = getGraphNodeStyle(n, 0, style);
      renderNodes.push({ id: n.id, text: n.label, annotation: n.annotation, x: cx, y: cy, ...s });
      nodePositions.set(n.id, { x: cx, y: cy });
    }

    for (const { node } of ringLayout(major, cx, cy, NO_GROUP_RADIUS_MAJOR, 0, style)) {
      renderNodes.push(node);
      nodePositions.set(node.id, { x: node.x, y: node.y });
    }

    for (const { node } of ringLayout(minor, cx, cy, NO_GROUP_RADIUS_MINOR, 0, style)) {
      renderNodes.push(node);
      nodePositions.set(node.id, { x: node.x, y: node.y });
    }
  }

  // 渲染边
  for (const edge of data.edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const { fromSide, toSide } = getOptimalConnectionSide(fromPos.x, fromPos.y, toPos.x, toPos.y);
    const edgeStyle = getGraphEdgeStyle(edge);

    // 计算 label 位置
    const labelPos = edge.label ? {
      x: (fromPos.x + toPos.x) / 2,
      y: (fromPos.y + toPos.y) / 2 - 15,
    } : undefined;

    const renderEdge: RenderEdge = {
      fromId: edge.from,
      fromSide,
      toId: edge.to,
      toSide,
      ...edgeStyle,
      label: edge.label,
    };

    // 存储标签位置供渲染器使用
    if (labelPos) {
      (renderEdge as any)._labelPos = labelPos;
    }

    renderEdges.push(renderEdge);
  }

  return { nodes: renderNodes, edges: renderEdges, groups: renderGroups };
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npx tsc --noEmit src/agent/tools/excalidraw-engine/layout-graph.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/layout-graph.ts
git commit -m "feat(engine): add knowledge graph layout with group support"
```

---

### Task 6: 引擎入口 + 旧接口适配器

**Files:**
- Create: `src/agent/tools/excalidraw-engine/index.ts`

- [ ] **Step 1: 创建引擎入口**

```typescript
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

/** 引擎主入口 */
export async function runEngine(input: EngineInput): Promise<EngineOutput> {
  try {
    const { diagramType, data, filename, style } = input;

    // 合并 style
    if (style && 'style' in data) {
      (data as any).style = style;
    }

    // 布局
    const layout = diagramType === 'mindmap'
      ? layoutMindmap(data as MindmapSemantic)
      : layoutGraph(data as GraphSemantic);

    log('engine', `布局完成: ${layout.nodes.length} 节点, ${layout.edges.length} 边`);

    // 渲染
    const name = filename || generateFilename(diagramType, data);
    const result = await render(layout, name);

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
  // 清理文件名：去除特殊字符，限制长度
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npx tsc --noEmit src/agent/tools/excalidraw-engine/index.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/index.ts
git commit -m "feat(engine): add engine entry point and legacy adapters"
```

---

## Chunk 3: 工具层改造

### Task 7: 重构 excalidraw.ts 为分发器

**Files:**
- Modify: `src/agent/tools/excalidraw.ts`

- [ ] **Step 1: 重写 excalidraw.ts 为轻量分发器**

保留 `createExcalidrawTool` 导出签名不变，内部逻辑委托给引擎。保留 `check` 和 `create` 两个简单 action 的原有实现。将 `mindmap`、`knowledge_graph`、`draw` 三个 action 委托给引擎。

关键改动：
- 删除 `createMindmap`、`createKnowledgeGraph` 函数（约 400 行布局+渲染代码）
- 删除 `BRANCH_COLORS`、`TOPIC_STYLE`、`NODE_SIZES`、`LAYOUT_RADII` 常量（已迁移到 styles.ts）
- 保留 `getAPI`、`checkAPI` 辅助函数
- 保留 `EXCALIDRAW_DEFINITION`（在 Task 8 中更新）
- `execute` 中的 `switch` 改为：
  - `check` → 调用 `checkAPI()` 返回状态
  - `create` → 调用 `ea.create()` 创建空文件
  - `mindmap` → 调用 `adaptLegacyMindmap` + `runEngine`
  - `knowledge_graph` → 调用 `adaptLegacyGraph` + `runEngine`
  - `draw` → 直接调用 `runEngine`

文件从 ~691 行缩减至 ~120 行。

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run build 2>&1 | tail -20`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw.ts
git commit -m "refactor(tools): slim excalidraw.ts to dispatcher, delegate to engine"
```

---

### Task 8: 更新 Zod Schema（definitions/excalidraw.ts）

**Files:**
- Modify: `src/agent/tools/definitions/excalidraw.ts`

- [ ] **Step 1: 更新 Zod schema 支持 `draw` action**

在现有 schema 基础上：
- `action` enum 新增 `'draw'`
- 新增 `diagramType` 字段：`z.enum(['mindmap', 'knowledge_graph']).optional()`
- 新增 `data` 字段：`z.object({...}).optional()` 用于语义数据
- 更新 `description` 说明 `draw` action 的用法
- 保留旧的 `topic`、`branches`、`nodes`、`edges` 字段用于旧接口兼容

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/definitions/excalidraw.ts
git commit -m "feat(tools): update excalidraw Zod schema with draw action"
```

---

## Chunk 4: UI + Subagent 集成

### Task 9: 消息按钮（message.ts）

**Files:**
- Modify: `src/components/message/message.ts`

- [ ] **Step 1: 添加 onVisualize 回调**

在 `AIMessage` 构造函数的 `options` 参数中新增：
```typescript
onVisualize?: (messageId: string, content: string) => void;
```

存储为 `this.onVisualize`（约 line 978 附近）。

- [ ] **Step 2: 在 renderActions 中添加按钮**

在 `renderActions` 方法中（约 line 1611-1613 之间），添加"生成图形"按钮：

```typescript
if (this.onVisualize) {
    const vizBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
    vizBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    vizBtn.title = '生成图形';
    vizBtn.addEventListener('click', () => {
        if (this.data.content && this.data.content.length >= 50) {
            this.onVisualize?.(this.data.id, this.data.content);
        }
    });
}
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/components/message/message.ts
git commit -m "feat(ui): add visualize button to AI message actions"
```

---

### Task 10: Sidebar View 回调 + Subagent

**Files:**
- Modify: `src/views/sidebar-view.ts`

- [ ] **Step 1: 在 createMessageListSection 中添加 onVisualize 回调**

在 `createMessageListSection` 方法中（约 line 1843 附近），添加 `onVisualize` 回调：

```typescript
onVisualize: async (messageId: string, content: string) => {
    await this.handleVisualize(messageId, content);
},
```

- [ ] **Step 2: 实现 handleVisualize 方法**

新增 `handleVisualize` 方法，使用 SubagentManager 启动绘图 subagent：

```typescript
async handleVisualize(messageId: string, content: string): Promise<void> {
    // 1. 检查 Excalidraw 可用性
    const ea = window.ExcalidrawAutomate;
    if (!ea) {
        new Notice('请先安装并启用 Excalidraw 插件');
        return;
    }

    // 2. 更新按钮状态为 loading
    this.updateVisualizeButtonState(messageId, 'loading', '分析中…');

    try {
        // 3. 获取 LLM 客户端
        const client = this.frontendAgent?.getLLMClient();
        if (!client) {
            new Notice('Agent 未初始化');
            this.updateVisualizeButtonState(messageId, 'reset');
            return;
        }

        // 4. LLM 解析内容 → 语义结构
        const parseResult = await client.chat([
            {
                role: 'system',
                content: VISUALIZE_PARSE_PROMPT,
            },
            {
                role: 'user',
                content: `请将以下 AI 回复内容解析为图示结构：\n\n${content}`,
            },
        ], [], { type: 'json_object' });

        const parsed = JSON.parse(parseResult.content);
        const { diagramType, data } = parsed;

        this.updateVisualizeButtonState(messageId, 'loading', '生成中…');

        // 5. 如果需要补充信息，使用 subagent 搜索
        if (parsed.needsMoreInfo && this.frontendAgent) {
            const subagentManager = this.frontendAgent.getSubagentManager();
            if (subagentManager) {
                const taskId = subagentManager.spawn(
                    `根据以下内容 "${content.substring(0, 200)}" 搜索补充信息，丰富图示数据。搜索关键词：${parsed.searchKeywords?.join(', ')}`,
                    '图示内容补充',
                );
                const supplementResult = await subagentManager.waitFor(taskId, 30000);
                if (supplementResult.status === 'completed' && supplementResult.result) {
                    // 将补充结果合并到 data 中（由第二次 LLM 调用处理合并）
                    const mergeResult = await client.chat([
                        {
                            role: 'system',
                            content: '将搜索补充结果合并到图示数据中，保持原有结构，仅添加新的节点和边。输出合并后的完整 JSON。',
                        },
                        {
                            role: 'user',
                            content: `原始数据:\n${JSON.stringify(data)}\n\n补充内容:\n${supplementResult.result}`,
                        },
                    ], [], { type: 'json_object' });
                    Object.assign(data, JSON.parse(mergeResult.content));
                }
            }
        }

        // 6. 调用引擎渲染
        const { runEngine } = await import('./agent/tools/excalidraw-engine/index.js');
        const result = await runEngine({
            diagramType,
            data,
        });

        if (result.success) {
            // 7. 更新 UI：追加文件链接
            this.appendVisualizeResult(messageId, result.filePath!);
            this.updateVisualizeButtonState(messageId, 'done');
            new Notice(`图形已生成：${result.nodeCount} 个节点`);
        } else {
            new Notice(`生成失败：${result.error}`);
            this.updateVisualizeButtonState(messageId, 'reset');
        }
    } catch (err: any) {
        new Notice(`生成图形出错：${err.message}`);
        this.updateVisualizeButtonState(messageId, 'reset');
    }
}
```

- [ ] **Step 3: 添加 VISUALIZE_PARSE_PROMPT 常量**

在 sidebar-view.ts 顶部或单独文件中定义解析 prompt：

```typescript
const VISUALIZE_PARSE_PROMPT = `你是一个图示结构分析器。分析用户提供的 AI 回复内容，判断适合用思维导图还是知识图谱表示，然后提取结构化数据。

输出 JSON 格式：
{
  "diagramType": "mindmap" | "knowledge_graph",
  "needsMoreInfo": boolean,
  "searchKeywords": ["keyword1", "keyword2"],
  "data": { ... }
}

如果是思维导图，data 格式：
{
  "topic": "中心主题",
  "summary": "一句话概括（可选）",
  "branches": [
    {
      "label": "分支标题",
      "importance": "high" | "medium" | "low",
      "annotation": "补充说明（可选）",
      "children": [
        { "label": "子节点", "importance": "medium", "annotation": "说明（可选）", "children": [...] }
      ]
    }
  ]
}

如果是知识图谱，data 格式：
{
  "title": "图谱标题",
  "groups": [{ "id": "g1", "label": "分组名" }],
  "nodes": [
    { "id": "n1", "label": "概念", "type": "concept", "group": "g1", "importance": "core" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "关系", "type": "hierarchy", "direction": "directed" }
  ]
}

规则：
- 3-7 个分支/分组
- 每个分支最多 5 个子节点
- 最多 3 层嵌套
- 节点标签保持简短（1-5 个词）
- importance 根据内容核心程度分配
- needsMoreInfo: 如果内容提及了需要搜索补充的书籍/概念/细节，设为 true
- 如果内容不适合生成图形（纯叙事、过短），返回 { "error": "不适合" }`;
```

- [ ] **Step 4: 添加 UI 辅助方法**

```typescript
/** 更新按钮状态 */
updateVisualizeButtonState(messageId: string, state: 'loading' | 'done' | 'reset', text?: string): void {
    // 找到对应消息的按钮元素并更新
    const msgEl = this.containerEl.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    const btn = msgEl.querySelector('.deeppdf-visualize-btn') as HTMLButtonElement;
    if (!btn) return;

    if (state === 'loading') {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${text || '处理中…'}`;
    } else if (state === 'done') {
        btn.style.display = 'none';
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalHtml || '';
    }
}

/** 追加文件链接到消息 */
appendVisualizeResult(messageId: string, filePath: string): void {
    const msgEl = this.containerEl.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    const contentEl = msgEl.querySelector('.deeppdf-message-content');
    if (!contentEl) return;

    const card = document.createElement('div');
    card.className = 'deeppdf-visualize-result';
    card.innerHTML = `<a href="#" class="internal-link" data-href="${filePath}">📊 已生成：${filePath.split('/').pop()}</a>`;
    contentEl.appendChild(card);
}
```

- [ ] **Step 5: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run build 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add src/views/sidebar-view.ts
git commit -m "feat(ui): add visualize handler with subagent support in sidebar"
```

---

## Chunk 5: Skills + 路由更新

### Task 11: 更新 built-in-skills.ts

**Files:**
- Modify: `src/built-in-skills.ts`

- [ ] **Step 1: 更新 topic-mindmap skill**

在 `topic-mindmap` skill 的 prompt 中（约 line 287-419），修改工具调用指导：
- 将 `action: "mindmap"` 改为 `action: "draw", diagramType: "mindmap"`
- 将数据格式指导改为使用 `MindmapSemantic` schema
- 强调 `importance` 和 `annotation` 字段的使用
- 工具选择规则保持"必须使用 excalidraw，不用 canvas"

- [ ] **Step 2: 更新 book-mindmap skill**

在 `book-mindmap` skill 的 prompt 中（约 line 421-565），同样修改：
- `action: "draw", diagramType: "mindmap"`
- 深度选择（overview/detailed）映射到 importance 分配策略
- 保留 5 步执行流程和书籍类型分类逻辑

- [ ] **Step 3: 新增 smart-visualize skill**

在 `built-in-skills.ts` 数组末尾添加新的 `smart-visualize` skill：

```typescript
{
    name: 'smart-visualize',
    description: '将内容可视化为图形（思维导图或知识图谱），LLM 自动判断最佳图形类型',
    triggerPhrases: ['画个图', '可视化', '用图表示', '转成图', '画出来', '图示化', '做个图表'],
    applicableScenarios: '自由创作场景；将任意内容可视化；用户要求用图形表达',
    instructions: `你是一个图示生成助手。

## 判断规则
- 内容有层级结构、分类、包含关系 → 思维导图
- 内容有多对多关系、因果链、人物/事件网络 → 知识图谱
- 不确定时优先选择思维导图

## 执行步骤
1. 分析用户需求，判断 diagramType
2. 如需从书籍中获取信息，先用搜索工具收集
3. 按 MindmapSemantic 或 GraphSemantic schema 组织数据
4. 调用 excalidraw 工具，参数：
   action: "draw"
   diagramType: "mindmap" 或 "knowledge_graph"
   data: { 按对应 schema 填充 }

## 数据要求
- 3-7 个分支或分组
- 每个分支最多 5 个子节点
- 最多 3 层嵌套
- 节点标签 1-5 个词
- 合理使用 importance 字段
- 为重要节点添加 annotation`,
}
```

- [ ] **Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run build 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add src/built-in-skills.ts
git commit -m "feat(skills): update mindmap skills for draw action, add smart-visualize"
```

---

### Task 12: 更新意图路由规则

**Files:**
- Modify: `src/agent/router/intent-rules.json`

- [ ] **Step 1: 扩展 action_output 规则的匹配模式**

在 `action_output` 规则的 `pattern` 字段中追加新的匹配词：

```json
"画一个|画张|做个图|制作.*图表|总结成表格|做.*卡片|闪卡|写.*笔记|思维导图|可视化|用图表示|转成图|画出来|图示化|做个图表"
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/router/intent-rules.json
git commit -m "feat(router): expand action_output patterns for visualization"
```

---

## Chunk 6: 集成测试

### Task 13: 端到端集成测试

**Files:**
- Create: `src/agent/tools/excalidraw-engine/__tests__/engine.test.ts`

- [ ] **Step 1: 编写引擎单元测试**

测试布局算法和样式系统（不依赖 ExcalidrawAutomate）：

```typescript
// 测试思维导图布局
describe('layoutMindmap', () => {
  it('should layout 3 branches correctly', () => {
    const data: MindmapSemantic = {
      topic: 'Test Topic',
      branches: [
        { label: 'Branch A', children: [{ label: 'A1' }, { label: 'A2' }] },
        { label: 'Branch B', children: [{ label: 'B1' }] },
        { label: 'Branch C', children: [] },
      ],
    };
    const result = layoutMindmap(data);
    expect(result.nodes.length).toBe(7); // topic + 3 branches + 3 children
    expect(result.edges.length).toBe(6); // 3 topic→branch + 3 branch→child
    // topic 在中心
    expect(result.nodes[0].id).toBe('topic');
    expect(result.nodes[0].x).toBe(500);
    expect(result.nodes[0].y).toBe(400);
  });
});

// 测试知识图谱布局
describe('layoutGraph', () => {
  it('should layout grouped nodes with containers', () => {
    const data: GraphSemantic = {
      title: 'Test Graph',
      groups: [{ id: 'g1', label: 'Group 1' }],
      nodes: [
        { id: 'n1', label: 'Core', importance: 'core', group: 'g1' },
        { id: 'n2', label: 'Major', importance: 'major', group: 'g1' },
      ],
      edges: [{ from: 'n1', to: 'n2', label: 'relates', type: 'association' }],
    };
    const result = layoutGraph(data);
    expect(result.nodes.length).toBe(2);
    expect(result.groups.length).toBe(1);
    expect(result.edges[0].label).toBe('relates');
  });
});

// 测试样式系统
describe('styles', () => {
  it('should assign correct shapes for topic and branches', () => {
    const topic = getMindmapNodeStyle('topic', 0);
    expect(topic.shape).toBe('ellipse');
    const branch = getMindmapNodeStyle('branch', 0);
    expect(branch.shape).toBe('box');
  });

  it('should use different colors for different branches', () => {
    const b0 = getMindmapNodeStyle('branch', 0);
    const b1 = getMindmapNodeStyle('branch', 1);
    expect(b0.strokeColor).not.toBe(b1.strokeColor);
  });
});

// 测试旧接口适配
describe('legacy adapters', () => {
  it('should convert string children to objects', () => {
    const result = adaptLegacyMindmap({
      topic: 'Test',
      branches: [{ label: 'B1', children: ['child1', 'child2'] }],
    });
    expect(result.branches[0].children[0]).toEqual({ label: 'child1' });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run test:run -- src/agent/tools/excalidraw-engine/__tests__/engine.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/excalidraw-engine/__tests__/engine.test.ts
git commit -m "test(engine): add unit tests for layout, styles, and adapters"
```

---

### Task 14: 全量构建验证

- [ ] **Step 1: 完整构建**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 2: 全量测试**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run test:run`
Expected: 所有测试通过

- [ ] **Step 3: 部署到 test-vault 并手动验证**

Run: `cd /Users/lizhao/workspace/DeepReader && npm run deploy`

手动测试场景：
1. 在 Obsidian 中打开 DeepReader，打开一本书
2. 对 AI 说"画一个思维导图" → 验证新引擎渲染
3. 点击 AI 回复的"生成图形"按钮 → 验证 subagent 流程
4. 打开生成的 .excalidraw.md 文件 → 验证视觉品质
