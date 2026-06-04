import { describe, it, expect } from 'vitest';
import { routeAfterPreSearch } from '@/agent/graph/edges';
import { NODE_NAMES } from '@/agent/graph/node-names';
import type { CognitiveEngineState } from '@/agent/graph/state';

describe('routeAfterPreSearch', () => {
  it('no early stop → analytical', () => {
    const state = { earlyStopContent: '', allowedTools: [] } as unknown as CognitiveEngineState;
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.ANALYTICAL);
  });

  it('early stop + no diagram tools → formatter', () => {
    const state = { earlyStopContent: 'done', allowedTools: [] } as unknown as CognitiveEngineState;
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.FORMATTER);
  });

  it('early stop + excalidraw → visualizer', () => {
    const state = {
      earlyStopContent: 'done',
      allowedTools: ['excalidraw'],
    } as unknown as CognitiveEngineState;
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.FORMATTER);
  });


  it('early stop + unrelated tools → formatter', () => {
    const state = {
      earlyStopContent: 'done',
      allowedTools: ['search_book', 'write_note'],
    } as unknown as CognitiveEngineState;
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.FORMATTER);
  });

  it('no early stop + diagram tools still goes analytical', () => {
    const state = {
      earlyStopContent: '',
      allowedTools: ['excalidraw'],
    } as unknown as CognitiveEngineState;
    expect(routeAfterPreSearch(state)).toBe(NODE_NAMES.ANALYTICAL);
  });
});
