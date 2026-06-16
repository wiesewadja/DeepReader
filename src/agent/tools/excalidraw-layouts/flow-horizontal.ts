import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { topologicalSort, syncBoundTextPositions } from './utils.js';

/** 单行最大宽度（px），超出则自动换行 */
const MAX_ROW_WIDTH = 1200;
/** 行间距（px） */
const ROW_SPACING = 200;

export const FlowHorizontalLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const spacingX = options?.spacing?.x ?? 250;
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

    // 按行拆分：每行节点总宽度不超过 MAX_ROW_WIDTH
    const N = orderedIds.length;
    const nodeWidths = orderedIds.map(id => elementMap.get(id)!.width);
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentRowWidth = 0;

    for (let i = 0; i < N; i++) {
      const nodeW = nodeWidths[i];
      const rowWidthWithNode = currentRow.length === 0
        ? nodeW
        : currentRowWidth + spacingX + nodeW;

      if (currentRow.length > 0 && rowWidthWithNode > MAX_ROW_WIDTH) {
        rows.push(currentRow);
        currentRow = [orderedIds[i]];
        currentRowWidth = nodeW;
      } else {
        currentRow.push(orderedIds[i]);
        currentRowWidth = rowWidthWithNode;
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    // 垂直居中各行：行数为 R 时，首行 y 为 centerY - (R-1)*ROW_SPACING/2
    const R = rows.length;
    const firstRowY = 300 - ((R - 1) * ROW_SPACING) / 2;

    for (let r = 0; r < R; r++) {
      const row = rows[r];
      const rowWidth = row.reduce((sum, id, i) => {
        const w = elementMap.get(id)!.width;
        return sum + (i > 0 ? spacingX : 0) + w;
      }, 0);
      const startX = centerX - rowWidth / 2;
      const rowY = firstRowY + r * ROW_SPACING;

      let cursorX = startX;
      for (const id of row) {
        const node = elementMap.get(id)!;
        node.x = cursorX;
        node.y = rowY - node.height / 2;
        cursorX += node.width + spacingX;
      }
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
