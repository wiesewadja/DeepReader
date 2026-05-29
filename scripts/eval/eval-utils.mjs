/**
 * eval-utils.mjs — 共享工具函数
 *
 * 被所有子命令使用。纯函数，无副作用（除文件系统操作外）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

// ── 路径构建 ──────────────────────────────────────────────────────────────

/** 相对于 vault 的 .eval 目录路径 */
export const EVAL_DIR = '.eval';

/** 构建 vault 内 .eval 目录的绝对路径 */
export function evalDir(vaultPath) {
  return resolve(vaultPath, EVAL_DIR);
}

/** 构建 datasets/{书名}/ 目录的绝对路径 */
export function datasetDir(vaultPath, bookTitle) {
  return resolve(vaultPath, EVAL_DIR, 'datasets', bookTitle);
}

/** 构建 responses/{runId}.json 的绝对路径 */
export function responsePath(vaultPath, bookTitle, runId) {
  return join(datasetDir(vaultPath, bookTitle), 'responses', `${runId}.json`);
}

/** 构建 golden.json 的绝对路径 */
export function goldenPath(vaultPath, bookTitle) {
  return join(datasetDir(vaultPath, bookTitle), 'golden.json');
}

/** 构建 reports/{date}_{bookTitle}.md 的绝对路径 */
export function reportPath(vaultPath, bookTitle) {
  const date = new Date().toISOString().split('T')[0];
  return join(evalDir(vaultPath), 'reports', `${date}_${bookTitle}.md`);
}

/** 构建 history/eval-log.jsonl 的绝对路径 */
export function historyPath(vaultPath) {
  return join(evalDir(vaultPath), 'history', 'eval-log.jsonl');
}

/** 构建 prompt 文件的绝对路径 */
export function promptPath(vaultPath, name) {
  return join(evalDir(vaultPath), name);
}

// ── 源码 prompt 路径 ──────────────────────────────────────────────────────

/** 源码中 eval-prompts/ 目录的路径（用于 rsync 同步） */
export function srcPromptDir() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, 'eval-prompts');
}

// ── 文件读写 ──────────────────────────────────────────────────────────────

export function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

