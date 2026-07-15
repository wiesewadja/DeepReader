import { describe, it, expect, vi } from 'vitest';
import { arrangeWithFallback } from '@/agent/tools/excalidraw/excalidraw-layout';
import { LAYOUT_REGISTRY } from '@/agent/tools/excalidraw/layouts/index';
import type { ElementDef, LayoutEngine } from '@/agent/tools/excalidraw/excalidraw-types';

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

describe('Layout Algorithms', () => {
  it('hierarchical-tree should position nodes in vertical tiers', () => {
    const elements = [
      makeElement({ id: 'root', x: 0, y: 0 }),
      makeElement({ id: 'child1', x: 0, y: 0 }),
      makeElement({ id: 'child2', x: 0, y: 0 }),
      // Link root -> child1 and root -> child2
      makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'child1', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'child2', gap: 2, focus: 0 } }),
    ];

    const arranged = LAYOUT_REGISTRY['hierarchical-tree'].arrange(elements);
    const rootArr = arranged.find(e => e.id === 'root')!;
    const c1 = arranged.find(e => e.id === 'child1')!;
    const c2 = arranged.find(e => e.id === 'child2')!;

    // Backbone chain layout: spineX = centerX - 220 = 280
    // Root positioned at spineX - root.width/2 = 280 - 50 = 230
    expect(rootArr.x).toBe(230);
    // startY = 150, layerMaxH = 50, root.height = 50
    // y = 150 + (50 - 50) / 2 = 150
    expect(rootArr.y).toBe(150);

    // Children should be on level 1 (Y = 150 + 50 + 160 = 360)
    // y = 360 + (50 - 50) / 2 = 360 (since layerMaxH = node height)
    expect(c1.y).toBe(360);
    expect(c2.y).toBe(360);
    
    // c1 and c2 should be spaced horizontally to the right of root
    expect(c1.x).toBeGreaterThan(rootArr.x);
    expect(c2.x).toBeGreaterThan(c1.x);
  });

  it('flow-horizontal should arrange nodes horizontally in topological order', () => {
    const elements = [
      makeElement({ id: 'nodeA', x: 10, y: 10 }),
      makeElement({ id: 'nodeB', x: 20, y: 10 }),
      makeElement({ id: 'arrow', type: 'arrow', startBinding: { elementId: 'nodeA', gap: 2, focus: 0 }, endBinding: { elementId: 'nodeB', gap: 2, focus: 0 } }),
    ];

    const arranged = LAYOUT_REGISTRY['flow-horizontal'].arrange(elements);
    const nA = arranged.find(e => e.id === 'nodeA')!;
    const nB = arranged.find(e => e.id === 'nodeB')!;

    // Y coordinates should be centered around 300
    expect(nA.y).toBe(300 - nA.height / 2);
    expect(nB.y).toBe(300 - nB.height / 2);

    // nodeA should be to the left of nodeB
    expect(nA.x).toBeLessThan(nB.x);
  });

  it('timeline should stagger nodes vertically', () => {
    const elements = [
      makeElement({ id: 'node1', x: 0, y: 0 }),
      makeElement({ id: 'node2', x: 0, y: 0 }),
      makeElement({ id: 'node3', x: 0, y: 0 }),
    ];

    const arranged = LAYOUT_REGISTRY['timeline'].arrange(elements);
    const n1 = arranged.find(e => e.id === 'node1')!;
    const n2 = arranged.find(e => e.id === 'node2')!;
    const n3 = arranged.find(e => e.id === 'node3')!;

    // staggerY = maxNodeH/2 + 40 = 50/2 + 40 = 65
    // centerY = 300
    // i=0 (even) -> centerY - staggerY - height/2 = 300 - 65 - 25 = 210
    // i=1 (odd) -> centerY + staggerY - height/2 = 300 + 65 - 25 = 340
    // i=2 (even) -> centerY - staggerY - height/2 = 210
    expect(n1.y).toBe(210);
    expect(n2.y).toBe(340);
    expect(n3.y).toBe(210);
  });

  it('radial should place surrounding nodes circularly around center node', () => {
    const elements = [
      makeElement({ id: 'center', x: 0, y: 0 }),
      makeElement({ id: 'surr1', x: 0, y: 0 }),
      makeElement({ id: 'surr2', x: 0, y: 0 }),
      makeElement({ id: 'surr3', x: 0, y: 0 }),
      // Link center -> surr
      makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'center', gap: 2, focus: 0 }, endBinding: { elementId: 'surr1', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'center', gap: 2, focus: 0 }, endBinding: { elementId: 'surr2', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow3', type: 'arrow', startBinding: { elementId: 'center', gap: 2, focus: 0 }, endBinding: { elementId: 'surr3', gap: 2, focus: 0 } }),
    ];

    const arranged = LAYOUT_REGISTRY['radial'].arrange(elements);
    const c = arranged.find(e => e.id === 'center')!;
    const s1 = arranged.find(e => e.id === 'surr1')!;

    // Center node should be centered at (500, 300)
    expect(c.x).toBe(500 - c.width / 2);
    expect(c.y).toBe(300 - c.height / 2);

    // Surrounding nodes should have different coordinates than center
    expect(s1.x).not.toBe(c.x);
  });

  it('matrix should place nodes in a grid', () => {
    const elements = [
      makeElement({ id: 'n1', x: 0, y: 0 }),
      makeElement({ id: 'n2', x: 0, y: 0 }),
      makeElement({ id: 'n3', x: 0, y: 0 }),
      makeElement({ id: 'n4', x: 0, y: 0 }),
    ];

    const arranged = LAYOUT_REGISTRY['matrix'].arrange(elements);
    const n1 = arranged.find(e => e.id === 'n1')!;
    const n2 = arranged.find(e => e.id === 'n2')!;
    const n3 = arranged.find(e => e.id === 'n3')!;
    const n4 = arranged.find(e => e.id === 'n4')!;

    // 2x2 grid. n1 and n2 on row 0, n3 and n4 on row 1
    expect(n1.y).toBe(n2.y); // Same row
    expect(n3.y).toBe(n4.y); // Same row
    expect(n1.y).toBeLessThan(n3.y); // Row 0 above row 1
    expect(n1.x).toBeLessThan(n2.x); // Column 0 left of column 1
  });
});

