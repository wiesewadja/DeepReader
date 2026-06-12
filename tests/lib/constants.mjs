/**
 * 测试常量
 * 
 * Plugin ID 动态检测：
 * - 环境变量 DEEPREADER_PLUGIN_ID 优先
 * - 主仓库 dev: deepreader-dev
 * - Worktree: deepreader-wt-{branch-name}
 * 
 * 可通过环境变量覆盖：
 *   DEEPREADER_PLUGIN_ID=my-plugin npm run test:e2e
 */

import { PLUGIN_ID as _PLUGIN_ID, INDEX_DIR as _INDEX_DIR, PLUGIN_DIR as _PLUGIN_DIR } from './plugin-id.mjs';

export const PLUGIN_ID = _PLUGIN_ID;
export const INDEX_DIR = _INDEX_DIR;
export const PLUGIN_DIR = _PLUGIN_DIR;

// 常用路径模板
export const getDataPath = (vaultPath) => `${vaultPath}/.obsidian/plugins/${PLUGIN_ID}/data.json`;
export const getIndexDir = (vaultPath) => `${vaultPath}/.obsidian/plugins/${PLUGIN_ID}/pageindex`;
