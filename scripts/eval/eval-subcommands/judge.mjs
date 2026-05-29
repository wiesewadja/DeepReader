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
  EvalError, getGitCommit, spawnPI,
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

  await spawnPI({
    vault, systemPrompt,
    tools: ['read', 'write', 'ls', 'find', 'grep', 'web'],
    timeoutMs: 600_000,
    promptMessage: `评估书籍《${bookTitle}》的 Agent 回复质量。\n运行 ID：${targetRunId}\nGit Commit：${gitCommit}\n题数：${responseData.responses?.length || 0}\n测试集：.eval/datasets/${bookTitle}/golden.json\n响应文件：.eval/datasets/${bookTitle}/responses/${targetRunId}.json\n按照系统提示词逐题评分，低分题进行根因分析。\n将报告写入 .eval/reports/ 并追加历史到 .eval/history/eval-log.jsonl。`,
  });

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
