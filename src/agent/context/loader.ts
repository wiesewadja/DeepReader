/**
 * ContextLoader - 加载用户上下文信息
 *
 * 分层加载策略：
 * - Layer 1: DeepReader/DeepReader.md（用户配置，始终加载）
 * - Layer 2: DeepReader/MEMORY.md（长期记忆，始终加载）
 * - Layer 3: DeepReader/HISTORY.md（时间线日志，按需加载）
 */

import { type App, normalizePath } from 'obsidian';
import { contextLog as log, error } from '../../utils/logger.js';

// 导出日志函数供控制台使用
export { setModuleEnabled, setModulesEnabled, getModuleConfig } from '../../utils/logger.js';

export interface UserContext {
	profile: string; // DeepReader.md 内容
	memorySummary: string; // 长期记忆摘要
	hasProfile: boolean; // 是否存在用户配置
}

/** DeepReader 目录名 */
const DEEPREADER_DIR = 'DeepReader';

export class ContextLoader {
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
	 * 加载用户上下文
	 */
	async loadContext(): Promise<UserContext> {
		const profile = await this.loadProfile();
		const memorySummary = await this.loadMemorySummary();

		return {
			profile: profile.content,
			hasProfile: profile.exists,
			memorySummary,
		};
	}

	/**
	 * Layer 1: 加载用户配置 (DeepReader.md)
	 */
	private async loadProfile(): Promise<{ content: string; exists: boolean }> {
		const profilePath = `${this.deepReaderPath}/DeepReader.md`;

		try {
			const exists = await this.app.vault.adapter.exists(profilePath);
			if (!exists) {
				// 用户未配置，返回默认模板提示
				return {
					content: `用户尚未配置个人信息。

你可以在对话中逐渐了解用户，或者建议用户创建 \`DeepReader/DeepReader.md\` 文件来填写个人信息，例如：

- 称呼偏好（如何称呼用户）
- 阅读兴趣和目的
- 背景知识水平
- 笔记风格偏好`,
					exists: false,
				};
			}

			const content = await this.app.vault.adapter.read(profilePath);
			return { content, exists: true };
		} catch (err) {
			error('[ContextLoader] Failed to load profile:', err);
			return {
				content: '（无法读取用户配置）',
				exists: false,
			};
		}
	}

	/**
	 * Layer 2: 加载长期记忆 (DeepReader/MEMORY.md)
	 */
	private async loadMemorySummary(): Promise<string> {
		try {
			const exists = await this.app.vault.adapter.exists(this.memoryPath);
			if (!exists) {
				return '（暂无长期记忆）';
			}

			const content = await this.app.vault.adapter.read(this.memoryPath);

			// 移除 frontmatter 和标题，只保留内容
			const cleanedContent = content
				.replace(/^---[\s\S]*?---\n/, '')
				.replace(/^# 长期记忆\n/, '')
				.replace(/^# Long-term Memory\n/, '')
				.trim();

			return cleanedContent || '（长期记忆为空）';
		} catch (err) {
			error('[ContextLoader] Failed to load memory summary:', err);
			return '（无法读取长期记忆）';
		}
	}

	/**
	 * 确保目录结构存在
	 */
	async ensureDirectories(): Promise<void> {
		// 确保 DeepReader 目录存在
		const exists = await this.app.vault.adapter.exists(this.deepReaderPath);
		if (!exists) {
			await this.app.vault.adapter.mkdir(this.deepReaderPath);
			log('[ContextLoader] Created directory:', this.deepReaderPath);
		}
	}

	/**
	 * 初始化默认 MEMORY.md（如果不存在）
	 */
	async initializeMemoryFile(): Promise<void> {
		await this.ensureDirectories();

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
		log('[ContextLoader] 初始化 MEMORY.md');
	}
}
