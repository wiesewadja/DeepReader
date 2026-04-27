// src/agent/tools/excalidraw-engine/layout-mindmap.ts
import type {
  MindmapSemantic, MindmapBranch, MindmapNode,
  LayoutNode, SubtreeBounds,
  RenderNode, RenderEdge, LayoutResult,
} from './types.js';
import { getMindmapNodeStyle, getMindmapEdgeStyle, getOptimalConnectionSide, computeNodeSize } from './styles.js';

const CENTER_X = 500;
const CENTER_Y = 400;
const BRANCH_RADIUS = 350;
const CHILD_DISTANCE = 220;
const LEAF_DISTANCE = 160;
const ANGLE_GAP = 0.25;
const MIN_BRANCH_ANGLE = Math.PI / 4;
const CHILD_GAP = 60;
const LEAF_GAP = 50;
const ANNOTATION_HEIGHT = 20;
const COLLISION_MAX_ITER = 15;
const COLLISION_CONVERGENCE = 2;

// --- Phase 1: 构建尺寸已知的布局树 ---

function buildLayoutTree(data: MindmapSemantic): LayoutNode {
  const topicSize = computeNodeSize(data.topic, 'topic');
  return {
    id: 'topic',
    text: data.topic,
    annotation: data.summary,
    level: 'topic',
    branchIndex: 0,
    ...topicSize,
    children: data.branches.map((b, i) => buildBranchNode(b, i)),
  };
}

function buildBranchNode(branch: MindmapBranch, index: number): LayoutNode {
  const size = computeNodeSize(branch.label, 'branch');
  return {
    id: `branch-${index}`,
    text: branch.label,
    annotation: branch.annotation,
    level: 'branch',
    branchIndex: index,
    ...size,
    children: branch.children.map((c, ci) => buildChildNode(c, index, ci, 'child', `branch-${index}`)),
  };
}

function buildChildNode(node: MindmapNode, branchIndex: number, childIndex: number, level: 'child' | 'leaf', parentId: string): LayoutNode {
  const nodeId = `${parentId}-${childIndex}`;
  const size = computeNodeSize(node.label, level);
  return {
    id: nodeId,
    text: node.label,
    annotation: node.annotation,
    level,
    branchIndex,
    ...size,
    link: node.link,
    children: (node.children ?? []).map((c, ci) => buildChildNode(c, branchIndex, ci, 'leaf', nodeId)),
  };
}

// --- Phase 2: 子树边界框 + 角度分配 ---

function computeSubtreeBounds(node: LayoutNode): SubtreeBounds {
  if (node.children.length === 0) {
    return {
      width: node.width,
      height: node.height + (node.annotation ? ANNOTATION_HEIGHT : 0),
      offsetX: node.width / 2,
      offsetY: node.height / 2,
    };
  }

  let maxChildExtent = 0;
  let totalChildStack = 0;
  for (let i = 0; i < node.children.length; i++) {
    const childBounds = computeSubtreeBounds(node.children[i]);
    const childExtent = CHILD_DISTANCE + childBounds.width;
    maxChildExtent = Math.max(maxChildExtent, childExtent);
    totalChildStack += Math.max(childBounds.height, node.children[i].height);
    if (i > 0) totalChildStack += CHILD_GAP;
  }

  const selfH = node.height + (node.annotation ? ANNOTATION_HEIGHT : 0);
  const height = Math.max(selfH, totalChildStack);
  const width = node.width + maxChildExtent;

  return { width, height, offsetX: width / 2, offsetY: height / 2 };
}

function subtreeAngularSpan(node: LayoutNode, distance: number): number {
  const bounds = computeSubtreeBounds(node);
  const angularSpan = 2 * Math.atan2(bounds.height / 2, distance) + ANGLE_GAP;
  return Math.max(angularSpan, MIN_BRANCH_ANGLE);
}

// --- Phase 2: 位置计算 ---

