#!/usr/bin/env node
/**
 * diff.mjs — diff 子命令
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateVault, validateGolden,
  latestRunId, secondLatestRunId, readHistory, readJSON,
  printStep, printError, printDivider, EvalError,
} from '../eval-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`用法: eval diff --book <书名> [选项]\n选项: --book -b <书名> --a <runId> --b <runId> --vault, -v <路径> --help, -h`);

  process.exit(0);}

export async function main({ bookTitle, vaultPath, a: runIdA, b: runIdB }) {
  if (!bookTitle) { showHelp(); throw new EvalError('缺少 bookTitle 参数', 'EINVAL'); }

  const vault = vaultPath;
  validateVault(vault);
  validateGolden(vault, bookTitle);

  const bId = runIdB || latestRunId(vault, bookTitle);
  const aId = runIdA || secondLatestRunId(vault, bookTitle);
  if (!bId) throw new EvalError('需要至少一次运行记录', 'ENOENT');
  if (!aId) throw new EvalError('需要至少两次运行记录', 'ENOENT');

  const dataA = readJSON(resolve(vault, '.eval', 'datasets', bookTitle, 'responses', `${aId}.json`));
  const dataB = readJSON(resolve(vault, '.eval', 'datasets', bookTitle, 'responses', `${bId}.json`));
  const history = readHistory(vault);
  const entryA = history.find(e => e.runId === aId);
  const entryB = history.find(e => e.runId === bId);

  printStep('DIFF', `对比 ${aId} vs ${bId}`);

  printDivider();
  console.log(`  run A: ${aId}  |  run B: ${bId}`);
  printDivider();
  console.log('  维度           |   A    |   B    |  变化  | 说明');
  printDivider();

  const dims = ['recall', 'faithfulness', 'formatting', 'efficiency', 'latency', 'weightedScore'];
  const labels = { recall:'召回率', faithfulness:'忠实度', formatting:'排版', efficiency:'效率', latency:'延迟', weightedScore:'加权总分' };

  for (const dim of dims) {
    const valA = entryA?.summary?.[dim] ?? null;
    const valB = entryB?.summary?.[dim] ?? null;
    const sA = valA !== null ? valA.toFixed(1) : 'N/A ';
    const sB = valB !== null ? valB.toFixed(1) : 'N/A ';
    let ds = '  —  '; let note = '';
    if (valA !== null && valB !== null) {
      const d = valB - valA;
      ds = `${d > 0 ? '▲' : d < 0 ? '▼' : '  '}${Math.abs(d).toFixed(1)}`.padStart(5);
      if (Math.abs(d) >= 0.5) note = d > 0 ? '提升显著' : '下降显著';
    }
    console.log(`  ${(labels[dim]||dim).padEnd(14)} | ${sA.padStart(5)} | ${sB.padStart(5)} | ${ds} | ${note}`);
  }

  printDivider();
  console.log(`  判定变化: ${entryA?.verdict || 'N/A'} → ${entryB?.verdict || 'N/A'}`);
  const passA = entryA?.passedCount ?? '?', passB = entryB?.passedCount ?? '?', total = entryB?.questionCount ?? '?';
  if (passA !== '?' && passB !== '?') console.log(`  通过题数: ${passA} → ${passB} / ${total}`);
  printDivider();
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book' || a === '-b') args.bookTitle = argv[++i];
    else if (a === '--a') args.a = argv[++i];
    else if (a === '--b') args.b = argv[++i];
    else if (a === '--vault' || a === '-v') args.vaultPath = resolve(__dirname, '..', '..', argv[++i]);
    else if (a === '--help' || a === '-h') { showHelp(); process.exit(0); }
  }
  if (!args.bookTitle) { printError('缺少必需参数：--book'); showHelp(); process.exit(2); }
  if (!args.vaultPath) args.vaultPath = resolve(__dirname, '..', '..', 'test-vault');
  main(args).then(() => process.exit(0)).catch(err => { printError(err.message); process.exit(err.code === 'ENOENT' || err.code === 'EINVAL' ? 2 : 1); });
}
