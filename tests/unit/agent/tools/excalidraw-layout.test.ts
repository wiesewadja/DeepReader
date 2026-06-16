import { describe, it, expect, vi } from 'vitest';
import { arrangeWithFallback } from '@/agent/tools/excalidraw-layout';
import { LAYOUT_REGISTRY } from '@/agent/tools/excalidraw-layouts';
import type { ElementDef, LayoutEngine } from '@/agent/tools/excalidraw-types';

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

    // Root should be centered at X=500, Y=150
    expect(rootArr.x).toBe(500 - rootArr.width / 2);
    expect(rootArr.y).toBe(150 - rootArr.height / 2);

    // Children should be on level 1 (Y = 150 + 180 = 330)
    expect(c1.y).toBe(330 - c1.height / 2);
    expect(c2.y).toBe(330 - c2.height / 2);
    
    // c1 and c2 should be spaced horizontally
    expect(c1.x).toBeLessThan(c2.x);
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

    // Staggering directions: i=0 (even) -> centerY - 90, i=1 (odd) -> centerY + 90
    expect(n1.y).toBe(300 - 90 - n1.height / 2);
    expect(n2.y).toBe(300 + 90 - n2.height / 2);
    expect(n3.y).toBe(300 - 90 - n3.height / 2);
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
    expect(n1.y).toBe(n2.y);
    expect(n3.y).toBe(n4.y);
    expect(n1.y).toBeLessThan(n3.y);
    expect(n1.x).toBeLessThan(n2.x);
    expect(n3.x).toBeLessThan(n4.x);
  });

  it('mind-map should place level-1 children alternating left and right of center', () => {
    const elements = [
      makeElement({ id: 'root', x: 0, y: 0, width: 120, height: 60 }),
      makeElement({ id: 'right1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'left1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'right2', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'right1', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'left1', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow3', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'right2', gap: 2, focus: 0 } }),
    ];

    const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
    const root = arranged.find(e => e.id === 'root')!;
    const right1 = arranged.find(e => e.id === 'right1')!;
    const left1 = arranged.find(e => e.id === 'left1')!;
    const right2 = arranged.find(e => e.id === 'right2')!;

    // Root centered at (500, 300)
    expect(root.x).toBe(500 - root.width / 2);
    expect(root.y).toBe(300 - root.height / 2);

    // right1 and right2 should be on the right side
    expect(right1.x + right1.width / 2).toBeGreaterThan(root.x + root.width / 2);
    expect(right2.x + right2.width / 2).toBeGreaterThan(root.x + root.width / 2);

    // left1 should be on the left side
    expect(left1.x + left1.width / 2).toBeLessThan(root.x + root.width / 2);
  });

  it('mind-map should extend descendants outward on the same side as their parent', () => {
    const elements = [
      makeElement({ id: 'root', x: 0, y: 0, width: 120, height: 60 }),
      makeElement({ id: 'right1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'right1child', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'right1', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'right1', gap: 2, focus: 0 }, endBinding: { elementId: 'right1child', gap: 2, focus: 0 } }),
    ];

    const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
    const right1 = arranged.find(e => e.id === 'right1')!;
    const right1child = arranged.find(e => e.id === 'right1child')!;

    // The grandchild should be further to the right than its parent
    expect(right1child.x + right1child.width / 2).toBeGreaterThan(right1.x + right1.width / 2);
  });

  it('mind-map dynamicSpacingX: keeps ≥60px gap between wide parent and children edges', () => {
    // 构造超宽 parent（width=400）+ 多个 100 宽的子节点，
    // 验证 dynamicSpacingX 自动放大：parent 右边到 child 左边至少 60px
    const elements = [
      makeElement({ id: 'root', x: 0, y: 0, width: 400, height: 80 }),
      makeElement({ id: 'c1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'c2', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'arrow_c1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c1', gap: 2, focus: 0 } }),
      makeElement({ id: 'arrow_c2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c2', gap: 2, focus: 0 } }),
    ];

    const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
    const root = arranged.find(e => e.id === 'root')!;
    const child = arranged.find(e => e.id === 'c1')!;

    // 计算水平间距：root 右边到 c1 左边
    const rootRightEdge = root.x + root.width;
    const childLeftEdge = child.x;
    const gap = childLeftEdge - rootRightEdge;

    // 父子节点边界至少 60px 留白（dynamicSpacingX = max(levelSpacingX, parent/2 + child/2 + 60)）
    expect(gap).toBeGreaterThanOrEqual(60);
  });
});

describe('arrangeWithFallback', () => {
  it('should return original resolveOverlaps when layout is undefined or invalid', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      // Overlapping
      makeElement({ id: 'rect2', x: 20, y: 10, width: 100, height: 50 }),
    ];

    const arranged = arrangeWithFallback(elements);
    // Overlap should be resolved (push is vertical)
    expect(arranged[0].y).not.toBe(elements[0].y);
    
    const arrangedInvalid = arrangeWithFallback(elements, 'invalid-layout' as any);
    expect(arrangedInvalid[0].y).not.toBe(elements[0].y);
  });

  it('should apply valid layout when it produces better or equal scores', () => {
    const elements = [
      makeElement({ id: 'node1', x: 0, y: 0 }),
      makeElement({ id: 'node2', x: 0, y: 0 }),
    ];

    // radial layout spreads them circular, so they won't overlap
    const arranged = arrangeWithFallback(elements, 'radial');
    const n1 = arranged.find(e => e.id === 'node1')!;
    const n2 = arranged.find(e => e.id === 'node2')!;
    
    expect(n1.x).not.toBe(n2.x);
  });

  it('should fall back to originalResolved if arranged layout is worse (e.g. too sparse)', () => {
    const badLayout: LayoutEngine = {
      arrange(elements) {
        return elements.map(el => ({ ...el, x: el.x * 10, y: el.y * 10 })); // Multiplies bounding area significantly
      }
    };
    LAYOUT_REGISTRY['bad-layout' as any] = badLayout;

    const elements = [
      makeElement({ id: 'n1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'n2', x: 200, y: 200, width: 100, height: 50 }),
    ];

    const arranged = arrangeWithFallback(elements, 'bad-layout' as any);
    const n1 = arranged.find(e => e.id === 'n1')!;
    const n2 = arranged.find(e => e.id === 'n2')!;
    expect(n1.x).toBe(0);
    expect(n2.x).toBe(200); // Should keep original positions
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
