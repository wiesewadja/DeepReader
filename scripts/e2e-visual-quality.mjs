/**
 * E2E 视觉质量改进验证 — 对比优化前后
 * 只测 2 个场景：T4(可视化) 和 T5(流程图)
 */
import { evalObsidian } from './smoke/lib/obsidian-cli.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const SCREENSHOT_DIR = 'test-output/visualizer-e2e';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendMessage(question) {
  console.log(`\n>>> Sending: "${question}"`);
  const escapedQ = JSON.stringify(question);
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    leaves[0].view.agentChatCtrl.sendMessage(${escapedQ});
  })()`);

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
  console.log('  TIMEOUT');
  return false;
}

async function getLastAssistantMsg() {
  return await evalObsidian(`(function(){
    var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    var hist = leaves[0].view.agentChatCtrl._agentChatHistory;
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].role === 'assistant') {
        var c = hist[i].content || '';
        return JSON.stringify({hasEmbed: c.indexOf('![[Excalidraw/') >= 0, len: c.length});
      }
    }
    return '{"error":"no assistant msg"}';
  })()`);
}

async function listExcalidrawFiles() {
  return JSON.parse(await evalObsidian(`(async function(){
    var list = await app.vault.adapter.list('Excalidraw');
    return JSON.stringify(list.files.filter(function(f){ return f.endsWith('.excalidraw'); }).sort());
  })()`));
}

async function screenshotExcalidraw(filename, outputName) {
  console.log(`  Screenshotting: ${filename}`);
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('excalidraw');
    leaves.forEach(function(l){ l.detach(); });
    await new Promise(function(r){ setTimeout(r, 1500); });
  })()`);

  await evalObsidian(`app.workspace.openLinkText("Excalidraw/${filename}", "")`);
  await sleep(8000);

  const dataUrl = await evalObsidian(`(async function(){
    return await new Promise(function(resolve, reject) {
      setTimeout(function() {
        try {
          var leaves = app.workspace.getLeavesOfType('excalidraw');
          if (leaves.length === 0) { reject('No leaves'); return; }
          var leaf = leaves[leaves.length - 1];
          var canvases = leaf.view.containerEl.querySelectorAll('canvas');
          var canvas = canvases[0];
          if (canvas && canvas.width > 0) resolve(canvas.toDataURL('image/png'));
          else reject('Canvas empty');
        } catch(e) { reject(e.message || String(e)); }
      }, 5000);
    });
  })()`);

  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('excalidraw');
    if (leaves.length > 0) leaves[leaves.length - 1].detach();
    await new Promise(function(r){ setTimeout(r, 500); });
  })()`);
  await sleep(1000);

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    console.log(`  FAILED`);
    return null;
  }

  const outputPath = `${SCREENSHOT_DIR}/${outputName}.png`;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(outputPath, Buffer.from(base64, 'base64'));
  console.log(`  Saved: ${outputPath} (${(Buffer.from(base64, 'base64').length / 1024).toFixed(1)} KB)`);
  return outputPath;
}

// ========== 初始化 ==========

console.log('=== 初始化 ===');
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

// ========== Test: 可视化 ==========

console.log('\n=== Test: 可视化展示章节结构 ===');
await sendMessage('请可视化展示这本书的章节结构');
const msg1 = await getLastAssistantMsg();
console.log('Msg:', msg1);

const filesAfter1 = await listExcalidrawFiles();
const newFile1 = filesAfter1[filesAfter1.length - 1];
if (newFile1) {
  const filename = newFile1.replace('Excalidraw/', '');
  await screenshotExcalidraw(filename, 'optimized-T4-visual');
}

// ========== Test: 流程图 ==========

console.log('\n=== Test: 流程图 ===');
await sendMessage('画一个流程图展示从预测到决策的完整流程');
const msg2 = await getLastAssistantMsg();
console.log('Msg:', msg2);

const filesAfter2 = await listExcalidrawFiles();
const newFile2 = filesAfter2[filesAfter2.length - 1];
if (newFile2) {
  const filename = newFile2.replace('Excalidraw/', '');
  await screenshotExcalidraw(filename, 'optimized-T5-flowchart');
}

console.log('\nDone.');
