import { describe, it, expect } from 'vitest';
import { routeByDepth, routeAfterInspectional } from '../../graph/edges.js';

describe('Cognitive Engine Graph — Edges', () => {
  describe('routeByDepth', () => {
    it('should route depth=0 to casual (END)', () => {
      expect(routeByDepth({ depth: 0 } as any)).toBe('casual');
    });

    it('should route depth=1 to inspectional', () => {
      expect(routeByDepth({ depth: 1 } as any)).toBe('inspectional');
    });

    it('should route depth=2 to analytical', () => {
      expect(routeByDepth({ depth: 2 } as any)).toBe('analytical');
    });

    it('should route depth=3 to analytical (syntopical downgrade)', () => {
      expect(routeByDepth({ depth: 3 } as any)).toBe('analytical');
    });
  });

  describe('routeAfterInspectional', () => {
    it('should route to formatter when depth=1 and structural analysis exists', () => {
      const state = { depth: 1, structuralAnalysis: '全书分为三部分...' } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });

    it('should route to analytical when depth=2', () => {
      const state = { depth: 2, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe('continue');
    });

    it('should route to analytical when no structural analysis', () => {
      const state = { depth: 1, structuralAnalysis: '' } as any;
      expect(routeAfterInspectional(state)).toBe('continue');
    });
  });
});

describe('Cognitive Engine Graph — State Annotation', () => {
  it('should export CognitiveEngineAnnotation', async () => {
    const { CognitiveEngineAnnotation } = await import('../../graph/state.js');
    expect(CognitiveEngineAnnotation).toBeDefined();
  });

  it('should export cognitiveEngine compiled graph', async () => {
    const { cognitiveEngine } = await import('../../graph/index.js');
    expect(cognitiveEngine).toBeDefined();
    expect(typeof cognitiveEngine.invoke).toBe('function');
    expect(typeof cognitiveEngine.stream).toBe('function');
  });
});
