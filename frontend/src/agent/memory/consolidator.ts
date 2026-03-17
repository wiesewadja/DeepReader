/**
 * MemoryConsolidator - 记忆整合器
 *
 * 参考 nanobot 的 MemoryConsolidator 设计：
 * 1. Token 阈值检测
 * 2. 在用户消息边界切割
 * 3. 调用 LLM 生成整合结果
 * 4. 更新 MEMORY.md 和 HISTORY.md
 */

import type { ChatMessage } from '../types';
import { MemoryStore } from './store';
import type { ConsolidationResult, ConsolidatorConfig } from './types';
import { DEFAULT_CONSOLIDATOR_CONFIG } from './types';
import { estimateTokens } from '../agent-loop';
import { agentLog } from '../../utils/logger';
import type { LLMClient } from '../llm-client';

/**
 * save_memory 工具定义（参考 nanobot）
 */
const SAVE_MEMORY_TOOL = [
	{
		type: 'function',
		function: {
			name: 'save_memory',
			description: '保存记忆整合结果到持久化存储。',
			parameters: {
				type: 'object',
				properties: {
					history_entry: {
						type: 'string',
						description:
							'一段总结关键事件/决策/主题的文字。以 [YYYY-MM-DD HH:MM] 开头。包含对 grep 搜索有用的细节。',
					},
					memory_update: {
						type: 'string',
						description:
							'完整的更新后长期记忆（markdown 格式）。包含所有现有事实和新事实。如果没有新信息则返回不变。',
					},
				},
				required: ['history_entry', 'memory_update'],
			},
		},
	},
];

/** MEMORY.md 最大行数 */
const MAX_MEMORY_LINES = 100;

/** MEMORY.md 最大字符数（约 5000 tokens） */
const MAX_MEMORY_CHARS = 8000;

/**
 * compress_memory 工具定义
 */
const COMPRESS_MEMORY_TOOL = [
	{
		type: 'function',
		function: {
			name: 'compress_memory',
			description: '压缩长期记忆，合并重复条目，保持在 200 行以内。',
			parameters: {
				type: 'object',
				properties: {
					compressed_memory: {
						type: 'string',
						description: '压缩后的长期记忆（markdown 格式）。合并相似条目，删除冗余。',
					},
				},
				required: ['compressed_memory'],
			},
		},
	},
];

export class MemoryConsolidator {
	private store: MemoryStore;
	private client: LLMClient;
	private config: ConsolidatorConfig;

	constructor(store: MemoryStore, client: LLMClient, config: Partial<ConsolidatorConfig> = {}) {
		this.store = store;
		this.client = client;
		this.config = { ...DEFAULT_CONSOLIDATOR_CONFIG, ...config };
	}

	/**
	 * 检查是否需要整合
	 */
	needsConsolidation(messages: ChatMessage[]): boolean {
		const tokens = estimateTokens(messages);
		const needs = tokens >= this.config.tokenThreshold;
		agentLog(`[Consolidator] needsConsolidation: ${tokens} tokens >= ${this.config.tokenThreshold} threshold = ${needs}`);
		return needs;
	}

	/**
	 * 选择整合边界（在用户消息处切割）
	 *
	 * 参考 nanobot: pick_consolidation_boundary
	 */
	pickConsolidationBoundary(
		messages: ChatMessage[],
		lastConsolidated: number,
		tokensToRemove: number
	): number | null {
		const start = lastConsolidated;
		if (start >= messages.length || tokensToRemove <= 0) {
			return null;
		}

		let removedTokens = 0;
		let lastBoundary: number | null = null;

		for (let idx = start; idx < messages.length; idx++) {
			const message = messages[idx];

			// 在用户消息边界记录
			if (idx > start && message.role === 'user') {
				lastBoundary = idx;
				if (removedTokens >= tokensToRemove) {
					return lastBoundary;
				}
			}

			removedTokens += estimateTokens([message]);
		}

		return lastBoundary;
	}

