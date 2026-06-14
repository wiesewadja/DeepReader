#!/usr/bin/env node
/**
 * verify-deploy.mjs — 部署后置校验
 *
 * 强制检查部署结果是否符合 .project-rules/07-deployment.md：
 * 1. test-vault 的 plugins/ 目录里只能有 deepreader-dev + 第三方（无 deepreader-wt-*）
 * 2. deepreader-dev/manifest.json 的 id 必须是 deepreader-dev
 * 3. deepreader-dev/manifest.json 的 version 必须是 <baseVersion>-<feature>.<HHMM>
 * 4. community-plugins.json 不能含 deepreader-wt-*
 *
 * 任一项失败，退出码 1（CI 拦截）。
 *
 * 用法:
 *   node scripts/verify-deploy.mjs             # 校验默认 test-vault
 *   node scripts/verify-deploy.mjs --silent    # 不输出成功日志
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

const SCRIPT_DIR = import.meta.dirname;
const ROOT = join(SCRIPT_DIR, '..');

// 找主仓库路径（worktree 中 .deploy-config.json 在主仓库）
function findMainRepo() {
  try {
    const out = execSync('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    const lines = out.split('\n');
    let mainPath = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        mainPath = lines[i].slice('worktree '.length);
      }
      if (lines[i] === 'branch refs/heads/main' && mainPath) {
        return mainPath;
      }
    }
  } catch {
    // 忽略
  }
  return ROOT;
}

const MAIN_REPO = findMainRepo();
const configPath = join(MAIN_REPO, '.deploy-config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const DEV_PATH = config.targets.dev.path;               // .../plugins/deepreader-dev
const PLUGINS_DIR = dirname(DEV_PATH);                  // .../plugins
const OBSIDIAN_DIR = dirname(PLUGINS_DIR);              // .../.obsidian
const COMMUNITY_PLUGINS = join(OBSIDIAN_DIR, 'community-plugins.json');

const args = process.argv.slice(2);
const silent = args.includes('--silent');

const errors = [];

// ─── 1. 检查 plugins/ 目录 ───
if (!existsSync(PLUGINS_DIR)) {
  errors.push(`plugins 目录不存在: ${PLUGINS_DIR}`);
} else {
  const dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const forbidden = dirs.filter(d => d.startsWith('deepreader-wt-'));
  if (forbidden.length > 0) {
    errors.push(
      `发现 worktree 隔离插件目录: ${forbidden.join(', ')}\n` +
      `     应 rm -rf 删除（详见 .project-rules/07-deployment.md）`
    );
  }

  // 允许 deepreader-dev + 任意第三方插件，禁止额外 deepreader-* 目录
  const extraDeepreader = dirs.filter(d => d.startsWith('deepreader') && d !== 'deepreader-dev');
  if (extraDeepreader.length > 0) {
    errors.push(
      `发现多余的 DeepReader 目录: ${extraDeepreader.join(', ')}\n` +
      `     test-vault 应只保留 deepreader-dev`
    );
  }

  if (!dirs.includes('deepreader-dev')) {
    errors.push('缺少 deepreader-dev 目录（部署可能未执行或失败）');
  }

  if (!silent) {
    console.log(`   plugins/: ${dirs.join(', ') || '(空)'}`);
  }
}

// ─── 2. 检查 deepreader-dev/manifest.json ───
const manifestPath = join(PLUGINS_DIR, 'deepreader-dev', 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  if (manifest.id !== 'deepreader-dev') {
    errors.push(`manifest.id = "${manifest.id}"，应为 "deepreader-dev"`);
  }

  // version 应为 <baseVersion>-<feature>.<HHMM>
  // baseVersion: YYYY.MM.DD；feature: 字母数字/连字符；HHMM: 4 位数字
  const versionRe = /^\d{4}\.\d{2}\.\d{2}-[a-zA-Z0-9-]+\.\d{4}$/;
  if (!versionRe.test(manifest.version || '')) {
    errors.push(
      `manifest.version = "${manifest.version}"\n` +
      `     应为 "<YYYY.MM.DD>-<feature>.<HHMM>" 格式（例 2026.06.13-async-visualizer.1638）`
    );
  } else if (!silent) {
    console.log(`   version: ${manifest.version}`);
  }
} else if (!errors.some(e => e.includes('缺少 deepreader-dev'))) {
  errors.push(`manifest.json 不存在: ${manifestPath}`);
}

// ─── 3. 检查 community-plugins.json ───
if (existsSync(COMMUNITY_PLUGINS)) {
  const enabled = JSON.parse(readFileSync(COMMUNITY_PLUGINS, 'utf-8'));
  const wtEnabled = enabled.filter(id => id.startsWith('deepreader-wt-'));
  if (wtEnabled.length > 0) {
    errors.push(
      `community-plugins.json 含遗留启用项: ${wtEnabled.join(', ')}\n` +
      `     应手动移除（Obsidian 设置 → 第三方插件）`
    );
  }
}

// ─── 4. 检查 deploy.js 自身（防止反模式回潮） ───
// 只检测确定性的反模式（任何回潮必然含其中之一）
// 不检测 'git worktree list' 字符串 — 读 .deploy-config.json 时合法使用
// 不检测 'deepreader-wt-' 字符串 — 注释/错误信息中合法出现
// 扫描时剔除 selfCheck 函数体，避免反模式列表自身触发误报
const deployJsPath = join(ROOT, 'scripts/deploy.js');
if (existsSync(deployJsPath)) {
  const raw = readFileSync(deployJsPath, 'utf-8');
  const deploySrc = raw.replace(
    /\/\/\s*─── 入口自检：防止反模式回潮 ───[\s\S]*?\}\)\(\);/,
    ''
  );
  const antiPatterns = [
    { re: /function\s+detectWorktree/, msg: 'detectWorktree() 函数（worktree 隔离路径反模式）' },
    { re: /\bsafeBranchName\b/, msg: 'safeBranchName 变量（按分支名造目录）' },
    { re: /\bbasePluginId\b/, msg: 'basePluginId 引用（.deploy-config.json 已删除该字段）' },
  ];
  for (const { re, msg } of antiPatterns) {
    if (re.test(deploySrc)) {
      errors.push(`scripts/deploy.js 含反模式: ${msg}`);
    }
  }
  // 必须项：getDevVersion 函数存在
  if (!/function\s+getDevVersion/.test(deploySrc)) {
    errors.push('scripts/deploy.js 缺少 getDevVersion() 函数（dev 目标必须注入特性版本号）');
  }
}

// ─── 输出 ───
if (!silent) {
  console.log('🔍 部署后置校验');
}

if (errors.length > 0) {
  console.error(`\n❌ 校验失败 (${errors.length} 项):`);
  for (const e of errors) console.error(`   - ${e}`);
  console.error('\n   详见 .project-rules/07-deployment.md');
  process.exit(1);
}

if (!silent) {
  console.log('✅ 校验通过');
}
process.exit(0);
