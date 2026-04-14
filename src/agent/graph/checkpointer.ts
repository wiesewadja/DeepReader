/**
 * FileCheckpointer — JSONL 文件系统持久化 Checkpointer
 *
 * 替换 MemorySaver，支持跨 Obsidian 重启的状态恢复。
 * 每个 thread 的 checkpoint 存储为一个 JSONL 文件。
 *
 * 目录结构：
 *   .obsidian/plugins/deepreader/checkpoints/
 *     {thread_id}.jsonl     — checkpoint 数据（追加写入）
 *     {thread_id}.writes.jsonl — pending writes 数据
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type CheckpointPendingWrite,
  type PendingWrite,
  copyCheckpoint,
} from '@langchain/langgraph-checkpoint';
import type { App } from 'obsidian';
import { normalizePath, TFile } from 'obsidian';
import { agentLog as log } from '../../utils/logger.js';

/** Checkpoints 目录路径（相对于 vault root） */
const CHECKPOINTS_DIR = '.obsidian/plugins/deepreader/checkpoints';

/**
 * 读取 JSONL 文件的所有行。
 * 文件不存在返回空数组。
 */
async function readJsonlLines(app: App, filePath: string): Promise<string[]> {
  const exists = await app.vault.adapter.exists(filePath);
  if (!exists) return [];
  const content = await app.vault.adapter.read(filePath);
  return content.split('\n').filter(line => line.trim().length > 0);
}

/**
 * 追加一行到 JSONL 文件。
 * 文件不存在时自动创建。
 */
async function appendJsonlLine(app: App, filePath: string, line: string): Promise<void> {
  const exists = await app.vault.adapter.exists(filePath);
  if (exists) {
    const existing = await app.vault.adapter.read(filePath);
    await app.vault.adapter.write(filePath, existing + '\n' + line);
  } else {
    // 确保目录存在
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (!(await app.vault.adapter.exists(dir))) {
      await app.vault.adapter.mkdir(dir);
    }
    await app.vault.adapter.write(filePath, line);
  }
}

/**
 * 从 config 中提取 thread_id
 */
function getThreadId(config: RunnableConfig): string {
  return (config.configurable?.thread_id as string) ?? 'default';
}

/**
 * 从 config 中提取 checkpoint_id（如果有）
 */
function getCheckpointId(config: RunnableConfig): string | undefined {
  return config.configurable?.checkpoint_id as string | undefined;
}

/**
 * FileCheckpointer: 基于 Obsidian Vault 文件系统的 LangGraph Checkpointer。
 *
 * 每次图执行时，LangGraph 会在每个节点完成后调用 `put()` 保存 checkpoint。
 * `interrupt()` 暂停时，最后一个 checkpoint 包含中断状态，可用于跨重启恢复。
 *
 * 存储格式：
 * - 每个 thread 一个 JSONL 文件
 * - 每行是一个 JSON 对象: { checkpoint, metadata, parentCheckpointId }
 * - 最后一行是最新 checkpoint
 */
export class FileCheckpointer extends BaseCheckpointSaver {
  private app: App;
  private checkpointsDir: string;

  constructor(app: App) {
    super();
    this.app = app;
    this.checkpointsDir = normalizePath(CHECKPOINTS_DIR);
  }

  /** 获取指定 thread 的 JSONL 文件路径 */
  private checkpointPath(threadId: string): string {
    return normalizePath(`${this.checkpointsDir}/${threadId}.jsonl`);
  }

  /** 获取指定 thread 的 pending writes 文件路径 */
  private writesPath(threadId: string): string {
    return normalizePath(`${this.checkpointsDir}/${threadId}.writes.jsonl`);
  }

