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

    // light primary: stroke '#0E7490', fill '#CFFAFE' (hand-drawn style)
    expect(rect.strokeColor).toBe('#0E7490');
    expect(rect.backgroundColor).toBe('#CFFAFE');
    expect(rect.fillStyle).toBe('solid');
    expect(rect.strokeWidth).toBe(2);

    // light emphasis: stroke '#C2410C', fill '#FFEDD5' (hand-drawn style)
    expect(ellipse.strokeColor).toBe('#C2410C');
    expect(ellipse.backgroundColor).toBe('#FFEDD5');

    expect(result.viewBackgroundColor).toBe('#FDF6E3'); // hand-drawn style beige background
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
    // dark success: stroke '#4ADE80', fill '#14532D' (hand-drawn style)
    expect(rect.strokeColor).toBe('#4ADE80');
    expect(rect.backgroundColor).toBe('#14532D');
    expect(result.viewBackgroundColor).toBe('#1E293B'); // hand-drawn style dark background
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
    // light connector: stroke '#374151', strokeWidth 2 (hand-drawn style)
    expect(arrow.strokeColor).toBe('#374151');
    expect(arrow.strokeWidth).toBe(2);
    expect(arrow.roughness).toBe(1);
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
    // light neutral: stroke '#374151', fill '#F3F4F6' (hand-drawn style)
    expect(rect.strokeColor).toBe('#374151');
    expect(rect.backgroundColor).toBe('#F3F4F6');
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
