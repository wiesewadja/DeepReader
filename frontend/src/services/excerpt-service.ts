/**
 * DeepPDF 摘录服务
 * 负责将 AI 回复内容保存为 Obsidian 笔记
 */

import { App, Notice, TFile, TFolder } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata, ExcerptOptions } from '../types/excerpt';
import { error as logError } from '../utils/logger.js';

/**
 * 摘录服务类
 */
export class ExcerptService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 保存摘录
   * @param content 摘录内容
   * @param metadata 摘录元数据
   * @param options 摘录选项
   * @returns 保存的文件路径
   */
  async saveExcerpt(
    content: ExcerptContent,
    metadata: ExcerptMetadata,
    options?: ExcerptOptions
  ): Promise<string | null> {
    const opts = options || {};

    try {
      // 1. 确定目标文件路径（按书籍和日期组织）
      const targetPath = opts.targetPath || this.getExcerptPath(metadata.sourcePdf);

      // 2. 确保目标文件存在
      await this.ensureExcerptFile(targetPath);

      // 3. 格式化摘录内容
      const formattedContent = this.formatExcerpt(content, metadata, opts);

      // 4. 追加到目标文件
      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (file instanceof TFile) {
        const existingContent = await this.app.vault.read(file);
        const newContent = existingContent + '\n\n' + formattedContent;
        await this.app.vault.modify(file, newContent);
      } else {
        // 文件不存在，创建新文件
        await this.app.vault.create(targetPath, formattedContent);
      }

      // 5. 显示成功提示
      // new Notice(`摘录已保存到 ${targetPath}`);

      return targetPath;
    } catch (error) {
      logError('保存摘录失败:', error);
      new Notice('保存摘录失败，请查看控制台');
      return null;
    }
  }

  /**
   * 根据书籍名称和日期生成摘录路径
   * 格式: 书籍摘录/{书籍名}/摘录-{日期}.md
   */
  getExcerptPath(sourcePdf: string): string {
    const baseFolder = '书籍摘录';

    // 清理书籍名称，移除不安全的文件名字符
    const bookName = this.sanitizeFilename(sourcePdf);

    // 获取当前日期 (YYYY-MM-DD)
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    return `${baseFolder}/${bookName}/摘录-${dateStr}.md`;
  }

  /**
   * 清理文件名，移除不安全字符
   */
  private sanitizeFilename(name: string): string {
    // 移除或替换不安全的文件名字符
    return name
      .replace(/[\\/:*?"<>|]/g, '_')  // Windows 不允许的字符
      .replace(/\.(pdf|epub|txt)$/i, '')  // 移除常见扩展名
      .trim()
      .substring(0, 100);  // 限制长度
  }

  /**
   * 获取默认摘录保存路径（已废弃，使用 getExcerptPath）
   */
  async getDefaultExcerptPath(): Promise<string> {
    return this.getExcerptPath('Unknown');
  }

  /**
   * 确保摘录文件存在
   */
  private async ensureExcerptFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!file) {
      // 确保所有父目录都存在（支持嵌套路径）
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      if (parentPath) {
        await this.ensureFolderExists(parentPath);
      }

      // 创建文件
      const content = this.generateExcerptFileHeader();
      await this.app.vault.create(path, content);
    }
  }

  /**
   * 递归确保文件夹存在
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder) return;

    // 先确保父目录存在
    const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
    if (parentPath) {
      await this.ensureFolderExists(parentPath);
    }

    // 创建当前目录
    await this.app.vault.createFolder(folderPath);
  }

  /**
   * 格式化摘录内容（使用 Obsidian callout 美化）
   * 标题行：用户笔记（如果有），否则显示时间戳
   */
  private formatExcerpt(
    content: ExcerptContent,
    metadata: ExcerptMetadata,
    options?: ExcerptOptions
  ): string {
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // 生成时间戳锚点（用于同一文件中定位）
    const timeAnchor = `${new Date().getFullYear()}-${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}`;

    // 根据来源类型选择不同的 callout 样式
    let calloutType = 'quote';
    if (metadata.sourceType === 'reading' && metadata.chapterPath) {
      calloutType = 'reading';
    } else if (metadata.sourceType === 'chat') {
      calloutType = 'chat';
    }

    // 标题行：优先使用用户笔记，否则显示时间戳
    const calloutTitle = options?.note?.trim() || timestamp;

    // 构建 callout 内容
    let calloutContent = '';

    // 摘录内容
    calloutContent += `${content.text}\n`;

    // 来源信息（根据类型显示不同链接）
    calloutContent += '\n---\n';
    if (metadata.sourceType === 'reading' && metadata.chapterPath) {
      // 阅读摘录：链接到章节文件
      const chapterDisplay = metadata.chapterName || metadata.chapterPath.split('/').pop()?.replace('.md', '') || metadata.chapterPath;
      calloutContent += `📍 来源: [[${metadata.chapterPath}|${chapterDisplay}]]\n`;
    } else {
      // 对话摘录或默认：只链接到书籍
      calloutContent += `📍 来源: [[${metadata.sourcePdf}]]\n`;
    }

    // 页码信息（如果有）
    if (metadata.page) {
      calloutContent += `📄 页码: 第 ${metadata.page} 页\n`;
    }

    // 组装完整的 callout
    // 先移除末尾的空白行，再处理每行前缀
    const contentLines = calloutContent.trimEnd().split('\n');
    const calloutBody = contentLines.map(line => `> ${line}`).join('\n');

    const formatted = `
> [!${calloutType}]+-${timeAnchor} ${calloutTitle}
${calloutBody}
`;

    return formatted;
  }

  /**
   * 生成摘录文件头部
   */
  private generateExcerptFileHeader(): string {
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

    return `# 📚 摘录 - ${dateStr}

本文件自动收集当天的阅读摘录。

---

`;
  }
}