	/**
	 * 执行整合（调用 LLM）
	 *
	 * 注意：MEMORY.md 整合聚焦于用户特征，HISTORY.md 由 MilestoneRecorder 负责
	 */
	async consolidate(
		messages: ChatMessage[],
		lastConsolidated: number,
		boundary: number
	): Promise<ConsolidationResult | null> {
		const toConsolidate = messages.slice(lastConsolidated, boundary);
		if (toConsolidate.length === 0) {
			return null;
		}

		const currentMemory = (await this.store.readLongTermMemory()) || '(空)';
		const formattedMessages = this.formatMessages(toConsolidate);

		// 聚焦于用户特征的 prompt
		const prompt = `分析这段对话，提取用户的阅读倾向、情绪变化、个人特征，并调用 save_memory 工具更新长期记忆。

## 当前长期记忆
${currentMemory}

## 待分析对话
${formattedMessages}

## 分析要点
1. **阅读倾向**：用户偏好深度讨论还是泛泛了解？对概念定义感兴趣吗？
2. **情绪变化**：用户在讨论中表现出什么情绪？（兴奋、困惑、低落等）
3. **个人成长**：用户的思维方式是否有变化？
4. **偏好发现**：用户对什么类型的书籍/话题感兴趣？

注意：
- history_entry 可以留空（阅读日志由系统自动记录）
- 只在有新的用户特征发现时才更新 memory_update`;

		try {
			// 调用 LLM
			const response = await this.callLLM(prompt);

			if (response) {
				// 只更新 MEMORY.md，不再写入 HISTORY.md（由 MilestoneRecorder 负责）
				if (response.memoryUpdate && response.memoryUpdate.trim()) {
					await this.store.writeLongTermMemory(response.memoryUpdate);
					agentLog('[Consolidator] MEMORY.md 已更新');

					// 检查是否需要压缩
					await this.maybeCompressMemory();
				}
				return response;
			}
		} catch (err) {
			agentLog('[Consolidator] 整合失败:', err);
		}

		return null;
	}

	/**
	 * 调用 LLM 获取整合结果
	 */
	private async callLLM(prompt: string): Promise<ConsolidationResult | null> {
		// 使用 LLMClient 的流式 API，但我们需要完整的工具调用结果
		let result: ConsolidationResult | null = null;

		await new Promise<void>((resolve) => {
			this.client.streamChat(
				[
					{
						role: 'system',
						content: '你是一个记忆整合助手。分析对话并提取重要信息。必须调用 save_memory 工具。',
					},
					{ role: 'user', content: prompt },
				],
				SAVE_MEMORY_TOOL as any,
				{
					onContent: () => {},
					onToolCall: (calls) => {
						if (calls.length > 0 && calls[0].name === 'save_memory') {
							try {
								const args = JSON.parse(calls[0].arguments);
								result = {
									historyEntry: args.history_entry || '',
									memoryUpdate: args.memory_update || '',
								};
							} catch {
								// 解析失败
							}
						}
					},
					onComplete: () => resolve(),
					onError: () => resolve(),
				}
			);
		});

		return result;
	}

	/**
	 * 格式化消息（用于 LLM 输入）
	 */
	private formatMessages(messages: ChatMessage[]): string {
		const lines: string[] = [];

		for (const msg of messages) {
			if (!msg.content) continue;

			const role = msg.role.toUpperCase();
			const content =
				typeof msg.content === 'string'
					? msg.content.slice(0, 500) + (msg.content.length > 500 ? '...' : '')
					: '(复杂内容)';

			lines.push(`[${role}] ${content}`);
		}

		return lines.join('\n');
	}

