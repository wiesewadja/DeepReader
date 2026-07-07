#!/usr/bin/env node

/**
 * DeepReader 测试环境配置脚本 (macOS)
 *
 * 一键完成：
 * 1. 检查目录结构
 * 2. 部署插件到 test-vault
 * 3. 启用插件（修改 community-plugins.json）
 * 4. 启动 Obsidian（如果未运行）
 * 5. 等待 Obsidian 就绪
 * 6. 检查插件加载状态
 * 7. 检查索引文件
 * 8. 检查 API Key 配置
 *
 * 用法:
 *   npm run setup:test-env           # 完整配置
 *   npm run setup:test-env:check     # 仅检查，不修复
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const TEST_VAULT = join(ROOT, 'test-vault');
const OBSIDIAN_DIR = join(TEST_VAULT, '.obsidian');
const PLUGINS_DIR = join(OBSIDIAN_DIR, 'plugins');
const PLUGIN_DIR = join(PLUGINS_DIR, 'deepreader-dev');
const COMMUNITY_PLUGINS = join(OBSIDIAN_DIR, 'community-plugins.json');
const PLUGIN_ID = 'deepreader-dev';

// 配置项
const CONFIG = {
  obsidianPath: '/Applications/Obsidian.app',
  checkOnly: process.argv.includes('--check'),
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(icon, message) {
  console.log(`${icon} ${message}`);
}

function success(message) {
  log(`${colors.green}✓${colors.reset}`, message);
}

function warn(message) {
  log(`${colors.yellow}⚠${colors.reset}`, message);
}

function error(message) {
  log(`${colors.red}✗${colors.reset}`, message);
}

function info(message) {
  log(`${colors.cyan}ℹ${colors.reset}`, message);
}

/**
 * 执行 shell 命令
 */
function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      ...options,
    });
  } catch (e) {
    return null;
  }
}

/**
 * 检查 Obsidian 是否正在运行
 */
function isObsidianRunning() {
  const result = exec('pgrep -x "Obsidian"');
  return result !== null;
}

/**
 * 启动 Obsidian
 */
function startObsidian() {
  if (isObsidianRunning()) {
    success('Obsidian 已运行');
    return true;
  }

  info('启动 Obsidian...');
  exec(`open -a "${CONFIG.obsidianPath}" "${TEST_VAULT}"`);

  // 等待 Obsidian 启动
  for (let i = 0; i < 30; i++) {
    execSync('sleep 1');
    if (isObsidianRunning()) {
      success('Obsidian 已启动');
      return true;
    }
    process.stdout.write('.');
  }

  error('Obsidian 启动超时');
  return false;
}

/**
 * 检查 Obsidian 连接
 */
async function checkObsidianConnection() {
  try {
    const { evalObsidian } = await import('./smoke/lib/obsidian-cli.mjs');
    const result = await evalObsidian('true', { timeout: 5000, vault: 'test-vault' });
    return result === true;
  } catch {
    return false;
  }
}

/**
 * 检查插件加载状态
 */
async function checkPluginLoaded() {
  try {
    const { evalObsidian } = await import('./smoke/lib/obsidian-cli.mjs');
    return await evalObsidian(`!!app.plugins?.plugins?.["${PLUGIN_ID}"]`, { vault: 'test-vault' });
  } catch {
    return false;
  }
}

/**
 * 启用插件
 */
function enablePlugin() {
  let enabled = [];
  if (existsSync(COMMUNITY_PLUGINS)) {
    enabled = JSON.parse(readFileSync(COMMUNITY_PLUGINS, 'utf-8'));
  }

  if (!enabled.includes(PLUGIN_ID)) {
    enabled.push(PLUGIN_ID);
    writeFileSync(COMMUNITY_PLUGINS, JSON.stringify(enabled, null, 2));
    success('插件已启用');
    return true;
  }

  success('插件已启用');
  return false;
}

/**
 * 检查索引文件
 */
async function checkIndexFiles() {
  try {
    const { evalObsidian } = await import('./smoke/lib/obsidian-cli.mjs');
    return await evalObsidian(`
      (async () => {
        const adapter = app.vault.adapter;
        const base = ".obsidian/plugins/${PLUGIN_ID}/pageindex";
        
        // 检查 catalog.json
        if (!(await adapter.exists(base + "/catalog.json"))) {
          return { exists: false };
        }
        
        const catalog = JSON.parse(await adapter.read(base + "/catalog.json"));
        if (!catalog?.books || Object.keys(catalog.books).length === 0) {
          return { exists: true, hasBooks: false };
        }
        
        return { exists: true, hasBooks: true, bookCount: Object.keys(catalog.books).length };
      })()
    `, { vault: 'test-vault' });
  } catch {
    return null;
  }
}

