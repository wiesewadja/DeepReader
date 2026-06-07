#!/usr/bin/env node
/**
 * 监控 AI极简经济学 索引进度
 * - 每 5s 轮询 .indexing.json
 * - 每 30s 截图（obsidian dev:screenshot）
 * - 每 60s 抓 console 日志（obsidian dev:console）
 * - 写进度到 test-vault/9-Logs/5layer-defense-E2E/01-idx-progress.md
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const VAULT = '/Users/lizhao/workspace/DeepReader/test-vault';
const BOOK_ID = 'ee090e29';
const STATUS_FILE = `${VAULT}/.obsidian/plugins/deepreader-dev/pageindex/${BOOK_ID}/.indexing.json`;
const PROGRESS_MD = `${VAULT}/9-Logs/5layer-defense-E2E/01-idx-progress.md`;
const SCREENSHOT_DIR = `${REPO_ROOT}/docs/test-strategies/screenshots`;
const POLL_INTERVAL_MS = 5_000;
const SCREENSHOT_INTERVAL_MS = 30_000;
const CONSOLE_INTERVAL_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function readStatus() {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

let lastStatus = null;
let lastScreenshotTime = 0;
let lastConsoleTime = 0;
let progressEntries = [];

async function takeScreenshot(label) {
  const ts = Date.now();
  const file = `${SCREENSHOT_DIR}/5layer-defense-idx-${ts}-${label}.png`;
  try {
    const { stdout } = await execAsync(
      `obsidian dev:screenshot path="${file}" vault=test-vault`,
      { timeout: 20_000 }
    );
    return { ok: true, file, size: stdout.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getConsole() {
  try {
    const { stdout } = await execAsync(
      `obsidian dev:console vault=test-vault`,
      { timeout: 10_000 }
    );
    return stdout;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

function writeProgressFile() {
  const status = lastStatus;
  const lines = [
    `# 索引进度监控 - ${nowIso()}`,
    ``,
    `**书目**: AI极简经济学 (阿杰伊·阿格拉沃尔, 乔舒亚·甘斯, 阿维·戈德法布)`,
    `**bookId**: ${BOOK_ID}`,
    `**状态**: ${status ? `${status.percent}% (${status.step})` : '已结束 / .indexing.json 已清理'}`,
    `**最后进度**: ${status ? status.stepLabel : 'N/A'}`,
    ``,
    `## 采样日志 (${progressEntries.length} 条)`,
    ``,
    `| 时间 | 百分比 | 步骤 | 标签 |`,
    `|------|--------|------|------|`,
  ];
  for (const e of progressEntries) {
    lines.push(`| ${e.ts} | ${e.percent}% | ${e.step} | ${e.stepLabel || ''} |`);
  }
  if (!status) {
    lines.push(``, `## 索引完成！`, ``, `.indexing.json 已删除（仅在成功完成后清理，失败时保留以便显示失败状态）`);
  }
  writeFileSync(PROGRESS_MD, lines.join('\n') + '\n');
}

async function main() {
  console.log(`[monitor] start at ${nowIso()}`);
  const startedAt = Date.now();
  let idxStatus = readStatus();
  if (!idxStatus) {
    console.log(`[monitor] status file not found at ${STATUS_FILE}`);
    process.exit(1);
  }
  lastStatus = idxStatus;
  progressEntries.push({ ts: nowIso(), percent: idxStatus.percent, step: idxStatus.step, stepLabel: idxStatus.stepLabel });
  writeProgressFile();

  let done = false;
  while (!done) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const now = Date.now();
    idxStatus = readStatus();
    if (!idxStatus) {
      console.log(`[monitor] status file removed → indexing done at ${nowIso()}`);
      lastStatus = null;
      done = true;
    } else {
      const changed = !lastStatus || idxStatus.percent !== lastStatus.percent || idxStatus.step !== lastStatus.step;
      if (changed) {
        lastStatus = idxStatus;
        progressEntries.push({ ts: nowIso(), percent: idxStatus.percent, step: idxStatus.step, stepLabel: idxStatus.stepLabel });
        console.log(`[monitor] ${idxStatus.percent}% ${idxStatus.step} - ${idxStatus.stepLabel}`);
        writeProgressFile();
      }
    }
    if (now - lastScreenshotTime > SCREENSHOT_INTERVAL_MS) {
      lastScreenshotTime = now;
      const ss = await takeScreenshot(idxStatus ? `p${idxStatus.percent}` : 'done');
      console.log(`[monitor] screenshot: ${ss.ok ? ss.file : ss.error}`);
    }
    if (now - lastConsoleTime > CONSOLE_INTERVAL_MS) {
      lastConsoleTime = now;
      const cl = await getConsole();
      const tail = cl.split('\n').slice(-15).join('\n');
      console.log(`[monitor] console tail:\n${tail}`);
    }
  }

  // Final screenshot
  const ss = await takeScreenshot('done');
  console.log(`[monitor] final screenshot: ${ss.ok ? ss.file : ss.error}`);
  writeProgressFile();
  console.log(`[monitor] done at ${nowIso()}, total ${(Date.now() - startedAt) / 1000}s`);
}

main().catch(e => {
  console.error(`[monitor] FATAL:`, e);
  process.exit(1);
});
