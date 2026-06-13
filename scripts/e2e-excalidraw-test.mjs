/**
 * Excalidraw 真实端到端测试
 * 通过 evalObsidian 模拟用户操作：选书 → 输入问题 → 等待回复 → 检查结果
 */
import { evalObsidian } from './smoke/lib/obsidian-cli.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const SCREENSHOT_DIR = 'test-output/excalidraw-e2e';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 发送消息并等待回复完成
 */
async function sendMessage(question) {
  console.log(`\nSending: "${question}"`);

  // 直接调用 sendMessage
  const escapedQ = JSON.stringify(question);
  await evalObsidian(`
    new Promise(function(resolve) {
      var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      var view = leaves[0].view;
      view.agentChatCtrl.sendMessage(${escapedQ});
      resolve('SENT');
    })
  `);

  // 轮询等待回复完成
  console.log('  Waiting for response...');
  let attempts = 0;
  const maxAttempts = 120; // 最多等 6 分钟

  while (attempts < maxAttempts) {
    await sleep(3000);
    const isStreaming = await evalObsidian(`
      (function() {
        var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
        var view = leaves[0].view;
        return view.agentChatCtrl.isAiStreaming;
      })()
    `);

    if (!isStreaming) {
      console.log('  Response complete!');
      break;
    }
    attempts++;
    if (attempts % 10 === 0) {
      console.log(`  Still waiting... (${attempts * 3}s)`);
    }
  }

  if (attempts >= maxAttempts) {
    console.log('  TIMEOUT waiting for response');
    return null;
  }

  // 获取最后的 AI 回复
  await sleep(2000);
  const lastMessage = await evalObsidian(`
    (function() {
      var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      var view = leaves[0].view;
      var hist = view.agentChatCtrl._agentChatHistory;
      if (!hist || hist.length === 0) return JSON.stringify({error: 'NO_HISTORY'});
      var result = {historyLength: hist.length};
      // 找最后一条 AI 消息
      for (var i = hist.length - 1; i >= 0; i--) {
        if (hist[i].role === 'assistant') {
          var content = hist[i].content || '';
          result.hasExcalidraw = content.indexOf('![[Excalidraw/') >= 0 || content.indexOf('.excalidraw') >= 0;
          result.contentPreview = content.substring(0, 2000);
          return JSON.stringify(result);
        }
      }
      result.error = 'NO_ASSISTANT_MSG';
      result.lastRoles = hist.slice(-3).map(function(m) { return m.role; });
      return JSON.stringify(result);
    })()
  `);

  return lastMessage;
}

/**
 * 截取 Excalidraw 文件的截图
 */
async function screenshotExcalidraw(filename) {
  console.log(`  Screenshotting: ${filename}`);

  // 关闭已有的 excalidraw leaves
  await evalObsidian(`
    new Promise(function(resolve) {
      var leaves = app.workspace.getLeavesOfType('excalidraw');
      leaves.forEach(function(l) { l.detach(); });
      setTimeout(resolve, 1000);
    })
  `);
  await sleep(1500);

  // 打开文件
  await evalObsidian(`app.workspace.openLinkText("Excalidraw/${filename}", "")`);
  await sleep(5000);

  // 截图
  const dataUrl = await evalObsidian(`
    new Promise(function(resolve, reject) {
      setTimeout(function() {
        try {
          var leaves = app.workspace.getLeavesOfType('excalidraw');
          if (leaves.length === 0) { reject('No excalidraw leaves'); return; }
          var leaf = leaves[leaves.length - 1];
          var view = leaf.view;
          var container = view.containerEl;
          var canvases = container.querySelectorAll('canvas');
          var canvas = canvases[0];
          if (canvas && canvas.width > 0) {
            resolve(canvas.toDataURL('image/png'));
          } else {
            reject('Canvas empty');
          }
        } catch(e) { reject(e.message || String(e)); }
      }, 3000);
    })
  `);

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    console.log(`  Failed to screenshot ${filename}`);
    return null;
  }

  const outputPath = `${SCREENSHOT_DIR}/${filename.replace('.excalidraw', '.png')}`;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(outputPath, Buffer.from(base64, 'base64'));
  console.log(`  Saved: ${outputPath} (${(Buffer.from(base64, 'base64').length / 1024).toFixed(1)} KB)`);

  // 关闭 leaf
  await evalObsidian(`
    new Promise(function(resolve) {
      var leaves = app.workspace.getLeavesOfType('excalidraw');
      if (leaves.length > 0) leaves[leaves.length - 1].detach();
      setTimeout(resolve, 500);
    })
  `);
  await sleep(1000);

  return outputPath;
}

