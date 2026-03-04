/**
 * DeepPDF 摘录服务
 * 负责将 AI 回复内容保存为 Obsidian 笔记
 */

import { App, Notice, TFile, TFolder } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata, ExcerptOptions } from '../types/excerpt';

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
      // 1. 确定目标文件路径
      const targetPath = opts.targetPath || await this.getDefaultExcerptPath();

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
      new Notice(`摘录已保存到 ${targetPath}`);

      return targetPath;
    } catch (error) {
      console.error('保存摘录失败:', error);
      new Notice('保存摘录失败，请查看控制台');
      return null;
    }
  }

  /**
   * 获取默认摘录保存路径
   */
  async getDefaultExcerptPath(): Promise<string> {
    // 从插件设置获取默认路径
    // 暂时使用固定路径， 后续从设置读取
    const defaultFolder = 'Excerpts';
    const defaultFile = 'DeepPDF.md';

    // 确保文件夹存在
    const folder = this.app.vault.getAbstractFileByPath(defaultFolder);
    if (!folder) {
      await this.app.vault.createFolder(defaultFolder);
    }

    return `${defaultFolder}/${defaultFile}`;
  }

  /**
   * 确保摘录文件存在
   */
  private async ensureExcerptFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!file) {
      // 创建文件
      const content = this.generateExcerptFileHeader();
      await this.app.vault.create(path, content);
    }
  }

  /**
   * 格式化摘录内容
   */
  private formatExcerpt(
    content: ExcerptContent,
    metadata: ExcerptMetadata,
    options?: ExcerptOptions
  ): string {
    const title = this.generateExcerptTitle(content);
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    let formatted = `## ${timestamp} ${title}\n\n`;

    // 添加引用内容
    formatted += `> ${content.text}\n\n`;

    // 添加元数据
    formatted += `**来源**: [[${metadata.sourcePdf}]]\n`;
    if (metadata.page) {
      formatted += `**页码**: ${metadata.page}\n`;
    }
    formatted += `**问题**: ${metadata.question}\n`;

    // 添加笔记（如果有）
    if (options?.note) {
      formatted += `**笔记**: ${options.note}\n`;
    }

    // 添加双向链接（如果启用）
    if (options?.includeBacklink !== false) {
    formatted += `\n---\n`;
    formatted += `[[DeepReader对话]](deepreader://conversation/${metadata.conversationId})\n`;
    }

    // 添加分隔线
    formatted += '\n---\n';

    return formatted;
  }

  /**
   * 生成摘录标题
   */
  private generateExcerptTitle(content: ExcerptContent): string {
    const text = content.text.trim();
    // 取第一行作为标题
    const firstLine = text.split('\n')[0];
    // 限制标题长度
    if (firstLine.length > 50) {
      return firstLine.substring(0, 47) + '...';
    }
    return firstLine;
  }

  /**
   * 生成摘录文件头部
   */
  private generateExcerptFileHeader(): string {
    return `# DeepPDF 摘录收集

自动保存与 AI 的对话摘录。

---
`;
  }
}
