#!/usr/bin/env node
/**
 * eval-cli.mjs — DeepReader Agent 评估系统统一 CLI 入口
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval-cli.mjs 在 scripts/eval/，工作区根在 scripts/eval/../../
const ROOT = resolve(__dirname, '..', '..');

const SUBCOMMANDS = ['generate', 'run', 'judge', 'history', 'diff', 'full'];

function showGlobalHelp() {
  console.log(`
DeepReader Agent 评估系统 CLI

用法:
  node scripts/eval/eval-cli.mjs <子命令> [选项]

子命令:
  generate   生成黄金测试集（PI Agent 生成 20 道测试题）
  run        E2E 执行（在 Obsidian 中运行 Agent，收集响应）
  judge      PI Agent 评分（评分 + 根因分析 + 报告）
  history    查看历史趋势
  diff       对比最近两次运行的差异
  full       完整流程（generate → run → judge）

全局选项:
  --vault <path>   Vault 路径，默认 ./test-vault
  --verbose         详细日志
  --help, -h        显示帮助

获取子命令帮助:
  node scripts/eval/eval-cli.mjs <子命令> --help

示例:
  eval full --book "反脆弱"
  eval full --book "反脆弱" --threshold 7.0
  eval judge --book "反脆弱" --run run-123
  eval history --book "反脆弱"
  eval diff --book "反脆弱"
`);
}

// ── 参数解析 ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { subcommand: null, vault: './test-vault', verbose: false };
  let i = 0;

  while (i < argv.length) {
    const a = argv[i];

    if (!out.subcommand && SUBCOMMANDS.includes(a)) {
      out.subcommand = a;
      i++;
      continue;
    }

    if (a === '--book' || a === '-b') { out.book = argv[++i]; i++; continue; }
    if (a === '--vault' || a === '-v') { out.vault = argv[++i]; i++; continue; }
    if (a === '--verbose') { out.verbose = true; i++; continue; }
    if (a === '--help' || a === '-h') { out.help = true; i++; continue; }

    out._rest = out._rest || [];
    out._rest.push(a);
    i++;
  }

  return out;
}

// ── 入口 ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) { showGlobalHelp(); return; }

  const args = parseArgs(argv);

  if (args.help && !args.subcommand) { showGlobalHelp(); return; }

  if (!args.subcommand) {
    console.error(`未知子命令: ${argv[0]}`);
    console.error(`可用子命令: ${SUBCOMMANDS.join(', ')}`);
    process.exit(2);
  }

  // vault 绝对路径
  const vaultPath = resolve(ROOT, args.vault);
  if (!existsSync(vaultPath)) {
    console.error(`Vault 路径不存在: ${vaultPath}`);
    process.exit(2);
  }

  // 直接调用子命令的 main 函数（不通过 process.argv）
  const { main: runSubcommand } = await import(
    `file://${resolve(__dirname, 'eval-subcommands', `${args.subcommand}.mjs`)}`
  );

  // 把 --run / --threshold / --a / --b / --format 等透传
  // 注意：--book 的值由 eval-cli 直接传（不在 extraFlags 里），--vault 也由 eval-cli 处理
  const extraFlags = {};
  const rest = args._rest || [];
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    if (f.startsWith('--') && f !== '--book' && f !== '--vault') {
      const key = f.slice(2);
      const raw = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      extraFlags[key] = key === 'threshold' && raw !== true ? parseFloat(raw) : raw;
    }
  }

  await runSubcommand({
    ...(args.book ? { bookTitle: args.book } : {}),
    vaultPath,
    ...extraFlags,
    verbose: args.verbose,
  });
}

main().catch(err => {
  console.error(`[EVAL CLI] 错误: ${err.message}`);
  process.exit(1);
});