  /**
   * 获取最新的 CheckpointTuple。
   *
   * 如果 config 中指定了 checkpoint_id，返回对应的 checkpoint。
   * 否则返回最新的 checkpoint。
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = getThreadId(config);
    const checkpointId = getCheckpointId(config);
    const filePath = this.checkpointPath(threadId);

    const lines = await readJsonlLines(this.app, filePath);
    if (lines.length === 0) return undefined;

    if (checkpointId) {
      // 查找指定 checkpoint_id
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const record = JSON.parse(lines[i]);
          if (record.checkpoint?.id === checkpointId) {
            return {
              config: {
                configurable: {
                  thread_id: threadId,
                  checkpoint_id: record.checkpoint.id,
                },
              },
              checkpoint: record.checkpoint as Checkpoint,
              metadata: record.metadata as CheckpointMetadata | undefined,
              parentConfig: record.parentCheckpointId
                ? {
                    configurable: {
                      thread_id: threadId,
                      checkpoint_id: record.parentCheckpointId,
                    },
                  }
                : undefined,
              pendingWrites: await this.loadPendingWrites(threadId, record.checkpoint.id),
            };
          }
        } catch {
          // 跳过损坏行
        }
      }
      return undefined;
    }

    // 返回最新 checkpoint（最后一行）
    try {
      const record = JSON.parse(lines[lines.length - 1]);
      return {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_id: record.checkpoint.id,
          },
        },
        checkpoint: record.checkpoint as Checkpoint,
        metadata: record.metadata as CheckpointMetadata | undefined,
        parentConfig: record.parentCheckpointId
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_id: record.parentCheckpointId,
              },
            }
          : undefined,
        pendingWrites: await this.loadPendingWrites(threadId, record.checkpoint.id),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * 列出所有 checkpoint（从新到旧）。
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = getThreadId(config);
    const filePath = this.checkpointPath(threadId);
    const limit = options?.limit ?? Infinity;

    const lines = await readJsonlLines(this.app, filePath);

    // 从最新到最旧
    let count = 0;
    for (let i = lines.length - 1; i >= 0 && count < limit; i--) {
      try {
        const record = JSON.parse(lines[i]);
        const checkpoint = record.checkpoint as Checkpoint;

        // 如果指定了 before，跳过更新的 checkpoint
        if (options?.before?.configurable?.checkpoint_id) {
          const beforeId = options.before.configurable.checkpoint_id as string;
          if (checkpoint.id === beforeId) continue;
        }

        yield {
          config: {
            configurable: {
              thread_id: threadId,
              checkpoint_id: checkpoint.id,
            },
          },
          checkpoint,
          metadata: record.metadata as CheckpointMetadata | undefined,
          parentConfig: record.parentCheckpointId
            ? {
                configurable: {
                  thread_id: threadId,
                  checkpoint_id: record.parentCheckpointId,
                },
              }
            : undefined,
        };
        count++;
      } catch {
        // 跳过损坏行
      }
    }
  }

  /**
   * 保存 checkpoint。
   *
   * 返回更新后的 config（包含新的 checkpoint_id）。
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Record<string, string | number>,
  ): Promise<RunnableConfig> {
    const threadId = getThreadId(config);
    const filePath = this.checkpointPath(threadId);
    const parentCheckpointId = getCheckpointId(config);

    const record = {
      checkpoint: copyCheckpoint(checkpoint),
      metadata,
      parentCheckpointId: parentCheckpointId ?? null,
      newVersions,
      ts: Date.now(),
    };

    await appendJsonlLine(this.app, filePath, JSON.stringify(record));

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  /**
   * 保存 pending writes（节点执行中间结果）。
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = getThreadId(config);
    const checkpointId = getCheckpointId(config);
    if (!checkpointId) return;

    const writesFilePath = this.writesPath(threadId);
    const record = { checkpointId, taskId, writes };

    await appendJsonlLine(this.app, writesFilePath, JSON.stringify(record));
  }

  /**
   * 删除指定 thread 的所有 checkpoint 和 writes。
   */
  async deleteThread(threadId: string): Promise<void> {
    const cpPath = this.checkpointPath(threadId);
    const wrPath = this.writesPath(threadId);

    if (await this.app.vault.adapter.exists(cpPath)) {
      await this.app.vault.adapter.remove(cpPath);
    }
    if (await this.app.vault.adapter.exists(wrPath)) {
      await this.app.vault.adapter.remove(wrPath);
    }
  }

  /**
   * 加载指定 checkpoint 的 pending writes。
   */
  private async loadPendingWrites(
    threadId: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[] | undefined> {
    const writesFilePath = this.writesPath(threadId);
    const lines = await readJsonlLines(this.app, writesFilePath);
    if (lines.length === 0) return undefined;

    const writes: CheckpointPendingWrite[] = [];
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.checkpointId === checkpointId) {
          writes.push(...(record.writes as CheckpointPendingWrite[]));  // eslint-disable-line @typescript-eslint/no-unsafe-argument
        }
      } catch {
        // 跳过损坏行
      }
    }

    return writes.length > 0 ? writes : undefined;
  }
}