export function writeJSON(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readFile(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function readFileOrDie(filePath, errorMessage) {
  if (!existsSync(filePath)) {
    throw new EvalError(errorMessage, 'ENOENT');
  }
  return readFileSync(filePath, 'utf-8');
}

export function readJSONOrDie(filePath, errorMessage) {
  const raw = readFileOrDie(filePath, errorMessage);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new EvalError(`文件格式错误 ${filePath}: ${e.message}`, 'EINVAL');
  }
}

// ── 目录操作 ──────────────────────────────────────────────────────────────

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listResponses(vaultPath, bookTitle) {
  const dir = join(datasetDir(vaultPath, bookTitle), 'responses');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse(); // 最新在前
}

// ── RunId ─────────────────────────────────────────────────────────────────

/** 生成新的 runId */
export function newRunId() {
  return `run-${Date.now()}`;
}

/** 找最新的 runId */
export function latestRunId(vaultPath, bookTitle) {
  const runs = listResponses(vaultPath, bookTitle);
  if (runs.length === 0) return null;
  return runs[0].replace('.json', '');
}

/** 找倒数第二个 runId（用于 diff） */
export function secondLatestRunId(vaultPath, bookTitle) {
  const runs = listResponses(vaultPath, bookTitle);
  if (runs.length < 2) return null;
  return runs[1].replace('.json', '');
}

// ── Catalog ───────────────────────────────────────────────────────────────

/**
 * 从 catalog.json 中查找书籍，返回 { bookId, title }
 * @param {string} vaultPath
 * @param {string} bookTitle 标题（模糊匹配）
 */
export function findBookInCatalog(vaultPath, bookTitle) {
  const catalogPath = join(vaultPath, '.obsidian', 'plugins', 'deepreader', 'pageindex', 'catalog.json');
  const catalog = readJSONOrDie(catalogPath, `catalog.json 不存在，请先索引书籍: ${catalogPath}`);

  const books = catalog.books || catalog;
  for (const [bookId, entry] of Object.entries(books)) {
    const title = typeof entry === 'string' ? entry : entry?.title || '';
    if (title === bookTitle || title.includes(bookTitle)) {
      return { bookId, title };
    }
  }

  const available = Object.values(books).map(v => typeof v === 'string' ? v : v?.title).join(', ');
  throw new EvalError(`未在 catalog.json 中找到"${bookTitle}"。可用: ${available}`, 'ENOENT');
}

// ── Git ───────────────────────────────────────────────────────────────────

/** 获取当前 git short commit hash */
export function getGitCommit(cwd) {
  try {
    const { execSync } = _require('child_process');
    return execSync('git rev-parse --short HEAD', { cwd }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// ── History ────────────────────────────────────────────────────────────────

/**
 * 读取历史记录（JSONL）
 * @returns {Array} 每行解析为一个对象
 */
export function readHistory(vaultPath) {
  const path = historyPath(vaultPath);
  if (!existsSync(path)) return [];
  const raw = readFile(path);
  if (!raw?.trim()) return [];
  return raw.trim().split('\n').map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * 追加历史记录到 eval-log.jsonl
 */
export function appendHistory(vaultPath, entry) {
  const path = historyPath(vaultPath);
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(entry) + '\n', { flag: 'a' });
}

// ── Validation ─────────────────────────────────────────────────────────────

/** 验证 vault 路径存在 */
export function validateVault(vaultPath) {
  if (!existsSync(vaultPath)) {
    throw new EvalError(`Vault 路径不存在: ${vaultPath}`, 'ENOENT');
  }
  if (!existsSync(join(vaultPath, '.obsidian'))) {
    throw new EvalError(`Vault 路径不是有效的 Obsidian vault: ${vaultPath}`, 'ENOENT');
  }
}

/** 验证 golden.json 存在 */
export function validateGolden(vaultPath, bookTitle) {
  const path = goldenPath(vaultPath, bookTitle);
  if (!existsSync(path)) {
    throw new EvalError(`golden.json 不存在: ${path}\n请先运行 eval generate`, 'ENOENT');
  }
  return path;
}

/** 验证 responses/{runId}.json 存在 */
export function validateResponse(vaultPath, bookTitle, runId) {
  const path = responsePath(vaultPath, bookTitle, runId);
  if (!existsSync(path)) {
    throw new EvalError(`响应文件不存在: ${path}`, 'ENOENT');
  }
  return path;
}

/** 验证 prompt 文件存在（vault 内） */
export function validatePrompt(vaultPath, promptName) {
  const path = promptPath(vaultPath, promptName);
  if (!existsSync(path)) {
    throw new EvalError(`Prompt 文件不存在: ${path}\n请运行 npm run eval:sync-prompts`, 'ENOENT');
  }
  return path;
}

/** 验证 prompt 文件存在（源码内） */
export function validateSrcPrompt(promptName) {
  const path = join(srcPromptDir(), promptName);
  if (!existsSync(path)) {
    throw new EvalError(`源码 prompt 文件不存在: ${path}`, 'ENOENT');
  }
  return path;
}

// ── 错误类型 ──────────────────────────────────────────────────────────────

export class EvalError extends Error {
  constructor(message, code = 'EVAL_ERROR') {
    super(message);
    this.name = 'EvalError';
    this.code = code;
  }
}

// ── 格式化输出 ────────────────────────────────────────────────────────────

/** 打印分界线 */
export function printDivider(char = '─', width = 70) {
  console.log(char.repeat(width));
}

/** 打印标题 */
export function printTitle(text) {
  console.log('');
  console.log(`  ${text}`);
  console.log('');
}

/** 打印错误（到 stderr） */
export function printError(msg) {
  console.error(`[EVAL ERROR] ${msg}`);
}

/** 打印成功 */
export function printOK(msg) {
  console.log(`✅ ${msg}`);
}

/** 打印失败 */
export function printFAIL(msg) {
  console.log(`❌ ${msg}`);
}

/** 打印警告 */
export function printWARN(msg) {
  console.log(`⚠️  ${msg}`);
}

/** 打印进度 */
export function printStep(step, msg) {
  console.log(`\n━━━ ${step}: ${msg} ━━━`);
}

/** 表格打印历史记录 */
export function printHistoryTable(entries) {
  if (entries.length === 0) {
    console.log('暂无评估历史。');
    return;
  }
  const col = (s, w) => String(s).substring(0, w).padEnd(w);
  printDivider();
  console.log(`${col('时间', 19)} | ${col('书籍', 12)} | ${col('运行ID', 20)} | ${col('总分', 5)} | ${col('判定', 4)} | commit`);
  printDivider();
  for (const e of entries) {
    const ts = (e.timestamp || '').substring(0, 19).replace('T', ' ');
    console.log(
      `${col(ts, 19)} | ${col(e.bookTitle || '', 12)} | ${col(e.runId || '', 20)} | ` +
      `${col(String(e.summary?.weightedScore ?? 'N/A'), 5)} | ${col(e.verdict || 'N/A', 4)} | ${e.gitCommit || 'unknown'}`
    );
  }
  printDivider();
  console.log(`共 ${entries.length} 条记录`);
}


