#!/usr/bin/env node
/**
 * eval-generate.mjs — PI Agent 生成黄金测试集
 *
 * 用法：node scripts/eval-generate.mjs --book=反脆弱
 *
 * 流程：spawn PI CLI (RPC mode) → 注入生成系统提示词 → PI 读本地数据 → 写入 golden.json
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VAULT = resolve(ROOT, 'test-vault');

// ── 参数解析 ──
const args = process.argv.slice(2);
const bookTitle = args.find(a => a.startsWith('--book='))?.split('=')[1];
if (!bookTitle) {
  console.error('用法: node scripts/eval-generate.mjs --book=反脆弱');
  process.exit(1);
}

// ── 读取系统提示词 ──
const systemPromptPath = join(VAULT, '.eval', 'pi-generate-system-prompt.md');
if (!existsSync(systemPromptPath)) {
  console.error(`系统提示词不存在: ${systemPromptPath}`);
  process.exit(1);
}
const systemPrompt = readFileSync(systemPromptPath, 'utf-8');

// ── 查找 bookId ──
const catalogPath = join(VAULT, '.obsidian', 'plugins', 'deepreader', 'pageindex', 'catalog.json');
if (!existsSync(catalogPath)) {
  console.error('catalog.json 不存在，请先索引书籍');
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
const books = catalog.books || catalog;
const entry = Object.entries(books).find(([, v]) => {
  const title = typeof v === 'string' ? v : v?.title || '';
  return title === bookTitle || title.includes(bookTitle);
});
if (!entry) {
  const available = Object.values(books).map(v => typeof v === 'string' ? v : v?.title).join(', ');
  console.error(`未在 catalog.json 中找到"${bookTitle}"。可用: ${available}`);
  process.exit(1);
}
const bookId = entry[0];

// ── spawn PI Agent ──
const PI_BIN = '/opt/homebrew/bin/pi';
const PI_ARGS = [
  '--mode', 'rpc',
  '--provider', 'xiaomi-token-plan-cn',
  '--model', 'mimo-v2.5',
  '--no-session', '--no-skills', '--no-extensions',
  '--tools', 'read,write,ls,find,grep',
  '--append-system-prompt', systemPrompt,
];

console.log(`[EVAL:GENERATE] 为《${bookTitle}》(bookId=${bookId}) 生成测试集...`);

const child = spawn(PI_BIN, PI_ARGS, {
  cwd: VAULT,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
let buffer = '';
let settled = false;

const timer = setTimeout(() => {
  if (!settled) { settled = true; child.kill(); console.error('[EVAL:GENERATE] 超时'); process.exit(1); }
}, 300_000); // 5 分钟超时

child.stdout.on('data', (d) => {
  buffer += d.toString('utf-8');
  while (true) {
    const idx = buffer.indexOf('\n');
    if (idx === -1) break;
    const line = buffer.substring(0, idx);
    buffer = buffer.substring(idx + 1);
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'message_update') {
        process.stdout.write(evt.text_delta || '');
        output += (evt.text_delta || '');
      }
      if (evt.type === 'agent_end' && !settled) {
        settled = true;
        clearTimeout(timer);
        console.log('\n[EVAL:GENERATE] PI Agent 完成');
        setTimeout(() => { child.kill(); checkResult(); }, 500);
      }
    } catch {}
  }
});

child.stderr.on('data', (d) => {
  // PI stderr 通常是调试日志，静默忽略
});

child.on('error', (err) => {
  if (!settled) { settled = true; clearTimeout(timer); console.error(`PI 启动失败: ${err.message}`); process.exit(1); }
});

child.on('close', (code) => {
  if (!settled) {
    settled = true;
    clearTimeout(timer);
    checkResult();
  }
});

// 发送生成请求
setTimeout(() => {
  const prompt = `为书籍《${bookTitle}》（bookId=${bookId}）生成黄金测试题集。请按照系统提示词中的要求，读取 tree.json、book-meta.json 和抽样 Markdown 文件，生成 15-20 道覆盖五大维度的测试题，写入 .eval/datasets/${bookTitle}/golden.json。`;
  child.stdin.write(JSON.stringify({ type: 'prompt', message: prompt }) + '\n');
}, 2000);

function checkResult() {
  const goldenPath = join(VAULT, '.eval', 'datasets', bookTitle, 'golden.json');
  if (existsSync(goldenPath)) {
    const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'));
    console.log(`[EVAL:GENERATE] 成功！共 ${golden.questions.length} 道题`);
    console.log(`[EVAL:GENERATE] 文件: ${goldenPath}`);
  } else {
    console.error('[EVAL:GENERATE] golden.json 未生成，PI Agent 可能没有执行写入');
    process.exit(1);
  }
}
