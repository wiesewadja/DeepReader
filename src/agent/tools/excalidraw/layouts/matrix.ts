import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

export const MatrixLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const columns = options?.columns ?? 2;
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

    const maxNodeW = movableNodes.reduce((max, n) => Math.max(max, n.width), 0);
    const maxNodeH = movableNodes.reduce((max, n) => Math.max(max, n.height), 0);

    const spacingX = options?.spacing?.x ?? (maxNodeW + 60);
    const spacingY = options?.spacing?.y ?? (maxNodeH + 60);

    const startX = centerX - ((cols - 1) * spacingX) / 2;
    const startY = centerY - ((rows - 1) * spacingY) / 2;

    // Draw dashed quadrant crosshairs centered at (centerX, centerY) to define the matrix zones
    if (N > 0) {
      const lineLenX = (cols - 1) * spacingX + maxNodeW + 80;
      const lineLenY = (rows - 1) * spacingY + maxNodeH + 80;

      const horizontalAxis: ElementDef = {
        id: 'matrix_axis_h',
        type: 'line',
        x: startX - maxNodeW / 2 - 40,
        y: centerY,
        width: 0,
        height: 0,
        points: [[0, 0], [lineLenX, 0]],
        strokeColor: '#cbd5e1',
        strokeWidth: 1,
        opacity: 50,
        strokeStyle: 'dashed',
      };

      const verticalAxis: ElementDef = {
        id: 'matrix_axis_v',
        type: 'line',
        x: centerX,
        y: startY - maxNodeH / 2 - 40,
        width: 0,
        height: 0,
        points: [[0, 0], [0, lineLenY]],
        strokeColor: '#cbd5e1',
        strokeWidth: 1,
        opacity: 50,
        strokeStyle: 'dashed',
      };

      clonedElements.push(horizontalAxis, verticalAxis);
    }

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
