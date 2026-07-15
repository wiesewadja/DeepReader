import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildExcalidrawJSON,
  detectOverlaps,
  detectTextOverlaps,
  detectConnectorNodeOverlaps,
  validateSemantics,
  edgeIntersection,
  calculateViewport,
  resolveOverlaps,
} from '@/agent/tools/excalidraw/excalidraw';
import { excalidrawTool } from '@/agent/tools/excalidraw/excalidraw';
import { writeExcalidrawJson } from '@/agent/tools/excalidraw/excalidraw';
import type { ElementDef } from '@/agent/tools/excalidraw/excalidraw';
import type { ToolContext } from '@/agent/tools/types';

function makeMockCtx(): ToolContext {
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const exists = vi.fn().mockResolvedValue(true);
  return {
    vault: {
      app: {
        vault: {
          adapter: { mkdir, write, exists },
        },
      },
      plugin: {} as any,
    },
    book: {} as any,
  } as unknown as ToolContext;
}

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

describe('buildExcalidrawJSON', () => {
  it('builds valid excalidraw file structure', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 'text_1', type: 'text', x: 50, y: 25, width: 100, height: 50, text: 'Hello', containerId: 'rect_1' }),
    ];

    const result = buildExcalidrawJSON(elements);

    expect(result.type).toBe('excalidraw');
    expect(result.version).toBe(2);
    expect(result.source).toBe('https://excalidraw.com');
    expect(result.elements).toHaveLength(2);
    expect(result.appState.viewBackgroundColor).toBe('#FDF6E3'); // hand-drawn style background
    expect(result.files).toEqual({});
  });

  it('converts text elements with correct defaults', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: '测试文本', fontSize: 20 }),
    ];

    const result = buildExcalidrawJSON(elements);
    const el = result.elements.find(e => e.id === 't1')!;

    expect(el.text).toBe('测试文本');
    expect(el.originalText).toBe('测试文本');
    expect(el.fontSize).toBe(20);
    expect(el.fontFamily).toBe(5);
    expect(el.textAlign).toBe('center');
    expect(el.verticalAlign).toBe('middle');
    expect(el.containerId).toBe('t1_bg'); // it got wrapped by bg!
  });

  it('钳制 text fontSize 到四档 S16/M20/L28/XL36', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'big', type: 'text', text: '大标题', fontSize: 30, strokeColor: '#1e293b' }),
      makeElement({ id: 'ok', type: 'text', text: '正常', fontSize: 18, strokeColor: '#1e293b' }),
      makeElement({ id: 'xl', type: 'text', text: '超大', fontSize: 40, strokeColor: '#1e293b' }),
    ];

    const result = buildExcalidrawJSON(elements);
    const bigEl = result.elements.find(e => e.id === 'big')!;
    const okEl = result.elements.find(e => e.id === 'ok')!;
    const xlEl = result.elements.find(e => e.id === 'xl')!;

    // 向下取档：30→28(L)，18→16(S)，40→36(XL)
    expect(bigEl.fontSize).toBe(28);
    expect(okEl.fontSize).toBe(16);
    expect(xlEl.fontSize).toBe(36);
  });

  it('converts arrow elements with bindings', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a1', type: 'arrow', points: [[0, 0], [100, 0]],
        startBinding: { elementId: 'n1', gap: 5, focus: 0 },
        endBinding: { elementId: 'n2', gap: 5, focus: 0 },
        endArrowHead: 'arrow',
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const el = result.elements[0];

    expect(el.type).toBe('arrow');
    expect(el.points).toEqual([[0, 0], [100, 0]]);
    expect(el.startBinding?.elementId).toBe('n1');
    expect(el.endBinding?.elementId).toBe('n2');
    expect(el.endArrowhead).toBe('arrow');
  });

  it('assigns unique seeds', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle' }),
      makeElement({ id: 'b', type: 'ellipse' }),
      makeElement({ id: 'c', type: 'diamond' }),
    ];

    const result = buildExcalidrawJSON(elements);
    const seeds = result.elements.map(e => e.seed);

    // Seeds should be unique positive integers
    expect(seeds.length).toBe(3); // 3 elements
    const seedSet = new Set(seeds);
    expect(seedSet.size).toBe(3);
    seeds.forEach(s => expect(s).toBeGreaterThan(0));
  });

  it('converts line elements with width/height set to 0', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'l1', type: 'line', width: 100, height: 50, points: [[0, 0], [200, 0]] }),
    ];

    const result = buildExcalidrawJSON(elements);
    const el = result.elements[0];

    expect(el.type).toBe('line');
    expect(el.points).toEqual([[0, 0], [200, 0]]);
    expect(el.width).toBe(0);
    expect(el.height).toBe(0);
    expect(el.startArrowhead).toBeUndefined();
    expect(el.endArrowhead).toBeUndefined();
  });
});

