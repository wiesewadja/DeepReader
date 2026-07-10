import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

export const HierarchicalTreeLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const spacingX = options?.spacing?.x ?? 200;
    const spacingY = options?.spacing?.y ?? 160;
    const startY = 150;
    const centerX = 500;

    // Clone all elements to avoid mutating inputs
    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el => 
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId && !shouldIgnoreInLayout(el)
    );
    const arrows = clonedElements.filter(el => el.type === 'arrow' || el.type === 'line');

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    // Build adjacency lists
    const parentToChildren = new Map<string, string[]>();
    const childToParents = new Map<string, string[]>();
    for (const arrow of arrows) {
      const startId = arrow.startBinding?.elementId;
      const endId = arrow.endBinding?.elementId;
      if (startId && endId) {
        if (!parentToChildren.has(startId)) parentToChildren.set(startId, []);
        parentToChildren.get(startId)!.push(endId);

        if (!childToParents.has(endId)) childToParents.set(endId, []);
        childToParents.get(endId)!.push(startId);
      }
    }

    // Find roots (no incoming edges among movable nodes)
    const movableIds = new Set(movableNodes.map(n => n.id));
    let roots = movableNodes.filter(node => {
      const parents = childToParents.get(node.id) || [];
      // Only count parents that are actually in movableNodes
      const activeParents = parents.filter(pId => movableIds.has(pId));
      return activeParents.length === 0;
    });

    if (roots.length === 0 && movableNodes.length > 0) {
      roots = [movableNodes[0]];
    }

    // BFS to find levels
    const nodeLevels = new Map<string, number>();
    const visited = new Set<string>();
    const queue: { id: string; level: number }[] = [];

    for (const root of roots) {
      queue.push({ id: root.id, level: 0 });
      visited.add(root.id);
    }

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      nodeLevels.set(id, level);

      const children = parentToChildren.get(id) || [];
      for (const child of children) {
        if (movableIds.has(child) && !visited.has(child)) {
          visited.add(child);
          queue.push({ id: child, level: level + 1 });
        }
      }
    }

    // Handle orphaned nodes (not reachable from roots)
    for (const node of movableNodes) {
      if (!nodeLevels.has(node.id)) {
        nodeLevels.set(node.id, 0);
      }
    }

    // Group by levels
    const levelToNodes = new Map<number, string[]>();
    for (const [id, level] of nodeLevels.entries()) {
      if (!levelToNodes.has(level)) {
        levelToNodes.set(level, []);
      }
      levelToNodes.get(level)!.push(id);
    }

    // Position nodes level by level with dynamic layer heights
    const levelMaxHeights = new Map<number, number>();
    for (const [level, ids] of levelToNodes.entries()) {
      const maxH = ids.reduce((max, id) => {
        const n = elementMap.get(id);
        return n ? Math.max(max, n.height) : max;
      }, 0);
      levelMaxHeights.set(level, maxH);
    }

    const levelY = new Map<number, number>();
    let currentY = startY;
    for (let level = 0; level < levelToNodes.size; level++) {
      levelY.set(level, currentY);
      const currentMaxH = levelMaxHeights.get(level) ?? 0;
      const nextGapY = spacingY; // Use spacingY as minimum gap
      currentY += currentMaxH + nextGapY;
    }

    // Check if this is a backbone chain (at most one parent node per level)
    let isBackboneChain = true;
    for (const [_, ids] of levelToNodes.entries()) {
      const parentNodes = ids.filter(id => (parentToChildren.get(id) || []).length > 0);
      if (parentNodes.length > 1) {
        isBackboneChain = false;
        break;
      }
    }

    if (isBackboneChain) {
      // Find the horizontal spine line position (e.g., center-left spine)
      const spineX = centerX - 220;

      // Find the maximum spine node width across all levels to align the leaves correctly
      let maxSpineWidth = 160;
      for (const [_, ids] of levelToNodes.entries()) {
        const spineId = ids.find(id => (parentToChildren.get(id) || []).length > 0);
        if (spineId) {
          const n = elementMap.get(spineId);
          if (n && n.width > maxSpineWidth) maxSpineWidth = n.width;
        }
      }
      const leafStartX = spineX + maxSpineWidth / 2 + 80;

      for (const [level, ids] of levelToNodes.entries()) {
        const yPos = levelY.get(level)!;
        const layerMaxH = levelMaxHeights.get(level) ?? 0;

        // Find if there is a spine node at this level
        const spineId = ids.find(id => (parentToChildren.get(id) || []).length > 0);

        if (spineId) {
          const spineNode = elementMap.get(spineId)!;
          spineNode.x = spineX - spineNode.width / 2;
          spineNode.y = yPos + (layerMaxH - spineNode.height) / 2;

          // Align leaf nodes of this level to the right of the spine node
          const leafIds = ids.filter(id => id !== spineId);
          let currentX = leafStartX;
          for (const leafId of leafIds) {
            const leaf = elementMap.get(leafId)!;
            leaf.x = currentX;
            leaf.y = yPos + (layerMaxH - leaf.height) / 2;
            currentX += leaf.width + 60;
          }
        } else {
          // Last level (usually only leaf nodes of the last spine node)
          // Align them starting from the same indent as other level leaves
          let currentX = leafStartX;
          for (const id of ids) {
            const leaf = elementMap.get(id)!;
            leaf.x = currentX;
            leaf.y = yPos + (layerMaxH - leaf.height) / 2;
            currentX += leaf.width + 60;
          }
        }
      }
    } else {
      // Standard tree layout (centering each level)
      for (const [level, ids] of levelToNodes.entries()) {
        const K = ids.length;
        const yPos = levelY.get(level)!;
        const layerMaxH = levelMaxHeights.get(level) ?? 0;
        const levelNodes = ids.map(id => elementMap.get(id)!);
        
        const totalWidthOfNodes = levelNodes.reduce((sum, n) => sum + n.width, 0);
        const minSpacingX = 60; // minimum edge-to-edge horizontal gap
        // Default to spacingX if nodes are small, but prevent overlap for wide nodes
        const avgNodeW = K > 0 ? totalWidthOfNodes / K : 100;
        const gapX = Math.max(minSpacingX, spacingX - avgNodeW);
        const totalWidthWithGaps = totalWidthOfNodes + (K - 1) * gapX;

        let currentX = centerX - totalWidthWithGaps / 2;
        for (let j = 0; j < K; j++) {
          const node = levelNodes[j];
          node.x = currentX;
          node.y = yPos + (layerMaxH - node.height) / 2;
          currentX += node.width + gapX;
        }
      }
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
