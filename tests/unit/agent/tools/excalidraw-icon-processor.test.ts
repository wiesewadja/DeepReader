/**
 * excalidraw-icon-processor 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateIconPosition,
  processIconsSync,
} from '../../../../src/agent/tools/excalidraw/excalidraw-icon-processor.js';
import type { ElementDef } from '../../../../src/agent/tools/excalidraw/excalidraw-types.js';

describe('excalidraw-icon-processor', () => {
  describe('calculateIconPosition', () => {
    const element: ElementDef = {
      id: 'test-1',
      type: 'rectangle',
      x: 100,
      y: 200,
      width: 200,
      height: 100,
      text: 'Test',
    };

    it('should position icon inside-left of element', () => {
      const pos = calculateIconPosition('inside', element, 40);
      // x: 100 + 12 = 112, y: 200 + (100-40)/2 = 230
      expect(pos.x).toBe(112);
      expect(pos.y).toBe(230);
    });

    it('should position icon to the left of element', () => {
      const pos = calculateIconPosition('left', element, 48);
      // x: 100 - 48 - 12 = 40, y: 200 + (100-48)/2 = 226
      expect(pos.x).toBe(40);
      expect(pos.y).toBe(226);
    });

    it('should position icon at top-right of element', () => {
      const pos = calculateIconPosition('top-right', element, 48);
      // x: 100 + 200 - 48 - 12 = 240, y: 200 - 48 - 12 = 140
      expect(pos.x).toBe(240);
      expect(pos.y).toBe(140);
    });

    it('should position icon above element', () => {
      const pos = calculateIconPosition('above', element, 48);
      // x: 100 + (200-48)/2 = 176, y: 200 - 48 - 12 = 140
      expect(pos.x).toBe(176);
      expect(pos.y).toBe(140);
    });

    it('should default to inside when position is unknown', () => {
      const pos = calculateIconPosition('unknown' as any, element, 40);
      expect(pos.x).toBe(112);
      expect(pos.y).toBe(230);
    });
  });

  describe('processIconsSync', () => {
    it('should return empty array for elements without icons', () => {
      const elements: ElementDef[] = [
        { id: 'e1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
        { id: 'e2', type: 'text', x: 0, y: 0, width: 50, height: 20, text: 'Hello' },
      ];
      const results = processIconsSync(elements);
      expect(results).toHaveLength(0);
    });

    it('should calculate positions for elements with icons', () => {
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
      ];
      const results = processIconsSync(elements);
      expect(results).toHaveLength(2);
      expect(results[0].element.id).toBe('e1');
      expect(results[0].iconPosition.x).toBe(112); // inside: 100 + 12
      expect(results[1].element.id).toBe('e2');
      expect(results[1].iconPosition.x).toBe(240); // left: 300 - 48 - 12
    });

    it('should default position to inside when not specified', () => {
      const elements: ElementDef[] = [
        {
          id: 'e1',
          type: 'rectangle',
          x: 100,
          y: 200,
          width: 200,
          height: 100,
          icon: { name: 'book' }, // no position
        },
      ];
      const results = processIconsSync(elements);
      expect(results).toHaveLength(1);
      // Default to inside
      expect(results[0].iconPosition.x).toBe(112);
    });
  });
});