function layoutNodeToRender(
  node: LayoutNode,
  x: number,
  y: number,
  style?: string,
): RenderNode {
  const nodeStyle = getMindmapNodeStyle(
    node.level,
    node.branchIndex,
    style as any,
    { width: node.width, height: node.height },
  );
  return {
    id: node.id,
    text: node.text,
    annotation: node.annotation,
    x, y,
    ...nodeStyle,
    link: node.link,
  };
}

function layoutChildren(
  parentId: string,
  parentX: number,
  parentY: number,
  children: LayoutNode[],
  level: 'child' | 'leaf',
  branchIndex: number,
  branchAngle: number,
  nodes: RenderNode[],
  edges: RenderEdge[],
  depth: number = 0,
): void {
  if (children.length === 0) return;

  const isLeaf = level === 'leaf';
  const distance = isLeaf ? LEAF_DISTANCE : CHILD_DISTANCE;
  const gap = isLeaf ? LEAF_GAP : CHILD_GAP;
  const isHorizontal = Math.abs(Math.cos(branchAngle)) > Math.abs(Math.sin(branchAngle));

  if (isHorizontal) {
    let totalHeight = 0;
    const effectiveHeights: number[] = [];
    for (let i = 0; i < children.length; i++) {
      const childBounds = computeSubtreeBounds(children[i]);
      const eh = Math.max(children[i].height + (children[i].annotation ? ANNOTATION_HEIGHT : 0), childBounds.height);
      effectiveHeights.push(eh);
      totalHeight += eh + (i > 0 ? gap : 0);
    }

    let currentY = parentY - totalHeight / 2;
    const dx = Math.cos(branchAngle) > 0 ? distance : -distance;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childX = parentX + dx;
      const childY = currentY + effectiveHeights[i] / 2;

      const render = layoutNodeToRender(child, childX, childY);
      nodes.push(render);

      const { fromSide, toSide } = getOptimalConnectionSide(parentX, parentY, childX, childY);
      edges.push({
        fromId: parentId, fromSide, toId: child.id, toSide,
        ...getMindmapEdgeStyle(isLeaf ? 'child-leaf' : 'branch-child', branchIndex),
      });

      currentY += effectiveHeights[i] + gap;

      if (child.children.length > 0 && depth < 2) {
        layoutChildren(child.id, childX, childY, child.children, 'leaf', branchIndex, branchAngle, nodes, edges, depth + 1);
      }
    }
  } else {
    let totalWidth = 0;
    const effectiveWidths: number[] = [];
    for (let i = 0; i < children.length; i++) {
      const childBounds = computeSubtreeBounds(children[i]);
      const ew = Math.max(children[i].width, childBounds.width);
      effectiveWidths.push(ew);
      totalWidth += ew + (i > 0 ? gap : 0);
    }

    let currentX = parentX - totalWidth / 2;
    const dy = Math.sin(branchAngle) > 0 ? distance : -distance;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childX = currentX + effectiveWidths[i] / 2;
      const childY = parentY + dy;

      const render = layoutNodeToRender(child, childX, childY);
      nodes.push(render);

      const { fromSide, toSide } = getOptimalConnectionSide(parentX, parentY, childX, childY);
      edges.push({
        fromId: parentId, fromSide, toId: child.id, toSide,
        ...getMindmapEdgeStyle(isLeaf ? 'child-leaf' : 'branch-child', branchIndex),
      });

      currentX += effectiveWidths[i] + gap;

      if (child.children.length > 0 && depth < 2) {
        layoutChildren(child.id, childX, childY, child.children, 'leaf', branchIndex, branchAngle, nodes, edges, depth + 1);
      }
    }
  }
}

// --- Phase 3: 增强碰撞检测 ---

interface CollisionEntry {
  x: number;
  y: number;
  width: number;
  effectiveHeight: number;
  id: string;
}