describe('detectOverlaps', () => {
  it('detects overlapping rectangles', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 'b', type: 'rectangle', x: 150, y: 0, width: 200, height: 100 }),
    ];

    const warnings = detectOverlaps(elements);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"a"');
    expect(warnings[0]).toContain('"b"');
    expect(warnings[0]).toContain('重叠');
  });

  it('ignores small overlaps below threshold', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 'b', type: 'rectangle', x: 195, y: 95, width: 10, height: 10 }),
    ];

    // Overlap area = 5 * 5 = 25 < 100
    const warnings = detectOverlaps(elements);
    expect(warnings).toHaveLength(0);
  });

  it('does not flag non-overlapping elements', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'b', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
    ];

    const warnings = detectOverlaps(elements);
    expect(warnings).toHaveLength(0);
  });

  it('ignores text and arrow elements for overlap detection', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 't', type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'overlap' }),
      makeElement({ id: 'ar', type: 'arrow', x: 0, y: 0, width: 0, height: 0, points: [[0, 0]] }),
    ];

    const warnings = detectOverlaps(elements);
    expect(warnings).toHaveLength(0);
  });
});

describe('validateSemantics', () => {
  it('warns about text without strokeColor', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: 'no color' }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('strokeColor'))).toBe(true);
  });

  it('does not warn about text with containerId', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: 'in container', containerId: 'r1' }),
      makeElement({ id: 'r1', type: 'rectangle', boundElements: [{ id: 't1', type: 'text' }] }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('strokeColor'))).toBe(false);
  });

  it('warns about invalid containerId reference', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: 'orphan', containerId: 'nonexistent' }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('nonexistent'))).toBe(true);
  });

  it('warns about missing bidirectional binding', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: 'bound', containerId: 'r1', strokeColor: '#000' }),
      makeElement({ id: 'r1', type: 'rectangle' }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('boundElements'))).toBe(true);
  });

  it('warns about arrow with missing startBinding target', () => {
    const elements: ElementDef[] = [
      makeElement({
        id: 'ar1', type: 'arrow', points: [[0, 0]],
        startBinding: { elementId: 'missing', gap: 5, focus: 0 },
      }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('startBinding'))).toBe(true);
  });

  it('warns about arrow with missing endBinding target', () => {
    const elements: ElementDef[] = [
      makeElement({
        id: 'ar1', type: 'arrow', points: [[0, 0]],
        endBinding: { elementId: 'missing', gap: 5, focus: 0 },
      }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('endBinding'))).toBe(true);
  });

  it('warns when container text ratio exceeds 30%', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: 'a', containerId: 'r1', strokeColor: '#000' }),
      makeElement({ id: 't2', type: 'text', text: 'b', containerId: 'r2', strokeColor: '#000' }),
      makeElement({ id: 't3', type: 'text', text: 'c', containerId: 'r3', strokeColor: '#000' }),
      makeElement({ id: 't4', type: 'text', text: 'd', containerId: 'r4', strokeColor: '#000' }),
      makeElement({ id: 'r1', type: 'rectangle', boundElements: [{ id: 't1', type: 'text' }] }),
      makeElement({ id: 'r2', type: 'rectangle', boundElements: [{ id: 't2', type: 'text' }] }),
      makeElement({ id: 'r3', type: 'rectangle', boundElements: [{ id: 't3', type: 'text' }] }),
      makeElement({ id: 'r4', type: 'rectangle', boundElements: [{ id: 't4', type: 'text' }] }),
    ];

    const warnings = validateSemantics(elements);
    expect(warnings.some(w => w.includes('30%'))).toBe(true);
  });
});

