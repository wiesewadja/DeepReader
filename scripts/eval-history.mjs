#!/usr/bin/env node
/**
 * eval-history.mjs — 查看评估历史
 *
 * 用法：node scripts/eval-history.mjs [--book=反脆弱]
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VAULT = resolve(ROOT, 'test-vault');

const args = process.argv.slice(2);
const bookFilter = args.find(a => a.startsWith('--book='))?.split('=')[1];

const historyPath = join(VAULT, '.eval', 'history', 'eval-log.jsonl');
if (!existsSync(historyPath)) {
  console.log('暂无评估历史。运行 eval:judge 后会自动记录。');
  process.exit(0);
}

const raw = readFileSync(historyPath, 'utf-8').trim();
if (!raw) {
  console.log('历史文件为空');
  process.exit(0);
}
const entries = raw.split('\n').map(l => JSON.parse(l));

const filtered = bookFilter
  ? entries.filter(e => e.bookTitle === bookFilter)
  : entries;

if (filtered.length === 0) {
  console.log(bookFilter ? `没有《${bookFilter}》的评估记录` : '暂无评估历史');
  process.exit(0);
}

// 表格输出
console.log('\n评估历史');
console.log('─'.repeat(90));
console.log('时间                | 书籍         | 运行ID               | 总分  | 判定   | commit');
console.log('─'.repeat(90));

for (const e of filtered) {
  const ts = (e.timestamp || '').substring(0, 19).replace('T', ' ');
  const book = (e.bookTitle || '').padEnd(12);
  const run = (e.runId || '').padEnd(20);
  const score = ((e.summary?.weightedScore ?? 'N/A') + '').padEnd(5);
  const verdict = (e.verdict || 'N/A').padEnd(6);
  const commit = e.gitCommit || 'unknown';
  console.log(`${ts} | ${book} | ${run} | ${score} | ${verdict} | ${commit}`);
}

console.log('─'.repeat(90));
console.log(`共 ${filtered.length} 条记录`);
