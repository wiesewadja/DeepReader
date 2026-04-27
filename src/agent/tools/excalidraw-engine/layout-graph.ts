// src/agent/tools/excalidraw-engine/layout-graph.ts
import type {
  GraphSemantic, GraphNode, GraphEdge, GraphGroup,
  RenderNode, RenderEdge, RenderGroup, LayoutResult,
} from './types.js';
import { getGraphNodeStyle, getGraphEdgeStyle, getGroupStyle, getOptimalConnectionSide } from './styles.js';

const CORE_RING_RADIUS = 80;

const START_X = 200;
const START_Y = 200;
const GROUP_SPACING_X = 600;
const GROUP_SPACING_Y = 500;
const INNER_RADIUS_MAJOR = 200;
const INNER_RADIUS_MINOR = 400;
const NO_GROUP_RADIUS_MAJOR = 300;
const NO_GROUP_RADIUS_MINOR = 550;
const GROUP_PADDING = 30;

function groupNodes(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = node.group ?? '__ungrouped__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(node);
  }
  return map;
}

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

export function layoutGraph(data: GraphSemantic): LayoutResult {
  const renderNodes: RenderNode[] = [];
  const renderEdges: RenderEdge[] = [];
  const renderGroups: RenderGroup[] = [];
  const style = data.style;

  const groups = data.groups ?? [];
  const nodeGroups = groupNodes(data.nodes);
  const nodePositions = new Map<string, { x: number; y: number }>();

  if (groups.length > 0) {
    const cols = groups.length <= 3 ? groups.length : Math.ceil(groups.length / 2);

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const col = gi % cols;
      const row = Math.floor(gi / cols);
      const gcx = START_X + col * GROUP_SPACING_X;
      const gcy = START_Y + row * GROUP_SPACING_Y;

      const groupNodesList = nodeGroups.get(group.id) ?? [];
      const { core, major, minor } = sortByImportance(groupNodesList);
      const positions: { x: number; y: number; width: number; height: number }[] = [];

      for (let ci = 0; ci < core.length; ci++) {
        const n = core[ci];
        const s = getGraphNodeStyle(n, gi, style);
        const cx = core.length === 1 ? gcx : gcx + CORE_RING_RADIUS * Math.cos((2 * Math.PI * ci) / core.length - Math.PI / 2);
        const cy = core.length === 1 ? gcy : gcy + CORE_RING_RADIUS * Math.sin((2 * Math.PI * ci) / core.length - Math.PI / 2);
        renderNodes.push({ id: n.id, text: n.label, annotation: n.annotation, x: cx, y: cy, ...s });
        positions.push({ x: cx, y: cy, width: s.width, height: s.height });
        nodePositions.set(n.id, { x: cx, y: cy });
      }

      for (const { node, position } of ringLayout(major, gcx, gcy, INNER_RADIUS_MAJOR, gi, style)) {
        renderNodes.push(node);
        positions.push(position);
        nodePositions.set(node.id, { x: node.x, y: node.y });
      }

      for (const { node, position } of ringLayout(minor, gcx, gcy, INNER_RADIUS_MINOR, gi, style)) {
        renderNodes.push(node);
        positions.push(position);
        nodePositions.set(node.id, { x: node.x, y: node.y });
      }

      const box = boundingBox(positions);
      const gStyle = getGroupStyle(gi);
      renderGroups.push({
        id: `group-${group.id}`, label: group.label,
        nodeIds: groupNodesList.map(n => n.id),
        x: box.x - GROUP_PADDING, y: box.y - GROUP_PADDING - 25,
        width: box.width + GROUP_PADDING * 2, height: box.height + GROUP_PADDING * 2 + 25,
        fillColor: gStyle.fillColor, strokeColor: gStyle.strokeColor,
      });
    }

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
    const { core, major, minor } = sortByImportance(data.nodes);
    const cx = 500;
    const cy = 400;

    for (let ci = 0; ci < core.length; ci++) {
      const n = core[ci];
      const s = getGraphNodeStyle(n, 0, style);
      const nx = core.length === 1 ? cx : cx + CORE_RING_RADIUS * Math.cos((2 * Math.PI * ci) / core.length - Math.PI / 2);
      const ny = core.length === 1 ? cy : cy + CORE_RING_RADIUS * Math.sin((2 * Math.PI * ci) / core.length - Math.PI / 2);
      renderNodes.push({ id: n.id, text: n.label, annotation: n.annotation, x: nx, y: ny, ...s });
      nodePositions.set(n.id, { x: nx, y: ny });
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

  for (const edge of data.edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const { fromSide, toSide } = getOptimalConnectionSide(fromPos.x, fromPos.y, toPos.x, toPos.y);
    const edgeStyle = getGraphEdgeStyle(edge);

    const labelPos = edge.label ? {
      x: (fromPos.x + toPos.x) / 2,
      y: (fromPos.y + toPos.y) / 2 - 15,
    } : undefined;

    const renderEdge: RenderEdge = {
      fromId: edge.from, fromSide,
      toId: edge.to, toSide,
      ...edgeStyle,
      label: edge.label,
    };

    if (labelPos) {
      (renderEdge as any).labelPos = labelPos;
    }

    renderEdges.push(renderEdge);
  }

  return { nodes: renderNodes, edges: renderEdges, groups: renderGroups };
}