describe('excalidrawTool.execute', () => {
  let mockCtx: ToolContext;

  beforeEach(() => {
    mockCtx = makeMockCtx();
  });

  it('writes file and returns embed on success', async () => {
    const result = await excalidrawTool.execute(
      {
        filename: 'test-diagram',
        elements: [
          makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
        ],
      },
      mockCtx,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.filepath).toBe('Excalidraw/test-diagram.excalidraw.md');
    expect(parsed.embed).toBe('![[Excalidraw/test-diagram.excalidraw.md]]');

    expect(mockCtx.vault.app.vault.adapter.write).toHaveBeenCalledWith(
      'Excalidraw/test-diagram.excalidraw.md',
      expect.any(String),
    );
  });

  it('creates Excalidraw directory if not exists', async () => {
    (mockCtx.vault.app.vault.adapter.exists as any).mockResolvedValue(false);

    await excalidrawTool.execute(
      {
        filename: 'new-diagram',
        elements: [makeElement({ id: 'r1', type: 'rectangle' })],
      },
      mockCtx,
    );

    expect(mockCtx.vault.app.vault.adapter.mkdir).toHaveBeenCalledWith('Excalidraw');
  });

  it('returns error for missing filename', async () => {
    const result = await excalidrawTool.execute(
      { elements: [makeElement({ id: 'r1', type: 'rectangle' })] } as any,
      mockCtx,
    );

    expect(result).toContain('错误');
  });

  it('returns error for empty elements', async () => {
    const result = await excalidrawTool.execute(
      { filename: 'empty', elements: [] },
      mockCtx,
    );

    expect(result).toContain('错误');
  });

  it('returns warnings when overlaps detected', async () => {
    const geom = await import('@/agent/tools/excalidraw/excalidraw-geometry');
    const spy = vi.spyOn(geom, 'resolveOverlaps').mockImplementation((els) => els as any);

    const result = await excalidrawTool.execute(
      {
        filename: 'overlapping',
        elements: [
          makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
          makeElement({ id: 'b', type: 'rectangle', x: 50, y: 0, width: 200, height: 100 }),
        ],
      },
      mockCtx,
    );

    spy.mockRestore();

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.suggestion).toContain('warnings');
  });

  it('rejects filename with path traversal', async () => {
    const result = await excalidrawTool.execute(
      { filename: '../../../etc/passwd', elements: [makeElement({ id: 'r1', type: 'rectangle' })] },
      mockCtx,
    );
    expect(result).toContain('错误');
  });

  it('rejects filename with forward slash', async () => {
    const result = await excalidrawTool.execute(
      { filename: 'sub/dir', elements: [makeElement({ id: 'r1', type: 'rectangle' })] },
      mockCtx,
    );
    expect(result).toContain('错误');
  });

  it('rejects filename with full-width colon', async () => {
    const result = await excalidrawTool.execute(
      { filename: '思维导图：测试', elements: [makeElement({ id: 'r1', type: 'rectangle' })] },
      mockCtx,
    );
    expect(result).toContain('错误');
  });
});

