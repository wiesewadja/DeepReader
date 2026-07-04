import type { ElementDef, LayoutEngine, LayoutOptions } from '../excalidraw-types.js';
import { syncBoundTextPositions, shouldIgnoreInLayout } from './utils.js';

export const RadialLayout: LayoutEngine = {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[] {
    const clonedElements = elements.map(el => ({ ...el }));
    const elementMap = new Map<string, ElementDef>(clonedElements.map(el => [el.id, el]));

    const movableNodes = clonedElements.filter(el => 
      el.type !== 'arrow' && el.type !== 'line' && !el.containerId && !shouldIgnoreInLayout(el)
    );

    if (movableNodes.length === 0) {
      return clonedElements;
    }

    const centerX = 500;
    const centerY = 300;

    // Find the center node (highest outgoing arrows, fallback to first node)
    let centerNode = movableNodes[0];
    const outgoingCount = new Map<string, number>();
    const arrows = clonedElements.filter(el => el.type === 'arrow' || el.type === 'line');
    for (const arrow of arrows) {
      const start = arrow.startBinding?.elementId;
      if (start) {
        outgoingCount.set(start, (outgoingCount.get(start) || 0) + 1);
      }
    }

    let maxOutgoing = -1;
    for (const node of movableNodes) {
      const count = outgoingCount.get(node.id) || 0;
      if (count > maxOutgoing) {
        maxOutgoing = count;
        centerNode = node;
      }
    }

    // Position center node at the exact center
    centerNode.x = centerX - centerNode.width / 2;
    centerNode.y = centerY - centerNode.height / 2;

    const surroundingNodes = movableNodes.filter(node => node.id !== centerNode.id);
    const S = surroundingNodes.length;

    if (S > 0) {
      const maxCenterDim = Math.max(centerNode.width, centerNode.height);
      const maxSatelliteW = surroundingNodes.reduce((max, n) => Math.max(max, n.width), 0);
      const maxSatelliteH = surroundingNodes.reduce((max, n) => Math.max(max, n.height), 0);
      const maxSatelliteDim = Math.max(maxSatelliteW, maxSatelliteH);

      const radiusFromCenter = maxCenterDim / 2 + maxSatelliteDim / 2 + 80;
      const radiusFromSatellites = S * (maxSatelliteDim + 40) / (2 * Math.PI);

      const radius = Math.max(260, radiusFromCenter, radiusFromSatellites);

      for (let i = 0; i < S; i++) {
        const node = surroundingNodes[i];
        const angle = (2 * Math.PI * i) / S;
        node.x = centerX + radius * Math.cos(angle) - node.width / 2;
        node.y = centerY + radius * Math.sin(angle) - node.height / 2;
      }
    }

    // Sync coordinates of bound text elements
    syncBoundTextPositions(clonedElements, elementMap);

    return clonedElements;
  }
};
