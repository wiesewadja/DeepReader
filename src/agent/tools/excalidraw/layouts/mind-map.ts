import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

/**
 * Growth modes for mind-map layout.
 * - Right-Left (default): Level-1 children alternate between right and left sides
 * - Right-facing: All Level-1 children go right
 * - Left-facing: All Level-1 children go left
 * - Radial: Center node + ring of Level-1 (like radial but with hierarchy)
 * - Up-Down / Up-facing / Down-facing: Vertical layouts
 */
export type GrowthMode =
  | 'Right-Left'
  | 'Right-facing'
  | 'Left-facing'
  | 'Radial'
  | 'Up-Down'
  | 'Up-facing'
  | 'Down-facing';

/**
 * Left-right mind map layout with configurable growth mode.
 *
 * - Center node sits in the middle.
 * - Level-1 children distributed according to growthMode.
 * - Level-2+ children continue outward on the same side as their parent.
 * - Subtrees are stacked vertically and centered around the center node.
 */
export const MindMapLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const centerX = 500;
    const centerY = 300;
    const siblingSpacingY = options?.spacing?.y ?? 80;
    const growthMode: GrowthMode = (options?.growthMode as GrowthMode) ?? 'Right-Left';

    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el =>
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId && !shouldIgnoreInLayout(el)
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

    const heightCache = new Map<string, number>();

    // Distribute Level-1 children based on growthMode
    switch (growthMode) {
      case 'Right-facing': {
        // All children go right
        layoutSide(level1Children, 1, centerNode, centerY, siblingSpacingY, childrenMap, heightCache);
        break;
      }
      case 'Left-facing': {
        // All children go left
        layoutSide(level1Children, -1, centerNode, centerY, siblingSpacingY, childrenMap, heightCache);
        break;
      }
      case 'Up-facing': {
        layoutVertical(level1Children, 'up', centerNode, centerX, siblingSpacingY, childrenMap, heightCache);
        break;
      }
      case 'Down-facing': {
        layoutVertical(level1Children, 'down', centerNode, centerX, siblingSpacingY, childrenMap, heightCache);
        break;
      }
      case 'Up-Down': {
        const half = Math.ceil(level1Children.length / 2);
        const upChildren = level1Children.slice(0, half);
        const downChildren = level1Children.slice(half);
        layoutVertical(upChildren, 'up', centerNode, centerX, siblingSpacingY, childrenMap, heightCache);
        layoutVertical(downChildren, 'down', centerNode, centerX, siblingSpacingY, childrenMap, heightCache);
        break;
      }
      case 'Radial': {
        // Distribute around center in a circle
        layoutRadial(level1Children, centerNode, centerX, centerY, childrenMap, heightCache);
        break;
      }
      case 'Right-Left':
      default: {
        // Alternate left and right (original behavior)
        const rightChildren: ElementDef[] = [];
        const leftChildren: ElementDef[] = [];
        level1Children.forEach((child, i) => {
          if (i % 2 === 0) rightChildren.push(child);
          else leftChildren.push(child);
        });
        layoutSide(rightChildren, 1, centerNode, centerY, siblingSpacingY, childrenMap, heightCache);
        layoutSide(leftChildren, -1, centerNode, centerY, siblingSpacingY, childrenMap, heightCache);
        break;
      }
    }

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

/**
 * 根据父节点宽度和子节点最大宽度，动态计算水平层间距。
 *
 * 保证：父子边界之间至少有 60px 留白，避免节点过宽时重叠或连线压字。
 */
function computeDynamicSpacingX(
  parentWidth: number,
  childWidths: number[],
): number {
  const childMaxWidth = childWidths.length > 0
    ? Math.max(...childWidths)
    : 0;
  return parentWidth / 2 + childMaxWidth / 2 + 60;
}

function layoutSide(
  nodes: ElementDef[],
  side: 1 | -1,
  centerNode: ElementDef,
  centerY: number,
  siblingSpacingY: number,
  childrenMap: Map<string, ElementDef[]>,
  heightCache: Map<string, number>,
): void {
  if (nodes.length === 0) return;

  const heights = nodes.map(n => computeSubtreeHeight(n, childrenMap, siblingSpacingY, new Set(), heightCache));
  const totalHeight = heights.reduce((a, b) => a + b, 0) + (nodes.length - 1) * siblingSpacingY;
  const centerX = centerNode.x + centerNode.width / 2;
  let currentY = centerY - totalHeight / 2;

  // 根据中心节点宽度和子节点最大宽度动态计算水平层间距
  const dynamicSpacingX = computeDynamicSpacingX(
    centerNode.width,
    nodes.map(n => n.width),
  );

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const subtreeHeight = heights[i];

    node.x = centerX + side * dynamicSpacingX - node.width / 2;
    node.y = currentY + (subtreeHeight - node.height) / 2;

    layoutDescendants(node, side, siblingSpacingY, childrenMap, new Set(), heightCache);

    currentY += subtreeHeight + siblingSpacingY;
  }
}

