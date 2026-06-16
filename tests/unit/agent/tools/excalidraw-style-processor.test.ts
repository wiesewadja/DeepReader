import { describe, it, expect } from 'vitest';
import { applyOrganicScrollStyle } from '@/agent/tools/excalidraw-style-processor';
import { buildExcalidrawJSON } from '@/agent/tools/excalidraw';
import { generateConnectorPoints } from '@/agent/tools/excalidraw-organic-geometry';
import type { ElementDef } from '@/agent/tools/excalidraw-types';
import type { ToolContext } from '@/agent/tools/types';

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

describe('applyOrganicScrollStyle', () => {
  it('returns original elements and default background color when disabled', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'primary' }),
      makeElement({ id: 'arrow_1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, points: [[0, 0], [100, 100]] }),
    ];

    const result = applyOrganicScrollStyle({
      elements,
      layout: 'mind-map',
      theme: 'light',
      enabled: false,
    });

    expect(result.elements).toEqual(elements);
    expect(result.viewBackgroundColor).toBe('#ffffff');
  });

  it('updates shape attributes and colors based on semantic colors and light theme', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'primary' }),
      makeElement({ id: 'ellipse_1', type: 'ellipse', semanticColor: 'emphasis' }),
    ];

    const result = applyOrganicScrollStyle({
      elements,
      theme: 'light',
      enabled: true,
    });

    const rect = result.elements.find(e => e.id === 'rect_1')!;
    const ellipse = result.elements.find(e => e.id === 'ellipse_1')!;

    expect(rect.roughness).toBe(1);
    expect(rect.strokeWidth).toBe(2);
    expect(rect.fillStyle).toBe('solid');
    expect(rect.strokeColor).toBe('#1e3a5f'); // light primary stroke
    expect(rect.backgroundColor).toBe('#c7d9f9'); // light primary fill

    expect(ellipse.strokeColor).toBe('#b91c1c'); // light emphasis stroke
    expect(ellipse.backgroundColor).toBe('#f9c6c6'); // light emphasis fill

    expect(result.viewBackgroundColor).toBe('#fffce8'); // light paper background
  });

  it('updates shape colors based on dark theme', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'success' }),
    ];

    const result = applyOrganicScrollStyle({
      elements,
      theme: 'dark',
      enabled: true,
    });

    const rect = result.elements.find(e => e.id === 'rect_1')!;
    expect(rect.strokeColor).toBe('#86efac'); // dark success stroke
    expect(rect.backgroundColor).toBe('#14532d'); // dark success fill
    expect(result.viewBackgroundColor).toBe('#1f1d19'); // dark background
  });

  it('converts arrow/line to wobbly freedraw elements and constructs arrowheads', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'rect_2', type: 'rectangle', x: 300, y: 100, width: 100, height: 50 }),
      makeElement({
        id: 'arrow_1',
        type: 'arrow',
        startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
        endBinding: { elementId: 'rect_2', gap: 2, focus: 0 },
        semanticColor: 'warning',
      }),
    ];

    const result = applyOrganicScrollStyle({
      elements,
      layout: 'flow-horizontal',
      theme: 'light',
      enabled: true,
    });

    // Expecting rect_1, rect_2, arrow_1 shaft, and 2 wing elements (total 5 elements)
    expect(result.elements).toHaveLength(5);

    const shaft = result.elements.find(e => e.id === 'arrow_1')!;
    expect(shaft.type).toBe('freedraw');
    expect(shaft.strokeColor).toBe('#9a3412'); // warning color
    expect(shaft.customData?.isOrganicConnector).toBe(true);
    expect(shaft.customData?.strokeOptions).toBeDefined();

    // Verify relative coordinate points
    expect(shaft.points).toBeDefined();
    expect(shaft.points![0]).toEqual([0, 0]);
    expect(shaft.points!.length).toBeGreaterThanOrEqual(8);

    // Verify pressures array
    expect(shaft.customData?.pressures).toBeDefined();
    expect(shaft.customData?.pressures).toHaveLength(shaft.points!.length);

    // Verify wing elements
    const wing1 = result.elements.find(e => e.id === 'arrow_1_wing1')!;
    const wing2 = result.elements.find(e => e.id === 'arrow_1_wing2')!;

    expect(wing1.type).toBe('freedraw');
    expect(wing1.points![0]).toEqual([0, 0]);
    expect(wing1.groupIds).toEqual(shaft.groupIds);

    expect(wing2.type).toBe('freedraw');
    expect(wing2.points![0]).toEqual([0, 0]);
  });

  it('returns original arrow element (not freedraw) when disabled — regression guard', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'rect_2', type: 'rectangle', x: 300, y: 100, width: 100, height: 50 }),
      makeElement({
        id: 'arrow_1',
        type: 'arrow',
        startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
        endBinding: { elementId: 'rect_2', gap: 2, focus: 0 },
      }),
    ];

    const result = applyOrganicScrollStyle({
      elements,
      layout: 'flow-horizontal',
      theme: 'light',
      enabled: false,
    });

    // disabled 时 arrow 不应被转换；原始 elements 应原样返回
    expect(result.elements).toEqual(elements);
    const arrow = result.elements.find(e => e.id === 'arrow_1')!;
    expect(arrow.type).toBe('arrow');
  });

  it('handles arrows with only startBinding (degraded)', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
      makeElement({
        id: 'arrow_half',
        type: 'arrow',
        startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
        // 没有 endBinding — 走退化分支
        points: [[0, 0], [50, 50]],
      }),
    ];

    const result = applyOrganicScrollStyle({
      elements,
      layout: 'flow-horizontal',
      theme: 'light',
      enabled: true,
    });

    // 不应崩溃，shaft 应被转换为 freedraw
    const shaft = result.elements.find(e => e.id === 'arrow_half')!;
    expect(shaft).toBeDefined();
    expect(shaft.type).toBe('freedraw');
  });

  it('produces identical output across multiple invocations (no global state pollution)', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'rect_2', type: 'rectangle', x: 300, y: 100, width: 100, height: 50 }),
      makeElement({
        id: 'arrow_solo',
        type: 'arrow',
        startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
        endBinding: { elementId: 'rect_2', gap: 2, focus: 0 },
      }),
    ];

    const input = { elements, layout: 'flow-horizontal' as const, theme: 'light' as const, enabled: true };
    const result1 = applyOrganicScrollStyle(input);
    const result2 = applyOrganicScrollStyle(input);

    // 关键回归：同一输入两次调用必须结果一致（之前 arrowGroupSeed 全局状态会污染）
    expect(result1.elements).toEqual(result2.elements);
    expect(result1.viewBackgroundColor).toBe(result2.viewBackgroundColor);

    // groupIds 也必须稳定（来自 el.id 的确定性 fallback）
    const shaft1 = result1.elements.find(e => e.id === 'arrow_solo')!;
    const shaft2 = result2.elements.find(e => e.id === 'arrow_solo')!;
    expect(shaft1.groupIds).toEqual(shaft2.groupIds);
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

