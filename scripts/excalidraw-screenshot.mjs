/**
 * 截图 Excalidraw 图形 v2
 * 关闭所有已打开的 excalidraw leaves，逐个打开文件截图
 */
import { evalObsidian } from './smoke/lib/obsidian-cli.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const OUTPUT_DIR = 'test-output/excalidraw-screenshots-v2';
mkdirSync(OUTPUT_DIR, { recursive: true });

const files = [
  { path: 'Excalidraw/S1-思维导图-AI经济学.excalidraw', name: 'S1-mindmap' },
  { path: 'Excalidraw/S2-流程图-阅读层次.excalidraw', name: 'S2-flowchart' },
  { path: 'Excalidraw/S3-概念图-AI核心概念.excalidraw', name: 'S3-conceptmap' },
  { path: 'Excalidraw/S4-全书框架-AI经济学.excalidraw', name: 'S4-framework' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Step 1: Close all existing excalidraw leaves
console.log('Closing all existing excalidraw leaves...');
await evalObsidian(`
  new Promise(function(resolve) {
    var leaves = app.workspace.getLeavesOfType("excalidraw");
    var count = leaves.length;
    if (count === 0) { resolve(0); return; }
    leaves.forEach(function(leaf) { leaf.detach(); });
    setTimeout(function() { resolve(count); }, 1000);
  })
`);
await sleep(1500);

const leafCount = await evalObsidian('app.workspace.getLeavesOfType("excalidraw").length');
console.log(`Remaining leaves: ${leafCount}`);

// Step 2: For each file, open, render, screenshot, close
for (const file of files) {
  console.log(`\nProcessing: ${file.name}`);

  // Open file
  await evalObsidian(`app.workspace.openLinkText("${file.path}", "")`);
  console.log('  Opened, waiting for render...');
  await sleep(5000);

  // Get the leaf that just opened
  const dataUrl = await evalObsidian(`
    new Promise(function(resolve, reject) {
      setTimeout(function() {
        try {
          var leaves = app.workspace.getLeavesOfType("excalidraw");
          if (leaves.length === 0) { reject("No excalidraw leaves"); return; }
          // Get the LAST leaf (most recently opened)
          var leaf = leaves[leaves.length - 1];
          var view = leaf.view;
          var container = view.containerEl;
          var canvases = container.querySelectorAll("canvas");
          // Use the first (visible) canvas
          var canvas = canvases[0];
          if (canvas && canvas.width > 0) {
            var url = canvas.toDataURL("image/png");
            resolve(url);
          } else {
            reject("Canvas empty or not found, count=" + canvases.length);
          }
        } catch(e) { reject(e.message || String(e)); }
      }, 2000);
    })
  `);

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    console.error(`  FAILED: ${dataUrl}`);
    continue;
  }

  // Save
  const outputPath = `${OUTPUT_DIR}/${file.name}.png`;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(outputPath, Buffer.from(base64, 'base64'));
  console.log(`  Saved: ${outputPath} (${(Buffer.from(base64, 'base64').length / 1024).toFixed(1)} KB)`);

  // Close this leaf
  await evalObsidian(`
    new Promise(function(resolve) {
      var leaves = app.workspace.getLeavesOfType("excalidraw");
      if (leaves.length > 0) {
        leaves[leaves.length - 1].detach();
      }
      setTimeout(resolve, 500);
    })
  `);
  await sleep(1000);
}

// Verify
const { readdirSync } = await import('fs');
const pngFiles = readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
console.log(`\nDone! ${pngFiles.length} screenshots in ${OUTPUT_DIR}:`);
for (const f of pngFiles) {
  const stat = await import('fs').then(m => m.statSync(`${OUTPUT_DIR}/${f}`));
  console.log(`  ${f}: ${(stat.size / 1024).toFixed(1)} KB`);
}
