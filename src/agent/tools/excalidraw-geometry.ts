/**
 * Excalidraw geometry utilities.
 *
 * Separated from excalidraw.ts to keep the tool executor focused on
 * orchestration (validation, JSON building, file I/O) while geometry
 * calculations live in their own module.
 */

type Positionable = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  containerId?: string | null;
};

interface ExcalidrawElement extends Positionable {
  points?: [number, number][];
  containerId?: string | null;
}

/**
 * Calculate the intersection point from an element's center toward a target,
 * landing on the element boundary + gap. Handles rectangle, ellipse, diamond.
 */
export function edgeIntersection(
  el: Positionable,
  targetCx: number,
  targetCy: number,
  gap: number,
): [number, number] {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const dx = targetCx - cx;
  const dy = targetCy - cy;

  // Coincident centers — offset upward
  if (dx === 0 && dy === 0) {
    return [cx, cy - el.height / 2 - gap];
  }

  const hw = el.width / 2 + gap;
  const hh = el.height / 2 + gap;

  let s: number;

  if (el.type === 'ellipse') {
    // Ellipse: s = 1 / sqrt((dx/a)^2 + (dy/b)^2)
    const a = hw;
    const b = hh;
    s = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  } else if (el.type === 'diamond') {
    // Diamond: s = 1 / (|dx|/hw + |dy|/hh)
    s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    // Rectangle: find minimum positive t among four edges
    const halfW = el.width / 2 + gap;
    const halfH = el.height / 2 + gap;
    let tMin = Infinity;
    if (dx !== 0) {
      const tRight = halfW / Math.abs(dx);
      if (tRight > 0 && tRight < tMin) tMin = tRight;
    }
    if (dy !== 0) {
      const tBottom = halfH / Math.abs(dy);
      if (tBottom > 0 && tBottom < tMin) tMin = tBottom;
    }
    s = tMin;
  }

  return [cx + dx * s, cy + dy * s];
}

/**
 * Calculate viewport (scrollX, scrollY, zoom) to center content.
 */
export function calculateViewport(elements: ExcalidrawElement[]): {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
} {
  if (elements.length === 0) {
    return { scrollX: 0, scrollY: 0, zoom: { value: 1 } };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.type === 'arrow' || el.type === 'line') {
      if (el.points) {
        for (const [px, py] of el.points) {
          minX = Math.min(minX, el.x + px);
          minY = Math.min(minY, el.y + py);
          maxX = Math.max(maxX, el.x + px);
          maxY = Math.max(maxY, el.y + py);
        }
      }
    } else {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + Math.abs(el.width));
      maxY = Math.max(maxY, el.y + Math.abs(el.height));
    }
  }

  if (minX === Infinity) {
    return { scrollX: 0, scrollY: 0, zoom: { value: 1 } };
  }

  const PADDING = 80;
  const contentW = maxX - minX + PADDING * 2;
  const contentH = maxY - minY + PADDING * 2;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const VP_W = 800;
  const VP_H = 600;
  const zoomValue = Math.min(VP_W / contentW, VP_H / contentH, 1);

  const scrollX = centerX - VP_W / (2 * zoomValue);
  const scrollY = centerY - VP_H / (2 * zoomValue);

  return { scrollX, scrollY, zoom: { value: zoomValue } };
}

const MIN_GAP = 20;
const MAX_ITERATIONS = 10;
const ALIGN_THRESHOLD = 10;

/**
 * Deterministic collision resolution — push apart overlapping elements.
 *
 * Only moves shapes (rectangle/ellipse/diamond) and free texts (no containerId).
 * Arrows are not moved; their coordinates are auto-calculated from bindings later.
 * After pushing, restores row alignment for elements with similar y coordinates.
 */
export function resolveOverlaps<T extends Positionable>(elements: T[]): T[] {
  const result = elements.map(el => ({ ...el })) as T[];

  // Collect movable element indices
  const movableIdx: number[] = [];
  for (let i = 0; i < result.length; i++) {
    const el = result[i];
    if (['rectangle', 'ellipse', 'diamond'].includes(el.type)) {
      movableIdx.push(i);
    } else if (el.type === 'text' && !el.containerId) {
      movableIdx.push(i);
    }
  }

  if (movableIdx.length > 100) return result;

  // Record original y-coordinates per row cluster for alignment restoration
  const originalY = movableIdx.map(i => result[i].y);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let hadOverlap = false;

    for (let i = 0; i < movableIdx.length; i++) {
      for (let j = i + 1; j < movableIdx.length; j++) {
        const a = result[movableIdx[i]];
        const b = result[movableIdx[j]];

        const xOv = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const yOv = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

        if (xOv > 0 && yOv > 0) {
          hadOverlap = true;

          // Push along the axis with less penetration (tie → horizontal)
          if (xOv <= yOv) {
            const push = (xOv + MIN_GAP) / 2;
            if (a.x < b.x) {
              a.x -= push;
              b.x += push;
            } else {
              a.x += push;
              b.x -= push;
            }
          } else {
            const push = (yOv + MIN_GAP) / 2;
            if (a.y < b.y) {
              a.y -= push;
              b.y += push;
            } else {
              a.y += push;
              b.y -= push;
            }
          }
        }
      }
    }

    if (!hadOverlap) break;
  }

  // Restore row alignment: cluster elements by original y, re-align
  const visited = new Set<number>();
  for (let i = 0; i < movableIdx.length; i++) {
    if (visited.has(i)) continue;
    const row: number[] = [i];
    visited.add(i);

    for (let j = i + 1; j < movableIdx.length; j++) {
      if (visited.has(j)) continue;
      if (Math.abs(originalY[i] - originalY[j]) < ALIGN_THRESHOLD) {
        row.push(j);
        visited.add(j);
      }
    }

    if (row.length > 1) {
      const avgY = row.reduce((sum, idx) => sum + result[movableIdx[idx]].y, 0) / row.length;
      // Check if alignment would re-introduce overlaps
      const aligned = row.map(idx => {
        const el = result[movableIdx[idx]];
        return { idx, x: el.x, right: el.x + el.width, y: avgY, bottom: avgY + el.height };
      });
      let causesOverlap = false;
      for (let a = 0; a < aligned.length && !causesOverlap; a++) {
        for (let b = a + 1; b < aligned.length && !causesOverlap; b++) {
          const xOv = Math.min(aligned[a].right, aligned[b].right) - Math.max(aligned[a].x, aligned[b].x);
          const yOv = Math.min(aligned[a].bottom, aligned[b].bottom) - Math.max(aligned[a].y, aligned[b].y);
          if (xOv > 0 && yOv > 0) causesOverlap = true;
        }
      }
      if (!causesOverlap) {
        for (const { idx } of aligned) {
          result[movableIdx[idx]].y = avgY;
        }
      }
    }
  }

  return result;
}
