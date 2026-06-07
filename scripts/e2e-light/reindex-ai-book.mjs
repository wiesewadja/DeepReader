#!/usr/bin/env node
/**
 * 通过 CDP 直接调用 indexBook API 重新索引 AI极简经济学
 *
 * 用途：验证 EPUB→Markdown 修复后效果
 * 流程：
 * 1. 通过 CDP 读取 plugin settings 拿到 LLM/embedding 配置
 * 2. 直接调用 plugin.api.indexBook(options)
 * 3. 等待 .indexing.json 状态文件出现 done 状态
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const execAsync = promisify(exec);
const VAULT = '/Users/lizhao/workspace/DeepReader/test-vault';
const PLUGIN_ID = 'deepreader-dev';
const BOOK_FILE = `${VAULT}/AI极简经济学 (阿杰伊·阿格拉沃尔, 乔舒亚·甘斯, 阿维·戈德法布) (z-library.sk, 1lib.sk, z-lib.sk).epub`;
const BOOK_ID = 'ee090e29';
const INDEX_DIR = `${VAULT}/.obsidian/plugins/${PLUGIN_ID}/pageindex/${BOOK_ID}`;
const NOTES_DIR = `${VAULT}/DeepReader/AI极简经济学`;

async function cdpEval(expression, awaitPromise = true, timeout = 60_000) {
  const params = JSON.stringify({
    expression,
    returnByValue: true,
    awaitPromise,
  });
  const cmd = `obsidian dev:cdp method=Runtime.evaluate params='${params.replace(/'/g, "'\\''")}' vault=test-vault`;
  const { stdout } = await execAsync(cmd, { timeout, maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function getSettings() {
  const expr = `(function(){
    const v = app.plugins.plugins["${PLUGIN_ID}"];
    if (!v) return JSON.stringify({error: "plugin not found"});
    const s = v.settings;
    return JSON.stringify({
      pageindexProvider: s.roles?.pageindex,
      pageindexModel: s.roles?.pageindex,
      embeddingProvider: s.roles?.embedding?.provider,
      embeddingModel: s.roles?.embedding?.model,
      rerankerProvider: s.roles?.reranker?.provider,
      rerankerModel: s.roles?.reranker?.model,
    });
  })()`;
  const r = await cdpEval(expr);
  return JSON.parse(r.result.value);
}

// 已知 provider baseUrl 默认值（与 src/config/providers.ts PROVIDER_CONFIGS 保持一致）
const DEFAULT_BASE_URLS = {
  xiaomi: "https://token-plan-cn.xiaomimimo.com/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  sensenova: "https://token.sensenova.cn/v1",
  deepseek: "https://api.deepseek.com",
  kimi: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  openai: "https://api.openai.com/v1",
};

async function callIndexBook() {
  // 直接在 Obsidian 内部构造 indexBook options 并调用
  const expr = `(async function(){
    const v = app.plugins.plugins["${PLUGIN_ID}"];
    if (!v || !v.api || !v.api.indexBook) return JSON.stringify({error: "indexBook API not found"});

    const s = v.settings;
    const piProvider = s.roles.pageindex.provider;
    const piAccount = s.providers[piProvider];
    const piRole = s.roles.pageindex;
    const emProvider = s.roles.embedding.provider;
    const emAccount = s.providers[emProvider];
    const emRole = s.roles.embedding;

    const DEFAULT_BASE_URLS = ${JSON.stringify(DEFAULT_BASE_URLS)};

    const opts = {
      filePath: ${JSON.stringify(BOOK_FILE)},
      fileType: "epub",
      outputDir: ${JSON.stringify(VAULT)},
      model: piRole.model,
      apiKey: piAccount.apiKey,
      baseUrl: piAccount.baseUrl || DEFAULT_BASE_URLS[piProvider] || "",
      embedding: {
        provider: emProvider,
        model: emRole.model,
        apiKey: emAccount.apiKey,
        baseUrl: emAccount.baseUrl || DEFAULT_BASE_URLS[emProvider] || "",
      },
      addNodeSummary: true,
      addDocDescription: true,
    };

    try {
      const result = await v.api.indexBook(opts);
      return JSON.stringify({ok: true, bookId: result?.bookId, numNodes: result?.tree?.structure?.length, sentOpts: {model: opts.model, baseUrl: opts.baseUrl, hasApiKey: !!opts.apiKey}});
    } catch (e) {
      return JSON.stringify({ok: false, error: e.message, stack: e.stack?.slice(0, 500), sentOpts: {model: opts.model, baseUrl: opts.baseUrl, hasApiKey: !!opts.apiKey, emBase: opts.embedding?.baseUrl, emModel: opts.embedding?.model}});
    }
  })()`;

  const r = await cdpEval(expr, true, 900_000); // 15 分钟超时（索引 + LLM 生成摘要）
  if (r.exceptionDetails) {
    return { ok: false, error: r.exceptionDetails.exception?.description };
  }
  if (!r.result?.value) return { ok: false, error: "no result value" };
  return JSON.parse(r.result.value);
}

async function waitForIndexingDone(maxMs = 600_000) {
  const start = Date.now();
  const statusFile = `${INDEX_DIR}/.indexing.json`;
  let lastStatus = null;
  while (Date.now() - start < maxMs) {
    if (existsSync(statusFile)) {
      try {
        const status = JSON.parse(readFileSync(statusFile, 'utf8'));
        if (status.percent !== lastStatus?.percent || status.step !== lastStatus?.step) {
          console.log(`[reindex] ${status.percent}% (${status.step}): ${status.message || ''}`);
          lastStatus = status;
        }
        if (status.percent >= 100 || status.step === 'done' || status.step === 'error') {
          return status;
        }
      } catch {}
    } else {
      // 文件不存在则说明 .indexing.json 已被清理（成功结束）
      const treeFile = `${INDEX_DIR}/tree.json`;
      if (existsSync(treeFile)) {
        const stat = require('node:fs').statSync(treeFile);
        return { step: 'tree_exists', percent: 100, mtime: stat.mtimeMs };
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return { step: 'timeout', percent: -1 };
}

async function main() {
  console.log(`[reindex] start at ${new Date().toISOString()}`);
  console.log(`[reindex] book: ${BOOK_FILE}`);

  // 1. 确认书存在
  if (!existsSync(BOOK_FILE)) {
    console.error(`[reindex] FAIL: book not found: ${BOOK_FILE}`);
    process.exit(1);
  }

  // 2. 读取 settings 确认配置
  const settings = await getSettings();
  console.log(`[reindex] settings:`, settings);

  // 3. 触发 indexBook
  console.log(`[reindex] calling indexBook...`);
  const result = await callIndexBook();
  console.log(`[reindex] indexBook returned:`, result);

  if (!result.ok) {
    console.error(`[reindex] FAIL: indexBook 失败: ${result.error}`);
    process.exit(1);
  }

  // 4. 等待索引完成
  console.log(`[reindex] waiting for indexing to complete...`);
  const finalStatus = await waitForIndexingDone();
  console.log(`[reindex] final status:`, finalStatus);

  if (finalStatus.step === 'timeout') {
    console.error(`[reindex] FAIL: 索引超时`);
    process.exit(1);
  }
  if (finalStatus.step === 'error') {
    console.error(`[reindex] FAIL: 索引报错: ${finalStatus.error}`);
    process.exit(1);
  }

  console.log(`[reindex] SUCCESS at ${new Date().toISOString()}`);
}

main().catch(e => {
  console.error(`[reindex] FATAL:`, e);
  process.exit(1);
});
