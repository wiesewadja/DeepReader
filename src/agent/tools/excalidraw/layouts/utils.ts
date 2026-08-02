import type { ElementDef } from '../excalidraw-types.js';
import { isContainer } from '../excalidraw-geometry.js';

/**
 * Perform a topological sort on movable nodes based on arrow connections.
 * Resolves ordering by original X coordinate to preserve LLM intent where possible.
 */
export function topologicalSort(movableNodes: ElementDef[], arrows: ElementDef[]): string[] {
  const movableIds = new Set(movableNodes.map(n => n.id));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of movableIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const arrow of arrows) {
    const start = arrow.startBinding?.elementId;
    const end = arrow.endBinding?.elementId;
    if (start && end && movableIds.has(start) && movableIds.has(end)) {
      adj.get(start)!.push(end);
      inDegree.set(end, inDegree.get(end)! + 1);
    }
  }

  const queue: string[] = [];
  for (const id of movableIds) {
    if (inDegree.get(id) === 0) {
      queue.push(id);
    }
  }

  const idToNode = new Map(movableNodes.map(n => [n.id, n]));
  queue.sort((a, b) => (idToNode.get(a)?.x ?? 0) - (idToNode.get(b)?.x ?? 0));

  const orderedIds: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    orderedIds.push(u);

    const neighbors = adj.get(u) || [];
    neighbors.sort((a, b) => (idToNode.get(a)?.x ?? 0) - (idToNode.get(b)?.x ?? 0));

    for (const v of neighbors) {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  const orderedSet = new Set(orderedIds);
  for (const id of movableIds) {
    if (!orderedSet.has(id)) {
      orderedIds.push(id);
    }
  }

  return orderedIds;
}

export function shouldIgnoreInLayout(el: ElementDef): boolean {
  const id = el.id.toLowerCase();
  const isLegacyIgnore = id.includes('title') || id.includes('subtitle') || id === 'header' || id.includes('legend');
  return (el.type === 'text' && !el.containerId) || isLegacyIgnore || isContainer(el);
}

/**
 * Synchronizes coordinates of all bound text elements to center them inside their container.
 */
export function syncBoundTextPositions(elements: ElementDef[], elementMap: Map<string, ElementDef>): void {
  for (const el of elements) {
    if (el.type === 'text' && el.containerId) {
      const container = elementMap.get(el.containerId);
      if (container) {
        el.x = container.x + (container.width - el.width) / 2;
        el.y = container.y + (container.height - el.height) / 2;
      }
    }
  }
}
