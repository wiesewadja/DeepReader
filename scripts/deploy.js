#!/usr/bin/env node

/**
 * DeepReader 插件部署脚本
 * 支持多目标部署：dev（开发）、daily（日常使用）
 * 
 * Worktree 支持：
 * - 自动检测当前是否在 worktree 中
 * - 如果是 worktree，部署到独立的插件目录（基于分支名）
 * - 共享主仓库的 test-vault
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 获取当前脚本所在目录
const scriptDir = __dirname;
const currentRoot = path.join(scriptDir, '..');

// 尝试从当前目录读取配置，如果不存在则从主仓库读取
let configPath = path.join(currentRoot, '.deploy-config.json');
if (!fs.existsSync(configPath)) {
  // 在 worktree 中，从主仓库读取配置
  try {
    const mainWorktree = execSync('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: currentRoot
    });
    const lines = mainWorktree.split('\n');
    let mainPath = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        mainPath = lines[i].slice('worktree '.length);
      }
      if (lines[i] === 'branch refs/heads/main' && mainPath) {
        break;
      }
    }
    if (mainPath) {
      configPath = path.join(mainPath, '.deploy-config.json');
    }
  } catch (e) {
    // 忽略错误
  }
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 获取命令行参数
const args = process.argv.slice(2);
const targets = args.length > 0 ? args : ['dev'];

console.log('🚀 DeepReader 插件部署\n');

// 检测 worktree
function detectWorktree() {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { 
      encoding: 'utf-8',
      cwd: path.join(__dirname, '..')
    }).trim();
    
    const mainWorktree = execSync('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: path.join(__dirname, '..')
    });
    
    // 找到 main 分支的 worktree 路径
    const lines = mainWorktree.split('\n');
    let mainPath = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        mainPath = lines[i].slice('worktree '.length);
      }
      if (lines[i] === 'branch refs/heads/main' && mainPath) {
        break;
      }
    }
    
    // 获取当前分支名
    const currentBranch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      cwd: path.join(__dirname, '..')
    }).trim();
    
    const isWorktree = gitRoot !== mainPath;
    
    return {
      isWorktree,
      gitRoot,
      mainPath,
      branch: currentBranch
    };
  } catch (e) {
    return { isWorktree: false, branch: 'unknown' };
  }
}

const worktreeInfo = detectWorktree();

if (worktreeInfo.isWorktree) {
  console.log(`🌿 检测到 worktree: ${worktreeInfo.branch}`);
  console.log(`   路径: ${worktreeInfo.gitRoot}\n`);
}

// 执行构建
console.log('📦 正在构建...');
try {
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('');
} catch (error) {
  console.error('❌ 构建失败');
  process.exit(1);
}

// 部署到指定目标
const binDir = path.join(__dirname, '..', 'bin');
const files = config.files;

// 源 manifest（git tracked，id 固定为 'deepreader'）
const srcManifestPath = path.join(binDir, 'manifest.json');
let baseManifest;
try {
  baseManifest = JSON.parse(fs.readFileSync(srcManifestPath, 'utf-8'));
} catch (e) {
  console.error('❌ 读取源 manifest 失败:', e.message);
  process.exit(1);
}

function deployToPath(targetPath, pluginId, targetName) {
  console.log(`🎯 部署到: ${targetName} (id=${pluginId})`);

  // 创建目标目录
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
    console.log(`   📁 创建目录: ${targetPath}`);
  }

  // 复制文件
  let copiedCount = 0;
  for (const file of files) {
    const src = path.join(binDir, file);
    const dest = path.join(targetPath, file);

    if (!fs.existsSync(src)) {
      console.log(`   ⚠️  文件不存在: ${src}`);
      continue;
    }

    if (file === 'manifest.json') {
      // manifest: 按 pluginId 改写 id 字段
      const targetManifest = { ...baseManifest, id: pluginId };
      fs.writeFileSync(dest, JSON.stringify(targetManifest, null, '\t') + '\n', 'utf-8');
    } else {
      fs.copyFileSync(src, dest);
    }
    copiedCount++;
  }

  console.log(`   ✅ 成功复制 ${copiedCount} 个文件\n`);
}

for (const targetName of targets) {
  const target = config.targets[targetName];

  if (!target) {
    console.log(`⚠️  未知目标: ${targetName}，跳过`);
    continue;
  }

  // 如果是 worktree，使用独立的插件目录
  if (worktreeInfo.isWorktree && targetName === 'dev') {
    const { basePluginId, testVaultPath } = config.worktree;
    // 从分支名生成安全的目录名（feat/xxx -> feat-xxx）
    const safeBranchName = worktreeInfo.branch.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const pluginId = `${basePluginId}-${safeBranchName}`;
    const pluginPath = path.join(testVaultPath, '.obsidian', 'plugins', pluginId);
    
    deployToPath(pluginPath, pluginId, `worktree (${worktreeInfo.branch})`);
  } else {
    deployToPath(target.path, target.pluginId, target.name);
  }
}

console.log('✨ 部署完成！');
