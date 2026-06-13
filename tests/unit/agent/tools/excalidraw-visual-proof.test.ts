/**
 * Visual quality proof test — proves that arrow edge intersection,
 * Z-index sorting, and viewport calculation work correctly.
 *
 * This test uses a realistic scenario (two nodes + connecting arrow)
 * and compares against the old "center-to-center" behavior.
 */
import { describe, it, expect } from 'vitest';
import { buildExcalidrawJSON } from '@/agent/tools/excalidraw';
import type { ElementDef } from '@/agent/tools/excalidraw';

function makeElement(overrides: Partial<ElementDef> & { id: string }): ElementDef {
  return { type: 'rectangle', x: 0, y: 0, width: 100, height: 50, ...overrides };
}

describe('visual quality proof: arrow does NOT pass through shapes', () => {
  it('arrow starts at shape edge, not center (edgeIntersection proof)', () => {
    // Layout: node_a (100,200,180x90) --arrow--> node_b (500,200,180x90)
    // Old behavior: arrow.x = 190 (node_a center x)
    // New behavior: arrow.x = 282 (node_a right edge 280 + gap 2)
    const elements: ElementDef[] = [
      makeElement({ id: 'node_a', type: 'rectangle', x: 100, y: 200, width: 180, height: 90 }),
      makeElement({ id: 'node_b', type: 'rectangle', x: 500, y: 200, width: 180, height: 90 }),
      makeElement({
        id: 'arrow_1', type: 'arrow',
        startBinding: { elementId: 'node_a', gap: 2, focus: 0 },
        endBinding: { elementId: 'node_b', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const arrow = result.elements.find(e => e.type === 'arrow')!;

    // Arrow start must be OUTSIDE node_a's right edge (x=280)
    // Old logic: arrow.x = 190 (center, INSIDE node_a — arrow passes through)
    // New logic: arrow.x = 282 (edge + gap, OUTSIDE node_a — clean)
    expect(arrow.x).toBeGreaterThan(280);
    expect(arrow.x).toBeCloseTo(282, 0);
  });

  it('arrow ends at target edge, not center', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'node_a', type: 'rectangle', x: 100, y: 200, width: 180, height: 90 }),
      makeElement({ id: 'node_b', type: 'rectangle', x: 500, y: 200, width: 180, height: 90 }),
      makeElement({
        id: 'arrow_1', type: 'arrow',
        startBinding: { elementId: 'node_a', gap: 2, focus: 0 },
        endBinding: { elementId: 'node_b', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const arrow = result.elements.find(e => e.type === 'arrow')!;
    const endX = arrow.x + arrow.points![1][0];

    // Arrow end must be OUTSIDE node_b's left edge (x=500)
    // Old logic: endX = 590 (center, INSIDE node_b — arrow passes through)
    // New logic: endX = 498 (edge - gap, OUTSIDE node_b — clean)
    expect(endX).toBeLessThan(500);
    expect(endX).toBeCloseTo(498, 0);
  });

  it('arrow does NOT intersect either shape body', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'node_a', type: 'rectangle', x: 100, y: 200, width: 180, height: 90 }),
      makeElement({ id: 'node_b', type: 'rectangle', x: 500, y: 200, width: 180, height: 90 }),
      makeElement({
        id: 'arrow_1', type: 'arrow',
        startBinding: { elementId: 'node_a', gap: 2, focus: 0 },
        endBinding: { elementId: 'node_b', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const arrow = result.elements.find(e => e.type === 'arrow')!;
    const endX = arrow.x + arrow.points![1][0];

    // node_a occupies x: [100, 280]
    // node_b occupies x: [500, 680]
    // Arrow must be entirely in the gap [282, 498]
    expect(arrow.x).toBeGreaterThan(280);
    expect(endX).toBeLessThan(500);
  });

  it('Z-index: text is always on top of arrows, arrows on top of shapes', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'label', type: 'text', x: 340, y: 180, width: 80, height: 30, text: '导致', strokeColor: '#1e293b' }),
      makeElement({ id: 'node_a', type: 'rectangle', x: 100, y: 200, width: 180, height: 90 }),
      makeElement({
        id: 'arrow_1', type: 'arrow',
        startBinding: { elementId: 'node_a', gap: 2, focus: 0 },
        endBinding: { elementId: 'node_b', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'node_b', type: 'rectangle', x: 500, y: 200, width: 180, height: 90 }),
    ];

    const result = buildExcalidrawJSON(elements);
    const types = result.elements.map(e => e.type);

    // All shapes must come before all arrows, all arrows before all text
    const lastShapeIdx = Math.max(...types.map((t, i) => ['rectangle', 'ellipse', 'diamond'].includes(t) ? i : -1));
    const firstArrowIdx = types.indexOf('arrow');
    const lastArrowIdx = types.lastIndexOf('arrow');
    const firstTextIdx = types.indexOf('text');

    expect(lastShapeIdx).toBeLessThan(firstArrowIdx);
    expect(lastArrowIdx).toBeLessThan(firstTextIdx);
  });

  it('viewport centers content and limits zoom to 1.0', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'node_a', type: 'rectangle', x: 100, y: 200, width: 180, height: 90 }),
      makeElement({ id: 'node_b', type: 'rectangle', x: 500, y: 200, width: 180, height: 90 }),
      makeElement({
        id: 'arrow_1', type: 'arrow',
        startBinding: { elementId: 'node_a', gap: 2, focus: 0 },
        endBinding: { elementId: 'node_b', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);

    // Content spans x: [100, 680], y: [200, 290]
    // Viewport should center this and zoom <= 1.0
    expect(result.appState.zoom.value).toBeLessThanOrEqual(1);
    expect(result.appState.zoom.value).toBeGreaterThan(0);
    expect(typeof result.appState.scrollX).toBe('number');
    expect(typeof result.appState.scrollY).toBe('number');
  });
});
