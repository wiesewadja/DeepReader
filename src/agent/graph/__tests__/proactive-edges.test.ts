import { describe, it, expect } from 'vitest';
import { routeFromStart, routeByDepth, routeAfterInspectional } from '../edges';

describe('proactive edge routing', () => {
  describe('routeFromStart', () => {
    it('routes to inspectional when isProactive=true', () => {
      const state = { isProactive: true, depth: 1 } as any;
      expect(routeFromStart(state)).toBe('inspectional');
    });

    it('routes to router when isProactive=false', () => {
      const state = { isProactive: false } as any;
      expect(routeFromStart(state)).toBe('router');
    });

    it('routes to router when isProactive is undefined', () => {
      const state = {} as any;
      expect(routeFromStart(state)).toBe('router');
    });
  });

  describe('routeAfterInspectional — proactive', () => {
    it('routes to done when isProactive=true', () => {
      const state = { isProactive: true, depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });

    it('routes to done even at depth=2 when isProactive=true', () => {
      const state = { isProactive: true, depth: 2 } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });
  });

  describe('routeByDepth — unchanged', () => {
    it('still routes depth=0 to formatter', () => {
      const state = { depth: 0 } as any;
      expect(routeByDepth(state)).toBe('formatter');
    });

    it('still routes depth>=1 to inspectional', () => {
      const state = { depth: 2 } as any;
      expect(routeByDepth(state)).toBe('inspectional');
    });
  });
});
