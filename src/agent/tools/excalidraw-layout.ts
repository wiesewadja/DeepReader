import { log } from '../../utils/logger.js';
import { resolveOverlaps } from './excalidraw-geometry.js';
import { scoreLayout } from './excalidraw-layout-score.js';
import { LAYOUT_REGISTRY } from './excalidraw-layouts/index.js';
import type { ElementDef, DiagramLayoutType } from './excalidraw-types.js';

/**
 * Executes the chosen layout algorithm on elements, scores the result,
 * and falls back to the original resolved layout if the automatically
 * arranged layout is lower quality (higher overlap or too sparse).
 */
export function arrangeWithFallback(
  elements: ElementDef[],
  layout?: DiagramLayoutType,
): ElementDef[] {
  // Always get the overlap-resolved version of the original elements as base fallback
  const originalResolved = resolveOverlaps(elements);

  if (!layout || !LAYOUT_REGISTRY[layout]) {
    if (layout) {
      log('warn', `Requested layout type "${layout}" is invalid or not registered. Falling back to default.`);
    }
    return originalResolved;
  }

  try {
    log('info', `Applying semantic layout algorithm: "${layout}"`);
    
    // Arrange elements using the layout engine and resolve any remaining overlaps
    const arrangedRaw = LAYOUT_REGISTRY[layout].arrange(elements);
    const arranged = resolveOverlaps(arrangedRaw);

    const originalScore = scoreLayout(originalResolved);
    const arrangedScore = scoreLayout(arranged);

    const IMPROVEMENT_THRESHOLD = 0.9;      // Overlap area must be reduced by at least 10%
    const BOUNDING_AREA_MAX_RATIO = 3.0;    // Prevent layout from exploding in size/sparseness

    // If original overlap is 0, we only accept arranged if its overlap is also 0
    let overlapImproved = false;
    if (originalScore.totalOverlapArea === 0) {
      overlapImproved = arrangedScore.totalOverlapArea === 0;
    } else {
      overlapImproved = arrangedScore.totalOverlapArea <= originalScore.totalOverlapArea * IMPROVEMENT_THRESHOLD;
    }

    const boundingAreaOk = arrangedScore.boundingArea <= originalScore.boundingArea * BOUNDING_AREA_MAX_RATIO;

    if (overlapImproved && boundingAreaOk) {
      log('info', `Layout "${layout}" accepted. Overlap: ${arrangedScore.totalOverlapArea}px² (orig: ${originalScore.totalOverlapArea}px²), Bounding Area: ${arrangedScore.boundingArea} (orig: ${originalScore.boundingArea})`);
      return arranged;
    }

    log('info', `Layout "${layout}" rejected. Falling back. OverlapImproved: ${overlapImproved} (arranged: ${arrangedScore.totalOverlapArea}px², orig: ${originalScore.totalOverlapArea}px²), BoundingAreaOk: ${boundingAreaOk} (arranged: ${arrangedScore.boundingArea}, orig: ${originalScore.boundingArea})`);
    return originalResolved;
  } catch (err) {
    log('error', `Failed to apply layout "${layout}". Error: ${err instanceof Error ? err.message : String(err)}`);
    return originalResolved;
  }
}
