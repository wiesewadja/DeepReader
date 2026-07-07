import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  describe('hierarchical-tree', () => {
    it('子节点应在父节点下方（垂直分层）', () => {
      const elements = [
        makeElement({ id: 'root' }),
        makeElement({ id: 'child1' }),
        makeElement({ id: 'child2' }),
        makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'child1', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'child2', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['hierarchical-tree'].arrange(elements);
      const root = arranged.find(e => e.id === 'root')!;
      const c1 = arranged.find(e => e.id === 'child1')!;
      const c2 = arranged.find(e => e.id === 'child2')!;

      // 核心业务逻辑：子节点 Y 应大于父节点 Y
      expect(c1.y).toBeGreaterThan(root.y + root.height);
      expect(c2.y).toBeGreaterThan(root.y + root.height);

      // 左右子节点应水平分开
      expect(c1.x).not.toBe(c2.x);
    });

    it('单链结构（backbone chain）应使用 spine 布局', () => {
      const elements = [
        makeElement({ id: 'level0' }),
        makeElement({ id: 'level1' }),
        makeElement({ id: 'level2' }),
        makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'level0', gap: 2, focus: 0 }, endBinding: { elementId: 'level1', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'level1', gap: 2, focus: 0 }, endBinding: { elementId: 'level2', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['hierarchical-tree'].arrange(elements);
      const l0 = arranged.find(e => e.id === 'level0')!;
      const l1 = arranged.find(e => e.id === 'level1')!;
      const l2 = arranged.find(e => e.id === 'level2')!;

      // 三层垂直递增
      expect(l0.y).toBeLessThan(l1.y);
      expect(l1.y).toBeLessThan(l2.y);
    });
  });

  describe('flow-horizontal', () => {
    it('节点应从左到右排列（拓扑序）', () => {
      const elements = [
        makeElement({ id: 'nodeA', x: 10, y: 10 }),
        makeElement({ id: 'nodeB', x: 20, y: 10 }),
        makeElement({ id: 'arrow', type: 'arrow', startBinding: { elementId: 'nodeA', gap: 2, focus: 0 }, endBinding: { elementId: 'nodeB', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['flow-horizontal'].arrange(elements);
      const nA = arranged.find(e => e.id === 'nodeA')!;
      const nB = arranged.find(e => e.id === 'nodeB')!;

      // nodeA 应在 nodeB 左边
      expect(nA.x).toBeLessThan(nB.x);
    });
  });

  describe('timeline', () => {
    it('节点应上下交错排列', () => {
      const elements = [
        makeElement({ id: 'node1' }),
        makeElement({ id: 'node2' }),
        makeElement({ id: 'node3' }),
      ];

      const arranged = LAYOUT_REGISTRY['timeline'].arrange(elements);
      const n1 = arranged.find(e => e.id === 'node1')!;
      const n2 = arranged.find(e => e.id === 'node2')!;
      const n3 = arranged.find(e => e.id === 'node3')!;

      // 交错：n1 和 n3 在同一侧，n2 在另一侧
      expect(n1.y).toBe(n3.y);
      expect(n1.y).not.toBe(n2.y);
    });
  });

  describe('radial', () => {
    it('子节点应围绕中心节点分布', () => {
      const elements = [
        makeElement({ id: 'center' }),
        makeElement({ id: 'surr1' }),
        makeElement({ id: 'surr2' }),
        makeElement({ id: 'surr3' }),
        makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'center', gap: 2, focus: 0 }, endBinding: { elementId: 'surr1', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'center', gap: 2, focus: 0 }, endBinding: { elementId: 'surr2', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow3', type: 'arrow', startBinding: { elementId: 'center', gap: 2, focus: 0 }, endBinding: { elementId: 'surr3', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['radial'].arrange(elements);
      const c = arranged.find(e => e.id === 'center')!;
      const s1 = arranged.find(e => e.id === 'surr1')!;
      const s2 = arranged.find(e => e.id === 'surr2')!;

      // 子节点应有不同位置（围绕中心）
      expect(s1.x).not.toBe(s2.x);
      expect(s1.y).not.toBe(s2.y);
    });
  });

  describe('matrix', () => {
    it('节点应排列成网格', () => {
      const elements = [
        makeElement({ id: 'n1' }),
        makeElement({ id: 'n2' }),
        makeElement({ id: 'n3' }),
        makeElement({ id: 'n4' }),
      ];

      const arranged = LAYOUT_REGISTRY['matrix'].arrange(elements);
      const n1 = arranged.find(e => e.id === 'n1')!;
      const n2 = arranged.find(e => e.id === 'n2')!;
      const n3 = arranged.find(e => e.id === 'n3')!;
      const n4 = arranged.find(e => e.id === 'n4')!;

      // 2x2 网格：同一行 Y 相同，不同行 Y 不同
      expect(n1.y).toBe(n2.y);
      expect(n3.y).toBe(n4.y);
      expect(n1.y).toBeLessThan(n3.y);
      // 同一行内左 < 右
      expect(n1.x).toBeLessThan(n2.x);
    });
  });

  describe('mind-map', () => {
    it('子节点应分布在中心节点两侧', () => {
      const elements = [
        makeElement({ id: 'root', width: 120, height: 60 }),
        makeElement({ id: 'right1', width: 100, height: 50 }),
        makeElement({ id: 'left1', width: 100, height: 50 }),
        makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'right1', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'left1', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
      const root = arranged.find(e => e.id === 'root')!;
      const right1 = arranged.find(e => e.id === 'right1')!;
      const left1 = arranged.find(e => e.id === 'left1')!;

      // 右侧子节点中心 > 根节点中心
      expect(right1.x + right1.width / 2).toBeGreaterThan(root.x + root.width / 2);
      // 左侧子节点中心 < 根节点中心
      expect(left1.x + left1.width / 2).toBeLessThan(root.x + root.width / 2);
    });

    it('后代节点应向同侧延伸', () => {
      const elements = [
        makeElement({ id: 'root', width: 120, height: 60 }),
        makeElement({ id: 'right1', width: 100, height: 50 }),
        makeElement({ id: 'right1child', width: 100, height: 50 }),
        makeElement({ id: 'arrow1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'right1', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow2', type: 'arrow', startBinding: { elementId: 'right1', gap: 2, focus: 0 }, endBinding: { elementId: 'right1child', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
      const right1 = arranged.find(e => e.id === 'right1')!;
      const right1child = arranged.find(e => e.id === 'right1child')!;

      // 孙节点应比父节点更靠右
      expect(right1child.x + right1child.width / 2).toBeGreaterThan(right1.x + right1.width / 2);
    });

    it('超宽父节点应保持子节点间距 ≥60px', () => {
      const elements = [
        makeElement({ id: 'root', width: 400, height: 80 }),
        makeElement({ id: 'c1', width: 100, height: 50 }),
        makeElement({ id: 'c2', width: 100, height: 50 }),
        makeElement({ id: 'arrow_c1', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c1', gap: 2, focus: 0 } }),
        makeElement({ id: 'arrow_c2', type: 'arrow', startBinding: { elementId: 'root', gap: 2, focus: 0 }, endBinding: { elementId: 'c2', gap: 2, focus: 0 } }),
      ];

      const arranged = LAYOUT_REGISTRY['mind-map'].arrange(elements);
      const root = arranged.find(e => e.id === 'root')!;
      const child = arranged.find(e => e.id === 'c1')!;

      const gap = child.x - (root.x + root.width);
      expect(gap).toBeGreaterThanOrEqual(60);
    });
  });
});

describe('arrangeWithFallback', () => {
  // 保存原始引用，测试后恢复
  let originalRegistry: typeof LAYOUT_REGISTRY;

  beforeEach(() => {
    originalRegistry = { ...LAYOUT_REGISTRY };
  });

  afterEach(() => {
    // 恢复 LAYOUT_REGISTRY，避免全局状态污染
    Object.keys(LAYOUT_REGISTRY).forEach(key => {
      delete (LAYOUT_REGISTRY as any)[key];
    });
    Object.assign(LAYOUT_REGISTRY, originalRegistry);
  });

  it('无布局时应使用 resolveOverlaps 解决重叠', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'rect2', x: 20, y: 10, width: 100, height: 50 }),
    ];

    const arranged = arrangeWithFallback(elements);
    // 重叠应被解决（至少一个元素位置改变）
    expect(arranged[0].y).not.toBe(elements[0].y);
  });

  it('无效布局名应降级到 resolveOverlaps', () => {
    const elements = [
      makeElement({ id: 'rect1', x: 0, y: 0, width: 100, height: 50 }),
      makeElement({ id: 'rect2', x: 20, y: 10, width: 100, height: 50 }),
    ];

    const arranged = arrangeWithFallback(elements, 'nonexistent-layout' as any);
    expect(arranged[0].y).not.toBe(elements[0].y);
  });

  it('好布局应被接受（产生更好的分数）', () => {
    const elements = [
      makeElement({ id: 'node1', x: 0, y: 0 }),
      makeElement({ id: 'node2', x: 0, y: 0 }),
    ];

    const arranged = arrangeWithFallback(elements, 'radial');
    const n1 = arranged.find(e => e.id === 'node1')!;
    const n2 = arranged.find(e => e.id === 'node2')!;

    // radial 布局应将节点分散
    expect(n1.x).not.toBe(n2.x);
  });

  it('0 overlap 时应直接接受布局（跳过 bounding area 检查）', () => {
    const sparseLayout: LayoutEngine = {
      arrange(elements) {
        // 故意放大坐标，但不产生重叠
        return elements.map(el => ({ ...el, x: el.x * 10, y: el.y * 10 }));
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

    // 0 overlap 时直接接受放大后的布局
    expect(n1.x).toBe(0);
    expect(n2.x).toBe(2000);
  });

  it('绑定文本应跟随容器移动', () => {
    const elements = [
      makeElement({ id: 'container', width: 200, height: 100 }),
      makeElement({ id: 'text', type: 'text', containerId: 'container', x: 10, y: 10, width: 100, height: 55 }),
    ];

    const arranged = arrangeWithFallback(elements, 'radial');
    const container = arranged.find(e => e.id === 'container')!;
    const text = arranged.find(e => e.id === 'text')!;

    // 文本应在容器内部
    expect(text.x).toBeGreaterThanOrEqual(container.x);
    expect(text.y).toBeGreaterThanOrEqual(container.y);
    expect(text.x + text.width).toBeLessThanOrEqual(container.x + container.width);
  });
});
