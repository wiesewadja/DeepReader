/**
 * Excalidraw 图标功能端到端集成测试
 *
 * 验证图标类型定义、图标库、图标处理器的完整流程。
 * 降级处理测试验证图标加载失败时的优雅降级。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LUCIDE_ICONS,
  loadIcon,
  suggestIconForText,
  getAllIconNames,
  getIconCategories,
  clearIconCache,
} from '../../../../src/agent/tools/excalidraw/excalidraw-icon-library.js';
import {
  calculateIconPosition,
  processIconsSync,
  processIcons,
} from '../../../../src/agent/tools/excalidraw/excalidraw-icon-processor.js';
import { buildExcalidrawJSON } from '../../../../src/agent/tools/excalidraw/excalidraw.js';
import type { ElementDef } from '../../../../src/agent/tools/excalidraw/excalidraw-types.js';

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

describe('Excalidraw Icon Integration', () => {
  beforeEach(() => {
    clearIconCache();
  });

  describe('Type Definitions', () => {
    it('should define valid icon positions', () => {
      const validPositions = ['inside', 'left', 'top-right', 'above'];
      const positions = ['inside', 'left', 'top-right', 'above'];
      positions.forEach(pos => {
        expect(validPositions).toContain(pos);
      });
    });

    it('should allow elements with icon field', () => {
      const element: ElementDef = {
        id: 'test-1',
        type: 'rectangle',
        x: 100,
        y: 200,
        width: 200,
        height: 100,
        text: 'Test Node',
        icon: {
          name: 'book',
          position: 'inside',
        },
      };

      expect(element.icon).toBeDefined();
      expect(element.icon?.name).toBe('book');
      expect(element.icon?.position).toBe('inside');
    });

    it('should allow elements without icon field', () => {
      const element: ElementDef = {
        id: 'test-2',
        type: 'ellipse',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        text: 'No Icon',
      };

      expect(element.icon).toBeUndefined();
    });
  });

  describe('Icon Library', () => {
    it('should contain all required icon categories', () => {
      const categories = getIconCategories();
      expect(categories).toHaveProperty('concept');
      expect(categories).toHaveProperty('action');
      expect(categories).toHaveProperty('status');
      expect(categories).toHaveProperty('entity');
      expect(categories).toHaveProperty('flow');
    });

    it('should provide 32 icons across categories', () => {
      const allIcons = getAllIconNames();
      expect(allIcons.length).toBe(32);
    });

    it('should suggest icons based on Chinese text', () => {
      expect(suggestIconForText('阅读笔记')).toBe('book');
      expect(suggestIconForText('思维导图')).toBe('brain');
      expect(suggestIconForText('创意灵感')).toBe('lightbulb');
      expect(suggestIconForText('目标管理')).toBe('target');
    });

    it('should return null for unmatched text', () => {
      expect(suggestIconForText('xyz123')).toBeNull();
    });
  });

  describe('Icon Processor', () => {
    it('should calculate correct icon positions', () => {
      const element: ElementDef = {
        id: 'node-1',
        type: 'rectangle',
        x: 100,
        y: 200,
        width: 200,
        height: 100,
        text: 'Test',
      };

      // Test inside position (size = 40)
      const insidePos = calculateIconPosition('inside', element, 40);
      expect(insidePos.x).toBe(112); // 100 + 12 padding
      expect(insidePos.y).toBe(230); // 200 + (100-40)/2

      // Test left position (size = 48)
      const leftPos = calculateIconPosition('left', element, 48);
      expect(leftPos.x).toBe(40); // 100 - 48 - 12
      expect(leftPos.y).toBe(226); // 200 + (100-48)/2

      // Test top-right position (size = 48)
      const topRightPos = calculateIconPosition('top-right', element, 48);
      expect(topRightPos.x).toBe(240); // 100 + 200 - 48 - 12
      expect(topRightPos.y).toBe(140); // 200 - 48 - 12
    });

    it('should process multiple elements with icons', () => {
      const elements: ElementDef[] = [
        {
          id: 'e1',
          type: 'rectangle',
          x: 100,
          y: 200,
          width: 200,
          height: 100,
          icon: { name: 'book', position: 'inside' },
        },
        {
          id: 'e2',
          type: 'ellipse',
          x: 300,
          y: 200,
          width: 150,
          height: 80,
          icon: { name: 'lightbulb', position: 'left' },
        },
        {
          id: 'e3',
          type: 'text',
          x: 50,
          y: 100,
          width: 100,
          height: 30,
          text: 'Plain text',
        },
      ];

      const results = processIconsSync(elements);
      expect(results).toHaveLength(2);
      expect(results[0].element.id).toBe('e1');
      expect(results[1].element.id).toBe('e2');
    });

    it('should handle empty elements array', () => {
      const results = processIconsSync([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle missing icon library gracefully', async () => {
      // Test that loadIcon returns null for unknown icons
      const result = await loadIcon('nonexistent-icon');
      expect(result).toBeNull();
    });

    it('should handle network failures gracefully', async () => {
      // Mock fetch to simulate network error
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await loadIcon('book');
      expect(result).toBeNull();

      // Restore original fetch
      global.fetch = originalFetch;
    });

    it('should handle 404 responses gracefully', async () => {
      // Mock fetch to simulate 404
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await loadIcon('unknown-icon');
      expect(result).toBeNull();
    });

    it('should continue processing when some icons fail', () => {
      const elements: ElementDef[] = [
        {
          id: 'e1',
          type: 'rectangle',
          x: 100,
          y: 200,
          width: 200,
          height: 100,
          icon: { name: 'book', position: 'inside' },
        },
        {
          id: 'e2',
          type: 'rectangle',
          x: 300,
          y: 200,
          width: 200,
          height: 100,
          icon: { name: 'unknown-icon', position: 'inside' },
        },
        {
          id: 'e3',
          type: 'rectangle',
          x: 500,
          y: 200,
          width: 200,
          height: 100,
          icon: { name: 'lightbulb', position: 'inside' },
        },
      ];

      const results = processIconsSync(elements);
      expect(results).toHaveLength(3); // All elements processed, positions calculated
    });
  });

  describe('Full Workflow', () => {
    it('should handle complete icon workflow from suggestion to positioning', () => {
      // 1. Suggest icon based on text
      const suggestedIcon = suggestIconForText('阅读笔记');
      expect(suggestedIcon).toBe('book');

      // 2. Create element with icon
      const element: ElementDef = {
        id: 'reading-notes',
        type: 'rectangle',
        x: 100,
        y: 200,
        width: 200,
        height: 100,
        text: '阅读笔记',
        icon: {
          name: suggestedIcon!,
          position: 'inside',
        },
      };

      // 3. Process icon positioning
      const results = processIconsSync([element]);
      expect(results).toHaveLength(1);
      expect(results[0].iconPosition.x).toBe(112);
      expect(results[0].iconPosition.y).toBe(230);
    });

    it('should handle multiple nodes with different icon positions', () => {
      const elements: ElementDef[] = [
        {
          id: 'start',
          type: 'ellipse',
          x: 50,
          y: 100,
          width: 120,
          height: 80,
          text: '开始',
          icon: { name: 'play', position: 'inside' },
        },
        {
          id: 'process',
          type: 'rectangle',
          x: 250,
          y: 100,
          width: 200,
          height: 100,
          text: '处理数据',
          icon: { name: 'database', position: 'left' },
        },
        {
          id: 'decision',
          type: 'diamond',
          x: 550,
          y: 100,
          width: 120,
          height: 120,
          text: '验证通过？',
          icon: { name: 'check-circle', position: 'top-right' },
        },
        {
          id: 'end',
          type: 'ellipse',
          x: 750,
          y: 100,
          width: 120,
          height: 80,
          text: '结束',
          icon: { name: 'target', position: 'above' },
        },
      ];

      const results = processIconsSync(elements);
      expect(results).toHaveLength(4);

      // Verify each element has correct position calculation
      const startResult = results.find(r => r.element.id === 'start');
      expect(startResult?.iconPosition.x).toBe(62); // inside: 50 + 12

      const processResult = results.find(r => r.element.id === 'process');
      expect(processResult?.iconPosition.x).toBe(190); // left: 250 - 48 - 12

      const decisionResult = results.find(r => r.element.id === 'decision');
      expect(decisionResult?.iconPosition.x).toBe(610); // top-right: 550 + 120 - 48 - 12

      const endResult = results.find(r => r.element.id === 'end');
      expect(endResult?.iconPosition.x).toBe(786); // above: 750 + (120-48)/2
    });
  });
});

describe('End-to-end icon embedding (PRD #25/#29)', () => {
  const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path></svg>';

  beforeEach(() => {
    clearIconCache();
  });

  it('embeds icon as an Excalidraw image element in the generated file', async () => {
    // Mock CDN fetch to avoid network in tests
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => SAMPLE_SVG,
    });
    (global as any).fetch = fetchMock;

    const elements: ElementDef[] = [
      makeElement({
        id: 'r1',
        type: 'rectangle',
        semanticColor: 'primary',
        icon: { name: 'book', position: 'inside' },
      }),
    ];

    // 1. processIcons loads SVG + computes position
    const icons = await processIcons(elements, 'light');
    expect(icons).toHaveLength(1);
    expect(icons[0].elementId).toBe('r1');
    expect(icons[0].x).toBe(112); // inside: x + 12
    expect(icons[0].color).toBe('#0E7490'); // inherited from primary stroke

    // 2. buildExcalidrawJSON emits an `image` element + files entry
    const file = buildExcalidrawJSON(elements, 'mind-map', undefined, true, icons);
    const img = file.elements.find(e => e.type === 'image');
    expect(img).toBeDefined();
    expect(img!.fileId).toBe('icon-r1');
    expect(img!.x).toBe(112);
    expect(img!.width).toBe(40); // 40% of node height (100)

    const fileEntry = file.files['icon-r1'] as any;
    expect(fileEntry).toBeDefined();
    expect(fileEntry.mimeType).toBe('image/svg+xml');
    expect(fileEntry.dataURL).toContain('data:image/svg+xml;base64,');
    // color inherited: currentColor replaced with semantic stroke
    const decoded = Buffer.from(fileEntry.dataURL.split(',')[1], 'base64').toString('utf8');
    expect(decoded).toContain('#0E7490');
    expect(decoded).not.toContain('currentColor');
  });

  it('gracefully degrades when icon CDN fails (no image element, chart still valid)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    (global as any).fetch = fetchMock;

    const elements: ElementDef[] = [
      makeElement({ id: 'r1', type: 'rectangle', icon: { name: 'book', position: 'inside' } }),
    ];

    const icons = await processIcons(elements);
    expect(icons).toHaveLength(0); // skipped, no crash

    const file = buildExcalidrawJSON(elements, 'mind-map', undefined, true, icons);
    expect(file.elements.find(e => e.type === 'image')).toBeUndefined();
    expect(Object.keys(file.files)).toHaveLength(0);
    // the base shape is still present and valid
    expect(file.elements.find(e => e.id === 'r1')).toBeDefined();
  });
});
