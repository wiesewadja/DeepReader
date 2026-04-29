import { describe, it, expect } from 'vitest';
import { routeAfterAnalysis } from '../edges';

describe('routeAfterAnalysis', () => {
  it('routes to formatter when no diagram intent', () => {
    const state = { allowedTools: [] } as any;
    expect(routeAfterAnalysis(state)).toBe('formatter');
  });

  it('routes to visualizer when diagram intent', () => {
    const state = { allowedTools: ['excalidraw'] } as any;
    expect(routeAfterAnalysis(state)).toBe('visualizer');
  });

  it('isSocratic no longer affects routing (socratic-filter removed)', () => {
    const state = { isSocratic: true, allowedTools: [] } as any;
    expect(routeAfterAnalysis(state)).toBe('formatter');
  });
});
