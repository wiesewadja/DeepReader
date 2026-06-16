import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

export const MatrixLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const columns = options?.columns ?? 2;
    const spacingX = options?.spacing?.x ?? 280;
    const spacingY = options?.spacing?.y ?? 200;
    const centerX = 500;
    const centerY = 300;

    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el => 
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId && !shouldIgnoreInLayout(el)
    );

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    const N = movableNodes.length;
    const cols = Math.min(columns, N);
    const rows = Math.ceil(N / cols);

    const startX = centerX - ((cols - 1) * spacingX) / 2;
    const startY = centerY - ((rows - 1) * spacingY) / 2;

    for (let i = 0; i < N; i++) {
      const node = movableNodes[i];
      const c = i % cols;
      const r = Math.floor(i / cols);

      node.x = startX + c * spacingX - node.width / 2;
      node.y = startY + r * spacingY - node.height / 2;
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