/**
 * 检查 API Key 配置
 */
async function checkApiKey() {
  try {
    const { evalObsidian } = await import('./smoke/lib/obsidian-cli.mjs');
    return await evalObsidian(`
      (() => {
        const s = app.plugins.plugins["${PLUGIN_ID}"]?.settings;
        const providers = s?.providers || {};
        return !!(s?.deepseekApiKey || s?.customApiKey || s?.openaiApiKey || 
                 Object.values(providers).some(p => !!p.apiKey));
      })()
    `, { vault: 'test-vault' });
  } catch {
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log(`${colors.cyan}🔧 DeepReader 测试环境配置 (macOS)${colors.reset}\n`);

  const issues = [];
  const fixes = [];

  // 1. 检查目录结构
  info('检查目录结构...');
  const dirs = [TEST_VAULT, OBSIDIAN_DIR, PLUGINS_DIR, PLUGIN_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      if (CONFIG.checkOnly) {
        issues.push(`目录不存在: ${dir}`);
      } else {
        execSync(`mkdir -p "${dir}"`);
        fixes.push(`创建目录: ${dir}`);
      }
    }
  }
  if (issues.length === 0) {
    success('目录结构完整');
  }

  // 2. 检查/启用插件
  info('检查插件启用状态...');
  if (!existsSync(COMMUNITY_PLUGINS)) {
    if (CONFIG.checkOnly) {
      issues.push('community-plugins.json 不存在');
    } else {
      writeFileSync(COMMUNITY_PLUGINS, JSON.stringify([PLUGIN_ID], null, 2));
      fixes.push('创建 community-plugins.json');
    }
  } else {
    const enabled = JSON.parse(readFileSync(COMMUNITY_PLUGINS, 'utf-8'));
    if (!enabled.includes(PLUGIN_ID)) {
      if (CONFIG.checkOnly) {
        issues.push('插件未启用');
      } else {
        enablePlugin();
        fixes.push('启用插件');
      }
    } else {
      success('插件已启用');
    }
  }

  // 3. 检查/启动 Obsidian
  info('检查 Obsidian 运行状态...');
  if (!isObsidianRunning()) {
    if (CONFIG.checkOnly) {
      issues.push('Obsidian 未运行');
    } else {
      if (!startObsidian()) {
        issues.push('Obsidian 启动失败');
      } else {
        fixes.push('启动 Obsidian');
      }
    }
  } else {
    success('Obsidian 正在运行');
  }

  // 4. 检查 Obsidian 连接
  info('检查 Obsidian 连接...');
  const connected = await checkObsidianConnection();
  if (!connected) {
    issues.push('Obsidian 连接失败');
  } else {
    success('Obsidian 连接正常');
  }

  // 5. 检查插件加载
  if (connected) {
    info('检查插件加载状态...');
    const loaded = await checkPluginLoaded();
    if (!loaded) {
      issues.push('插件未加载');
    } else {
      success('插件已加载');
    }
  }

  // 6. 检查索引文件
  if (connected) {
    info('检查索引文件...');
    const indexInfo = await checkIndexFiles();
    if (!indexInfo) {
      issues.push('索引文件检查失败');
    } else if (!indexInfo.exists) {
      issues.push('catalog.json 不存在');
    } else if (!indexInfo.hasBooks) {
      warn('索引中无书籍记录');
    } else {
      success(`索引文件完整 (${indexInfo.bookCount} 本书)`);
    }
  }

  // 7. 检查 API Key
  if (connected) {
    info('检查 API Key 配置...');
    const hasApiKey = await checkApiKey();
    if (!hasApiKey) {
      warn('未配置 API Key（Agent 功能可能受限）');
    } else {
      success('API Key 已配置');
    }
  }

  // 输出结果
  console.log('\n' + '─'.repeat(50));

  if (fixes.length > 0) {
    console.log(`${colors.green}已修复:${colors.reset}`);
    for (const fix of fixes) {
      console.log(`  ✓ ${fix}`);
    }
  }

  if (issues.length > 0) {
    console.log(`${colors.red}存在问题:${colors.reset}`);
    for (const issue of issues) {
      console.log(`  ✗ ${issue}`);
    }
    console.log(`\n${colors.yellow}提示:${colors.reset} 运行 npm run setup:test-env 自动修复`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✅ 测试环境配置完成！${colors.reset}`);
    console.log(`\n可以运行测试:`);
    console.log(`  npm run smoke:core      # 冒烟测试`);
    console.log(`  npm run e2e-light       # 轻量 E2E`);
    console.log(`  npm run test:run        # 单元测试`);
  }
}

main().catch(console.error);