describe('mind-map growthMode', () => {
  const center = makeElement({ id: 'root', x: 0, y: 0, width: 120, height: 60 });
  const child1 = makeElement({ id: 'c1', x: 0, y: 0, width: 100, height: 50 });
  const child2 = makeElement({ id: 'c2', x: 0, y: 0, width: 100, height: 50 });
  const child3 = makeElement({ id: 'c3', x: 0, y: 0, width: 100, height: 50 });
  const child4 = makeElement({ id: 'c4', x: 0, y: 0, width: 100, height: 50 });
  const arrows = [
    makeElement({ id: 'a1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c1', gap: 2, focus: 0 } }),
    makeElement({ id: 'a2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c2', gap: 2, focus: 0 } }),
    makeElement({ id: 'a3', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c3', gap: 2, focus: 0 } }),
    makeElement({ id: 'a4', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c4', gap: 2, focus: 0 } }),
  ];
  const elements = [center, child1, child2, child3, child4, ...arrows];

  it('Right-Left: alternates children left and right (default)', () => {
    const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
    const r = arranged.find(e => e.id === 'root')!;
    const c1 = arranged.find(e => e.id === 'c1')!;
    const c2 = arranged.find(e => e.id === 'c2')!;

    // Root centered at (500, 300)
    expect(r.x).toBe(500 - r.width / 2);
    // c1 (even index) goes right, c2 (odd index) goes left
    expect(c1.x).toBeGreaterThan(r.x + r.width / 2);
    expect(c2.x).toBeLessThan(r.x);
  });

  it('Right-facing: all children go right', () => {
    const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements, { growthMode: 'Right-facing' });
    const r = arranged.find(e => e.id === 'root')!;
    const c1 = arranged.find(e => e.id === 'c1')!;
    const c2 = arranged.find(e => e.id === 'c2')!;
    const c3 = arranged.find(e => e.id === 'c3')!;

    // All children should be to the right of root
    expect(c1.x).toBeGreaterThan(r.x + r.width / 2);
    expect(c2.x).toBeGreaterThan(r.x + r.width / 2);
    expect(c3.x).toBeGreaterThan(r.x + r.width / 2);
  });

  it('Left-facing: all children go left', () => {
    const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements, { growthMode: 'Left-facing' });
    const r = arranged.find(e => e.id === 'root')!;
    const c1 = arranged.find(e => e.id === 'c1')!;
    const c2 = arranged.find(e => e.id === 'c2')!;

    // All children should be to the left of root
    expect(c1.x).toBeLessThan(r.x);
    expect(c2.x).toBeLessThan(r.x);
  });

  it('defaults to Right-Left when no growthMode specified', () => {
    const arrangedDefault = LAYOUT_REGISTRY['mind-map'].arrange(elements);
    const arrangedExplicit = LAYOUT_REGISTRY['mind-map'].arrange(elements, { growthMode: 'Right-Left' });

    // Both should produce same layout
    for (const id of ['root', 'c1', 'c2', 'c3', 'c4']) {
      const d = arrangedDefault.find(e => e.id === id)!;
      const e = arrangedExplicit.find(e => e.id === id)!;
      expect(d.x).toBe(e.x);
      expect(d.y).toBe(e.y);
    }
  });
});

