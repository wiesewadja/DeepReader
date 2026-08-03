#!/usr/bin/env node

/**
 * DeepReader 插件部署脚本
 * 支持多目标部署：dev（开发）、daily（日常使用）
 *
 * worktree 中也直接覆盖 dev 目标路径，保持 Obsidian 内只有一个插件实例。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── 入口自检：防止反模式回潮 ───
// 如果 scripts/deploy.js 被改回 worktree 隔离路径模式，立刻拒绝执行
// 只检测确定性的反模式（注释/字符串中合法出现的词不算）
// 扫描时剔除自检函数自身，避免字符串自触发
(function selfCheck() {
  const raw = fs.readFileSync(__filename, 'utf-8');
  // 剔除 selfCheck 函数体（从标记到对应 IIFE 结束）
  const self = raw.replace(
    /\/\/\s*─── 入口自检：防止反模式回潮 ───[\s\S]*?\}\)\(\);/,
    ''
  );
  const antiPatterns = [
    { re: /function\s+detectWorktree/, msg: 'detectWorktree() 函数' },
    { re: /\bsafeBranchName\b/, msg: 'safeBranchName 变量' },
  ];
  for (const { re, msg } of antiPatterns) {
    if (re.test(self)) {
      console.error(`❌ scripts/deploy.js 含反模式: ${msg}`);
      console.error('   所有 worktree 必须覆盖到同一个 deepreader-dev/，禁止按分支名生成独立目录');
      console.error('   详见 .project-rules/07-deployment.md');
      process.exit(1);
    }
  }
})();

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

// 类型检查 + 版本同步 + css（与 target 无关，一次性；bundle 在 per-target 循环里按 target 构建）
console.log('📦 正在构建（类型检查 + 资源）...');
try {
  execSync('npm run build:check', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
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

/**
 * dev 部署专用：生成带特性标识 + 时间戳的版本号
 * 格式：<baseVersion>-<feature>.<HHMM>
 * 例：2026.06.13-async-visualizer.1430
 *
 * 让 Obsidian 插件列表能直观看到当前部署的是哪个分支、何时部署的
 */
function getDevVersion(baseVersion) {
  let branch = 'unknown';
  try {
    branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
      cwd: path.join(__dirname, '..')
    }).trim();
  } catch (e) {
    // 忽略
  }
  // feat/async-visualizer → async-visualizer；main → main
  // 前缀清单对齐 .project-rules/09-branching.md 的分支命名（feat|fix|refactor|perf|docs|test|chore）
  const feature = branch
    .replace(/^(feat|fix|refactor|perf|docs|test|chore)\//, '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 30) || 'main';
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  // Trim baseVersion to YYYY.MM.DD (strip any trailing .N patch segment)
  const baseDate = baseVersion.match(/^\d{4}\.\d{2}\.\d{2}/)?.[0] ?? baseVersion;
  return `${baseDate}-${feature}.${hhmm}`;
}

function deployToPath(targetPath, pluginId, targetName, overrideVersion) {
  console.log(`🎯 部署到: ${targetName} (id=${pluginId})`);
  if (overrideVersion) {
    console.log(`   🏷️  版本: ${overrideVersion}`);
  }

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
      // manifest: 按 pluginId 改写 id 字段；dev 目标额外重写 version
      const targetManifest = { ...baseManifest, id: pluginId };
      if (overrideVersion) targetManifest.version = overrideVersion;
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

  // per-target bundle：
  //   dev  = test-vault 测试版本 → 保留内部命令（微信读书快捷入口 + 调试/测试命令），测试照常跑
  //   daily= 正式版本（坚果云 / GitHub release）→ 剥离内部命令，不暴露给最终用户
  const internalCommands = targetName === 'dev' ? 'true' : 'false';
  console.log(`📦 构建 bundle (target=${targetName}, 内部命令=${internalCommands === 'true' ? '保留' : '剥离'})...`);
  try {
    execSync('npm run build:bundle', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, INTERNAL_COMMANDS: internalCommands },
    });
  } catch (error) {
    console.error(`❌ ${targetName} bundle 构建失败`);
    process.exit(1);
  }

  // dev 目标注入特性版本号，方便用户在 Obsidian 插件列表里看到部署生效
  const overrideVersion = targetName === 'dev' ? getDevVersion(baseManifest.version) : undefined;
  deployToPath(target.path, target.pluginId, target.name, overrideVersion);
}

console.log('✨ 部署完成！\n');

// 部署到 dev 目标后强制跑后置校验（test-vault 干净 + manifest 正确）
if (targets.includes('dev')) {
  try {
    execSync('node scripts/verify-deploy.mjs', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  } catch (e) {
    console.error('\n❌ 部署后置校验失败，请按提示修复');
    process.exit(1);
  }

  // 自动 reload 插件（确保最新代码生效）
  console.log('\n🔄 正在 reload 插件...');
  try {
    execSync('obsidian vault=test-vault plugin:reload id=deepreader-dev', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    console.log('✅ 插件已 reload');
  } catch (e) {
    console.log('⚠️  插件 reload 失败（可能 Obsidian 未运行）');
  }
}
