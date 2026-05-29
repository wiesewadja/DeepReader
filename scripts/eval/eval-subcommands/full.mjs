#!/usr/bin/env node
/**
 * full.mjs — full 子命令
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { printStep, printError, printOK } from '../eval-utils.mjs';
import { main as generate } from './generate.mjs';
import { main as run } from './run.mjs';
import { main as judge } from './judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`用法: eval full --book <书名> [选项]\n选项: --book -b <书名> --threshold <分> --vault, -v <路径> --help, -h`);

  process.exit(0);}

export async function main({ bookTitle, vaultPath, threshold }) {
  if (!bookTitle) { showHelp(); throw new EvalError('缺少 bookTitle 参数', 'EINVAL'); }

  const vault = vaultPath;

  printStep('PHASE 1/3', '生成黄金测试集');
  try {
    const r = await generate({ bookTitle, vaultPath: vault });
    printOK('Phase 1 完成');
  } catch (err) {
    printError(`Phase 1 (generate) 失败: ${err.message}`);
    process.exit(1);
  }

  printStep('PHASE 2/3', 'E2E 执行 Agent');
  let runId;
  try {
    const r = await run({ bookTitle, vaultPath: vault });
    runId = r.runId;
    printOK(`Phase 2 完成：${r.questionCount} 道题`);
  } catch (err) {
    printError(`Phase 2 (run) 失败: ${err.message}`);
    process.exit(1);
  }

  printStep('PHASE 3/3', 'PI Agent 评分');
  try {
    const r = await judge({ bookTitle, vaultPath: vault, run: runId, threshold });
    if (threshold !== undefined) {
      if (r.score >= threshold) printOK(`✅ 评估通过：分数 ${r.score} >= ${threshold}`);
      else { printError(`❌ 评估未通过：分数 ${r.score} < ${threshold}`); process.exit(1); }
    } else {
      printOK(`Phase 3 完成：总分 ${r.score}，判定 ${r.verdict}`);
    }
  } catch (err) {
    printError(`Phase 3 (judge) 失败: ${err.message}`);
    process.exit(1);
  }

  printOK('全流程完成！');
  console.log(`\n下一步：node scripts/eval/eval-cli.mjs history --book "${bookTitle}"`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book' || a === '-b') args.bookTitle = argv[++i];
    else if (a === '--threshold' || a === '-t') args.threshold = parseFloat(argv[++i]);
    else if (a === '--vault' || a === '-v') args.vaultPath = resolve(__dirname, '..', '..', argv[++i]);
    else if (a === '--help' || a === '-h') { showHelp(); process.exit(0); }
  }
  if (!args.bookTitle) { printError('缺少必需参数：--book'); showHelp(); process.exit(2); }
  if (!args.vaultPath) args.vaultPath = resolve(__dirname, '..', '..', 'test-vault');
  main(args).then(() => process.exit(0)).catch(err => { printError(err.message); process.exit(1); });
}
