import type { ElementDef, LayoutScore } from './excalidraw-types.js';

/**
 * Calculates a quality score for the layout.
 * Lower scores indicate better layout quality.
 * Note: Arrow and line elements are explicitly ignored in scoring because their 
 * final coordinates are not computed until buildExcalidrawJSON is executed.
 */
export function scoreLayout(elements: ElementDef[]): LayoutScore {
  const shapes = elements.filter(e =>
    ['rectangle', 'ellipse', 'diamond'].includes(e.type) || (e.type === 'text' && !e.containerId)
  );

  if (shapes.length === 0) {
    return {
      totalOverlapArea: 0,
      overlapPairs: 0,
      boundingArea: 0,
      edgeCrossings: 0,
    };
  }

  let totalOverlapArea = 0;
  let overlapPairs = 0;

  // Calculate pairwise overlaps
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];

      const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const overlapArea = xOverlap * yOverlap;

      if (overlapArea > 0) {
        totalOverlapArea += overlapArea;
        overlapPairs++;
      }
    }
  }

  // Calculate bounding box area
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.width);
    maxY = Math.max(maxY, s.y + s.height);
  }

  const PADDING = 80;
  const boundingArea = (maxX - minX + PADDING * 2) * (maxY - minY + PADDING * 2);

  return {
    totalOverlapArea,
    overlapPairs,
    boundingArea: isFinite(boundingArea) ? boundingArea : 0,
    edgeCrossings: 0, // Phase 1: fixed at 0
  };
}
