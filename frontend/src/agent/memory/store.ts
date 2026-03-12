/**
 * MemoryStore - 用户可见的记忆存储
 *
 * 文件位置: Obsidian Vault/DeepReader/
 * - MEMORY.md: 长期记忆（用户画像、偏好）
 * - HISTORY.md: 时间线日志（对话历史）
 *
 * 参考: nanobot 的 memory.py 设计
 */

import { App, normalizePath } from 'obsidian';
import { agentLog } from '../../utils/logger';

/** DeepReader 目录名 */
const DEEPREADER_DIR = 'DeepReader';

export class MemoryStore {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 获取 DeepReader 目录路径
	 */
	private get deepReaderPath(): string {
		return normalizePath(DEEPREADER_DIR);
	}

	/**
	 * 获取 MEMORY.md 路径
	 */
	private get memoryPath(): string {
		return normalizePath(`${DEEPREADER_DIR}/MEMORY.md`);
	}

	/**
	 * 获取 HISTORY.md 路径
	 */
	private get historyPath(): string {
		return normalizePath(`${DEEPREADER_DIR}/HISTORY.md`);
	}

	/**
	 * 读取长期记忆
	 */
	async readLongTermMemory(): Promise<string | null> {
		try {
			const exists = await this.app.vault.adapter.exists(this.memoryPath);
			if (!exists) return null;
			const content = await this.app.vault.adapter.read(this.memoryPath);
			return content.trim() || null;
		} catch (err) {
			agentLog('[MemoryStore] 读取 MEMORY.md 失败:', err);
			return null;
		}
	}

	/**
	 * 写入长期记忆
	 */
	async writeLongTermMemory(content: string): Promise<void> {
		await this.ensureDirectory();
		await this.app.vault.adapter.write(this.memoryPath, content);
		agentLog('[MemoryStore] MEMORY.md 已更新');
	}

	/**
	 * 追加历史条目
	 */
	async appendHistory(entry: string): Promise<void> {
		await this.ensureDirectory();

		const exists = await this.app.vault.adapter.exists(this.historyPath);
		const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
		// 使用 --- 分隔符，与 readHistory 保持一致
		const formattedEntry = `[${timestamp}] ${entry}\n\n---\n\n`;

		if (exists) {
			const existing = await this.app.vault.adapter.read(this.historyPath);
			await this.app.vault.adapter.write(this.historyPath, existing + formattedEntry);
		} else {
			const header = `# 对话历史\n\n> 此文件记录与 DeepReader Agent 的对话摘要\n\n---\n\n`;
			await this.app.vault.adapter.write(this.historyPath, header + formattedEntry);
		}

		agentLog('[MemoryStore] HISTORY.md 已追加条目');
	}

	/**
	 * 读取历史（最近 N 条）
	 */
	async readHistory(limit: number = 50): Promise<string> {
		try {
			const exists = await this.app.vault.adapter.exists(this.historyPath);
			if (!exists) return '';
			const content = await this.app.vault.adapter.read(this.historyPath);
			const entries = content.split(/\n\n---\n\n/);
			return entries.slice(-limit).join('\n\n---\n\n');
		} catch (err) {
			agentLog('[MemoryStore] 读取 HISTORY.md 失败:', err);
			return '';
		}
	}

	/**
	 * 获取记忆上下文（用于 System Prompt）
	 */
	async getMemoryContext(): Promise<string> {
		const longTerm = await this.readLongTermMemory();
		if (longTerm) {
			// 移除 frontmatter 和标题，只保留内容
			const content = longTerm
				.replace(/^---[\s\S]*?---\n/, '')
				.replace(/^# 长期记忆\n/, '')
				.replace(/^# Long-term Memory\n/, '');
			return `## 长期记忆\n${content.trim()}`;
		}
		return '';
	}

	/**
	 * 初始化默认 MEMORY.md
	 */
	async initializeMemory(): Promise<void> {
		await this.ensureDirectory();

		const exists = await this.app.vault.adapter.exists(this.memoryPath);
		if (exists) return;

		const defaultContent = `# 长期记忆

此文件存储关于用户的重要信息，会在对话中自动更新。

## 用户画像

（Agent 会在这里记录了解到的用户信息）

## 阅读偏好

（Agent 会在这里记录用户的阅读偏好）

## 兴趣主题

（Agent 会在这里记录用户感兴趣的主题）

---

*此文件由 DeepReader Agent 自动维护，你也可以直接编辑*
`;

		await this.app.vault.adapter.write(this.memoryPath, defaultContent);
		agentLog('[MemoryStore] 初始化 MEMORY.md');
	}

	/**
	 * 确保 DeepReader 目录存在
	 */
	private async ensureDirectory(): Promise<void> {
		const exists = await this.app.vault.adapter.exists(this.deepReaderPath);
		if (!exists) {
			await this.app.vault.adapter.mkdir(this.deepReaderPath);
			agentLog('[MemoryStore] 创建 DeepReader 目录');
		}
	}
}
