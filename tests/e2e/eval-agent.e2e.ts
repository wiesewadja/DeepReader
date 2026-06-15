/**
 * Agent Q&A 评估 E2E 脚本
 *
 * 通过 evalBackdoor API 逐题执行 Agent，收集结构化响应到 JSON 文件。
 * 使用"启动+轮询"模式绕过 executeObsidian 30s 同步超时限制。
 *
 * 用法: EVAL_BOOK=反脆弱 npx wdio run tests/wdio.conf.ts --spec tests/e2e/eval-agent.e2e.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const VAULT_PATH = path.resolve(__dirname, '../../test-vault');
const EVAL_DIR = path.join(VAULT_PATH, '.eval');

const EVAL_BOOK = process.env.EVAL_BOOK || '反脆弱';
const RUN_ID = process.env.EVAL_RUN_ID || `run-${Date.now()}`;

interface GoldenQuestion {
  id: string;
  type: string;
  question: string;
  ground_truth: string;
  difficulty: string;
  expected_depth: number;
}

interface GoldenDataset {
  version: number;
  bookId: string;
  bookTitle: string;
  questions: GoldenQuestion[];
}

interface EvalResponse {
  questionId: string;
  question: string;
  type: string;
  response: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; resultLength: number }>;
  nodesVisited: string[];
  durationMs: number;
  depth?: number;
  error?: string;
  timestamp: string;
}

const goldenPath = path.join(EVAL_DIR, 'datasets', EVAL_BOOK, 'golden.json');
if (!fs.existsSync(goldenPath)) {
  console.error(`[Eval] golden.json not found: ${goldenPath}`);
  process.exit(1);
}

const golden: GoldenDataset = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
console.log(`[Eval] Loaded ${golden.questions.length} questions for "${golden.bookTitle}" (bookId: ${golden.bookId})`);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Agent Q&A Evaluation', function () {
  this.timeout(600_000);

  const responses: EvalResponse[] = [];

  before(async function () {
    // 注册 evalBackdoor + 轮询辅助
    // 注意：本文件用 browser.executeObsidian（函数序列化），无法直接复用
    // scripts/smoke/lib/eval-backdoor.mjs 的字符串注入版本。
    // 接口契约（startQnA/pollResult 签名 + 返回结构）见该模块顶部文档。
    const registered = await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
      if (!plugin || !plugin.getFrontendAgent) return false;
      if (plugin.evalBackdoor?.startQnA) return true;

      // 存储区：每个 questionId 对应一个 Promise resolve
      const pendingResults: Record<string, any> = {};

      plugin.evalBackdoor = {
        // 启动 Agent（fire-and-forget，立即返回）
        async startQnA(questionId: string, question: string, bookId: string): Promise<string> {
          try {
            const agent = await plugin.getFrontendAgent();
            // 修复：dev 部署的插件 id 是 deepreader-dev，不是 deepreader
            const metaPath = `.obsidian/plugins/deepreader-dev/pageindex/${bookId}/book-meta.json`;
            const metaRaw = await plugin.app.vault.adapter.read(metaPath);
            const meta = JSON.parse(metaRaw);

            const context = {
              vault: { app: plugin.app, plugin: plugin },
              book: {
                indexId: bookId,
                pdfName: meta.title || bookId,
                documentMetadata: { title: meta.title, author: meta.author, page_count: meta.totalPages },
                docDescription: meta.description,
              },
              mode: 'normal',
            };

            // 异步执行，不 await 让它后台跑
            agent.runGraphEngine(question, context, {
              onProgress: () => {},
              onContent: () => {},
              onComplete: () => {},
              onError: () => {},
            }).then(result => {
              const lastMsg = result.messages[result.messages.length - 1];
              pendingResults[questionId] = {
                done: true,
                response: lastMsg?.content || '',
                toolCalls: result.traceData?.toolCalls || [],
                nodesVisited: result.traceData?.nodesVisited || [],
                durationMs: result.traceData?.durationMs || 0,
                depth: result.traceData?.depth,
              };
            }).catch(e => {
              pendingResults[questionId] = { done: true, error: e.message };
            });

            return 'started';
          } catch (e: any) {
            pendingResults[questionId] = { done: true, error: e.message };
            return 'error';
          }
        },

        // 轮询结果（同步，快速返回）
        pollResult(questionId: string): any {
          const r = pendingResults[questionId];
          if (r) {
            delete pendingResults[questionId];
            return r;
          }
          return null;
        },
      };
      return true;
    });
    expect(registered).toBe(true);
    console.log('[Eval] evalBackdoor registered');
  });

  for (const q of golden.questions) {
    it(`[${q.type}] ${q.id}: ${q.question.substring(0, 40)}...`, async function () {
      console.log(`\n[Eval] Q${q.id}: ${q.question}`);
      const startTime = Date.now();

      // Step 1: 启动 Agent（快速返回）
      await browser.executeObsidian(
        ({ app }, args: { qid: string; question: string; bookId: string }) => {
          const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
          return plugin?.evalBackdoor?.startQnA(args.qid, args.question, args.bookId);
        },
        { qid: q.id, question: q.question, bookId: golden.bookId },
      );
      console.log(`[Eval] Q${q.id} started, polling...`);

      // Step 2: 轮询结果（每 5 秒一次，最多 3 分钟）
      let result: any = null;
      const pollTimeout = 180_000;
      while (Date.now() - startTime < pollTimeout) {
        await sleep(5000);
        result = await browser.executeObsidian(
          ({ app }, args: { qid: string }) => {
            const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
            return plugin?.evalBackdoor?.pollResult(args.qid);
          },
          { qid: q.id },
        );
        if (result) break;
      }

      const elapsed = Date.now() - startTime;

      if (!result) {
        console.log(`[Eval] Q${q.id} TIMEOUT after ${elapsed}ms`);
        responses.push({
          questionId: q.id, question: q.question, type: q.type,
          response: '', toolCalls: [], nodesVisited: [], durationMs: elapsed,
          error: 'TIMEOUT', timestamp: new Date().toISOString(),
        });
        return; // 不 fail，记录超时继续
      }

      const response: EvalResponse = {
        questionId: q.id,
        question: q.question,
        type: q.type,
        response: result.response || '',
        toolCalls: result.toolCalls || [],
        nodesVisited: result.nodesVisited || [],
        durationMs: result.durationMs || elapsed,
        depth: result.depth,
        error: result.error,
        timestamp: new Date().toISOString(),
      };

      if (response.error) {
        console.log(`[Eval] Q${q.id} ERROR: ${response.error}`);
      } else {
        console.log(`[Eval] Q${q.id} done in ${elapsed}ms`);
        console.log(`[Eval] Q${q.id} response: ${response.response.substring(0, 100)}...`);
        console.log(`[Eval] Q${q.id} nodes: ${response.nodesVisited.join(' → ')}`);
        console.log(`[Eval] Q${q.id} tools: ${response.toolCalls.map(t => t.tool).join(', ') || 'none'}`);
      }

      responses.push(response);

      if (!response.error) {
        expect(response.response).toBeTruthy();
        expect(response.response.length).toBeGreaterThan(10);
      }
    });
  }

  after(function () {
    const responseDir = path.join(EVAL_DIR, 'datasets', EVAL_BOOK, 'responses');
    fs.mkdirSync(responseDir, { recursive: true });

    const outputPath = path.join(responseDir, `${RUN_ID}.json`);
    const output = {
      runId: RUN_ID,
      bookId: golden.bookId,
      bookTitle: golden.bookTitle,
      timestamp: new Date().toISOString(),
      questionCount: golden.questions.length,
      responses,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\n[Eval] Responses saved to: ${outputPath}`);
    console.log(`[Eval] Total: ${responses.length} responses`);
  });
});
