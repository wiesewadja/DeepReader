/**
 * 插件状态验证和配置辅助函数
 */

const PLUGIN_ID = 'deepreader-dev';

export class PluginHelper {
  /**
   * 验证插件已加载
   */
  static async assertLoaded(): Promise<void> {
    const loaded = await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.[PLUGIN_ID];
    });
    expect(loaded).toBe(true);
  }

  /**
   * 检查插件是否已加载
   */
  static async isLoaded(): Promise<boolean> {
    return await browser.executeObsidian(({ app }) => {
      return !!app.plugins?.plugins?.[PLUGIN_ID];
    });
  }

  /**
   * 获取插件实例
   */
  static async getPlugin(): Promise<any> {
    return await browser.executeObsidian(({ app }) => {
      return (app.plugins?.plugins?.[PLUGIN_ID] as any) ?? null;
    });
  }

  /**
   * 获取插件设置
   */
  static async getSettings(): Promise<Record<string, any>> {
    return await browser.executeObsidian(({ app }) => {
      return (app.plugins?.plugins?.[PLUGIN_ID] as any)?.settings ?? {};
    });
  }

  /**
   * 检查是否有 API Key
   */
  static async hasApiKey(): Promise<boolean> {
    return await browser.executeObsidian(({ app }) => {
      const s = (app.plugins?.plugins?.[PLUGIN_ID] as any)?.settings;
      return !!(s?.deepseekApiKey || s?.customApiKey || s?.openaiApiKey);
    });
  }

  /**
   * 写入插件设置（仅限 Obsidian 启动前）
   */
  static writeSettingsSync(settings: Record<string, unknown>, vaultPath: string): void {
    const fs = require('fs');
    const path = require('path');
    const dataPath = path.join(vaultPath, `.obsidian/plugins/${PLUGIN_ID}/data.json`);
    const existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const merged = { ...existing, ...settings };
    fs.writeFileSync(dataPath, JSON.stringify(merged, null, 2), 'utf-8');
  }

  /**
   * 获取插件控制台日志
   */
  static async getConsoleLogs(filter?: string): Promise<string[]> {
    const logs = await browser.getLogs('browser');
    return logs
      .filter(log => {
        const msg = log.message;
        if (filter) return msg.includes(filter);
        return msg.includes('DeepReader') || msg.includes('DeepPDF') ||
               msg.includes('[S0') || msg.includes('[S1') ||
               msg.includes('[S2') || msg.includes('[S4');
      })
      .map(log => log.message);
  }
}