describe('buildExcalidrawJSON with style processor integration', () => {
  it('correctly maps freedraw elements and sorts them below text but above shapes', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'rect_2', type: 'rectangle', x: 300, y: 100, width: 100, height: 50 }),
      makeElement({
        id: 'arrow_1',
        type: 'arrow',
        startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
        endBinding: { elementId: 'rect_2', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'text_1', type: 'text', text: 'Hello', x: 200, y: 100, width: 80, height: 30 }),
    ];

    const mockContext: ToolContext = {
      vault: {
        app: {
          vault: {
            getConfig: (key: string) => (key === 'theme' ? 'dark' : undefined)
          }
        } as any,
        plugin: {
          settings: {
            enableOrganicScrollStyle: true
          }
        } as any
      } as any,
      book: {} as any,
    };

    const file = buildExcalidrawJSON(elements, 'flow-horizontal', mockContext);

    expect(file.appState.viewBackgroundColor).toBe('#1f1d19'); // Dark background
    
    // Total elements in output:
    // rect_1, rect_2, text_1 background, text_1, arrow_1 shaft, arrow_1 wing1, arrow_1 wing2 (total 7 elements)
    expect(file.elements).toHaveLength(7);

    const types = file.elements.map(e => e.type);
    
    // Z-Index verification: rectangle < freedraw < text
    const lastRectIdx = Math.max(...types.map((t, i) => t === 'rectangle' ? i : -1));
    const firstFreedrawIdx = types.indexOf('freedraw');
    const lastFreedrawIdx = types.lastIndexOf('freedraw');
    const firstTextIdx = types.indexOf('text');

    expect(lastRectIdx).toBeLessThan(firstFreedrawIdx);
    expect(lastFreedrawIdx).toBeLessThan(firstTextIdx);

    // Verify that customData and pressures were preserved in the output ExcalidrawElement
    const excalidrawShaft = file.elements.find(e => e.id === 'arrow_1')!;
    expect(excalidrawShaft.type).toBe('freedraw');
    expect(excalidrawShaft.customData).toBeDefined();
    expect(excalidrawShaft.customData?.isOrganicConnector).toBe(true);
    expect(excalidrawShaft.pressures).toBeDefined();
    expect(excalidrawShaft.pressures!.length).toBeGreaterThan(0);

    // Verify text background was created and bound to text
    const textBg = file.elements.find(e => e.id === 'text_1_bg')!;
    expect(textBg.type).toBe('rectangle');
    expect(textBg.backgroundColor).toBe('#1a1815'); // dark neutral textBg
    const excalidrawText = file.elements.find(e => e.id === 'text_1')!;
    expect(excalidrawText.containerId).toBe('text_1_bg');

    // Verify roundness on shape elements in final output
    const excalidrawRect = file.elements.find(e => e.id === 'rect_1')!;
    expect(excalidrawRect.roundness).toEqual({ type: 3 });
  });
});
