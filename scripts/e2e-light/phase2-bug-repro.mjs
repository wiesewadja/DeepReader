#!/usr/bin/env node
/**
 * Phase 2: 4 轮 bug 复现
 *
 * 模拟用户连续 4 轮询问"回报函数工程"概念，
 * 验证 LLM 反复声称"未出现"。
 *
 * 每轮：
 * 1. 写入 step 标记到 Obsidian
 * 2. 截图
 * 3. 通过 dev:cdp 调 sendMessageWithInput
 * 4. 等待响应（轮询 isAiStreaming）
 * 5. 捕获最终响应
 * 6. 写入结果
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const VAULT = '/Users/lizhao/workspace/DeepReader/test-vault';
const LOG_DIR = `${VAULT}/9-Logs/5layer-defense-E2E`;
const SCREENSHOT_DIR = `${REPO_ROOT}/docs/test-strategies/screenshots`;

const QUESTIONS = [
  "《AI极简经济学》中有没有提到'回报函数工程'这个概念？",
  "这本书里关于'回报函数工程'的内容在哪里？",
  "我好像在第8章看到过'回报函数工程'，你再确认一下有没有？",
  "你再搜索一下，'回报函数工程'应该是在判断的价值那一章。",
];

function nowIso() {
  return new Date().toISOString();
}

async function cdpEval(expression) {
  // Use proper escaping via JSON.stringify
  const params = JSON.stringify({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const cmd = `obsidian dev:cdp method=Runtime.evaluate params='${params.replace(/'/g, "'\\''")}'`;
  const { stdout } = await execAsync(cmd, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function takeScreenshot(label) {
  const ts = Date.now();
  const file = `${SCREENSHOT_DIR}/5layer-defense-p2-${ts}-${label}.png`;
  try {
    await execAsync(`obsidian dev:screenshot path="${file}" vault=test-vault`, { timeout: 20_000 });
    return file;
  } catch (e) {
    return null;
  }
}

async function waitForResponse(maxMs = 60_000) {
  const start = Date.now();
  let lastState = null;
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 2_000));
    const r = await cdpEval(`(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;return JSON.stringify({streaming:!!v.agentChatCtrl.aiStreaming,processing:!!v.agentChatCtrl.processing,historyLen:v.agentChatCtrl.agentChatHistory?v.agentChatCtrl.agentChatHistory.length:0});})()`);
    if (r.exceptionDetails) {
      console.log(`[wait] error: ${r.exceptionDetails.exception?.description}`);
      continue;
    }
    const state = JSON.parse(r.result.value);
    if (lastState && state.streaming === false && state.processing === false && state.historyLen > 0) {
      // Make sure state has been stable for at least 1 cycle
      await new Promise(r => setTimeout(r, 2_000));
      const r2 = await cdpEval(`(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;return JSON.stringify({streaming:!!v.agentChatCtrl.aiStreaming,processing:!!v.agentChatCtrl.processing});})()`);
      const state2 = JSON.parse(r2.result.value);
      if (state2.streaming === false && state2.processing === false) {
        return state.historyLen;
      }
    }
    lastState = state;
    process.stdout.write(`[wait] ${state.streaming ? 'streaming' : 'idle'} h=${state.historyLen} t=${Math.floor((Date.now()-start)/1000)}s\r`);
  }
  return null;
}

async function getLastAssistantMessage() {
  const r = await cdpEval(`(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;const h=v.agentChatCtrl.agentChatHistory;if(!h)return null;for(let i=h.length-1;i>=0;i--){if(h[i].role==="assistant")return JSON.stringify({idx:i,content:h[i].content,id:h[i].id});}return null;})()`);
  if (r.exceptionDetails) {
    return { error: r.exceptionDetails.exception?.description };
  }
  if (!r.result?.value) return null;
  return JSON.parse(r.result.value);
}

async function sendMessage(message) {
  const expr = `(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;v.sendMessageWithInput(${JSON.stringify(message)});return "sent";})()`;
  const r = await cdpEval(expr);
  return r.result?.value;
}

async function writeStepMarker(turnNum, question, response) {
  const file = `${LOG_DIR}/02-bug-repro-turn-${turnNum}.md`;
  const content = `# Phase 2 - Turn ${turnNum}\n\n` +
    `**时间**: ${nowIso()}\n\n` +
    `**用户提问**: ${question}\n\n` +
    `**LLM 响应**:\n\n` +
    (response ? `\`\`\`\n${response.content}\n\`\`\`\n\n` +
    `**响应 ID**: ${response.id}\n\n` +
    `**响应长度**: ${response.content?.length || 0} chars\n\n` +
    `**是否提到"回报函数工程"**: ${response.content?.includes('回报函数工程') ? '✅ 是' : '❌ 否'}\n` +
    `**是否说"未出现"**: ${/未出现|未提及|未涉及|未找到|没找到|没有|未存在|没有出现|未提到|没有提及|不包含|没有涉及/i.test(response.content || '') ? '⚠️ 是' : '✅ 否'}\n` +
    `**是否承认存在但没找到**: ${/(没有找到|未找到|没找到|找不到).{0,30}(回报函数|这一章|那一章|这本书)/.test(response.content || '') ? '⚠️ 是' : '✅ 否'}\n` :
    `**响应**: 未捕获到\n`);
  writeFileSync(file, content);
  return file;
}

async function main() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  console.log(`[phase2] start at ${nowIso()}`);
  console.log(`[phase2] log dir: ${LOG_DIR}`);

  // Verify state
  const stateCheck = await cdpEval(`(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;return JSON.stringify({bookMgrPdf:v.bookMgr.currentPdfName,bookMgrIdx:v.bookMgr.currentIndexId,historyLen:v.agentChatCtrl.agentChatHistory?v.agentChatCtrl.agentChatHistory.length:0,isProcessing:v.agentChatCtrl.processing});})()`);
  console.log(`[phase2] initial state: ${stateCheck.result.value}`);

  // Pre-screenshot
  await takeScreenshot('pre');

  const results = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const turnNum = i + 1;
    const question = QUESTIONS[i];
    console.log(`\n[phase2] === TURN ${turnNum}/4 ===`);
    console.log(`[phase2] Q: ${question}`);

    await takeScreenshot(`turn${turnNum}-pre`);
    await sendMessage(question);
    console.log(`[phase2] message sent, waiting for response...`);

    const histLen = await waitForResponse(90_000);
    console.log(`\n[phase2] response ready (history len=${histLen})`);

    const response = await getLastAssistantMessage();
    if (response) {
      console.log(`[phase2] response (${response.content?.length || 0} chars): ${response.content?.slice(0, 200)}...`);
    } else {
      console.log(`[phase2] NO RESPONSE CAPTURED`);
    }

    await takeScreenshot(`turn${turnNum}-post`);
    const markerFile = await writeStepMarker(turnNum, question, response);
    console.log(`[phase2] marker: ${markerFile}`);

    results.push({ turn: turnNum, question, response });
  }

  // Final summary
  const summaryFile = `${LOG_DIR}/02-bug-repro-summary.md`;
  let summary = `# Phase 2 - 4 轮 bug 复现汇总\n\n` +
    `**完成时间**: ${nowIso()}\n\n` +
    `**目标**: 验证 LLM 在 4 轮中是否始终未找到"回报函数工程"概念\n\n` +
    `## 4 轮结果\n\n` +
    `| 轮次 | 用户问题 | 响应长度 | 提到"回报函数工程" | 说"未出现" | 承认没找到 |\n` +
    `|------|----------|----------|--------------------|------------|------------|\n`;
  for (const r of results) {
    const c = r.response?.content || '';
    summary += `| ${r.turn} | ${r.question.slice(0, 30)}... | ${c.length} | ` +
      `${c.includes('回报函数工程') ? '✅' : '❌'} | ` +
      `${/未出现|未提及|未涉及|没找到|没有|未存在|没有出现|未提到/i.test(c) ? '⚠️' : '✅'} | ` +
      `${/(没有找到|未找到|没找到|找不到).{0,30}/.test(c) ? '⚠️' : '✅'} |\n`;
  }
  summary += `\n## Phase 2 结论\n\n`;
  const allMissed = results.every(r => !(r.response?.content || '').includes('回报函数工程'));
  summary += allMissed
    ? `❌ **BUG 复现成功**: 4 轮响应均未提到"回报函数工程"概念，但概念实际存在于第 8 章 (H2: 判断的价值) 10 处\n`
    : `✅ 至少 1 轮提到了概念，未完全复现 bug\n`;

  writeFileSync(summaryFile, summary);
  console.log(`\n[phase2] summary: ${summaryFile}`);
  console.log(`[phase2] done at ${nowIso()}`);
}

main().catch(e => {
  console.error(`[phase2] FATAL:`, e);
  process.exit(1);
});
