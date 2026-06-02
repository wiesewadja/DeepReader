#!/usr/bin/env node
/**
 * run.mjs — run 子命令
 */
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  validateVault, validateGolden, validateResponse,
  datasetDir, newRunId, ensureDir, readJSON,
  printStep, printError, printOK, EvalError,
} from '../eval-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`用法: eval run --book <书名> [选项]\n选项: --book, -b <书名>  --vault, -v <路径>  --help, -h`);

  process.exit(0);}

export async function main({ bookTitle, vaultPath }) {
  if (!bookTitle) { showHelp(); throw new EvalError('缺少 bookTitle 参数', 'EINVAL'); }

  const vault = vaultPath;
  validateVault(vault);

  const golden = validateGolden(vault, bookTitle);
  const goldenData = readJSON(golden);
  const { bookId } = goldenData;

  const indexDir = resolve(vault, '.obsidian', 'plugins', 'deepreader-dev', 'pageindex', bookId);
  if (!existsSync(indexDir)) {
    throw new EvalError(`书籍索引数据不存在: ${indexDir}\n请先索引书籍 "${bookTitle}"`, 'ENOENT');
  }

  const runId = newRunId();
  const questionCount = goldenData.questions?.length || 0;

  printStep('RUN', `E2E 执行 Agent（runId=${runId})`);
  console.log(`书籍: ${bookTitle} (bookId=${bookId})`);
  console.log(`题数: ${questionCount}`);
  console.log(`输出: ${datasetDir(vault, bookTitle)}/responses/${runId}.json`);

  ensureDir(resolve(datasetDir(vault, bookTitle), 'responses'));

  const ROOT = resolve(__dirname, '..', '..');
  await spawnWDIO({ vault, book: bookTitle, bookId, runId, questionCount, ROOT });

  validateResponse(vault, bookTitle, runId);
  const elapsed = Math.round((Date.now() - parseInt(runId.replace('run-', ''))) / 60000);

  printOK(`完成！共 ${questionCount} 道题，耗时约 ${elapsed} 分钟`);
  printOK(`响应文件: ${datasetDir(vault, bookTitle)}/responses/${runId}.json`);
  return { runId, questionCount };
}

function spawnWDIO({ vault, book, bookId, runId, questionCount, ROOT }) {
  return new Promise((resolve, reject) => {
    const wdioBin = resolve(ROOT, 'node_modules', '.bin', 'wdio');
    const specFile = resolve(ROOT, 'tests', 'e2e', 'specs', 'eval-agent.e2e.ts');
    const wdioConf = resolve(ROOT, 'tests', 'wdio.conf.ts');
    if (!existsSync(wdioBin)) { reject(new EvalError(`wdio 未安装: ${wdioBin}`, 'ENOENT')); return; }

    console.log(`\n启动 wdio（最多 10 分钟）...`);
    const child = spawn(wdioBin, ['run', wdioConf, '--spec', specFile], {
      cwd: vault, stdio: 'inherit',
      env: { ...process.env, EVAL_BOOK: book, EVAL_RUN_ID: runId, EVAL_BOOK_ID: bookId },
    });
    child.on('close', code => {
      if (code === 0) resolve({ done: true });
      else reject(new EvalError(`wdio 执行失败，退出码 ${code}`, 'ENONZERO'));
    });
    child.on('error', err => reject(new EvalError(`wdio 启动失败: ${err.message}`, 'ENOENT')));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book' || a === '-b') args.bookTitle = argv[++i];
    else if (a === '--vault' || a === '-v') args.vaultPath = resolve(__dirname, '..', '..', argv[++i]);
    else if (a === '--help' || a === '-h') { showHelp(); process.exit(0); }
  }
  if (!args.bookTitle) { printError('缺少必需参数：--book'); showHelp(); process.exit(2); }
  if (!args.vaultPath) args.vaultPath = resolve(__dirname, '..', '..', 'test-vault');
  main(args).then(() => process.exit(0)).catch(err => { printError(err.message); process.exit(err.code === 'ENOENT' || err.code === 'EINVAL' ? 2 : 1); });
}