describe('edgeIntersection', () => {
  it('computes rectangle right edge', () => {
    const el = makeElement({ id: 'src', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const [sx, sy] = edgeIntersection(el, 200, 25, 2);
    // Should be at right edge + gap: x = 102, y = 25
    expect(sx).toBeCloseTo(102, 1);
    expect(sy).toBeCloseTo(25, 1);
  });

  it('computes rectangle bottom edge', () => {
    const el = makeElement({ id: 'src', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const [sx, sy] = edgeIntersection(el, 50, 200, 2);
    expect(sx).toBeCloseTo(50, 1);
    expect(sy).toBeCloseTo(52, 1);
  });

  it('computes ellipse edge', () => {
    const el = makeElement({ id: 'src', type: 'ellipse', x: 0, y: 0, width: 100, height: 50 });
    // Diagonal direction — ellipse should differ from rectangle
    const [sx, sy] = edgeIntersection(el, 200, 100, 2);
    // On a diagonal, ellipse boundary is inside rectangle boundary
    const [rx] = edgeIntersection(makeElement({ id: 'r', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }), 200, 100, 2);
    expect(sx).toBeLessThan(rx);
  });

  it('computes diamond edge', () => {
    const el = makeElement({ id: 'src', type: 'diamond', x: 0, y: 0, width: 100, height: 50 });
    const [sx, sy] = edgeIntersection(el, 200, 100, 2);
    expect(sx).toBeGreaterThan(50);
    expect(sy).toBeGreaterThan(25);
  });

  it('handles coincident centers', () => {
    const el = makeElement({ id: 'src', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const [sx, sy] = edgeIntersection(el, 50, 25, 2);
    // Should offset upward
    expect(sy).toBeLessThan(0);
  });

  it('handles pure vertical direction', () => {
    const el = makeElement({ id: 'src', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const [sx, sy] = edgeIntersection(el, 50, 200, 2);
    expect(sx).toBe(50);
    expect(sy).toBeCloseTo(52, 1);
  });
});

describe('arrow edge intersection in buildExcalidrawJSON', () => {
  it('calculates arrow from shape edges when both bindings resolve', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'src', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'dst', type: 'rectangle', x: 300, y: 0, width: 100, height: 50 }),
      makeElement({
        id: 'arr', type: 'arrow',
        startBinding: { elementId: 'src', gap: 2, focus: 0 },
        endBinding: { elementId: 'dst', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const arrow = result.elements.find(e => e.type === 'arrow')!;

    // Arrow x should be at src right edge + gap (102), not center (50)
    expect(arrow.x).toBeCloseTo(102, 0);
    // Arrow end point x: dst left edge - gap (298), so relative: 298 - 102 = 196
    expect(arrow.points![1][0]).toBeCloseTo(196, 0);
    expect(arrow.points![1][1]).toBeCloseTo(0, 0);
  });
});

describe('z-index sorting', () => {
  it('sorts elements with shapes first, arrows middle, text last', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', text: 'label' }),
      makeElement({ id: 'a1', type: 'arrow', points: [[0, 0], [100, 0]],
        startBinding: { elementId: 'r1', gap: 2, focus: 0 },
        endBinding: { elementId: 'r2', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'r2', type: 'rectangle', x: 300, y: 0, width: 100, height: 50 }),
    ];

    const result = buildExcalidrawJSON(elements);
    const types = result.elements.map(e => e.type);

    const rectIdx = types.indexOf('rectangle');
    const arrowIdx = types.indexOf('arrow');
    const textIdx = types.indexOf('text');

    expect(rectIdx).toBeLessThan(arrowIdx);
    expect(arrowIdx).toBeLessThan(textIdx);
  });
});

describe('calculateViewport', () => {
  it('calculates viewport for single element', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 100 }),
    ];
    const result = buildExcalidrawJSON(elements);

    expect(result.appState.scrollX).toBeDefined();
    expect(result.appState.scrollY).toBeDefined();
    expect((result.appState.zoom as any).value).toBeLessThanOrEqual(1);
  });

  it('zooms out for large content', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 2000, height: 1500 }),
    ];
    const result = buildExcalidrawJSON(elements);

    expect((result.appState.zoom as any).value).toBeLessThan(1);
  });

  it('never zooms past 1.0', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 50, height: 30 }),
    ];
    const result = buildExcalidrawJSON(elements);

    expect((result.appState.zoom as any).value).toBe(1);
  });
});

