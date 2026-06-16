import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { syncBoundTextPositions } from './utils.js';

/**
 * Left-right mind map layout.
 *
 * - Center node sits in the middle.
 * - Level-1 children alternate between right and left sides.
 * - Level-2+ children continue outward on the same side as their parent.
 * - Subtrees are stacked vertically and centered around the center node.
 */
export const MindMapLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const centerX = 500;
    const centerY = 300;
    const levelSpacingX = options?.spacing?.x ?? 260;
    const siblingSpacingY = options?.spacing?.y ?? 120;

    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el =>
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId
    );
    const arrows = clonedElements.filter(el => el.type === 'arrow' || el.type === 'line');

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    const childrenMap = buildChildrenMap(movableNodes, arrows);
    const parentMap = buildParentMap(movableNodes, arrows);

    // Find center node: no parent among movable nodes, fallback to first node.
    const movableIds = new Set(movableNodes.map(n => n.id));
    const roots = movableNodes.filter(n => {
      const parentId = parentMap.get(n.id);
      return !parentId || !movableIds.has(parentId);
    });
    const centerNode = roots[0] ?? movableNodes[0];

    centerNode.x = centerX - centerNode.width / 2;
    centerNode.y = centerY - centerNode.height / 2;

    const level1Children = childrenMap.get(centerNode.id) || [];

    // Alternate level-1 children between right and left.
    const rightChildren: ElementDef[] = [];
    const leftChildren: ElementDef[] = [];
    level1Children.forEach((child, i) => {
      if (i % 2 === 0) rightChildren.push(child);
      else leftChildren.push(child);
    });

    layoutSide(rightChildren, 1, centerX, centerY, levelSpacingX, siblingSpacingY, childrenMap);
    layoutSide(leftChildren, -1, centerX, centerY, levelSpacingX, siblingSpacingY, childrenMap);

    syncBoundTextPositions(clonedElements, elementMap);
    return clonedElements;
  }
};

function buildChildrenMap(nodes: ElementDef[], arrows: ElementDef[]): Map<string, ElementDef[]> {
  const map = new Map<string, ElementDef[]>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const id of nodeMap.keys()) {
    map.set(id, []);
  }
  for (const arrow of arrows) {
    const start = arrow.startBinding?.elementId;
    const end = arrow.endBinding?.elementId;
    if (start && end && nodeMap.has(start) && nodeMap.has(end)) {
      map.get(start)!.push(nodeMap.get(end)!);
    }
  }
  return map;
}

function buildParentMap(nodes: ElementDef[], arrows: ElementDef[]): Map<string, string> {
  const map = new Map<string, string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const arrow of arrows) {
    const start = arrow.startBinding?.elementId;
    const end = arrow.endBinding?.elementId;
    if (start && end && nodeMap.has(start) && nodeMap.has(end)) {
      map.set(end, start);
    }
  }
  return map;
}

function layoutSide(
  nodes: ElementDef[],
  side: 1 | -1,
  centerX: number,
  centerY: number,
  levelSpacingX: number,
  siblingSpacingY: number,
  childrenMap: Map<string, ElementDef[]>,
): void {
  if (nodes.length === 0) return;

  const heights = nodes.map(n => computeSubtreeHeight(n, childrenMap, siblingSpacingY, new Set()));
  const totalHeight = heights.reduce((a, b) => a + b, 0) + (nodes.length - 1) * siblingSpacingY;
  let currentY = centerY - totalHeight / 2;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const subtreeHeight = heights[i];

    node.x = centerX + side * levelSpacingX - node.width / 2;
    node.y = currentY + (subtreeHeight - node.height) / 2;

    layoutDescendants(node, side, levelSpacingX, siblingSpacingY, childrenMap, new Set());

    currentY += subtreeHeight + siblingSpacingY;
  }
}

function computeSubtreeHeight(
  node: ElementDef,
  childrenMap: Map<string, ElementDef[]>,
  siblingSpacingY: number,
  visited: Set<string>,
): number {
  if (visited.has(node.id)) return node.height;
  visited.add(node.id);

  const children = childrenMap.get(node.id) || [];
  if (children.length === 0) return node.height;

  let childrenHeight = 0;
  for (let i = 0; i < children.length; i++) {
    childrenHeight += computeSubtreeHeight(children[i], childrenMap, siblingSpacingY, new Set(visited));
    if (i < children.length - 1) childrenHeight += siblingSpacingY;
  }
  return Math.max(node.height, childrenHeight);
}

function layoutDescendants(
  parent: ElementDef,
  side: 1 | -1,
  levelSpacingX: number,
  siblingSpacingY: number,
  childrenMap: Map<string, ElementDef[]>,
  visited: Set<string>,
): void {
  if (visited.has(parent.id)) return;
  visited.add(parent.id);

  const children = childrenMap.get(parent.id) || [];
  if (children.length === 0) return;

  const heights = children.map(c => computeSubtreeHeight(c, childrenMap, siblingSpacingY, new Set(visited)));
  const totalHeight = heights.reduce((a, b) => a + b, 0) + (children.length - 1) * siblingSpacingY;
  const parentCenterX = parent.x + parent.width / 2;
  let currentY = parent.y + parent.height / 2 - totalHeight / 2;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const subtreeHeight = heights[i];

    child.x = parentCenterX + side * levelSpacingX - child.width / 2;
    child.y = currentY + (subtreeHeight - child.height) / 2;

    layoutDescendants(child, side, levelSpacingX, siblingSpacingY, childrenMap, new Set(visited));

    currentY += subtreeHeight + siblingSpacingY;
  }
}
