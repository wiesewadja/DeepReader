#!/usr/bin/env node
/**
 * generate.mjs — generate 子命令
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  goldenPath, datasetDir, validateVault, validateSrcPrompt,
  findBookInCatalog, ensureDir, readJSON,
  printStep, printError, printOK, printDivider, EvalError, spawnPI,
} from '../eval-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`用法: eval generate --book <书名> [选项]\n选项: --book, -b <书名>  --vault, -v <路径>  --help, -h`);

  process.exit(0);}

export async function main({ bookTitle, vaultPath }) {
  if (!bookTitle) { showHelp(); throw new EvalError('缺少 bookTitle 参数', 'EINVAL'); }

  const vault = vaultPath;
  validateVault(vault);

  const { bookId } = findBookInCatalog(vault, bookTitle);

  const golden = goldenPath(vault, bookTitle);
  if (existsSync(golden)) {
    throw new EvalError(`golden.json 已存在: ${golden}\n请先删除或使用其他书名`, 'EEXIST');
  }

  const promptFile = validateSrcPrompt('pi-generate-system-prompt.md');
  const systemPrompt = readFileSync(promptFile, 'utf-8');
  ensureDir(datasetDir(vault, bookTitle));

  printStep('GENERATE', `为《${bookTitle}》生成黄金测试集`);
  console.log(`bookId: ${bookId}`);

  await spawnPI({
    systemPrompt, vault,
    promptMessage: `为书籍《${bookTitle}》（bookId=${bookId}）生成黄金测试题集。
 步骤：1. 读取 .obsidian/plugins/deepreader-dev/pageindex/${bookId}/tree.json 2. 读取 .obsidian/plugins/deepreader-dev/pageindex/${bookId}/book-meta.json 3. 从不同卷/部分抽样 8-10 个章节 4. 生成恰好 20 道测试题
写入 .eval/datasets/${bookTitle}/golden.json`,
  });

  const finalPath = goldenPath(vault, bookTitle);
  if (!existsSync(finalPath)) throw new EvalError('PI Agent 未写入 golden.json', 'ENODATA');

  const data = readJSON(finalPath);
  if (!data?.questions?.length) throw new EvalError('golden.json 格式错误', 'EINVAL');

  printDivider();
  console.log(`\n✅ 生成完毕！共 ${data.questions.length} 道题\n文件: ${finalPath}\n`);
  printDivider();
  for (const q of data.questions) {
    const s = (q.question || '').substring(0, 50).padEnd(50);
    console.log(`  ${String(q.id||'').padEnd(5)} | ${String(q.type||'').padEnd(19)} | ${String(q.difficulty||'').padEnd(12)} | ${s}`);
  }
  printDivider();
  return { bookId, questionCount: data.questions.length };
}

// CLI 入口：eval-cli 调用 main({ bookTitle, vaultPath })
// 直接 CLI：node generate.mjs --book "反脆弱"
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