describe('detectTextOverlaps', () => {
  it('detects free text overlapping with shape', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 't1', type: 'text', x: 10, y: 10, width: 180, height: 80, text: 'overlap' }),
    ];

    const warnings = detectTextOverlaps(elements);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('t1');
    expect(warnings[0]).toContain('r1');
  });

  it('ignores container-bound text', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 't1', type: 'text', x: 10, y: 10, width: 180, height: 80, text: 'inside', containerId: 'r1' }),
    ];

    const warnings = detectTextOverlaps(elements);
    expect(warnings).toHaveLength(0);
  });

  it('detects free text overlapping with another free text', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 't1', type: 'text', x: 0, y: 0, width: 200, height: 50, text: 'text1' }),
      makeElement({ id: 't2', type: 'text', x: 10, y: 10, width: 200, height: 50, text: 'text2' }),
    ];

    const warnings = detectTextOverlaps(elements);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('resolveOverlaps', () => {
  it('pushes apart two overlapping rectangles', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 'b', type: 'rectangle', x: 100, y: 0, width: 200, height: 100 }),
    ];

    const resolved = resolveOverlaps(elements);

    // After resolution, elements should not overlap
    const a = resolved.find(e => e.id === 'a')!;
    const b = resolved.find(e => e.id === 'b')!;
    const xOv = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const yOv = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    expect(xOv * yOv).toBe(0);
  });

  it('pushes apart overlapping free texts but not bound texts', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 't1', type: 'text', x: 10, y: 10, width: 100, height: 50, text: 'free' }),
      makeElement({ id: 't2', type: 'text', x: 10, y: 10, width: 100, height: 50, text: 'bound', containerId: 'r1' }),
    ];

    const resolved = resolveOverlaps(elements);

    const boundText = resolved.find(e => e.id === 't2')!;
    expect(boundText.x).toBe(10);
    expect(boundText.y).toBe(10);
  });

  it('preserves row alignment after pushing', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'b', type: 'rectangle', x: 80, y: 102, width: 100, height: 50 }),
      makeElement({ id: 'c', type: 'rectangle', x: 300, y: 101, width: 100, height: 50 }),
    ];

    const resolved = resolveOverlaps(elements);

    // a and c are on the same row (original y: 100, 101, 102 all within 10px)
    // After alignment, their y should be the same
    const a = resolved.find(e => e.id === 'a')!;
    const c = resolved.find(e => e.id === 'c')!;
    expect(Math.abs(a.y - c.y)).toBeLessThan(1);
  });

  it('does not modify elements when no overlaps exist', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'b', type: 'rectangle', x: 300, y: 0, width: 100, height: 50 }),
    ];

    const resolved = resolveOverlaps(elements);

    expect(resolved[0].x).toBe(0);
    expect(resolved[1].x).toBe(300);
  });

  it('arrows follow resolved shape positions in buildExcalidrawJSON', () => {
    // Two overlapping shapes + arrow between them
    const elements: ElementDef[] = [
      makeElement({ id: 'src', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'dst', type: 'rectangle', x: 50, y: 0, width: 100, height: 50 }),
      makeElement({
        id: 'arr', type: 'arrow',
        startBinding: { elementId: 'src', gap: 2, focus: 0 },
        endBinding: { elementId: 'dst', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const arrow = result.elements.find(e => e.type === 'arrow')!;

    // Arrow must still start at src edge and end at dst edge (not pass through)
    // After resolveOverlaps pushes shapes apart, edges change but arrow still works
    expect(arrow.points!.length).toBe(2);
    // Arrow start should not be inside the source shape
    const srcEl = result.elements.find(e => e.id === 'src')!;
    expect(arrow.x).toBeGreaterThan(srcEl.x + srcEl.width - 1);
  });
});

describe('writeExcalidrawJson', () => {
  it('写入纯 JSON 到 .excalidraw 文件（非 .md）', async () => {
    const ctx = makeMockCtx();
    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 220, height: 110, text: '中心' }),
    ];

    const filepath = await writeExcalidrawJson('test-diagram', elements, ctx);

    expect(filepath).toBe('Excalidraw/test-diagram.excalidraw');
    expect(ctx.vault.app.vault.adapter.write).toHaveBeenCalledWith(
      'Excalidraw/test-diagram.excalidraw',
      expect.any(String),
    );
    // 写入内容是合法 JSON（非 .excalidraw.md 的 frontmatter 格式）
    const writtenContent = (ctx.vault.app.vault.adapter.write as any).mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.type).toBe('excalidraw');
    expect(Array.isArray(parsed.elements)).toBe(true);
  });

  it('元素经 buildExcalidrawJSON 处理（字号优化生效）', async () => {
    const ctx = makeMockCtx();
    // shape 带 text → buildExcalidrawJSON 会自动创建绑定的 text 子元素 + 字号优化
    const elements: ElementDef[] = [
      makeElement({ id: 'box', type: 'rectangle', x: 0, y: 0, width: 220, height: 110, text: '短文本' }),
    ];

    await writeExcalidrawJson('opt-test', elements, ctx);

    const writtenContent = (ctx.vault.app.vault.adapter.write as any).mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    // shape + auto-created text = 2 elements
    expect(parsed.elements.length).toBe(2);
    const textEl = parsed.elements.find((e: any) => e.type === 'text');
    expect(textEl).toBeDefined();
    expect(textEl.fontSize).toBeGreaterThanOrEqual(16);
  });

  it('确保 Excalidraw 目录存在', async () => {
    const ctx = makeMockCtx();
    (ctx.vault.app.vault.adapter.exists as any).mockResolvedValue(false);

    await writeExcalidrawJson('new-file', [makeElement({ id: 'r1' })], ctx);

    expect(ctx.vault.app.vault.adapter.mkdir).toHaveBeenCalledWith('Excalidraw');
  });

  it('空 elements 抛异常', async () => {
    const ctx = makeMockCtx();
    await expect(writeExcalidrawJson('empty', [], ctx)).rejects.toThrow(/elements 为空/);
  });

  it('非法 filename 抛异常', async () => {
    const ctx = makeMockCtx();
    await expect(
      writeExcalidrawJson('bad/name', [makeElement({ id: 'r1' })], ctx),
    ).rejects.toThrow(/filename 非法/);
  });

  it('多次调用同一 filename 覆盖写入（增量累积场景）', async () => {
    const ctx = makeMockCtx();
    // 模拟渐进：节1 写 1 元素，节2 写 2 元素（累积）
    await writeExcalidrawJson('grow', [makeElement({ id: 'r1' })], ctx);
    await writeExcalidrawJson('grow', [makeElement({ id: 'r1' }), makeElement({ id: 'r2' })], ctx);

    const calls = (ctx.vault.app.vault.adapter.write as any).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('Excalidraw/grow.excalidraw');
    expect(calls[1][0]).toBe('Excalidraw/grow.excalidraw'); // 同路径覆盖
    // 第二次元素更多
    const second = JSON.parse(calls[1][1]);
    expect(second.elements.length).toBeGreaterThan(JSON.parse(calls[0][1]).elements.length);
  });
});

