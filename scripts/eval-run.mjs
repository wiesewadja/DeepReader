#!/usr/bin/env node
/**
 * eval-run.mjs — E2E 响应收集（wdio 执行）
 *
 * 用法：node scripts/eval-run.mjs --book=反脆弱
 *
 * 流程：spawn wdio → 收集 Agent 响应到 JSON 文件
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const bookTitle = args.find(a => a.startsWith('--book='))?.split('=')[1];
if (!bookTitle) {
  console.error('用法: node scripts/eval-run.mjs --book=反脆弱');
  process.exit(1);
}

const runId = `run-${Date.now()}`;
console.log(`[EVAL:RUN] 收集《${bookTitle}》响应 (runId=${runId})...`);

const child = spawn('npx', [
  'wdio', 'run', 'wdio.conf.ts',
  '--spec', 'tests/specs/eval-agent.e2e.ts',
], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    EVAL_BOOK: bookTitle,
    EVAL_RUN_ID: runId,
  },
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(`\n[EVAL:RUN] 完成！runId=${runId}`);
    console.log(`[EVAL:RUN] 下一步：node scripts/eval-judge.mjs --book=${bookTitle} --run=${runId}`);
  } else {
    console.error(`\n[EVAL:RUN] wdio 退出码: ${code}`);
    process.exit(code ?? 1);
  }
});
