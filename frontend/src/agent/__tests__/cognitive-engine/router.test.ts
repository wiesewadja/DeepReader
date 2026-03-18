import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouterState } from '../../cognitive-engine/states/router';
import { createSharedContext } from '../../cognitive-engine/context';
import type { SharedContext } from '../../cognitive-engine/types';

describe('RouterState', () => {
  let routerState: RouterState;
  let ctx: SharedContext;

  beforeEach(() => {
    routerState = new RouterState();
    ctx = createSharedContext({
      indexId: 'test',
      pdfName: 'Test Book',
      rawUserQuery: '这本书讲了什么？',
    });
  });

  it('should have correct metadata', () => {
    expect(routerState.name).toBe('Router');
    expect(routerState.model).toBe('fast');
    expect(routerState.tools).toEqual([]);
  });

  it('should route macro overview query to depth 1 via regex', async () => {
    ctx.rawUserQuery = '这本书的核心观点是什么？';

    await routerState.execute(ctx);

    expect(ctx.depth).toBe(1);
    expect(ctx.standaloneQuery).toBe('这本书的核心观点是什么？');
    expect(ctx.detectedIntents).toContain('检视阅读');
  });

  it('should route concept inquiry to depth 2 via regex', async () => {
    ctx.rawUserQuery = '什么是MECE？';

    await routerState.execute(ctx);

    expect(ctx.depth).toBe(2);
    expect(ctx.standaloneQuery).toBe('什么是MECE？');
  });

  it('should route syntopical query to depth 3 via regex', async () => {
    ctx.rawUserQuery = '这本书和《金字塔原理》有什么异同？';

    await routerState.execute(ctx);

    expect(ctx.depth).toBe(3);
    expect(ctx.detectedIntents).toContain('主题阅读');
  });

  it('should fallback to depth 2 for unknown queries', async () => {
    ctx.rawUserQuery = '一些随机的问题';

    await routerState.execute(ctx);

    expect(ctx.depth).toBe(2); // fallback
  });

  it('should mark state as executed', async () => {
    await routerState.execute(ctx);

    expect(ctx.executedStates.has('Router')).toBe(true);
    expect(ctx.isStateSuccessful('Router')).toBe(true);
  });
});