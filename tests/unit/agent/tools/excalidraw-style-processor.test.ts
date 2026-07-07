import { describe, it, expect } from 'vitest';
import { applyDiagramStyle } from '@/agent/tools/excalidraw-style-processor';
import { PALETTE, BACKGROUNDS, CONNECTOR_COLORS } from '@/agent/tools/excalidraw-organic-palette';
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

describe('applyDiagramStyle', () => {
  describe('语义颜色映射（从常量验证，不硬编码）', () => {
    it('light 主题下 primary 语义应映射到 PALETTE 定义的颜色', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'primary' }),
      ];

      const result = applyDiagramStyle({ elements, theme: 'light' });
      const rect = result.elements.find(e => e.id === 'rect_1')!;
      const expected = PALETTE.light.primary;

      expect(rect.strokeColor).toBe(expected.stroke);
      expect(rect.backgroundColor).toBe(expected.fill);
      expect(rect.fillStyle).toBe('solid');
    });

    it('light 主题下 emphasis 语义应映射到 PALETTE 定义的颜色', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'ellipse_1', type: 'ellipse', semanticColor: 'emphasis' }),
      ];

      const result = applyDiagramStyle({ elements, theme: 'light' });
      const ellipse = result.elements.find(e => e.id === 'ellipse_1')!;
      const expected = PALETTE.light.emphasis;

      expect(ellipse.strokeColor).toBe(expected.stroke);
      expect(ellipse.backgroundColor).toBe(expected.fill);
    });

    it('dark 主题下 success 语义应映射到 PALETTE 定义的颜色', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'success' }),
      ];

      const result = applyDiagramStyle({ elements, theme: 'dark' });
      const rect = result.elements.find(e => e.id === 'rect_1')!;
      const expected = PALETTE.dark.success;

      expect(rect.strokeColor).toBe(expected.stroke);
      expect(rect.backgroundColor).toBe(expected.fill);
    });

    it('未指定 semanticColor 时应回退到 neutral', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'rect_1', type: 'rectangle' }), // 无 semanticColor
      ];

      const result = applyDiagramStyle({ elements, theme: 'light' });
      const rect = result.elements.find(e => e.id === 'rect_1')!;
      const expected = PALETTE.light.neutral;

      expect(rect.strokeColor).toBe(expected.stroke);
      expect(rect.backgroundColor).toBe(expected.fill);
    });

    it('无效 semanticColor 应回退到 neutral', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'rect_1', type: 'rectangle', semanticColor: 'nonexistent' as any }),
      ];

      const result = applyDiagramStyle({ elements, theme: 'light' });
      const rect = result.elements.find(e => e.id === 'rect_1')!;
      const expected = PALETTE.light.neutral;

      expect(rect.strokeColor).toBe(expected.stroke);
      expect(rect.backgroundColor).toBe(expected.fill);
    });
  });

  describe('背景色', () => {
    it('light 主题背景色应与 BACKGROUNDS 常量一致', () => {
      const result = applyDiagramStyle({ elements: [], theme: 'light' });
      expect(result.viewBackgroundColor).toBe(BACKGROUNDS.light);
    });

    it('dark 主题背景色应与 BACKGROUNDS 常量一致', () => {
      const result = applyDiagramStyle({ elements: [], theme: 'dark' });
      expect(result.viewBackgroundColor).toBe(BACKGROUNDS.dark);
    });
  });

  describe('连线/箭头样式', () => {
    it('arrow 应使用 CONNECTOR_COLORS 定义的颜色', () => {
      const elements: ElementDef[] = [
        makeElement({
          id: 'arrow_1',
          type: 'arrow',
          startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
          endBinding: { elementId: 'rect_2', gap: 2, focus: 0 },
        }),
      ];

      const result = applyDiagramStyle({ elements, theme: 'light' });
      const arrow = result.elements.find(e => e.id === 'arrow_1')!;

      expect(arrow.strokeColor).toBe(CONNECTOR_COLORS.light.stroke);
      expect(arrow.roughness).toBe(0);
    });

    it('line 应使用 CONNECTOR_COLORS 定义的颜色', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'line_1', type: 'line' as any }),
      ];

      const result = applyDiagramStyle({ elements, theme: 'dark' });
      const line = result.elements.find(e => e.id === 'line_1')!;

      expect(line.strokeColor).toBe(CONNECTOR_COLORS.dark.stroke);
    });

    it('只有一个 startBinding 的 arrow 不应崩溃', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
        makeElement({
          id: 'arrow_half',
          type: 'arrow',
          startBinding: { elementId: 'rect_1', gap: 2, focus: 0 },
          points: [[0, 0], [50, 50]],
        }),
      ];

      const result = applyDiagramStyle({ elements, layout: 'flow-horizontal', theme: 'light' });
      const arrow = result.elements.find(e => e.id === 'arrow_half')!;

      expect(arrow).toBeDefined();
      expect(arrow.type).toBe('arrow');
    });
  });

  describe('幂等性（多次调用结果一致）', () => {
    it('同一输入多次调用应返回相同结果', () => {
      const elements: ElementDef[] = [
        makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50 }),
        makeElement({ id: 'rect_2', type: 'rectangle', x: 300, y: 100, width: 100, height: 50 }),
      ];

      const input = { elements, layout: 'flow-horizontal' as const, theme: 'light' as const };
      const result1 = applyDiagramStyle(input);
      const result2 = applyDiagramStyle(input);

      expect(result1.elements).toEqual(result2.elements);
      expect(result1.viewBackgroundColor).toBe(result2.viewBackgroundColor);
    });
  });
});

describe('generateConnectorPoints', () => {
  it('起终点重合时应返回两个相同点', () => {
    const points = generateConnectorPoints([100, 100], [100, 100], 'mind-map');
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual([100, 100]);
    expect(points[1]).toEqual([100, 100]);
  });
});

describe('buildExcalidrawJSON 集成测试', () => {
  it('应正确应用样式并绑定文本到背景', () => {
    const elements: ElementDef[] = [
      makeElement({ id: 'rect_1', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, semanticColor: 'primary' }),
      makeElement({ id: 'rect_2', type: 'rectangle', x: 300, y: 100, width: 100, height: 50, semanticColor: 'emphasis' }),
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
        plugin: {} as any
      } as any,
      book: {} as any,
    };

    const file = buildExcalidrawJSON(elements, 'flow-horizontal', mockContext);

    // 背景色应与 dark 主题常量一致
    expect(file.appState.viewBackgroundColor).toBe(BACKGROUNDS.dark);

    // 样式应从 PALETTE 应用
    const rect1 = file.elements.find(e => e.id === 'rect_1')!;
    expect(rect1.strokeColor).toBe(PALETTE.dark.primary.stroke);
    expect(rect1.fillStyle).toBe('solid');

    // 文本应绑定到背景矩形
    const textBg = file.elements.find(e => e.id === 'text_1_bg')!;
    expect(textBg.type).toBe('rectangle');
    const excalidrawText = file.elements.find(e => e.id === 'text_1')!;
    expect(excalidrawText.containerId).toBe('text_1_bg');
  });
});
