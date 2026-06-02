#!/usr/bin/env node

/**
 * DeepReader 插件部署脚本
 * 支持多目标部署：dev（开发）、daily（日常使用）
 *
 * Dev 目标会自动把 manifest.json 的 id 改为 <pluginId>（默认 deepreader-dev），
 * 并部署到 <pluginId> 目录，避免与 daily 版本的 deepreader 冲突。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取配置文件
const configPath = path.join(__dirname, '..', '.deploy-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 获取命令行参数
const args = process.argv.slice(2);
const targets = args.length > 0 ? args : ['dev'];

console.log('🚀 DeepReader 插件部署\n');

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

for (const targetName of targets) {
  const target = config.targets[targetName];

  if (!target) {
    console.log(`⚠️  未知目标: ${targetName}，跳过`);
    continue;
  }

  const pluginId = target.pluginId || 'deepreader';
  console.log(`🎯 部署到: ${target.name} (id=${pluginId})`);

  // 创建目标目录
  if (!fs.existsSync(target.path)) {
    fs.mkdirSync(target.path, { recursive: true });
    console.log(`   📁 创建目录: ${target.path}`);
  }

  // 复制文件
  let copiedCount = 0;
  for (const file of files) {
    const src = path.join(binDir, file);
    const dest = path.join(target.path, file);

    if (!fs.existsSync(src)) {
      console.log(`   ⚠️  文件不存在: ${src}`);
      continue;
    }

    if (file === 'manifest.json') {
      // manifest: 按 target.pluginId 改写 id 字段
      const targetManifest = { ...baseManifest, id: pluginId };
      fs.writeFileSync(dest, JSON.stringify(targetManifest, null, '\t') + '\n', 'utf-8');
    } else {
      fs.copyFileSync(src, dest);
    }
    copiedCount++;
  }

  console.log(`   ✅ 成功复制 ${copiedCount} 个文件\n`);
}

console.log('✨ 部署完成！');