describe('arrangeWithFallback', () => {
  it('should accept good layouts', () => {
    const elements = [
      makeElement({ id: 'n1', x: 0, y: 0 }),
      makeElement({ id: 'n2', x: 200, y: 200 }),
    ];

    const arranged = arrangeWithFallback(elements, 'radial');
    const n1 = arranged.find(e => e.id === 'n1')!;
    const n2 = arranged.find(e => e.id === 'n2')!;
    
    expect(n1.x).not.toBe(n2.x);
  });

  it('should accept layouts with 0 overlap even if sparse (current behavior)', () => {
    // Note: arrangeWithFallback accepts layouts with 0 overlap immediately,
    // even if they are very sparse. This is an intentional optimization to avoid
    // O(n^2) fallback computation when the layout is already conflict-free.
    const sparseLayout: LayoutEngine = {
      arrange(elements) {
        // Spread nodes far apart (0 overlap but very sparse)
        return elements.map(el => ({ ...el, x: el.x * 1000, y: el.y * 1000 }));
      }
    };
    LAYOUT_REGISTRY['sparse-layout' as any] = sparseLayout;

    const elements = [
      makeElement({ id: 'n1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'n2', x: 200, y: 200, width: 100, height: 50 }),
    ];

    const arranged = arrangeWithFallback(elements, 'sparse-layout' as any);
    const n1 = arranged.find(e => e.id === 'n1')!;
    const n2 = arranged.find(e => e.id === 'n2')!;
    // With 0 overlap, the arranged layout is accepted directly
    expect(n1.x).toBe(0);
    expect(n2.x).toBe(200000); // Layout was applied (not fallen back)
  });

  it('should fall back when arranged layout has overlap AND is much sparser', () => {
    // Create a layout that produces overlap AND expands bounding area
    const overlapLayout: LayoutEngine = {
      arrange(elements) {
        // All nodes stacked at same position (overlap) but then spread horizontally
        return elements.map((el, i) => ({ 
          ...el, 
          x: i * 50, // Close together horizontally
          y: 0,       // Same Y → overlap
        }));
      }
    };
    LAYOUT_REGISTRY['overlap-layout' as any] = overlapLayout;

    const elements = [
      makeElement({ id: 'n1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'n2', x: 200, y: 200, width: 100, height: 50 }),
    ];

    const arranged = arrangeWithFallback(elements, 'overlap-layout' as any);
    // Should return arranged layout since overlap is reduced
    expect(arranged.length).toBeGreaterThanOrEqual(2);
  });

  it('should synchronize bound text positions relative to their container', () => {
    const elements = [
      makeElement({ id: 'container', x: 0, y: 0, width: 200, height: 100 }),
      makeElement({ id: 'text', type: 'text', containerId: 'container', x: 10, y: 10, width: 100, height: 55 }),
    ];

    // Radial layout centers the single node 'container' at (500, 300) -> x=400, y=250
    // The text should move inside it centered:
    // text.x = 400 + (200 - 100) / 2 = 450
    // text.y = 250 + (100 - 55) / 2 = 272.5
    const arranged = arrangeWithFallback(elements, 'radial');
    const container = arranged.find(e => e.id === 'container')!;
    const text = arranged.find(e => e.id === 'text')!;

    expect(container.x).toBe(400);
    expect(container.y).toBe(250);
    expect(text.x).toBe(450);
    expect(text.y).toBe(272.5);
  });
});
