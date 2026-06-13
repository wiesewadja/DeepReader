/**
 * Excalidraw geometry utilities.
 *
 * Separated from excalidraw.ts to keep the tool executor focused on
 * orchestration (validation, JSON building, file I/O) while geometry
 * calculations live in their own module.
 */

interface ElementDef {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExcalidrawElement extends ElementDef {
  points?: [number, number][];
}

/**
 * Calculate the intersection point from an element's center toward a target,
 * landing on the element boundary + gap. Handles rectangle, ellipse, diamond.
 */
export function edgeIntersection(
  el: ElementDef,
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
