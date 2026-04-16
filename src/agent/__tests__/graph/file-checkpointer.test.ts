/**
 * Tests for FileCheckpointer
 *
 * Uses an in-memory mock of Obsidian's vault adapter
 * to verify checkpoint persistence behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileCheckpointer } from '../../graph/checkpointer.js';
import type { Checkpoint, CheckpointTuple } from '@langchain/langgraph-checkpoint';
import { copyCheckpoint } from '@langchain/langgraph-checkpoint';

// === Mock Obsidian Vault Adapter ===

function createMockApp() {
  const files = new Map<string, string>();

  return {
    vault: {
      adapter: {
        exists: vi.fn(async (path: string) => files.has(path)),
        read: vi.fn(async (path: string) => {
          const content = files.get(path);
          if (content === undefined) throw new Error(`File not found: ${path}`);
          return content;
        }),
        write: vi.fn(async (path: string, content: string) => {
          files.set(path, content);
        }),
        remove: vi.fn(async (path: string) => {
          files.delete(path);
        }),
        mkdir: vi.fn(async (path: string) => {
          // Mock: just mark directory as existing
          files.set(path + '/', '');
        }),
      },
    },
    // Expose for assertions
    _files: files,
  };
}

type MockApp = ReturnType<typeof createMockApp>;

function makeConfig(threadId: string, checkpointId?: string) {
  return {
    configurable: {
      thread_id: threadId,
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

function makeCheckpoint(id: string): Checkpoint {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  };
}

describe('FileCheckpointer', () => {
  let app: MockApp;
  let checkpointer: FileCheckpointer;

  beforeEach(() => {
    app = createMockApp() as any;
    checkpointer = new FileCheckpointer(app as any);
  });

  describe('getTuple', () => {
    it('should return undefined when no checkpoints exist', async () => {
      const result = await checkpointer.getTuple(makeConfig('thread-1'));
      expect(result).toBeUndefined();
    });

    it('should return latest checkpoint after put', async () => {
      const cp = makeCheckpoint('cp-001');
      await checkpointer.put(makeConfig('thread-1'), cp, { source: 'input' } as any, {});

      const tuple = await checkpointer.getTuple(makeConfig('thread-1'));
      expect(tuple).toBeDefined();
      expect(tuple!.checkpoint.id).toBe('cp-001');
      expect(tuple!.config.configurable?.thread_id).toBe('thread-1');
      expect(tuple!.config.configurable?.checkpoint_id).toBe('cp-001');
    });

    it('should return specific checkpoint by id', async () => {
      const cp1 = makeCheckpoint('cp-001');
      const cp2 = makeCheckpoint('cp-002');

      await checkpointer.put(makeConfig('thread-1'), cp1, { source: 'input' } as any, {});
      await checkpointer.put(makeConfig('thread-1', 'cp-001'), cp2, { source: 'loop' } as any, {});

      // Get latest (cp-002)
      const latest = await checkpointer.getTuple(makeConfig('thread-1'));
      expect(latest!.checkpoint.id).toBe('cp-002');

      // Get specific (cp-001)
      const specific = await checkpointer.getTuple(makeConfig('thread-1', 'cp-001'));
      expect(specific!.checkpoint.id).toBe('cp-001');
    });

    it('should track parent checkpoint', async () => {
      const cp1 = makeCheckpoint('cp-001');
      const cp2 = makeCheckpoint('cp-002');

      const config1 = await checkpointer.put(makeConfig('thread-1'), cp1, { source: 'input' } as any, {});
      await checkpointer.put(config1, cp2, { source: 'loop' } as any, {});

      const tuple = await checkpointer.getTuple(makeConfig('thread-1'));
      expect(tuple!.parentConfig?.configurable?.checkpoint_id).toBe('cp-001');
    });
  });

  describe('put', () => {
    it('should persist checkpoint to file', async () => {
      const cp = makeCheckpoint('cp-001');
      const config = await checkpointer.put(makeConfig('thread-1'), cp, { source: 'input' } as any, {});

      expect(config.configurable?.checkpoint_id).toBe('cp-001');
      // File should have been written
      expect(app.vault.adapter.write).toHaveBeenCalled();
    });

    it('should append multiple checkpoints', async () => {
      const cp1 = makeCheckpoint('cp-001');
      const cp2 = makeCheckpoint('cp-002');

      await checkpointer.put(makeConfig('thread-1'), cp1, { source: 'input' } as any, {});
      await checkpointer.put(makeConfig('thread-1', 'cp-001'), cp2, { source: 'loop' } as any, {});

      // Should have 2 writes
      expect(app.vault.adapter.write).toHaveBeenCalledTimes(2);
    });
  });

  describe('list', () => {
    it('should list checkpoints from newest to oldest', async () => {
      const cp1 = makeCheckpoint('cp-001');
      const cp2 = makeCheckpoint('cp-002');
      const cp3 = makeCheckpoint('cp-003');

      const config1 = await checkpointer.put(makeConfig('thread-1'), cp1, { source: 'input' } as any, {});
      const config2 = await checkpointer.put(config1, cp2, { source: 'loop' } as any, {});
      await checkpointer.put(config2, cp3, { source: 'loop' } as any, {});

      const tuples: CheckpointTuple[] = [];
      for await (const tuple of checkpointer.list(makeConfig('thread-1'))) {
        tuples.push(tuple);
      }

      expect(tuples).toHaveLength(3);
      expect(tuples[0].checkpoint.id).toBe('cp-003');
      expect(tuples[1].checkpoint.id).toBe('cp-002');
      expect(tuples[2].checkpoint.id).toBe('cp-001');
    });

    it('should respect limit option', async () => {
      const cp1 = makeCheckpoint('cp-001');
      const cp2 = makeCheckpoint('cp-002');

      const config1 = await checkpointer.put(makeConfig('thread-1'), cp1, { source: 'input' } as any, {});
      await checkpointer.put(config1, cp2, { source: 'loop' } as any, {});

      const tuples: CheckpointTuple[] = [];
      for await (const tuple of checkpointer.list(makeConfig('thread-1'), { limit: 1 })) {
        tuples.push(tuple);
      }

      expect(tuples).toHaveLength(1);
      expect(tuples[0].checkpoint.id).toBe('cp-002');
    });
  });

  describe('deleteThread', () => {
    it('should remove all checkpoint files for a thread', async () => {
      const cp = makeCheckpoint('cp-001');
      await checkpointer.put(makeConfig('thread-1'), cp, { source: 'input' } as any, {});

      await checkpointer.deleteThread('thread-1');

      const result = await checkpointer.getTuple(makeConfig('thread-1'));
      expect(result).toBeUndefined();
    });
  });

  describe('putWrites', () => {
    it('should store and retrieve pending writes', async () => {
      const cp = makeCheckpoint('cp-001');
      const config = await checkpointer.put(makeConfig('thread-1'), cp, { source: 'input' } as any, {});

      await checkpointer.putWrites(config, [['channel1', 'value1']], 'task-1');

      const tuple = await checkpointer.getTuple(makeConfig('thread-1'));
      expect(tuple!.pendingWrites).toBeDefined();
      expect(tuple!.pendingWrites!.length).toBeGreaterThan(0);
    });
  });
});
