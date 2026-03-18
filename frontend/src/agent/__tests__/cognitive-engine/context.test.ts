import { describe, it, expect } from 'vitest';
import { createSharedContext } from '../../cognitive-engine/context';

describe('SharedContext', () => {
  it('should create context with required fields', () => {
    const ctx = createSharedContext({
      indexId: 'test-index',
      pdfName: 'Test Book',
      rawUserQuery: 'What is MECE?',
    });

    expect(ctx.indexId).toBe('test-index');
    expect(ctx.pdfName).toBe('Test Book');
    expect(ctx.rawUserQuery).toBe('What is MECE?');
    expect(ctx.depth).toBe(2); // default
    expect(ctx.chatHistory).toEqual([]);
    expect(ctx.executedStates).toBeInstanceOf(Set);
    expect(ctx.stateResults).toBeInstanceOf(Map);
  });

  describe('markStateExecuted', () => {
    it('should track executed states', () => {
      const ctx = createSharedContext({
        indexId: 'test',
        pdfName: 'Book',
        rawUserQuery: 'query',
      });

      ctx.markStateExecuted('Router', true, undefined, 150);

      expect(ctx.executedStates.has('Router')).toBe(true);
      expect(ctx.needsStateExecution('Router')).toBe(false);
      expect(ctx.isStateSuccessful('Router')).toBe(true);
    });

    it('should track failed states', () => {
      const ctx = createSharedContext({
        indexId: 'test',
        pdfName: 'Book',
        rawUserQuery: 'query',
      });

      ctx.markStateExecuted('Inspectional', false, 'Timeout', 5000);

      expect(ctx.executedStates.has('Inspectional')).toBe(true);
      expect(ctx.isStateSuccessful('Inspectional')).toBe(false);

      const result = ctx.stateResults.get('Inspectional');
      expect(result?.error).toBe('Timeout');
      expect(result?.duration).toBe(5000);
    });
  });

  describe('needsStateExecution', () => {
    it('should return true for unexecuted states', () => {
      const ctx = createSharedContext({
        indexId: 'test',
        pdfName: 'Book',
        rawUserQuery: 'query',
      });

      expect(ctx.needsStateExecution('Router')).toBe(true);
      expect(ctx.needsStateExecution('Analytical')).toBe(true);
    });

    it('should return false for executed states', () => {
      const ctx = createSharedContext({
        indexId: 'test',
        pdfName: 'Book',
        rawUserQuery: 'query',
      });

      ctx.markStateExecuted('Router', true);
      expect(ctx.needsStateExecution('Router')).toBe(false);
    });
  });
});