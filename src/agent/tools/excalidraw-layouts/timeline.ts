import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { topologicalSort, syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

export const TimelineLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const centerY = 300;
    const centerX = 500;

    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el => 
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId && !shouldIgnoreInLayout(el)
    );

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    const maxNodeW = movableNodes.reduce((max, n) => Math.max(max, n.width), 0);
    const maxNodeH = movableNodes.reduce((max, n) => Math.max(max, n.height), 0);

    const spacingX = options?.spacing?.x ?? (maxNodeW + 80);
    const staggerY = options?.spacing?.y ?? (maxNodeH / 2 + 40);

    const arrows = clonedElements.filter(el => el.type === 'arrow' || el.type === 'line');
    const orderedIds = topologicalSort(movableNodes, arrows);

    const N = orderedIds.length;
    const maxPerLine = 6;
    const timelineRows: string[][] = [];
    for (let i = 0; i < N; i += maxPerLine) {
      timelineRows.push(orderedIds.slice(i, i + maxPerLine));
    }
    
    const R = timelineRows.length;
    const rowSpacingY = maxNodeH + staggerY * 2 + 60; // vertical spacing between timelines
    const startY = centerY - ((R - 1) * rowSpacingY) / 2;

    for (let r = 0; r < R; r++) {
      const row = timelineRows[r];
      const K = row.length;
      const rowStartX = centerX - ((K - 1) * spacingX) / 2;
      const rowCenterY = startY + r * rowSpacingY;

      for (let i = 0; i < K; i++) {
        const node = elementMap.get(row[i])!;
        node.x = rowStartX + i * spacingX - node.width / 2;
        const direction = i % 2 === 0 ? -1 : 1;
        node.y = rowCenterY + direction * staggerY - node.height / 2;
      }
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
