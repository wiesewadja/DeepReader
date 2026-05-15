/**
 * MemoryStore - 用户可见的记忆存储
 *
 * 文件位置: Obsidian Vault/DeepReader/
 * - MEMORY.md: 长期记忆（用户画像、偏好）
 * - HISTORY.md: 阅读历程（里程碑日志，最近 30 天）
 * - history/: 归档目录（按月归档）
 *
 * 参考: nanobot 的 memory.py 设计
 */

import { App, normalizePath } from 'obsidian';
import { agentLog } from '../../utils/logger';
import type { IMemoryStore } from './types.js';
import { MAX_MEMORY_CHARS } from '../config/agent-constants.js';

/** DeepReader 目录名 */
const DEEPREADER_DIR = 'DeepReader';

/** 历史归档目录 */
const HISTORY_ARCHIVE_DIR = `${DEEPREADER_DIR}/history`;

/** 历史记录保留天数 */
const HISTORY_RETENTION_DAYS = 30;

/** 历史记录最大条目数 */
const MAX_HISTORY_ENTRIES = 200;

export class MemoryStore implements IMemoryStore {
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
	 * 获取归档目录路径
	 */
	private get historyArchivePath(): string {
		return normalizePath(HISTORY_ARCHIVE_DIR);
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
	 * 获取 MEMORY.md 行数
	 */
	async getMemoryLineCount(): Promise<number> {
		try {
			const content = await this.readLongTermMemory();
			if (!content) return 0;
			return content.split('\n').length;
		} catch {
			return 0;
		}
	}

	/**
	 * 追加历史条目
	 */
	async appendHistory(entry: string): Promise<void> {
		await this.ensureDirectory();

		const exists = await this.app.vault.adapter.exists(this.historyPath);
		// 使用本地时间格式
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		const timestamp = `${year}-${month}-${day} ${hours}:${minutes}`;
		// 使用 --- 分隔符，与 readHistory 保持一致
		const formattedEntry = `[${timestamp}] ${entry}\n\n---\n\n`;

		if (exists) {
			const existing = await this.app.vault.adapter.read(this.historyPath);
			await this.app.vault.adapter.write(this.historyPath, existing + formattedEntry);

			// 检查是否需要归档
			await this.maybeArchiveHistory();
		} else {
			const header = `# 阅读历程\n\n> 此文件记录阅读里程碑（最近 30 天）\n\n---\n\n`;
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
	 * 搜索历史记录
	 *
	 * @param query 搜索关键词
	 * @param limit 返回条目数
	 */
	async searchHistory(query: string, limit: number = 20): Promise<string[]> {
		try {
			const content = await this.readHistory(100);
			if (!content) return [];

			const keywords = query.toLowerCase().split(/\s+/);
			const entries = content.split(/\n\n---\n\n/);
			const matches: string[] = [];

			for (const entry of entries) {
				const entryLower = entry.toLowerCase();
				if (keywords.some((kw) => entryLower.includes(kw)) && entry.trim().length > 10) {
					matches.push(entry.trim());
				}
			}

			return matches.slice(0, limit);
		} catch (err) {
			agentLog('[MemoryStore] 搜索历史失败:', err);
			return [];
		}
	}

	async searchDialogueSummaries(bookName: string, limit: number = 10): Promise<string[]> {
		try {
			const content = await this.readHistory(100);
			if (!content) return [];

			const entries = content.split(/\n\n---\n\n/);
			const dialogueEntries = entries.filter(entry =>
				entry.includes('💬') &&
				(entry.includes(`《${bookName}》`) || entry.includes(bookName))
			);

			return dialogueEntries.slice(-limit).map(e => e.trim());
		} catch (err) {
			agentLog('[MemoryStore] 搜索对话摘要失败:', err);
			return [];
		}
	}

	/**
	 * 获取阅读统计摘要
	 */
	async getReadingSummary(): Promise<string> {
		try {
			const content = await this.readHistory(100);
			if (!content) return '暂无阅读记录';

			const entries = content.split(/\n\n---\n\n/).filter((e) => e.trim());

			// 统计书籍
			const books = new Set<string>();
			const bookPattern = /《(.+?)》/g;

			for (const entry of entries) {
				const matches = entry.matchAll(bookPattern);
				for (const match of matches) {
					books.add(match[1]);
				}
			}

			// 统计里程碑类型
			const milestones = {
				'📖': 0, // 开始阅读
				'🔄': 0, // 切换书籍
				'📍': 0, // 进度里程碑
				'💡': 0, // 吸收度提升
				'✅': 0, // 完成阅读
				'🔁': 0, // 新一轮
			};

			for (const entry of entries) {
				for (const [emoji] of Object.entries(milestones)) {
					if (entry.includes(emoji)) {
						milestones[emoji as keyof typeof milestones]++;
					}
				}
			}

			// 生成摘要
			const lines = [
				`📚 已阅读书籍: ${books.size} 本`,
				`📖 开始阅读: ${milestones['📖']} 次`,
				`📍 进度里程碑: ${milestones['📍']} 次`,
				`💡 吸收度提升: ${milestones['💡']} 次`,
				`✅ 完成阅读: ${milestones['✅']} 次`,
			];

			if (books.size > 0) {
				lines.push(`\n最近阅读: ${Array.from(books).slice(-5).join('、')}`);
			}

			return lines.join('\n');
		} catch (err) {
			agentLog('[MemoryStore] 获取阅读摘要失败:', err);
			return '获取阅读摘要失败';
		}
	}

	/**
	 * 检查并归档旧历史记录
	 *
	 * 当条目超过 MAX_HISTORY_ENTRIES 或有超过 HISTORY_RETENTION_DAYS 天的记录时触发
	 */
	private async maybeArchiveHistory(): Promise<void> {
		try {
			const content = await this.app.vault.adapter.read(this.historyPath);
			const entries = content.split(/\n\n---\n\n/).filter((e) => e.trim());

			// 检查是否需要归档
			if (entries.length <= MAX_HISTORY_ENTRIES) {
				return;
			}

			// 找出需要归档的条目（保留最近 150 条）
			const keepCount = 150;
			const toArchive = entries.slice(0, entries.length - keepCount);
			const toKeep = entries.slice(entries.length - keepCount);

			if (toArchive.length === 0) return;

			// 确定归档月份（使用最早条目的日期）
			const firstEntry = toArchive[0];
			const dateMatch = firstEntry.match(/\[(\d{4}-\d{2})/);
			const archiveMonth = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 7);

			// 创建归档文件
			await this.ensureHistoryArchiveDir();
			const archivePath = normalizePath(`${HISTORY_ARCHIVE_DIR}/${archiveMonth}.md`);

			// 检查归档文件是否已存在
			let archiveContent = '';
			if (await this.app.vault.adapter.exists(archivePath)) {
				archiveContent = await this.app.vault.adapter.read(archivePath);
			} else {
				archiveContent = `# 阅读历程归档 - ${archiveMonth}\n\n---\n\n`;
			}

			// 追加到归档文件
			const archiveEntries = toArchive.join('\n\n---\n\n');
			await this.app.vault.adapter.write(archivePath, archiveContent + archiveEntries + '\n\n---\n\n');

			// 更新主历史文件
			const header = `# 阅读历程\n\n> 此文件记录阅读里程碑（最近 30 天）\n> 归档文件位于 history/ 目录\n\n---\n\n`;
			await this.app.vault.adapter.write(this.historyPath, header + toKeep.join('\n\n---\n\n'));

			agentLog(`[MemoryStore] 归档了 ${toArchive.length} 条历史记录到 ${archiveMonth}.md`);
		} catch (err) {
			agentLog('[MemoryStore] 归档历史失败:', err);
		}
	}

	/**
	 * 确保归档目录存在
	 */
	private async ensureHistoryArchiveDir(): Promise<void> {
		const exists = await this.app.vault.adapter.exists(this.historyArchivePath);
		if (!exists) {
			await this.app.vault.adapter.mkdir(this.historyArchivePath);
			agentLog('[MemoryStore] 创建归档目录');
		}
	}

	/** MEMORY.md 最大字符数 */
	static readonly MAX_MEMORY_CHARS = MAX_MEMORY_CHARS;

	/**
	 * 获取记忆上下文（用于 System Prompt）
	 */
	async getMemoryContext(): Promise<string> {
		const longTerm = await this.readLongTermMemory();
		if (longTerm) {
			// 检查大小
			const charCount = longTerm.length;
			const lineCount = longTerm.split('\n').length;

			if (charCount > MemoryStore.MAX_MEMORY_CHARS) {
				agentLog(`[MemoryStore] ⚠️ MEMORY.md 过大: ${charCount} 字符, ${lineCount} 行 (限制: ${MemoryStore.MAX_MEMORY_CHARS} 字符)`);
				agentLog(`[MemoryStore] ⚠️ 建议: 发送一条消息触发压缩，或手动精简 MEMORY.md`);
			}

			// 移除 frontmatter、标题和冗余说明
			const content = longTerm
				.replace(/^---[\s\S]*?---\n/, '')
				.replace(/^# 长期记忆\n\n?/, '')
				.replace(/^# Long-term Memory\n\n?/, '')
				.replace(/此文件存储关于用户的重要信息.*\n/, '')
				.replace(/\*此文件由.*\*\n?/, '')
				.replace(/\n---\n*$/, ''); // 移除末尾的分隔符
			return `## 长期记忆\n\n${content.trim()}`;
		}
		return '';
	}

	/**
	 * 检查 MEMORY.md 是否需要压缩
	 */
	async needsCompression(): Promise<boolean> {
		const content = await this.readLongTermMemory();
		if (!content) return false;
		return content.length > MemoryStore.MAX_MEMORY_CHARS;
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

称呼：
专业背景：
认知水平：

## 提问倾向

（Agent 会在这里记录用户的提问风格和模式）

## 阅读偏好

（Agent 会在这里记录用户的阅读偏好：理论vs实践、精读vs概览等）

## 兴趣主题

（Agent 会在这里记录用户感兴趣的主题和领域）

## 阅读习惯

（Agent 会在这里记录用户的阅读行为：常读时段、阅读节奏等）

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