	/**
	 * 执行多轮整合（如果需要）
	 */
	async maybeConsolidate(
		messages: ChatMessage[],
		lastConsolidated: number,
		onConsolidated: (newIndex: number) => void
	): Promise<number> {
		let currentTokens = estimateTokens(messages);
		const targetTokens = this.config.tokenThreshold * this.config.targetRatio;
		let newLastConsolidated = lastConsolidated;

		for (let round = 0; round < this.config.maxRounds; round++) {
			if (currentTokens < this.config.tokenThreshold) {
				break;
			}

			const tokensToRemove = currentTokens - targetTokens;
			const boundary = this.pickConsolidationBoundary(messages, newLastConsolidated, tokensToRemove);

			if (boundary === null) {
				// 正常情况：当前对话轮次未完成，没有用户消息边界可切割
				// 等用户发送下一条消息后，就会有新的边界
				agentLog(`[Consolidator] 跳过整合: 当前轮次未完成，无安全边界`);
				break;
			}

			const result = await this.consolidate(messages, newLastConsolidated, boundary);

			if (result) {
				const previousLastConsolidated = newLastConsolidated;
				newLastConsolidated = boundary;
				onConsolidated(newLastConsolidated);

				// 重新计算 tokens
				currentTokens = estimateTokens(messages.slice(newLastConsolidated));

				agentLog(
					`[Consolidator] 第 ${round + 1} 轮整合完成，整合了 ${boundary - previousLastConsolidated} 条消息`
				);
			} else {
				break;
			}
		}

		return newLastConsolidated;
	}

	/**
	 * 检查并压缩 MEMORY.md（如果超过限制）
	 */
	private async maybeCompressMemory(): Promise<void> {
		const currentMemory = await this.store.readLongTermMemory();
		if (!currentMemory) return;

		const lineCount = currentMemory.split('\n').length;
		const charCount = currentMemory.length;

		agentLog(`[Consolidator] MEMORY.md 当前 ${lineCount} 行, ${charCount} 字符`);

		// 同时检查行数和字符数
		if (lineCount <= MAX_MEMORY_LINES && charCount <= MAX_MEMORY_CHARS) {
			return;
		}

		agentLog(`[Consolidator] 触发压缩: ${lineCount} 行 / ${charCount} 字符 超限`);

		const compressed = await this.compressMemoryWithLLM(currentMemory);
		if (compressed) {
			await this.store.writeLongTermMemory(compressed);
			agentLog(`[Consolidator] 压缩完成: ${lineCount} 行 -> ${compressed.split('\n').length} 行, ${charCount} 字符 -> ${compressed.length} 字符`);
		}
	}

	/**
	 * 使用 LLM 压缩记忆
	 */
	private async compressMemoryWithLLM(currentMemory: string): Promise<string | null> {
		const prompt = `激进压缩以下长期记忆，目标：100 行以内，8000 字符以内。

## 当前记忆 (${currentMemory.split('\n').length} 行, ${currentMemory.length} 字符)
${currentMemory}

## 压缩规则（必须严格执行）
1. **激进合并**：相同概念只保留一次，用逗号连接多个值
2. **删除冗余**：
   - 删除"正在阅读"、"当前关注"等临时状态（这些会过时）
   - 删除重复出现的概念（如"社会中心主义"出现多次 → 只保留一次）
   - 删除过于详细的描述
3. **极简表达**：
   - 用关键词替代完整句子
   - 用"-"列表替代段落
4. **保持结构**：用户画像/阅读偏好/兴趣主题/阅读习惯

## 输出格式
保持 Markdown 格式，但极度精简。

调用 compress_memory 工具返回压缩后的记忆。`;

		let result: string | null = null;

		await new Promise<void>((resolve) => {
			this.client.streamChat(
				[
					{
						role: 'system',
						content: '你是记忆压缩助手。压缩记忆并调用 compress_memory 工具。',
					},
					{ role: 'user', content: prompt },
				],
				COMPRESS_MEMORY_TOOL as any,
				{
					onContent: () => {},
					onToolCall: (calls) => {
						if (calls.length > 0 && calls[0].name === 'compress_memory') {
							try {
								const args = JSON.parse(calls[0].arguments);
								result = args.compressed_memory || null;
							} catch {
								// 解析失败
							}
						}
					},
					onComplete: () => resolve(),
					onError: () => resolve(),
				}
			);
		});

		return result;
	}
}
