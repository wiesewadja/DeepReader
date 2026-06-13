/**
 * 逐一截图所有 VISUALIZER 生成的 excalidraw 文件
 */
import { evalObsidian } from './smoke/lib/obsidian-cli.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const SCREENSHOT_DIR = 'test-output/visualizer-e2e';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const files = [
  { test: 'T1-思维导图', file: 'AI极简经济学整体结构思维导图.excalidraw' },
  { test: 'T2-脑图', file: 'AI极简经济学脑图.excalidraw' },
  { test: 'T3-导图', file: 'AI极简经济学框架.excalidraw' },
  { test: 'T4-可视化', file: 'AI极简经济学章节结构.excalidraw' },
  { test: 'T5-流程图', file: 'AI极简经济学_预测到决策流程图.excalidraw' },
  { test: 'T6-概念图', file: 'AI极简经济学_预测与判断互补关系.excalidraw' },
  { test: 'T7-示意图', file: 'AI极简经济学-信息影响决策循环图.excalidraw' },
  { test: 'T8-知识图谱', file: 'AI极简经济学决策知识图谱.excalidraw' },
  { test: 'T9-图表', file: 'AI极简经济学_预测准确度与价值关系.excalidraw' },
  { test: 'T10-画X图', file: 'AI极简经济学全书架构.excalidraw' },
  { test: 'T11-infographic', file: 'AI极简经济学-预测机器逻辑链.excalidraw' },
];

for (const { test, file } of files) {
  console.log(`\n--- ${test}: ${file} ---`);

  // 关闭已有 excalidraw leaves
  await evalObsidian(`(async function(){
    var leaves = app.workspace.getLeavesOfType('excalidraw');
    leaves.forEach(function(l){ l.detach(); });
    await new Promise(function(r){ setTimeout(r, 1500); });
  })()`);

  // 打开文件
  await evalObsidian(`app.workspace.openLinkText("Excalidraw/${file}", "")`);
  await sleep(8000);

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
      }, 5000);
    });
  })()`);

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    console.log(`  FAILED`);
    continue;
  }

  const safeName = test.replace(/[^a-zA-Z0-9-]/g, '_');
  const outputPath = `${SCREENSHOT_DIR}/${safeName}.png`;
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
}

console.log('\nDone.');
