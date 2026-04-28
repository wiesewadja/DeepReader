import { describe, it, expect } from 'vitest';
import { routeAfterAnalysis } from '../edges';

describe('socratic edge routing', () => {
  describe('routeAfterAnalysis — socratic mode', () => {
    it('routes to socratic when isSocratic=true', () => {
      const state = { isSocratic: true, allowedTools: [] } as any;
      expect(routeAfterAnalysis(state)).toBe('socratic');
    });

    it('routes to formatter when isSocratic=false', () => {
      const state = { isSocratic: false, allowedTools: [] } as any;
      expect(routeAfterAnalysis(state)).toBe('formatter');
    });

    it('routes to formatter when isSocratic is undefined', () => {
      const state = { allowedTools: [] } as any;
      expect(routeAfterAnalysis(state)).toBe('formatter');
    });

    it('routes to visualizer when isSocratic=true + diagram intent', () => {
      const state = { isSocratic: true, allowedTools: ['excalidraw'] } as any;
      expect(routeAfterAnalysis(state)).toBe('visualizer');
    });

    it('routes to visualizer when isSocratic=false + diagram intent', () => {
      const state = { isSocratic: false, allowedTools: ['excalidraw'] } as any;
      expect(routeAfterAnalysis(state)).toBe('visualizer');
    });
  });
});
