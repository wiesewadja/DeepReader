/**
 * Memory 工具 - Agent 记忆管理
 *
 * 提供：
 * - save_memory: 保存重要信息到长期记忆 + 追加历史日志
 * - search_memory: 搜索记忆内容
 *
 * 设计参考: nanobot 的 memory.py
 */

import { toolsLog as log, error } from '../../utils/logger.js';
import { MemoryStore } from '../memory/store.js';
import type { ToolExecutor, ToolContext } from './types.js';

/**
 * 创建 save_memory 工具执行器
 */
export function createSaveMemoryTool(): ToolExecutor {
	return {
		async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
			const historyEntry = args.history_entry as string;
			const memoryUpdate = args.memory_update as string | undefined;

			if (!historyEntry || typeof historyEntry !== 'string') {
				return 'Error: history_entry 参数是必需的，且必须是字符串';
			}

			if (!context.vault?.app) {
				return 'Error: Obsidian App 实例不可用';
			}

			const store = new MemoryStore(context.vault.app);

			try {
				// 1. 追加历史条目
				await store.appendHistory(historyEntry);

				// 2. 更新长期记忆（如果有）
				if (memoryUpdate) {
					const existingMemory = await store.readLongTermMemory();
					const timestamp = new Date().toISOString().split('T')[0];

					if (existingMemory) {
						// 追加更新
						const updatedMemory = `${existingMemory.trim()}\n\n### ${timestamp}\n${memoryUpdate}`;
						await store.writeLongTermMemory(updatedMemory);
					} else {
						// 创建新的记忆文件
						const newMemory = `# 长期记忆

此文件存储关于用户的重要信息，会在对话中自动更新。

---

### ${timestamp}
${memoryUpdate}

---

*此文件由 DeepReader Agent 自动维护，你也可以直接编辑*`;
						await store.writeLongTermMemory(newMemory);
					}
				}

				log('[save_memory] 记忆已保存');
				return '记忆已成功保存。';
			} catch (err) {
				error('[save_memory] 执行失败:', err);
				return `保存记忆时出错: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	};
}

/**
 * 创建 search_memory 工具执行器
 */
export function createSearchMemoryTool(): ToolExecutor {
	return {
		async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
			const query = args.query as string;

			if (!query || typeof query !== 'string') {
				return 'Error: query 参数是必需的，且必须是字符串';
			}

			if (!context.vault?.app) {
				return 'Error: Obsidian App 实例不可用';
			}

			const store = new MemoryStore(context.vault.app);

			try {
				const results: string[] = [];

				// 1. 搜索长期记忆 (MEMORY.md)
				const longTermMemory = await store.readLongTermMemory();
				if (longTermMemory) {
					const keywords = query.toLowerCase().split(/\s+/);
					const lines = longTermMemory.split('\n');
					for (const line of lines) {
						const lineLower = line.toLowerCase();
						if (keywords.some((kw) => lineLower.includes(kw)) && line.trim().length > 10) {
							results.push(`[记忆] ${line.trim()}`);
						}
					}
				}

				// 2. 搜索阅读历程 (HISTORY.md)
				const historyMatches = await store.searchHistory(query, 10);
				for (const match of historyMatches) {
					results.push(`[历程] ${match}`);
				}

				if (results.length === 0) {
					return `未找到与 "${query}" 相关的记忆。`;
				}

				// 去重并限制数量
				const uniqueResults = [...new Set(results)].slice(0, 15);

				return `找到 ${uniqueResults.length} 条相关记录：\n\n${uniqueResults.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
			} catch (err) {
				error('[search_memory] 执行失败:', err);
				return `搜索记忆时出错: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	};
}

// 导出工具定义（用于注册）
export const saveMemoryTool: ToolExecutor = {
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		if (!context.vault?.app) {
			return 'Error: Obsidian App 实例不可用';
		}
		return createSaveMemoryTool().execute(args, context);
	},
};

export const searchMemoryTool: ToolExecutor = {
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		if (!context.vault?.app) {
			return 'Error: Obsidian App 实例不可用';
		}
		return createSearchMemoryTool().execute(args, context);
	},
};

// 兼容旧名称（废弃，但保持向后兼容）
export const createAddMemoryTool = createSaveMemoryTool;
export const addMemoryTool = saveMemoryTool;