describe('detectConnectorNodeOverlaps', () => {
  it('detects arrow crossing an unrelated rectangle', () => {
    const elements: ElementDef[] = [
      { id: 'src', type: 'rectangle', x: 0, y: 100, width: 100, height: 50 },
      { id: 'dst', type: 'rectangle', x: 400, y: 100, width: 100, height: 50 },
      { id: 'unrelated', type: 'rectangle', x: 200, y: 80, width: 100, height: 80 }, // block the path [100, 125] to [400, 125]
      {
        id: 'arr',
        type: 'arrow',
        x: 0,
        y: 0,
        startBinding: { elementId: 'src', gap: 2, focus: 0 },
        endBinding: { elementId: 'dst', gap: 2, focus: 0 },
      },
    ];

    const warnings = detectConnectorNodeOverlaps(elements);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('arr');
    expect(warnings[0]).toContain('unrelated');
  });

  it('ignores arrow connecting to shapes without crossing others', () => {
    const elements: ElementDef[] = [
      { id: 'src', type: 'rectangle', x: 0, y: 100, width: 100, height: 50 },
      { id: 'dst', type: 'rectangle', x: 400, y: 100, width: 100, height: 50 },
      { id: 'unrelated', type: 'rectangle', x: 200, y: 300, width: 100, height: 80 }, // far away
      {
        id: 'arr',
        type: 'arrow',
        x: 0,
        y: 0,
        startBinding: { elementId: 'src', gap: 2, focus: 0 },
        endBinding: { elementId: 'dst', gap: 2, focus: 0 },
      },
    ];

    const warnings = detectConnectorNodeOverlaps(elements);
    expect(warnings).toHaveLength(0);
  });

  it('detects multi-segment arrow (L-shape) crossing an unrelated rectangle', () => {
    // src 在左下、dst 在右上、unrelated 在中间。
    // 直线 (src→dst) 不穿过 unrelated，但 L 形折线经过中间点 [250, -60] 时穿过 unrelated
    const elements: ElementDef[] = [
      { id: 'src', type: 'rectangle', x: 0, y: 300, width: 80, height: 50 },
      { id: 'dst', type: 'rectangle', x: 500, y: 0, width: 80, height: 50 },
      { id: 'unrelated', type: 'rectangle', x: 200, y: 220, width: 100, height: 80 },
      {
        id: 'arr',
        type: 'arrow',
        x: 40,
        y: 325,
        // L 形折线：起点 (40,325) → 中间 (290,265) → 终点 (540,25)
        // 中间点 (290,265) 落在 unrelated (200,220)-(300,300) 内部
        points: [[0, 0], [250, -60], [500, -300]],
        startBinding: { elementId: 'src', gap: 2, focus: 0 },
        endBinding: { elementId: 'dst', gap: 2, focus: 0 },
      },
    ];

    const warnings = detectConnectorNodeOverlaps(elements);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('arr');
    expect(warnings[0]).toContain('unrelated');
  });

  it('ignores L-shape arrow whose segments bypass the unrelated shape', () => {
    // L 形折线明确绕开 unrelated，所有段都不相交
    const elements: ElementDef[] = [
      { id: 'src', type: 'rectangle', x: 0, y: 0, width: 80, height: 50 },
      { id: 'dst', type: 'rectangle', x: 500, y: 0, width: 80, height: 50 },
      { id: 'unrelated', type: 'rectangle', x: 200, y: 200, width: 100, height: 80 },
      {
        id: 'arr',
        type: 'arrow',
        x: 40,
        y: 25,
        // 折线 (40,25) → (290,-50) → (540,25)，整条线在 y < 50 区域，绕开 unrelated
        points: [[0, 0], [250, -75], [500, 0]],
        startBinding: { elementId: 'src', gap: 2, focus: 0 },
        endBinding: { elementId: 'dst', gap: 2, focus: 0 },
      },
    ];

    const warnings = detectConnectorNodeOverlaps(elements);
    expect(warnings).toHaveLength(0);
  });
});

