#!/usr/bin/env node
/**
 * eval-judge.mjs — PI Agent 评分 + 根因分析 + 报告生成
 *
 * 用法：node scripts/eval-judge.mjs --book=反脆弱 --run=2026-05-29T12-00-00
 *
 * 流程：spawn PI CLI (RPC mode) → 注入评估系统提示词 → PI 读响应+本地数据+LangSmith → 写报告+历史
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VAULT = resolve(ROOT, 'test-vault');

// ── 参数解析 ──
const args = process.argv.slice(2);
const bookTitle = args.find(a => a.startsWith('--book='))?.split('=')[1];
let runId = args.find(a => a.startsWith('--run='))?.split('=')[1];

if (!bookTitle) {
  console.error('用法: node scripts/eval-judge.mjs --book=反脆弱 [--run=runId]');
  process.exit(1);
}

// ── 读取系统提示词 ──
const systemPromptPath = join(VAULT, '.eval', 'pi-judge-system-prompt.md');
if (!existsSync(systemPromptPath)) {
  console.error(`系统提示词不存在: ${systemPromptPath}`);
  process.exit(1);
}
const systemPrompt = readFileSync(systemPromptPath, 'utf-8');

// ── 定位响应文件 ──
const responsesDir = join(VAULT, '.eval', 'datasets', bookTitle, 'responses');
if (!existsSync(responsesDir)) {
  console.error(`响应目录不存在: ${responsesDir}\n请先运行 eval:run`);
  process.exit(1);
}

if (!runId) {
  // 自动取最新的响应文件
  const files = readdirSync(responsesDir).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error('没有找到响应文件');
    process.exit(1);
  }
  runId = files[files.length - 1].replace('.json', '');
  console.log(`[EVAL:JUDGE] 自动选择最新运行: ${runId}`);
}

const responseFile = join(responsesDir, `${runId}.json`);
if (!existsSync(responseFile)) {
  console.error(`响应文件不存在: ${responseFile}`);
  process.exit(1);
}

// ── 获取 git commit ──
let gitCommit = 'unknown';
try {
  gitCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch {}

// ── spawn PI Agent ──
const PI_BIN = '/opt/homebrew/bin/pi';
const PI_ARGS = [
  '--mode', 'rpc',
  '--provider', 'xiaomi-token-plan-cn',
  '--model', 'mimo-v2.5',
  '--no-session', '--no-skills', '--no-extensions',
  '--tools', 'read,write,ls,find,grep,web',
  '--append-system-prompt', systemPrompt,
];

console.log(`[EVAL:JUDGE] 评估《${bookTitle}》运行 ${runId}...`);

const child = spawn(PI_BIN, PI_ARGS, {
  cwd: VAULT,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
let buffer = '';
let settled = false;

const timer = setTimeout(() => {
  if (!settled) { settled = true; child.kill(); console.error('[EVAL:JUDGE] 超时'); process.exit(1); }
}, 600_000); // 10 分钟超时（评估需要读文件+调 API）

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
      if (evt.type === 'tool_execution_start') {
        console.log(`\n[TOOL] ${evt.tool_name}(${JSON.stringify(evt.args).slice(0, 80)}...)`);
      }
      if (evt.type === 'agent_end' && !settled) {
        settled = true;
        clearTimeout(timer);
        console.log('\n[EVAL:JUDGE] PI Agent 完成');
        setTimeout(() => { child.kill(); checkResults(); }, 500);
      }
    } catch {}
  }
});

child.stderr.on('data', () => {});

child.on('error', (err) => {
  if (!settled) { settled = true; clearTimeout(timer); console.error(`PI 启动失败: ${err.message}`); process.exit(1); }
});

child.on('close', () => {
  if (!settled) { settled = true; clearTimeout(timer); checkResults(); }
});

// 发送评估请求
setTimeout(() => {
  const goldenPath = `.eval/datasets/${bookTitle}/golden.json`;
  const responsePath = `.eval/datasets/${bookTitle}/responses/${runId}.json`;
  const prompt = `评估书籍《${bookTitle}》的 Agent 回复质量。\n\n测试集：${goldenPath}\n响应文件：${responsePath}\nGit Commit：${gitCommit}\n运行 ID：${runId}\n\n按照系统提示词中的评估标准逐题评分，低分题进行根因分析（读取 LangSmith trace + 本地索引数据）。\n将报告写入 .eval/reports/ 并追加历史到 .eval/history/eval-log.jsonl。`;
  child.stdin.write(JSON.stringify({ type: 'prompt', message: prompt }) + '\n');
}, 2000);

function checkResults() {
  const date = new Date().toISOString().split('T')[0];
  const reportPattern = `${date}_${bookTitle}.md`;
  const reportsDir = join(VAULT, '.eval', 'reports');

  if (existsSync(reportsDir)) {
    const reports = readdirSync(reportsDir).filter(f => f.includes(bookTitle));
    if (reports.length > 0) {
      console.log(`\n[EVAL:JUDGE] 报告已生成: ${join(reportsDir, reports[reports.length - 1])}`);
    }
  }

  const historyPath = join(VAULT, '.eval', 'history', 'eval-log.jsonl');
  if (existsSync(historyPath)) {
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n');
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    console.log(`[EVAL:JUDGE] 结果: ${lastEntry.verdict} | 总分: ${lastEntry.summary.weightedScore}`);
  }
}
