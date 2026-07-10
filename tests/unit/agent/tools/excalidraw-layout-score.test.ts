import { describe, it, expect } from 'vitest';
import { scoreLayout } from '@/agent/tools/excalidraw/excalidraw-layout-score';
import type { ElementDef } from '@/agent/tools/excalidraw/excalidraw-types';

function makeElement(overrides: Partial<ElementDef> & { id: string }): ElementDef {
  return {
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    ...overrides,
  };
}

describe('scoreLayout', () => {
  it('should return zero overlap for empty elements list', () => {
    const score = scoreLayout([]);
    expect(score.totalOverlapArea).toBe(0);
    expect(score.overlapPairs).toBe(0);
    expect(score.boundingArea).toBe(0);
  });

  it('should calculate correct bounding area and zero overlaps for non-overlapping shapes', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'rect2', x: 200, y: 100, width: 100, height: 50 }),
    ];
    const score = scoreLayout(elements);
    expect(score.totalOverlapArea).toBe(0);
    expect(score.overlapPairs).toBe(0);
    // Bounding box: x in [0, 300], y in [0, 150] -> width 300, height 150 + 80px padding on each side (width + 160, height + 160)
    expect(score.boundingArea).toBe(460 * 310);
  });

  it('should calculate overlap correctly for overlapping shapes', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      // Overlaps rect1 horizontally by 50px (x=50 to 100) and vertically by 25px (y=25 to 50)
      makeElement({ id: 'rect2', x: 50, y: 25, width: 100, height: 50 }),
    ];
    const score = scoreLayout(elements);
    expect(score.overlapPairs).toBe(1);
    expect(score.totalOverlapArea).toBe(50 * 25);
  });

  it('should ignore arrow and line elements in overlap and bounding area calculation', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      // Overlaps rect1 but is an arrow, so it should be ignored
      makeElement({ id: 'arrow1', type: 'arrow', x: 10, y: 10, width: 50, height: 50 }),
      // Line, should be ignored
      makeElement({ id: 'line1', type: 'line', x: -100, y: -100, width: 50, height: 50 }),
    ];
    const score = scoreLayout(elements);
    expect(score.overlapPairs).toBe(0);
    expect(score.totalOverlapArea).toBe(0);
    // Bounding box should only contain rect1: width 100, height 50 (+ 160 padding)
    expect(score.boundingArea).toBe(260 * 210);
  });

  it('should ignore bound text elements in overlap and bounding area calculations', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      // Bound text inside rect1
      makeElement({ id: 'text1', type: 'text', containerId: 'rect1', x: 10, y: 10, width: 80, height: 30, text: 'test' }),
    ];
    const score = scoreLayout(elements);
    expect(score.overlapPairs).toBe(0);
    expect(score.totalOverlapArea).toBe(0);
    expect(score.boundingArea).toBe(260 * 210);
  });
});