function computeSubtreeHeight(
  node: ElementDef,
  childrenMap: Map<string, ElementDef[]>,
  siblingSpacingY: number,
  visited: Set<string>,
  heightCache: Map<string, number>,
): number {
  if (heightCache.has(node.id)) {
    return heightCache.get(node.id)!;
  }
  if (visited.has(node.id)) return node.height;
  visited.add(node.id);

  const children = childrenMap.get(node.id) || [];
  if (children.length === 0) {
    heightCache.set(node.id, node.height);
    return node.height;
  }

  let childrenHeight = 0;
  for (let i = 0; i < children.length; i++) {
    childrenHeight += computeSubtreeHeight(children[i], childrenMap, siblingSpacingY, new Set(visited), heightCache);
    if (i < children.length - 1) childrenHeight += siblingSpacingY;
  }
  const result = Math.max(node.height, childrenHeight);
  heightCache.set(node.id, result);
  return result;
}

function layoutDescendants(
  parent: ElementDef,
  side: 1 | -1,
  siblingSpacingY: number,
  childrenMap: Map<string, ElementDef[]>,
  visited: Set<string>,
  heightCache: Map<string, number>,
): void {
  if (visited.has(parent.id)) return;
  visited.add(parent.id);

  const children = childrenMap.get(parent.id) || [];
  if (children.length === 0) return;

  const heights = children.map(c => computeSubtreeHeight(c, childrenMap, siblingSpacingY, new Set(visited), heightCache));
  const totalHeight = heights.reduce((a, b) => a + b, 0) + (children.length - 1) * siblingSpacingY;
  const parentCenterX = parent.x + parent.width / 2;
  let currentY = parent.y + parent.height / 2 - totalHeight / 2;

  // 根据父节点宽度和子节点最大宽度动态计算水平层间距
  const dynamicSpacingX = computeDynamicSpacingX(
    parent.width,
    children.map(c => c.width),
  );

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const subtreeHeight = heights[i];

    child.x = parentCenterX + side * dynamicSpacingX - child.width / 2;
    child.y = currentY + (subtreeHeight - child.height) / 2;

    layoutDescendants(child, side, siblingSpacingY, childrenMap, new Set(visited), heightCache);

    currentY += subtreeHeight + siblingSpacingY;
  }
}

/**
 * Vertical layout for Up-facing / Down-facing growth modes.
 * Children are stacked vertically above or below the center node.
 */
function layoutVertical(
  nodes: ElementDef[],
  direction: 'up' | 'down',
  centerNode: ElementDef,
  centerX: number,
  siblingSpacingY: number,
  childrenMap: Map<string, ElementDef[]>,
  heightCache: Map<string, number>,
): void {
  if (nodes.length === 0) return;

  const side = direction === 'up' ? -1 : 1;
  const totalWidth = nodes.reduce((a, n) => a + n.width, 0) + (nodes.length - 1) * 60;
  let currentX = centerX - totalWidth / 2;

  for (const node of nodes) {
    const dynamicSpacingY = node.height / 2 + centerNode.height / 2 + 60;

    node.x = currentX;
    node.y = centerNode.y + centerNode.height / 2 + side * dynamicSpacingY - node.height / 2;

    // Layout descendants vertically
    layoutDescendantsVertical(node, direction, siblingSpacingY, childrenMap, new Set(), heightCache);

    currentX += node.width + 60;
  }
}

function layoutDescendantsVertical(
  parent: ElementDef,
  direction: 'up' | 'down',
  siblingSpacingY: number,
  childrenMap: Map<string, ElementDef[]>,
  visited: Set<string>,
  heightCache: Map<string, number>,
): void {
  if (visited.has(parent.id)) return;
  visited.add(parent.id);

  const children = childrenMap.get(parent.id) || [];
  if (children.length === 0) return;

  const side = direction === 'up' ? -1 : 1;
  const totalWidth = children.reduce((a, c) => a + c.width, 0) + (children.length - 1) * 60;
  let currentX = parent.x + parent.width / 2 - totalWidth / 2;
  const dynamicSpacingY = parent.height / 2 + 60;

  for (const child of children) {
    child.x = currentX;
    child.y = parent.y + parent.height / 2 + side * dynamicSpacingY - child.height / 2;

    layoutDescendantsVertical(child, direction, siblingSpacingY, childrenMap, new Set(visited), heightCache);

    currentX += child.width + 60;
  }
}

/**
 * Radial layout: distribute children in a circle around the center node.
 */
function layoutRadial(
  nodes: ElementDef[],
  centerNode: ElementDef,
  centerX: number,
  centerY: number,
  childrenMap: Map<string, ElementDef[]>,
  heightCache: Map<string, number>,
): void {
  if (nodes.length === 0) return;

  const radius = 200;
  const angleStep = (2 * Math.PI) / nodes.length;

  nodes.forEach((node, i) => {
    const angle = i * angleStep - Math.PI / 2; // Start from top
    node.x = centerX + radius * Math.cos(angle) - node.width / 2;
    node.y = centerY + radius * Math.sin(angle) - node.height / 2;
  });
}
