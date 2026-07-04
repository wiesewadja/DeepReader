import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { topologicalSort, syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

/** 单行最大宽度（px），超出则自动换行 */
const MAX_ROW_WIDTH = 1000;

export const FlowHorizontalLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const gapX = options?.spacing?.x ?? 60;
    const rowSpacing = options?.spacing?.y ?? 160;
    const centerX = 500;

    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el =>
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId && !shouldIgnoreInLayout(el)
    );

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    const arrows = clonedElements.filter(el => el.type === 'arrow' || el.type === 'line');
    const orderedIds = topologicalSort(movableNodes, arrows);

    // 按行拆分：每行节点总宽度不超过 MAX_ROW_WIDTH
    const N = orderedIds.length;
    const nodeWidths = orderedIds.map(id => elementMap.get(id)!.width);
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentRowWidth = 0;

    for (let i = 0; i < N; i++) {
      const nodeW = nodeWidths[i];
      const addedWidth = currentRow.length === 0
        ? nodeW
        : gapX + nodeW;

      if (currentRow.length > 0 && currentRowWidth + addedWidth > MAX_ROW_WIDTH) {
        rows.push(currentRow);
        currentRow = [orderedIds[i]];
        currentRowWidth = nodeW;
      } else {
        currentRow.push(orderedIds[i]);
        currentRowWidth += addedWidth;
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    // 垂直对齐各行
    const R = rows.length;
    const firstRowY = 300 - ((R - 1) * rowSpacing) / 2;

    for (let r = 0; r < R; r++) {
      const row = rows[r];
      const totalRowWidth = row.reduce((sum, id, i) => {
        const w = elementMap.get(id)!.width;
        return sum + (i > 0 ? gapX : 0) + w;
      }, 0);
      const startX = centerX - totalRowWidth / 2;
      const rowY = firstRowY + r * rowSpacing;

      if (r % 2 === 0) {
        // Even rows: Flow left-to-right
        let cursorX = startX;
        for (let i = 0; i < row.length; i++) {
          const node = elementMap.get(row[i])!;
          node.x = cursorX;
          node.y = rowY - node.height / 2;
          cursorX += node.width + gapX;
        }
      } else {
        // Odd rows: Flow right-to-left (S-curve / Snake flow)
        let cursorX = startX + totalRowWidth;
        for (let i = 0; i < row.length; i++) {
          const node = elementMap.get(row[i])!;
          cursorX -= node.width;
          node.x = cursorX;
          node.y = rowY - node.height / 2;
          cursorX -= gapX;
        }
      }
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
