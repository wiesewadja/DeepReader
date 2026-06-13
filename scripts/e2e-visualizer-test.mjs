/**
 * Phase 1 VISUALIZER 完整端到端测试
 *
 * 覆盖场景：
 *   Test 1 (S1): "请画一张思维导图展示这本书的整体结构" → depth=1 → INSPECTIONAL → VISUALIZER
 *   Test 2 (S2): "画一个流程图展示从预测到决策的完整流程" → depth=2 → ANALYTICAL → VISUALIZER
 *   Test 3 (S1): "请用概念图展示书中核心概念的关系" → depth=1 → INSPECTIONAL → VISUALIZER
 *
 * 每轮：发送消息 → 等待回复 → 检查 embed → 截图 → MiniMax 分析
 */
import { evalObsidian } from './smoke/lib/obsidian-cli.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const SCREENSHOT_DIR = 'test-output/visualizer-e2e';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 工具函数 ==========

async function sendMessage(question) {
  console.log(`\n>>> Sending: "${question}"`);
  const escapedQ = JSON.stringify(question);
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    leaves[0].view.agentChatCtrl.sendMessage(${escapedQ});
  })()`);

  // 轮询等待（最多 5 分钟）
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const state = await evalObsidian(`(function(){
      var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      var v = leaves[0].view;
      return JSON.stringify({s: v.agentChatCtrl.isAiStreaming, p: v.agentChatCtrl.isProcessing});
    })()`);
    const p = JSON.parse(state);
    if (!p.s && !p.p && i > 0) {
      console.log(`  AI completed in ~${i * 5}s`);
      return true;
    }
    if (i % 6 === 0) console.log(`  Waiting... ${i * 5}s`);
  }
  console.log('  TIMEOUT (5min)');
  return false;
}

async function getLastAssistantMsg() {
  return await evalObsidian(`(function(){
    var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    var hist = leaves[0].view.agentChatCtrl._agentChatHistory;
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].role === 'assistant') {
        var c = hist[i].content || '';
        return JSON.stringify({
          hasEmbed: c.indexOf('![[Excalidraw/') >= 0,
          len: c.length,
          preview: c.substring(0, 600)
        });
      }
    }
    return '{"error":"no assistant msg"}';
  })()`);
}

async function listExcalidrawFiles() {
  return JSON.parse(await evalObsidian(`(async function(){
    var list = await app.vault.adapter.list('Excalidraw');
    return JSON.stringify(list.files.filter(function(f){ return f.endsWith('.excalidraw'); }));
  })()`));
}

async function screenshotExcalidraw(filename) {
  console.log(`  Screenshotting: ${filename}`);

  // 关闭已有的 excalidraw leaves
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('excalidraw');
    leaves.forEach(function(l){ l.detach(); });
    await new Promise(function(r){ setTimeout(r, 1500); });
  })()`);

  // 打开文件
  await evalObsidian(`app.workspace.openLinkText("Excalidraw/${filename}", "")`);
  await sleep(6000);

  // 截图
  const dataUrl = await evalObsidian(`(async function(){
    return await new Promise(function(resolve, reject) {
      setTimeout(function() {
        try {
          var leaves = app.workspace.getLeavesOfType('excalidraw');
          if (leaves.length === 0) { reject('No excalidraw leaves'); return; }
          var leaf = leaves[leaves.length - 1];
          var container = leaf.view.containerEl;
          var canvases = container.querySelectorAll('canvas');
          var canvas = canvases[0];
          if (canvas && canvas.width > 0) {
            resolve(canvas.toDataURL('image/png'));
          } else {
            reject('Canvas empty');
          }
        } catch(e) { reject(e.message || String(e)); }
      }, 4000);
    });
  })()`);

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    console.log(`  FAILED to screenshot ${filename}`);
    return null;
  }

  const outputPath = `${SCREENSHOT_DIR}/${filename.replace('.excalidraw', '.png')}`;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(outputPath, Buffer.from(base64, 'base64'));
  console.log(`  Saved: ${outputPath} (${(Buffer.from(base64, 'base64').length / 1024).toFixed(1)} KB)`);

  // 关闭 leaf
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('excalidraw');
    if (leaves.length > 0) leaves[leaves.length - 1].detach();
    await new Promise(function(r){ setTimeout(r, 500); });
  })()`);
  await sleep(1000);

  return outputPath;
}

// ========== 初始化 ==========

console.log('=== 初始化 ===');

// 确认 sidebar 打开且选中 AI极简经济学
const initState = await evalObsidian(`(function(){
  var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
  if (leaves.length === 0) return 'NO_SIDEBAR';
  var v = leaves[0].view;
  var h = v.agentChatCtrl.host;
  return JSON.stringify({bookId: h.currentIndexId, pdfName: h.currentPdfName});
})()`);
console.log('State:', initState);

const parsed = JSON.parse(initState);
if (parsed.bookId !== 'ee090e29') {
  console.log('Selecting AI极简经济学...');
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    await leaves[0].view.selectIndex('ee090e29');
    await new Promise(function(r){ setTimeout(r, 2000); });
  })()`);
}

const filesBefore = await listExcalidrawFiles();
console.log('Files before:', filesBefore.length);

// ========== Test 1: S1 思维导图 ==========

console.log('\n========================================');
console.log('Test 1: S1 Inspectional — 思维导图');
console.log('========================================');

await sendMessage('请画一张思维导图展示这本书的整体结构');
const test1Msg = await getLastAssistantMsg();
console.log('Test 1 msg:', test1Msg);

// ========== Test 2: S2 流程图 ==========

console.log('\n========================================');
console.log('Test 2: S2 Analytical — 流程图');
console.log('========================================');

await sendMessage('画一个流程图展示从预测到决策的完整流程');
const test2Msg = await getLastAssistantMsg();
console.log('Test 2 msg:', test2Msg);

// ========== Test 3: S1 概念图 ==========

console.log('\n========================================');
console.log('Test 3: S1 Inspectional — 概念图');
console.log('========================================');

await sendMessage('请用概念图展示书中预测机器和人类判断力的互补关系');
const test3Msg = await getLastAssistantMsg();
console.log('Test 3 msg:', test3Msg);

// ========== 检查新生成的文件 ==========

console.log('\n========================================');
console.log('检查生成文件');
console.log('========================================');

const filesAfter = await listExcalidrawFiles();
const beforeSet = new Set(filesBefore);
const newFiles = filesAfter.filter(f => !beforeSet.has(f));
console.log('New files:', newFiles);

// ========== 截图所有新文件 ==========

console.log('\n========================================');
console.log('截图');
console.log('========================================');

const screenshots = [];
for (const filepath of newFiles) {
  const filename = filepath.replace('Excalidraw/', '');
  const path = await screenshotExcalidraw(filename);
  if (path) screenshots.push({ file: filename, path });
}

// ========== 汇总 ==========

console.log('\n========================================');
console.log('测试汇总');
console.log('========================================');

const tests = [
  { name: 'Test 1 (S1 思维导图)', raw: test1Msg },
  { name: 'Test 2 (S2 流程图)', raw: test2Msg },
  { name: 'Test 3 (S1 概念图)', raw: test3Msg },
];

for (const t of tests) {
  try {
    const p = JSON.parse(t.raw);
    console.log(`${t.name}: hasEmbed=${p.hasEmbed}, contentLen=${p.len}`);
  } catch(e) {
    console.log(`${t.name}: parse error`);
  }
}
console.log('New excalidraw files:', newFiles);
console.log('Screenshots:', screenshots.map(s => s.path));
console.log('\nDone. Use MiniMax to analyze screenshots.');
