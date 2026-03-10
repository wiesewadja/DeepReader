/**
 * ContextLoader - 加载用户上下文信息
 *
 * 分层加载策略：
 * - Layer 1: DeepReader.md（用户配置，始终加载）
 * - Layer 2: memory/summary.md（记忆摘要，始终加载）
 * - Layer 3: memory/entries/*.md（详细记忆，按需加载）
 */

import { App } from 'obsidian';
import { contextLog as log, error } from '../../utils/logger.js';

export interface UserContext {
  profile: string;       // DeepReader.md 内容
  memorySummary: string; // 记忆摘要
  hasProfile: boolean;   // 是否存在用户配置
}

export class ContextLoader {
  private app: App;
  private deepReaderDir: string;

  constructor(app: App) {
    this.app = app;
    this.deepReaderDir = 'DeepReader';
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
    const profilePath = `${this.deepReaderDir}/DeepReader.md`;

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
   * Layer 2: 加载记忆摘要 (memory/summary.md)
   */
  private async loadMemorySummary(): Promise<string> {
    const summaryPath = `${this.deepReaderDir}/memory/summary.md`;

    try {
      const exists = await this.app.vault.adapter.exists(summaryPath);
      if (!exists) {
        return '（暂无记忆摘要）';
      }

      const content = await this.app.vault.adapter.read(summaryPath);
      return content.trim() || '（记忆摘要为空）';
    } catch (err) {
      error('[ContextLoader] Failed to load memory summary:', err);
      return '（无法读取记忆摘要）';
    }
  }

  /**
   * Layer 3: 搜索详细记忆（按需调用）
   */
  async searchMemory(query: string): Promise<string[]> {
    const entriesDir = `${this.deepReaderDir}/memory/entries`;

    try {
      const exists = await this.app.vault.adapter.exists(entriesDir);
      if (!exists) {
        return [];
      }

      // 列出所有记忆条目
      const files = await this.app.vault.adapter.list(entriesDir);
      const results: string[] = [];

      // 简单的关键词匹配（后续可以用更智能的搜索）
      const keywords = query.toLowerCase().split(/\s+/);

      for (const file of files.files) {
        if (!file.endsWith('.md')) continue;

        const content = await this.app.vault.adapter.read(file);
        const lowerContent = content.toLowerCase();

        // 检查是否包含任意关键词
        if (keywords.some(kw => lowerContent.includes(kw))) {
          results.push(content);
        }
      }

      return results;
    } catch (err) {
      error('[ContextLoader] Failed to search memory:', err);
      return [];
    }
  }

  /**
   * 添加新记忆条目
   */
  async addMemoryEntry(content: string): Promise<boolean> {
    const entriesDir = `${this.deepReaderDir}/memory/entries`;
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const fileName = `${timestamp}-${Date.now()}.md`;
    const filePath = `${entriesDir}/${fileName}`;

    try {
      // 确保目录存在
      const dirExists = await this.app.vault.adapter.exists(entriesDir);
      if (!dirExists) {
        await this.app.vault.createFolder(entriesDir);
      }

      // 写入记忆条目
      const entryContent = `# 记忆条目 - ${timestamp}\n\n${content}`;
      await this.app.vault.adapter.write(filePath, entryContent);

      log('[ContextLoader] Added memory entry:', fileName);
      return true;
    } catch (err) {
      error('[ContextLoader] Failed to add memory entry:', err);
      return false;
    }
  }

  /**
   * 确保目录结构存在
   */
  async ensureDirectories(): Promise<void> {
    const dirs = [
      this.deepReaderDir,
      `${this.deepReaderDir}/memory`,
      `${this.deepReaderDir}/memory/entries`,
    ];

    for (const dir of dirs) {
      const exists = await this.app.vault.adapter.exists(dir);
      if (!exists) {
        await this.app.vault.createFolder(dir);
        log('[ContextLoader] Created directory:', dir);
      }
    }
  }

  /**
   * 检查是否需要自动摘要
   * 当条目数超过阈值时返回 true
   */
  async needsSummarization(): Promise<boolean> {
    const entriesDir = `${this.deepReaderDir}/memory/entries`;
    const THRESHOLD = 10;

    try {
      const exists = await this.app.vault.adapter.exists(entriesDir);
      if (!exists) {
        return false;
      }

      const files = await this.app.vault.adapter.list(entriesDir);
      const mdFiles = files.files.filter((f: string) => f.endsWith('.md'));

      return mdFiles.length >= THRESHOLD;
    } catch {
      return false;
    }
  }
}