/**
 * 列出 Excalidraw 目录中的文件
 */
async function listExcalidrawFiles() {
  return await evalObsidian(`
    new Promise(function(resolve) {
      app.vault.adapter.list('Excalidraw').then(function(list) {
        var files = list.files.filter(function(f) { return f.endsWith('.excalidraw'); });
        resolve(JSON.stringify(files));
      }).catch(function() { resolve('[]'); });
    })
  `);
}

// ===== 测试开始 =====

// Step 1: 确认侧边栏和书籍
console.log('=== Setup ===');
const sidebarCheck = await evalObsidian(`
  (function() {
    var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
    if (leaves.length === 0) return 'NO_SIDEBAR';
    var view = leaves[0].view;
    return JSON.stringify({
      sidebar: 'OPEN',
      bookId: view.bookMgr._currentIndexId,
      bookName: view.bookMgr._currentPdfName,
    });
  })()
`);
console.log('State:', sidebarCheck);

// 如果没有选中书，选择 AI极简经济学
const state = JSON.parse(sidebarCheck);
if (state.bookId !== 'ee090e29') {
  console.log('Selecting AI极简经济学...');
  await evalObsidian(`
    new Promise(function(resolve) {
      var leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
      leaves[0].view.selectIndex('ee090e29');
      setTimeout(resolve, 3000);
    })
  `);
}

// 记录测试前的 excalidraw 文件
const filesBefore = await listExcalidrawFiles();
console.log('Files before test:', filesBefore);

// ===== Test 1: S1 检视阅读 — 全书框架图 =====
console.log('\n===== Test 1: S1 Inspectional — 全书框架图 =====');
const test1Result = await sendMessage('请帮我画一张思维导图，展示 AI极简经济学 这本书的整体结构');
console.log('Test 1 result:', test1Result);

// ===== Test 2: S2 分析阅读 — 概念关系图 =====
console.log('\n===== Test 2: S2 Analytical — 概念关系图 =====');
const test2Result = await sendMessage('画一个流程图，展示从预测到决策的完整流程');
console.log('Test 2 result:', test2Result);

// ===== Test 3: S2 分析阅读 — 可视化概念 =====
console.log('\n===== Test 3: S2 Analytical — 可视化核心概念 =====');
const test3Result = await sendMessage('可视化展示书中提到的预测机器和判断力的关系');
console.log('Test 3 result:', test3Result);

// ===== 检查生成的文件 =====
console.log('\n===== Checking generated files =====');
const filesAfter = await listExcalidrawFiles();
console.log('Files after test:', filesAfter);

// 找到新生成的文件
const beforeSet = new Set(JSON.parse(filesBefore));
const afterArr = JSON.parse(filesAfter);
const newFiles = afterArr.filter(f => !beforeSet.has(f));
console.log('New files generated:', newFiles);

// ===== 截图所有新生成的文件 =====
console.log('\n===== Screenshots =====');
const screenshots = [];
for (const filepath of newFiles) {
  const filename = filepath.replace('Excalidraw/', '');
  const screenshotPath = await screenshotExcalidraw(filename);
  if (screenshotPath) {
    screenshots.push({ file: filename, screenshot: screenshotPath });
  }
}

// ===== 汇总结果 =====
console.log('\n===== Summary =====');
console.log('Tests completed:', [
  { name: 'S1 思维导图', result: test1Result },
  { name: 'S2 流程图', result: test2Result },
  { name: 'S2 概念图', result: test3Result },
].map(t => ({
  name: t.name,
  hasExcalidraw: t.result ? JSON.parse(t.result).hasExcalidraw : false,
})));
console.log('New files:', newFiles);
console.log('Screenshots:', screenshots.map(s => s.screenshot));
