#!/usr/bin/env node
/**
 * Phase 3a: L1+L4 前向场景验证
 *
 * 测试用户对 LLM 的"未出现"答案 pushback 后，
 * L1 (Router correction) + L4 (S2-Pre hard-guard) 是否触发并找到正确章节。
 *
 * 流程：
 * 1. 第 1 轮：直接问"回报函数工程" (触发 bug)
 * 2. 第 2 轮：用户 pushback (应该触发 L1 + L4)
 * 3. 验证 LLM 最终能找到第 8 章 + 文件 23
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const VAULT = '/Users/lizhao/workspace/DeepReader/test-vault';
const LOG_DIR = `${VAULT}/9-Logs/5layer-defense-E2E`;

function nowIso() {
  return new Date().toISOString();
}

async function cdpEval(expression) {
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
  const file = `/Users/lizhao/workspace/DeepReader/docs/test-strategies/screenshots/5layer-defense-p3a-${Date.now()}-${label}.png`;
  try {
    await execAsync(`obsidian dev:screenshot path="${file}" vault=test-vault`, { timeout: 20_000 });
    return file;
  } catch {
    return null;
  }
}

async function sendMessage(message) {
  const expr = `(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;v.sendMessageWithInput(${JSON.stringify(message)});return "sent";})()`;
  const r = await cdpEval(expr);
  return r.result?.value;
}

async function waitForResponse(maxMs = 120_000) {
  const start = Date.now();
  let stableCycles = 0;
  let lastState = null;
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 2_000));
    const r = await cdpEval(`(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;return JSON.stringify({streaming:!!v.agentChatCtrl.aiStreaming,processing:!!v.agentChatCtrl.processing,histLen:v.agentChatCtrl.agentChatHistory?v.agentChatCtrl.agentChatHistory.length:0});})()`);
    if (r.exceptionDetails) continue;
    const state = JSON.parse(r.result.value);
    if (state.streaming === false && state.processing === false && state.histLen > 0) {
      stableCycles++;
      if (stableCycles >= 2) return state.histLen;
    } else {
      stableCycles = 0;
    }
    lastState = state;
    process.stdout.write(`[wait] ${state.streaming ? 'streaming' : 'idle'} h=${state.histLen} t=${Math.floor((Date.now()-start)/1000)}s\r`);
  }
  return null;
}

async function getLastAssistant() {
  const r = await cdpEval(`(function(){const v=app.workspace.getLeavesOfType("deeppdf-sidebar-view")[0].view;const h=v.agentChatCtrl.agentChatHistory;if(!h)return null;for(let i=h.length-1;i>=0;i--){if(h[i].role==="assistant")return JSON.stringify({idx:i,content:h[i].content,id:h[i].id});}return null;})()`);
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description };
  if (!r.result?.value) return null;
  return JSON.parse(r.result.value);
}

async function main() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  console.log(`[phase3a] start at ${nowIso()}`);

  await takeScreenshot('pre');

  // Turn 1: Direct question (replicate bug)
  console.log(`\n[phase3a] === TURN 1/3 (initial question - should reproduce) ===`);
  await sendMessage("《AI极简经济学》中有没有提到'回报函数工程'这个概念？");
  console.log(`[phase3a] message sent, waiting...`);
  const h1 = await waitForResponse();
  const r1 = await getLastAssistant();
  console.log(`\n[phase3a] Turn 1 response (${r1?.content?.length || 0} chars): ${(r1?.content || '').slice(0, 150)}...`);

  await takeScreenshot('t1-post');
  writeFileSync(`${LOG_DIR}/03a-turn-1.md`, `# Phase 3a - Turn 1 (initial question)\n\n**时间**: ${nowIso()}\n\n**用户**: 《AI极简经济学》中有没有提到'回报函数工程'这个概念？\n\n**LLM 响应** (${r1?.content?.length || 0} chars):\n\n\`\`\`\n${r1?.content || '(empty)'}\n\`\`\`\n\n**是否提到"回报函数工程"**: ${r1?.content?.includes('回报函数工程') ? '✅' : '❌'}\n**是否提到"第 8 章"**: ${r1?.content?.includes('第 8 章') || r1?.content?.includes('第8章') ? '✅' : '❌'}\n`);

  // Turn 2: User pushback (L1 trigger)
  console.log(`\n[phase3a] === TURN 2/3 (user pushback - should trigger L1+L4) ===`);
  await sendMessage("不，我确定这本书里就有这个概念，就在第 8 章'判断的价值'那一章。你再认真搜索一下。");
  console.log(`[phase3a] message sent, waiting...`);
  const h2 = await waitForResponse();
  const r2 = await getLastAssistant();
  console.log(`\n[phase3a] Turn 2 response (${r2?.content?.length || 0} chars): ${(r2?.content || '').slice(0, 200)}...`);

  await takeScreenshot('t2-post');
  writeFileSync(`${LOG_DIR}/03a-turn-2.md`, `# Phase 3a - Turn 2 (L1+L4 trigger via user pushback)\n\n**时间**: ${nowIso()}\n\n**用户**: 不，我确定这本书里就有这个概念，就在第 8 章'判断的价值'那一章。你再认真搜索一下。\n\n**LLM 响应** (${r2?.content?.length || 0} chars):\n\n\`\`\`\n${r2?.content || '(empty)'}\n\`\`\`\n\n**是否提到"回报函数工程"**: ${r2?.content?.includes('回报函数工程') ? '✅' : '❌'}\n**是否提到"第 8 章"**: ${r2?.content?.includes('第 8 章') || r2?.content?.includes('第8章') ? '✅' : '❌'}\n**是否承认之前错了**: ${/(确实|抱歉|不好意思|我之前|先前|刚才|我搞错了|我记混了|我搜的)/.test(r2?.content || '') ? '✅' : '⚠️'}\n**是否找到正确的章节**: ${(r2?.content?.includes('第 8 章') || r2?.content?.includes('第8章')) && r2?.content?.includes('回报函数工程') ? '✅ 是' : '❌ 否'}\n`);

  // Turn 3: Direct ask for chapter location
  console.log(`\n[phase3a] === TURN 3/3 (follow-up) ===`);
  await sendMessage("具体讲讲'回报函数工程'这个概念在第 8 章的哪一节？");
  console.log(`[phase3a] message sent, waiting...`);
  const h3 = await waitForResponse();
  const r3 = await getLastAssistant();
  console.log(`\n[phase3a] Turn 3 response (${r3?.content?.length || 0} chars): ${(r3?.content || '').slice(0, 200)}...`);

  await takeScreenshot('t3-post');
  writeFileSync(`${LOG_DIR}/03a-turn-3.md`, `# Phase 3a - Turn 3 (follow-up: specify section)\n\n**时间**: ${nowIso()}\n\n**用户**: 具体讲讲'回报函数工程'这个概念在第 8 章的哪一节？\n\n**LLM 响应** (${r3?.content?.length || 0} chars):\n\n\`\`\`\n${r3?.content || '(empty)'}\n\`\`\`\n\n**是否提到"回报函数工程"**: ${r3?.content?.includes('回报函数工程') ? '✅' : '❌'}\n**是否说在第 8 章**: ${r3?.content?.includes('第 8 章') || r3?.content?.includes('第8章') ? '✅' : '❌'}\n`);

  // Final summary
  const summaryFile = `${LOG_DIR}/03a-summary.md`;
  const success = (r2?.content || '').includes('回报函数工程') &&
                  ((r2?.content || '').includes('第 8 章') || (r2?.content || '').includes('第8章'));
  let summary = `# Phase 3a - L1+L4 前向场景汇总\n\n` +
    `**完成时间**: ${nowIso()}\n\n` +
    `**目标**: 验证用户 pushback 后 LLM 能否找到正确章节\n\n` +
    `## 3 轮结果\n\n` +
    `| 轮次 | 触发条件 | 响应长度 | 提到回报函数 | 提到第 8 章 |\n` +
    `|------|----------|----------|--------------|------------|\n` +
    `| 1 | 初始问 | ${r1?.content?.length || 0} | ${r1?.content?.includes('回报函数工程') ? '✅' : '❌'} | ${(r1?.content || '').match(/第\s*8章|第8章/) ? '✅' : '❌'} |\n` +
    `| 2 | 用户 pushback | ${r2?.content?.length || 0} | ${r2?.content?.includes('回报函数工程') ? '✅' : '❌'} | ${(r2?.content || '').match(/第\s*8章|第8章/) ? '✅' : '❌'} |\n` +
    `| 3 | 追问小节 | ${r3?.content?.length || 0} | ${r3?.content?.includes('回报函数工程') ? '✅' : '❌'} | ${(r3?.content || '').match(/第\s*8章|第8章/) ? '✅' : '❌'} |\n\n` +
    `## Phase 3a 结论\n\n` +
    (success
      ? `✅ **L1+L4 修复成功**: 用户 pushback 触发了正确路径，LLM 找到了第 8 章和"回报函数工程"概念。\n`
      : `❌ **修复未生效**: 用户 pushback 后 LLM 仍然没有找到正确的章节/概念。\n`);
  writeFileSync(summaryFile, summary);
  console.log(`\n[phase3a] summary: ${summaryFile}`);
  console.log(`[phase3a] done at ${nowIso()}`);
}

main().catch(e => {
  console.error(`[phase3a] FATAL:`, e);
  process.exit(1);
});