describe('customData injection', () => {
  it('injects isBranch on branch arrows', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child1', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child2', type: 'rectangle', x: 200, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child1', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'arrow2', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child2', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const arrow1 = result.elements.find(e => e.id === 'arrow1')!;
    const arrow2 = result.elements.find(e => e.id === 'arrow2')!;

    expect(arrow1.customData?.isBranch).toBe(true);
    expect(arrow2.customData?.isBranch).toBe(true);
  });

  it('injects depth on all nodes via BFS', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child1', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'grandchild1', type: 'rectangle', x: 400, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child1', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'arrow2', type: 'arrow',
        startBinding: { elementId: 'child1', gap: 2, focus: 0 },
        endBinding: { elementId: 'grandchild1', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const root = result.elements.find(e => e.id === 'root')!;
    const child1 = result.elements.find(e => e.id === 'child1')!;
    const grandchild1 = result.elements.find(e => e.id === 'grandchild1')!;

    expect(root.customData?.depth).toBe(0);
    expect(child1.customData?.depth).toBe(1);
    expect(grandchild1.customData?.depth).toBe(2);
  });

  it('marks root nodes with isAdditionalRoot', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'root2', type: 'rectangle', x: 0, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'child1', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow',
        startBinding: { elementId: 'root1', gap: 2, focus: 0 },
        endBinding: { elementId: 'child1', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const root1 = result.elements.find(e => e.id === 'root1')!;
    const root2 = result.elements.find(e => e.id === 'root2')!;
    const child1 = result.elements.find(e => e.id === 'child1')!;

    // root1 has no parent, so it IS an additional root (MindMapBuilder 标记)
    expect(root1.customData?.isAdditionalRoot).toBe(true);
    // root2 has no parent, so it IS an additional root
    expect(root2.customData?.isAdditionalRoot).toBe(true);
    // child1 has a parent, so it's NOT an additional root
    expect(child1.customData?.isAdditionalRoot).toBeUndefined();
  });

  it('does not inject customData on text elements', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'text1', type: 'text', text: 'label', x: 0, y: 0, width: 100, height: 50 }),
    ];

    const result = buildExcalidrawJSON(elements);
    const text1 = result.elements.find(e => e.id === 'text1')!;
    // text elements should not get depth/isAdditionalRoot
    expect(text1.customData?.depth).toBeUndefined();
    expect(text1.customData?.isAdditionalRoot).toBeUndefined();
  });

  it('preserves existing customData when injecting', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, customData: { foo: 'bar' } }),
      makeElement({ id: 'child', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'arrow', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const root = result.elements.find(e => e.id === 'root')!;

    expect(root.customData?.foo).toBe('bar');
    expect(root.customData?.depth).toBe(0);
  });
});