function resolveCollisions(nodes: RenderNode[], edges: RenderEdge[]): void {
  const parentMap = new Map<string, string>();
  for (const edge of edges) {
    parentMap.set(edge.toId, edge.fromId);
  }

  const entries: CollisionEntry[] = nodes.map(n => ({
    x: n.x,
    y: n.y,
    width: n.width,
    effectiveHeight: n.height + (n.annotation ? ANNOTATION_HEIGHT : 0),
    id: n.id,
  }));

  for (let iter = 0; iter < COLLISION_MAX_ITER; iter++) {
    let totalMoved = 0;

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];

        const overlapX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
        const overlapY = (a.effectiveHeight + b.effectiveHeight) / 2 - Math.abs(a.y - b.y);

        if (overlapX > 0 && overlapY > 0) {
          const parentA = parentMap.get(a.id);
          const parentB = parentMap.get(b.id);

          if (parentA && parentA === parentB) {
            const push = overlapY / 2 + 1;
            if (a.y < b.y) { a.y -= push; b.y += push; }
            else { a.y += push; b.y -= push; }
          } else {
            const distA = Math.hypot(a.x - CENTER_X, a.y - CENTER_Y) || 1;
            const distB = Math.hypot(b.x - CENTER_X, b.y - CENTER_Y) || 1;
            const target = distA < distB ? a : b;
            const dx = target.x - CENTER_X;
            const dy = target.y - CENTER_Y;
            const len = Math.hypot(dx, dy) || 1;

            if (overlapX < overlapY) {
              target.x += (dx / len) * overlapX;
            } else {
              target.y += (dy / len) * overlapY;
            }
          }
          totalMoved += overlapX + overlapY;
        }
      }
    }

    if (totalMoved < COLLISION_CONVERGENCE) break;
  }

  for (let i = 0; i < nodes.length; i++) {
    nodes[i].x = entries[i].x;
    nodes[i].y = entries[i].y;
  }
}

// --- 主入口 ---

export function layoutMindmap(data: MindmapSemantic): LayoutResult {
  // Phase 1: 构建尺寸已知的布局树
  const layoutTree = buildLayoutTree(data);

  const nodes: RenderNode[] = [];
  const edges: RenderEdge[] = [];

  // 放置中心主题节点
  const topicRender = layoutNodeToRender(layoutTree, CENTER_X, CENTER_Y, data.style);
  nodes.push(topicRender);

  // Phase 2: 按子树角跨度分配角度
  const totalSpan = layoutTree.children.reduce(
    (sum, child) => sum + subtreeAngularSpan(child, BRANCH_RADIUS), 0,
  );
  let currentAngle = -Math.PI / 2;

  for (let i = 0; i < layoutTree.children.length; i++) {
    const branchNode = layoutTree.children[i];
    const span = subtreeAngularSpan(branchNode, BRANCH_RADIUS);
    const angle = (span / totalSpan) * 2 * Math.PI;
    const midAngle = currentAngle + angle / 2;

    const bx = CENTER_X + BRANCH_RADIUS * Math.cos(midAngle);
    const by = CENTER_Y + BRANCH_RADIUS * Math.sin(midAngle);

    const branchRender = layoutNodeToRender(branchNode, bx, by, data.style);
    nodes.push(branchRender);

    const { fromSide, toSide } = getOptimalConnectionSide(CENTER_X, CENTER_Y, bx, by);
    edges.push({
      fromId: 'topic', fromSide, toId: branchNode.id, toSide,
      ...getMindmapEdgeStyle('topic-branch', i),
    });

    if (branchNode.children.length > 0) {
      layoutChildren(branchNode.id, bx, by, branchNode.children, 'child', i, midAngle, nodes, edges);
    }

    currentAngle += angle;
  }

  // Phase 3: 碰撞检测
  resolveCollisions(nodes, edges);

  return { nodes, edges, groups: [] };
}
