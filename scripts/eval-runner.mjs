#!/usr/bin/env node
/**
 * eval-runner.mjs — 一键全流程：收集响应 + PI 评估
 *
 * 用法：node scripts/eval-runner.mjs --book=反脆弱
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const bookTitle = args.find(a => a.startsWith('--book='))?.split('=')[1];
if (!bookTitle) {
  console.error('用法: node scripts/eval-runner.mjs --book=反脆弱');
  process.exit(1);
}

console.log(`\n╔══════════════════════════════════════╗`);
console.log(`║  DeepReader Agent 评估 — 《${bookTitle}》`);
console.log(`╚══════════════════════════════════════╝\n`);

// Phase 1: 收集响应
console.log('━━━ Phase 1: 收集 Agent 响应 ━━━');
const phase1 = spawn('node', [
  resolve(__dirname, 'eval-run.mjs'),
  `--book=${bookTitle}`,
], { cwd: ROOT, stdio: 'inherit' });

await new Promise((resolve, reject) => {
  phase1.on('close', (code) => {
    if (code === 0) resolve(undefined);
    else reject(new Error(`eval-run 退出码 ${code}`));
  });
  phase1.on('error', reject);
}).catch(err => {
  console.error(`\nPhase 1 失败: ${err.message}`);
  process.exit(1);
});

// 自动找最新 runId
const responsesDir = resolve(ROOT, 'test-vault', '.eval', 'datasets', bookTitle, 'responses');
const files = readdirSync(responsesDir).filter(f => f.endsWith('.json')).sort();
const runId = files[files.length - 1]?.replace('.json', '');
if (!runId) {
  console.error('未找到响应文件');
  process.exit(1);
}

console.log(`\n━━━ Phase 2: PI Agent 评估 ━━━`);
console.log(`运行 ID: ${runId}\n`);

const phase2 = spawn('node', [
  resolve(__dirname, 'eval-judge.mjs'),
  `--book=${bookTitle}`,
  `--run=${runId}`,
], { cwd: ROOT, stdio: 'inherit' });

await new Promise((resolve, reject) => {
  phase2.on('close', (code) => {
    if (code === 0) resolve(undefined);
    else reject(new Error(`eval-judge 退出码 ${code}`));
  });
  phase2.on('error', reject);
}).catch(err => {
  console.error(`\nPhase 2 失败: ${err.message}`);
  process.exit(1);
});

console.log(`\n✅ 全流程完成！查看历史：node scripts/eval-history.mjs --book=${bookTitle}`);
