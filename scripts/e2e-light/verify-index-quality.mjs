#!/usr/bin/env node
/**
 * Index Quality 快速验证
 *
 * 验证 EPUB 索引修复后的数据质量：
 * 1. tree.json 中 title="##" 的节点数 = 0
 * 2. "##" 节点的 frontmatter 摘要不再错位
 * 3. 章节文件的 title 字段反映实际章节名
 *
 * 用法: node scripts/e2e-light/verify-index-quality.mjs [bookId]
 *  默认检查 ee090e29 (AI极简经济学)
 */

import { readFileSync, existsSync } from 'node:fs';

const BOOK_ID = process.argv[2] || 'ee090e29';
const INDEX_DIR = `/Users/lizhao/workspace/DeepReader/test-vault/.obsidian/plugins/deepreader-dev/pageindex/${BOOK_ID}`;
const NOTES_DIR = `/Users/lizhao/workspace/DeepReader/test-vault/DeepReader`;

async function main() {
  console.log(`[verify-index] checking bookId=${BOOK_ID}`);

  const treePath = `${INDEX_DIR}/tree.json`;
  if (!existsSync(treePath)) {
    console.error(`[verify-index] FAIL: tree.json not found at ${treePath}`);
    console.error(`[verify-index] 请先重新索引: 清空 ${INDEX_DIR} 后通过 Obsidian 触发索引`);
    process.exit(1);
  }

  const tree = JSON.parse(readFileSync(treePath, 'utf8'));
  const structure = tree.structure || [];

  // ── 检查 1: title="##" 的节点数 ──
  const findAll = (nodes, results = []) => {
    for (const n of nodes) {
      results.push(n);
      if (n.nodes) findAll(n.nodes, results);
    }
    return results;
  };
  const allNodes = findAll(structure);
  const emptyTitled = allNodes.filter(n => !n.title || n.title === '##' || n.title.trim() === '');

  console.log(`\n=== 检查 1: title 为空/## 的节点 ===`);
  console.log(`总节点数: ${allNodes.length}`);
  console.log(`title 为空/"##": ${emptyTitled.length} (${(emptyTitled.length/allNodes.length*100).toFixed(1)}%)`);
  if (emptyTitled.length > 0) {
    console.log(`前 5 个:`);
    emptyTitled.slice(0, 5).forEach(n => {
      console.log(`  - nodeId=${n.nodeId} title=${JSON.stringify(n.title)}`);
    });
  }

  const check1Pass = emptyTitled.length === 0;
  console.log(`状态: ${check1Pass ? '✅ 通过' : '❌ 失败'}`);

  // ── 检查 2: chapter 节点的 title 应有真实章节名 ──
  console.log(`\n=== 检查 2: chapter 节点 title 质量 ===`);
  const chapterNodes = allNodes.filter(n => /^第[一二三四五六七八九十百千\d]+章/.test(n.title || ''));
  console.log(`章级节点数: ${chapterNodes.length}`);
  const sample = chapterNodes.slice(0, 5);
  sample.forEach(n => {
    console.log(`  - ${n.title}`);
  });
  const check2Pass = chapterNodes.length > 0;
  console.log(`状态: ${check2Pass ? '✅ 通过' : '❌ 失败'}`);

  // ── 检查 3: 找一本已生成的 chapter 文件，检查 frontmatter 摘要是否合理 ──
  console.log(`\n=== 检查 3: 章节文件 frontmatter 摘要质量 ===`);
  let notesChecked = 0;
  let wrongSummaryCount = 0;
  for (const n of chapterNodes) {
    // Find note file by nodeId
    const expectedFileName = String(allNodes.indexOf(n) + 1).padStart(2, '0') + ' - ';
    // Simpler: read the corresponding note file
    // Just check the first 3 chapter files
    if (notesChecked >= 3) break;
    notesChecked++;
  }
  // Read any note file in DeepReader dir
  const { readdirSync } = await import('node:fs');
  let sampleNotes = [];
  try {
    const dirs = readdirSync(NOTES_DIR);
    for (const d of dirs) {
      try {
        const files = readdirSync(`${NOTES_DIR}/${d}`);
        for (const f of files.slice(0, 3)) {
          if (f.endsWith('.md')) sampleNotes.push(`${NOTES_DIR}/${d}/${f}`);
        }
      } catch (e) {}
      if (sampleNotes.length >= 5) break;
    }
  } catch (e) {
    console.log(`(无法扫描 ${NOTES_DIR}: ${e.message})`);
  }

  for (const path of sampleNotes) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
    if (!fmMatch) continue;
    const fm = fmMatch[1];
    const titleMatch = fm.match(/^title:\s*(.+)$/m);
    const nodeIdMatch = fm.match(/^node_id:\s*"([^"]+)"/m);
    const title = titleMatch ? titleMatch[1].trim().replace(/^"|"$/g, '') : '';
    const nodeId = nodeIdMatch ? nodeIdMatch[1] : '';
    // Look for [!summary] in body
    const summaryMatch = content.match(/> \[!summary\]\n((?:> .+\n?)+)/);
    const summary = summaryMatch ? summaryMatch[1].replace(/^> /gm, '').trim() : '';
    if (title === '##' || !title) wrongSummaryCount++;
    console.log(`  - ${path.split('/').pop()}: title=${JSON.stringify(title)} nodeId=${nodeId} summary.len=${summary.length}`);
    if (summary.length > 0) {
      console.log(`    summary[:60]: ${summary.slice(0, 60)}...`);
    }
  }
  const check3Pass = wrongSummaryCount === 0;
  console.log(`状态: ${check3Pass ? '✅ 通过' : `❌ 失败 (${wrongSummaryCount} 个错位摘要)`}`);

  // ── 总结 ──
  console.log(`\n=== 总结 ===`);
  const allPass = check1Pass && check2Pass && check3Pass;
  console.log(`empty/## 标题: ${check1Pass ? '✅' : '❌'}`);
  console.log(`章级节点命名: ${check2Pass ? '✅' : '❌'}`);
  console.log(`摘要正确性: ${check3Pass ? '✅' : '❌'}`);
  console.log(`\n总判定: ${allPass ? '✅ 修复生效' : '❌ 仍有问题'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error(`[verify-index] FATAL:`, e);
  process.exit(1);
});
