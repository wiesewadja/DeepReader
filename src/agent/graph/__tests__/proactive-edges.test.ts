import { describe, it, expect, afterEach } from 'vitest';
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

  describe('routeAfterInspectional — proactive + visualizer', () => {
    afterEach(() => {
      delete (globalThis as any).ExcalidrawAutomate;
    });

    it('routes to visualizer for inspectional when Excalidraw available', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, proactiveTrigger: 'inspectional', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe('visualizer');
    });

    it('routes to done for inspectional when Excalidraw not available', () => {
      const state = { isProactive: true, proactiveTrigger: 'inspectional', depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });

    it('routes to done for highlight trigger even with Excalidraw', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, proactiveTrigger: 'highlight', depth: 1 } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });

    it('routes to done for chapter trigger even with Excalidraw', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, proactiveTrigger: 'chapter', depth: 1 } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });

    it('routes to done when proactiveTrigger is undefined', () => {
      (globalThis as any).ExcalidrawAutomate = {};
      const state = { isProactive: true, depth: 1, structuralAnalysis: '...' } as any;
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
