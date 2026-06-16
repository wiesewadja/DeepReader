import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { topologicalSort, syncBoundTextPositions } from './utils.js';

export const FlowHorizontalLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const spacingX = options?.spacing?.x ?? 250;
    const centerY = 300;
    const centerX = 500;

    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el => 
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId
    );

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    const arrows = clonedElements.filter(el => el.type === 'arrow' || el.type === 'line');
    const orderedIds = topologicalSort(movableNodes, arrows);

    // Position horizontally centered
    const N = orderedIds.length;
    const startX = centerX - ((N - 1) * spacingX) / 2;

    for (let i = 0; i < N; i++) {
      const node = elementMap.get(orderedIds[i])!;
      node.x = startX + i * spacingX - node.width / 2;
      node.y = centerY - node.height / 2;
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