describe('boundary generation', () => {
  it('generates boundary for Level-1 subtrees', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child1', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child2', type: 'rectangle', x: 200, y: 100, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child1', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'arrow2', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child2', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const boundary = result.elements.find(e => e.id === 'boundary-child1');

    expect(boundary).toBeDefined();
    expect(boundary?.type).toBe('rectangle');
    expect(boundary?.customData?.isBoundary).toBe(true);
    expect(boundary?.customData?.parentId).toBe('child1');
    expect(boundary?.fillStyle).toBe('hachure');
    expect(boundary?.strokeWidth).toBe(1);
  });

  it('boundary includes 20px padding around subtree', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child1', type: 'rectangle', x: 200, y: 50, width: 100, height: 50 }),
      makeElement({ id: 'grandchild1', type: 'rectangle', x: 400, y: 50, width: 80, height: 40 }),
      makeElement({ id: 'arrow1', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child1', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'arrow2', type: 'arrow',
        startBinding: { elementId: 'child1', gap: 2, focus: 0 },
        endBinding: { elementId: 'grandchild1', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const boundary = result.elements.find(e => e.id === 'boundary-child1');

    expect(boundary).toBeDefined();
    // child1 at x=200, grandchild1 at x=400, width=80 → maxX=480
    // boundary x = 200-20 = 180, width = 480-180+20 = 320
    expect(boundary?.x).toBe(180);
    expect(boundary?.width).toBe(320);
  });

  it('does not generate boundary for depth=0 root nodes', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
    ];

    const result = buildExcalidrawJSON(elements);
    const boundary = result.elements.find(e => e.id?.startsWith('boundary-'));

    expect(boundary).toBeUndefined();
  });

  it('generates separate boundaries for each Level-1 subtree', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child1', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child2', type: 'rectangle', x: 200, y: 200, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child1', gap: 2, focus: 0 },
      }),
      makeElement({ id: 'arrow2', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child2', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const boundaries = result.elements.filter(e => e.id?.startsWith('boundary-'));

    expect(boundaries.length).toBe(2);
    expect(boundaries.some(b => b.customData?.parentId === 'child1')).toBe(true);
    expect(boundaries.some(b => b.customData?.parentId === 'child2')).toBe(true);
  });
});

describe('crossLinks styling', () => {
  it('applies dashed style to crossLink arrows', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'node1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'node2', type: 'rectangle', x: 200, y: 200, width: 100, height: 50 }),
      makeElement({ id: 'crossLink1', type: 'arrow',
        startBinding: { elementId: 'node1', gap: 2, focus: 0 },
        endBinding: { elementId: 'node2', gap: 2, focus: 0 },
        customData: { isCrossLink: true },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const crossLink = result.elements.find(e => e.id === 'crossLink1');

    expect(crossLink).toBeDefined();
    expect(crossLink?.strokeStyle).toBe('dashed');
    expect(crossLink?.strokeWidth).toBe(1);
    expect(crossLink?.opacity).toBe(60);
  });

  it('does not apply dashed style to regular branch arrows', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'root', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'child', type: 'rectangle', x: 200, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'branchArrow', type: 'arrow',
        startBinding: { elementId: 'root', gap: 2, focus: 0 },
        endBinding: { elementId: 'child', gap: 2, focus: 0 },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const branchArrow = result.elements.find(e => e.id === 'branchArrow');

    expect(branchArrow).toBeDefined();
    expect(branchArrow?.strokeStyle).not.toBe('dashed');
    expect(branchArrow?.strokeWidth).not.toBe(1);
  });

  it('preserves crossLink customData after styling', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'node1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'node2', type: 'rectangle', x: 200, y: 200, width: 100, height: 50 }),
      makeElement({ id: 'crossLink1', type: 'arrow',
        startBinding: { elementId: 'node1', gap: 2, focus: 0 },
        endBinding: { elementId: 'node2', gap: 2, focus: 0 },
        customData: { isCrossLink: true, source: 'analysis' },
      }),
    ];

    const result = buildExcalidrawJSON(elements);
    const crossLink = result.elements.find(e => e.id === 'crossLink1');

    expect(crossLink?.customData?.isCrossLink).toBe(true);
    expect(crossLink?.customData?.source).toBe('analysis');
  });
});
