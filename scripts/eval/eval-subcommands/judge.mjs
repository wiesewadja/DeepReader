#!/usr/bin/env node
/**
 * judge.mjs — judge 子命令
 */
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateVault, validateGolden, validateResponse, validatePrompt,
  latestRunId, evalDir, reportPath,
  readJSON, readFile, readHistory,
  printStep, printError, printOK, printDivider,
  EvalError, getGitCommit,
} from '../eval-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`用法: eval judge --book <书名> [选项]\n选项: --book, -b <书名> --run <id> --threshold <分> --vault, -v <路径> --help, -h`);
  process.exit(0);
}

export async function main({ bookTitle, vaultPath, run: runId, threshold }) {
  if (!bookTitle) { showHelp(); throw new EvalError('缺少 bookTitle 参数', 'EINVAL'); }

  const vault = vaultPath;
  validateVault(vault);
  validateGolden(vault, bookTitle);

  const targetRunId = runId || latestRunId(vault, bookTitle);
  if (!targetRunId) throw new EvalError(`未找到运行记录。请先运行: eval run --book "${bookTitle}"`, 'ENOENT');

  validateResponse(vault, bookTitle, targetRunId);

  const ROOT = resolve(__dirname, '..', '..');
  const gitCommit = getGitCommit(ROOT);
  const promptFile = validatePrompt(vault, 'pi-judge-system-prompt.md');
  const systemPrompt = readFile(promptFile);
  const responseFile = resolve(vault, evalDir(vault), 'datasets', bookTitle, 'responses', `${targetRunId}.json`);
  const responseData = readJSON(responseFile);

  printStep('JUDGE', `评估《${bookTitle}》运行 ${targetRunId}`);
  console.log(`git commit: ${gitCommit}`);

  await spawnPI({ vault, systemPrompt, bookTitle, runId: targetRunId, gitCommit, responseData });

  // PI Agent 写完后再从 history 读评分（eval-log.jsonl 最新一条即本次结果）
  const history = readHistory(vault);
  const entry = history.find(e => e.runId === targetRunId);
  const score = entry?.summary?.weightedScore ?? 0;
  const verdict = entry?.verdict || 'N/A';

  printDivider();
  console.log(`\n  评估完成 | 总分: ${score} | 判定: ${verdict}`);
  console.log(`  报告: ${reportPath(vault, bookTitle)}`);
  printDivider();

  if (threshold !== undefined) {
    if (score >= threshold) { printOK(`分数 ${score} >= 阈值 ${threshold}，通过`); return { exitCode: 0, score, verdict }; }
    else { printError(`分数 ${score} < 阈值 ${threshold}，失败`); return { exitCode: 1, score, verdict }; }
  }
  return { exitCode: 0, score, verdict };
}

function spawnPI({ vault, systemPrompt, bookTitle, runId, gitCommit, responseData }) {
  return new Promise((resolve, reject) => {
    const PI_BIN = process.env.PI_BIN || '/opt/homebrew/bin/pi';
    const child = spawn(PI_BIN, [
      '--mode', 'rpc',
      '--provider', process.env.PI_PROVIDER || 'xiaomi-token-plan-cn',
      '--model', process.env.PI_MODEL || 'mimo-v2.5',
      '--no-session', '--no-skills', '--no-extensions',
      '--tools', 'read,write,ls,find,grep,web',
      '--append-system-prompt', systemPrompt,
    ], { cwd: vault, stdio: ['pipe', 'pipe', 'pipe'] });

    let buffer = ''; let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); reject(new EvalError('PI Agent 执行超时（10分钟）', 'ETIMEDOUT')); }
    }, 600_000);

    child.stdout.on('data', d => {
      buffer += d.toString('utf-8'); process.stdout.write(d.toString('utf-8'));
      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.substring(0, idx); buffer = buffer.substring(idx + 1);
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'tool_execution_start') console.log(`\n[TOOL] ${evt.tool_name}`);
          if (evt.type === 'agent_end' && !settled) {
            settled = true; clearTimeout(timer);
            console.log('\n[PI Agent 完成]');
            setTimeout(() => child.kill(), 500);
            resolve({ done: true });
          }
        } catch {}
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(new EvalError(`PI 启动失败: ${err.message}`, 'ENOENT')); } });
    child.on('close', () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ done: true }); } });

    setTimeout(() => {
      const qCount = responseData.responses?.length || 0;
      const prompt = `评估书籍《${bookTitle}》的 Agent 回复质量。\n运行 ID：${runId}\nGit Commit：${gitCommit}\n题数：${qCount}\n测试集：.eval/datasets/${bookTitle}/golden.json\n响应文件：.eval/datasets/${bookTitle}/responses/${runId}.json\n按照系统提示词逐题评分，低分题进行根因分析。\n将报告写入 .eval/reports/ 并追加历史到 .eval/history/eval-log.jsonl。`;
      child.stdin.write(JSON.stringify({ type: 'prompt', message: prompt }) + '\n');
    }, 2000);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book' || a === '-b') args.bookTitle = argv[++i];
    else if (a === '--run') args.run = argv[++i];
    else if (a === '--threshold' || a === '-t') args.threshold = parseFloat(argv[++i]);
    else if (a === '--vault' || a === '-v') args.vaultPath = resolve(__dirname, '..', '..', argv[++i]);
    else if (a === '--help' || a === '-h') { showHelp(); }
  }
  if (!args.bookTitle) { printError('缺少必需参数：--book'); showHelp(); process.exit(2); }
  if (!args.vaultPath) args.vaultPath = resolve(__dirname, '..', '..', 'test-vault');
  main(args).then(r => process.exit(r?.exitCode ?? 0)).catch(err => { printError(err.message); process.exit(2); });
}
