#!/usr/bin/env node
/**
 * history.mjs — history 子命令
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateVault, readHistory, printHistoryTable, printError } from '../eval-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`用法: eval history [选项]\n选项: --book, -b <书名> --vault, -v <路径> --help, -h`);

  process.exit(0);}

export async function main({ bookTitle, vaultPath }) {
  const vault = vaultPath;
  validateVault(vault);

  const allEntries = readHistory(vault);
  if (allEntries.length === 0) { console.log('暂无评估历史。'); return 0; }

  const entries = bookTitle ? allEntries.filter(e => e.bookTitle === bookTitle) : allEntries;
  if (entries.length === 0) { console.log(bookTitle ? `没有《${bookTitle}》的评估记录` : '暂无评估历史'); return 0; }

  entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  console.log(`\n评估历史${bookTitle ? `（${bookTitle}）` : ''}`);
  printHistoryTable(entries);

  if (entries.length >= 2) {
    const diff = (entries[0].summary?.weightedScore || 0) - (entries[1].summary?.weightedScore || 0);
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : ' ';
    console.log(`\n趋势：最新 ${entries[0].summary?.weightedScore} vs 前次 ${entries[1].summary?.weightedScore}  ${arrow}${Math.abs(diff).toFixed(2)}`);
  }
  return 0;
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
  if (!args.vaultPath) args.vaultPath = resolve(__dirname, '..', '..', 'test-vault');
  main(args).then(() => process.exit(0)).catch(err => { printError(err.message); process.exit(2); });
}
