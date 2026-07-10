import { describe, it, expect } from 'vitest';
import { applyDiagramStyle } from '@/agent/tools/excalidraw/excalidraw-style-processor';
import { generateConnectorPoints } from '@/agent/tools/excalidraw/excalidraw-organic-geometry';
import type { ElementDef } from '@/agent/tools/excalidraw/excalidraw-types';

function makeElement(overrides: Partial<ElementDef> & { id: string }): ElementDef {
  return {
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    ...overrides,
  };
}

describe('applyDiagramStyle', () => {
  it('applies semantic colors and background for light theme', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'primary' }),
      makeElement({ id: 'ellipse_1', type: 'ellipse', semanticColor: 'emphasis' }),
    ];

    const result = applyDiagramStyle({
      elements,
      layout: 'mind-map',
      theme: 'light',
    });

    const rect = result.elements.find(e => e.id === 'rect_1')!;
    const ellipse = result.elements.find(e => e.id === 'ellipse_1')!;

    // light primary: stroke '#3b82f6', fill '#dbeafe'
    expect(rect.strokeColor).toBe('#3b82f6');
    expect(rect.backgroundColor).toBe('#dbeafe');
    expect(rect.fillStyle).toBe('solid');
    expect(rect.strokeWidth).toBe(1.5);

    // light emphasis: stroke '#ec4899', fill '#fce7f3'
    expect(ellipse.strokeColor).toBe('#ec4899');
    expect(ellipse.backgroundColor).toBe('#fce7f3');

    expect(result.viewBackgroundColor).toBe('#f8fafc'); // light background
  });

  it('applies dark theme colors', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'success' }),
    ];

    const result = applyDiagramStyle({
      elements,
      theme: 'dark',
    });

    const rect = result.elements.find(e => e.id === 'rect_1')!;
    // dark success: stroke '#34d399', fill '#064e3b'
    expect(rect.strokeColor).toBe('#34d399');
    expect(rect.backgroundColor).toBe('#064e3b');
    expect(result.viewBackgroundColor).toBe('#0f172a'); // dark background
  });

  it('styles connectors with unified color', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'primary' }),
      makeElement({ id: 'rect_2', type: 'rectangle', semanticColor: 'primary' }),
      makeElement({
        id: 'arrow_1',
        type: 'arrow',
        startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
        endBinding: { elementId: 'rect_2', gap: 2, focus: 0 },
        semanticColor: 'warning',
      }),
    ];

    const result = applyDiagramStyle({
      elements,
      layout: 'flow-horizontal',
      theme: 'light',
    });

    const arrow = result.elements.find(e => e.id === 'arrow_1')!;
    // light connector: stroke '#94a3b8', strokeWidth 1.5
    expect(arrow.strokeColor).toBe('#94a3b8');
    expect(arrow.strokeWidth).toBe(1.5);
    expect(arrow.roughness).toBe(0);
    expect(arrow.opacity).toBe(90);
  });

  it('preserves text elements without styling', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'text_1', type: 'text', text: 'Hello', width: 80, height: 30 }),
    ];

    const result = applyDiagramStyle({
      elements,
      theme: 'light',
    });

    const text = result.elements.find(e => e.id === 'text_1')!;
    expect(text.type).toBe('text');
    // text should not have strokeColor/backgroundColor added
    expect(text.strokeColor).toBeUndefined();
    expect(text.backgroundColor).toBeUndefined();
  });

  it('uses neutral style when semanticColor is missing', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle' }),
    ];

    const result = applyDiagramStyle({
      elements,
      theme: 'light',
    });

    const rect = result.elements.find(e => e.id === 'rect_1')!;
    // light neutral: stroke '#94a3b8', fill '#f1f5f9'
    expect(rect.strokeColor).toBe('#94a3b8');
    expect(rect.backgroundColor).toBe('#f1f5f9');
  });
});

describe('generateConnectorPoints', () => {
  it('returns two points when start equals end (degenerate case)', () => {
    const points = generateConnectorPoints([100, 100], [100, 100], 'mind-map');
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual([100, 100]);
    expect(points[1]).toEqual([100, 100]);
  });
});
