/**
 * Memory 工具 - Agent 记忆管理
 *
 * 提供：
 * - save_memory: 保存重要信息到长期记忆 + 追加历史日志
 * - search_memory: 搜索记忆内容
 *
 * 设计参考: nanobot 的 memory.py
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { MemoryStore } from '../memory/store.js';
import { toolsLog as log, error } from '../../utils/logger.js';

/**
 * save_memory 工具定义
 *
 * 这是 LLM 调用的工具，用于：
 * 1. 将重要对话内容追加到 HISTORY.md
 * 2. 更新 MEMORY.md（用户画像、偏好等）
 */
export const saveMemoryDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'save_memory',
		description: `保存重要信息到长期记忆。写入对话摘要到 HISTORY.md，更新用户画像到 MEMORY.md。用于用户表达偏好、纠正行为、提供个人信息时。`,
		parameters: {
			type: 'object',
			properties: {
				history_entry: {
					type: 'string',
					description: '对话摘要，简洁描述本次对话的要点',
				},
				memory_update: {
					type: 'string',
					description: '需要更新到 MEMORY.md 的内容（用户画像、偏好变化等）',
				},
			},
			required: ['history_entry'],
		},
	},
};

/**
 * search_memory 工具定义
 */
const searchMemoryDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'search_memory',
		description: `搜索用户记忆和阅读历程（MEMORY.md + HISTORY.md）。用于"我读过什么书"、"读到哪里了"等查询。`,
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: '搜索关键词，用空格分隔多个词（如"学会提问 批判性思维"）',
				},
			},
			required: ['query'],
		},
	},
};

/**
 * 创建 save_memory 工具执行器
 */
export function createSaveMemoryTool(_app: any): ToolExecutor {
	return {
		definition: saveMemoryDefinition,
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
export function createSearchMemoryTool(_app: any): ToolExecutor {
	return {
		definition: searchMemoryDefinition,
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
	definition: saveMemoryDefinition,
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		if (!context.vault?.app) {
			return 'Error: Obsidian App 实例不可用';
		}
		return createSaveMemoryTool(context.vault.app).execute(args, context);
	},
};

export const searchMemoryTool: ToolExecutor = {
	definition: searchMemoryDefinition,
	async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
		if (!context.vault?.app) {
			return 'Error: Obsidian App 实例不可用';
		}
		return createSearchMemoryTool(context.vault.app).execute(args, context);
	},
};

// 兼容旧名称（废弃，但保持向后兼容）
export const addMemoryDefinition = saveMemoryDefinition;
export const createAddMemoryTool = createSaveMemoryTool;
export const addMemoryTool = saveMemoryTool;
