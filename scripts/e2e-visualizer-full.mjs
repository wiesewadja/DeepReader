/**
 * VISUALIZER 全面 E2E 测试
 *
 * 覆盖所有图表关键词 × 所有阅读层次 + 负面测试
 * 每轮：发送消息 → 等待回复 → 检查 embed → 截图 → 视觉分析
 */
import { evalObsidian } from './smoke/lib/obsidian-cli.mjs';
import { writeFileSync, mkdirSync } from 'fs';

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
          preview: c.substring(0, 400)
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

// ========== 测试结果收集 ==========

const results = [];

function recordTest(testId, testName, keyword, expectedDiagram, data) {
  const entry = {
    id: testId,
    name: testName,
    keyword,
    expectedDiagram,
    hasEmbed: data.hasEmbed,
    contentLen: data.len,
    screenshot: data.screenshot || null,
    newFile: data.newFile || null,
    pass: expectedDiagram ? data.hasEmbed : !data.hasEmbed,
  };
  results.push(entry);

  const status = entry.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status} [${testId}] ${testName} | embed=${data.hasEmbed} len=${data.len}`);
  return entry;
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

const filesBaseline = await listExcalidrawFiles();
console.log('Files baseline:', filesBaseline.length);

function getNewFiles(currentFiles) {
  const baselineSet = new Set(filesBaseline);
  return currentFiles.filter(f => !baselineSet.has(f));
}

// ========== GROUP A: S1 检视阅读 + 可视化 ==========

const groupATests = [
  { id: 'T1', name: 'S1-思维导图', keyword: '思维导图', query: '请画一张思维导图展示这本书的整体结构' },
  { id: 'T2', name: 'S1-脑图', keyword: '脑图', query: '请生成这本书的脑图' },
  { id: 'T3', name: 'S1-导图', keyword: '导图', query: '请画导图展示这本书的框架' },
  { id: 'T4', name: 'S1-可视化', keyword: '可视化', query: '请可视化展示这本书的章节结构' },
];

console.log('\n========================================');
console.log('GROUP A: S1 检视阅读 + 可视化 (4 tests)');
console.log('========================================');

for (const t of groupATests) {
  console.log(`\n--- ${t.id}: ${t.name} ---`);
  await sendMessage(t.query);
  const msgRaw = await getLastAssistantMsg();
  const filesNow = await listExcalidrawFiles();
  const newFiles = getNewFiles(filesNow);

  const msgData = JSON.parse(msgRaw);
  const data = { hasEmbed: msgData.hasEmbed, len: msgData.len || 0 };

  // 截图最新文件
  if (newFiles.length > 0) {
    const latest = newFiles[newFiles.length - 1].replace('Excalidraw/', '');
    const shot = await screenshotExcalidraw(latest);
    data.screenshot = shot;
    data.newFile = latest;
  }

  recordTest(t.id, t.name, t.keyword, true, data);
}

// ========== GROUP B: S2 分析阅读 + 可视化 ==========

const groupBTests = [
  { id: 'T5', name: 'S2-流程图', keyword: '流程图', query: '画一个流程图展示从预测到决策的完整流程' },
  { id: 'T6', name: 'S2-概念图', keyword: '概念图', query: '请用概念图展示预测机器和人类判断力的互补关系' },
  { id: 'T7', name: 'S2-示意图', keyword: '示意图', query: '画一个示意图展示信息如何影响决策' },
  { id: 'T8', name: 'S2-知识图谱', keyword: '知识图谱', query: '构建这本书关于决策的知识图谱' },
  { id: 'T9', name: 'S2-图表', keyword: '图表', query: '用图表展示书中预测准确度和价值的关系' },
];

console.log('\n========================================');
console.log('GROUP B: S2 分析阅读 + 可视化 (5 tests)');
console.log('========================================');

for (const t of groupBTests) {
  console.log(`\n--- ${t.id}: ${t.name} ---`);
  await sendMessage(t.query);
  const msgRaw = await getLastAssistantMsg();
  const filesNow = await listExcalidrawFiles();
  const newFiles = getNewFiles(filesNow);

  const msgData = JSON.parse(msgRaw);
  const data = { hasEmbed: msgData.hasEmbed, len: msgData.len || 0 };

  if (newFiles.length > 0) {
    const latest = newFiles[newFiles.length - 1].replace('Excalidraw/', '');
    const shot = await screenshotExcalidraw(latest);
    data.screenshot = shot;
    data.newFile = latest;
  }

  recordTest(t.id, t.name, t.keyword, true, data);
}

// ========== GROUP C: 边界测试 ==========

const groupCTests = [
  { id: 'T10', name: '边界-画X图', keyword: '画X图', query: '画一张图展示全书架构' },
  { id: 'T11', name: '边界-infographic', keyword: 'infographic', query: 'build an infographic about the prediction machines' },
];

console.log('\n========================================');
console.log('GROUP C: 边界测试 (2 tests)');
console.log('========================================');

for (const t of groupCTests) {
  console.log(`\n--- ${t.id}: ${t.name} ---`);
  await sendMessage(t.query);
  const msgRaw = await getLastAssistantMsg();
  const filesNow = await listExcalidrawFiles();
  const newFiles = getNewFiles(filesNow);

  const msgData = JSON.parse(msgRaw);
  const data = { hasEmbed: msgData.hasEmbed, len: msgData.len || 0 };

  if (newFiles.length > 0) {
    const latest = newFiles[newFiles.length - 1].replace('Excalidraw/', '');
    const shot = await screenshotExcalidraw(latest);
    data.screenshot = shot;
    data.newFile = latest;
  }

  recordTest(t.id, t.name, t.keyword, true, data);
}

// ========== GROUP D: 负面测试 ==========

const groupDTests = [
  { id: 'T12', name: '负面-S1无图表', keyword: '无', query: '这本书主要讲了什么' },
  { id: 'T13', name: '负面-S2无图表', keyword: '无', query: '请解释预测和判断的区别' },
  { id: 'T14', name: '负面-S2无图表', keyword: '无', query: '总结第三章的核心论证' },
];

console.log('\n========================================');
console.log('GROUP D: 负面测试 (3 tests) — 不应生成图表');
console.log('========================================');

for (const t of groupDTests) {
  console.log(`\n--- ${t.id}: ${t.name} ---`);
  await sendMessage(t.query);
  const msgRaw = await getLastAssistantMsg();
  const filesNow = await listExcalidrawFiles();
  const newFiles = getNewFiles(filesNow);

  const msgData = JSON.parse(msgRaw);
  const data = { hasEmbed: msgData.hasEmbed, len: msgData.len || 0 };

  // 负面测试不应有新文件，但如果有，也截图记录
  if (newFiles.length > 0) {
    const latest = newFiles[newFiles.length - 1].replace('Excalidraw/', '');
    const shot = await screenshotExcalidraw(latest);
    data.screenshot = shot;
    data.newFile = latest;
  }

  recordTest(t.id, t.name, t.keyword, false, data);
}

// ========== 汇总报告 ==========

console.log('\n========================================');
console.log('测试汇总');
console.log('========================================');

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`总计: ${results.length} | ✅ PASS: ${passed} | ❌ FAIL: ${failed}\n`);

for (const r of results) {
  const status = r.pass ? '✅' : '❌';
  const diagram = r.expectedDiagram ? `[${r.keyword}]` : '[无图表]';
  const embed = r.hasEmbed ? '有embed' : '无embed';
  const file = r.newFile ? `file=${r.newFile}` : '';
  const shot = r.screenshot ? `screenshot=${r.screenshot}` : '';
  console.log(`${status} ${r.id} ${r.name} ${diagram} ${embed} ${file} ${shot}`);
}

// 保存结果 JSON
const reportPath = `${SCREENSHOT_DIR}/report.json`;
writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\nReport saved: ${reportPath}`);

// 输出截图列表用于后续分析
const screenshots = results.filter(r => r.screenshot).map(r => r.screenshot);
console.log('\nScreenshots for visual analysis:');
screenshots.forEach(s => console.log(`  ${s}`));
