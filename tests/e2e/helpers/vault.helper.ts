/**
 * Vault 操作辅助函数
 */

export class VaultHelper {
  /**
   * 获取 vault 基础路径
   */
  static async getBasePath(): Promise<string> {
    return await browser.executeObsidian(({ app }) => {
      return (app.vault.adapter as any).getBasePath?.() || '';
    });
  }

  /**
   * 检查文件是否存在
   */
  static async exists(path: string): Promise<boolean> {
    return await browser.executeObsidian(async ({ app }, p: string) => {
      return await app.vault.adapter.exists(p);
    }, path);
  }

  /**
   * 读取文件内容
   */
  static async read(path: string): Promise<string> {
    return await browser.executeObsidian(async ({ app }, p: string) => {
      const adapter = app.vault.adapter as any;
      return await adapter.read(p);
    }, path);
  }

  /**
   * 列出目录内容
   */
  static async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return await browser.executeObsidian(async ({ app }, p: string) => {
      const adapter = app.vault.adapter as any;
      const exists = await adapter.exists(p);
      if (!exists) return { files: [], folders: [] };
      const listing = await adapter.list(p);
      return {
        files: listing?.files || [],
        folders: listing?.folders || [],
      };
    }, path);
  }

  /**
   * 获取目录下的 Markdown 文件
   */
  static async getMarkdownFiles(path: string): Promise<string[]> {
    const { files } = await this.list(path);
    return files.filter(f => f.endsWith('.md'));
  }

  /**
   * 检查插件索引数据是否存在
   */
  static async hasBookIndex(bookId: string): Promise<boolean> {
    return await this.exists(`.obsidian/plugins/deepreader-dev/pageindex/${bookId}/book-meta.json`);
  }

  /**
   * 删除目录及其内容
   */
  static async removeDir(path: string): Promise<void> {
    await browser.executeObsidian(async ({ app }, p: string) => {
      const adapter = app.vault.adapter as any;
      try {
        const exists = await adapter.exists(p);
        if (exists) {
          const entries = await adapter.list(p);
          for (const f of entries.files || []) {
            await adapter.remove(f);
          }
          await adapter.rmdir(p, true);
        }
      } catch { /* ignore errors */ }
    }, path);
  }
}
