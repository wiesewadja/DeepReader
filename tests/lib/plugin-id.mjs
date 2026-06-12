/**
 * 动态检测当前环境的 Plugin ID
 * 
 * 规则：
 * - 环境变量 DEEPREADER_PLUGIN_ID 优先
 * - 主仓库 dev: deepreader-dev
 * - Worktree: deepreader-wt-{branch-name}
 * 
 * 用法：
 *   import { PLUGIN_ID, INDEX_DIR } from './plugin-id.mjs';
 */

import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function detectPluginId() {
  // 1. 环境变量优先
  if (process.env.DEEPREADER_PLUGIN_ID) {
    return process.env.DEEPREADER_PLUGIN_ID;
  }

  // 2. 检测是否在 worktree 中
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      cwd: REPO_ROOT
    }).trim();

    const worktrees = execSync('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: REPO_ROOT
    });

    // 找到 main 分支的路径
    const lines = worktrees.split('\n');
    let mainPath = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        mainPath = lines[i].slice('worktree '.length);
      }
      if (lines[i] === 'branch refs/heads/main' && mainPath) {
        break;
      }
    }

    // 如果不在 main worktree，返回 worktree 插件 ID
    if (gitRoot !== mainPath) {
      const branch = execSync('git branch --show-current', {
        encoding: 'utf-8',
        cwd: REPO_ROOT
      }).trim();
      
      const safeBranch = branch.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
      return `deepreader-wt-${safeBranch}`;
    }
  } catch (e) {
    // 忽略错误，使用默认值
  }

  // 3. 默认返回 dev 插件 ID
  return 'deepreader-dev';
}

export const PLUGIN_ID = detectPluginId();
export const INDEX_DIR = `.obsidian/plugins/${PLUGIN_ID}/pageindex`;
export const PLUGIN_DIR = `.obsidian/plugins/${PLUGIN_ID}`;
