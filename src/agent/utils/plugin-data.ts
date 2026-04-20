/**
 * 插件数据目录工具函数
 *
 * 管理隐藏在 .obsidian/plugins/deepreader/data/ 下的数据
 */

import type { App } from 'obsidian';
import { toolsLog as log } from '../../utils/logger.js';

/** 插件数据根目录 */
export const PLUGIN_DATA_DIR = '.obsidian/plugins/deepreader/data';

/** Memory 目录 */
export const MEMORY_DATA_DIR = `${PLUGIN_DATA_DIR}/memory`;

/** Memory 条目目录 */
export const MEMORY_ENTRIES_DIR = `${MEMORY_DATA_DIR}/entries`;

/**
 * 确保插件数据目录结构存在
 */
export async function ensurePluginDataDirs(app: App): Promise<void> {
  const dirs = [
    PLUGIN_DATA_DIR,
    MEMORY_DATA_DIR,
    MEMORY_ENTRIES_DIR,
  ];

  for (const dir of dirs) {
    const exists = await app.vault.adapter.exists(dir);
    if (!exists) {
      await app.vault.createFolder(dir);
      log('[PluginData] Created directory:', dir);
    }
  }
}
