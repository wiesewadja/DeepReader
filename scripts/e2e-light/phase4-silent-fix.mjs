#!/usr/bin/env node
/**
 * Phase 4: Silent-fix 验证
 *
 * 验证用户最终输出中，never 出现"检索失败/未覆盖/无法找到/搜索出错"
 * 等暴露内部失败状态的 sentinel 词。
 *
 * P0 不变量: 检索失败/未覆盖/未索引 等内部状态不得暴露给用户
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const LOG_DIR = '/Users/lizhao/workspace/DeepReader/test-vault/9-Logs/5layer-defense-E2E';

// Sentinel 词：暴露内部失败状态的词
const SENTINEL_PATTERNS = [
  // 检索/搜索失败类
  /检索失败/,
  /搜索失败/,
  /搜索出错/,
  /查询失败/,
  /查询出错/,
  /无法.{0,5}(查询|检索|搜索)/,
  /未能.{0,3}(搜索|检索|查询)/,
  // 索引/覆盖类
  /未覆盖/,
  /未索引/,
  /未建立.{0,5}索引/,
  /没有索引/,
  /索引失败/,
  /索引出错/,
  // 内部错误类
  /服务异常/,
  /系统错误/,
  /internal.{0,5}error/i,
  /server.{0,5}error/i,
  // 工具调用残留
  /\[TOOL_CALL\]/,
  /<tool_response/,
  /search_book\(.*\)/,
  /pre_search\(.*\)/,
  // 路径暴露
  /\.pageindex\//,
  /\.obsidian\/plugins\//,
  // 调试占位符
  /TODO.*未完成/,
  /FIXME/,
  /\[DEBUG\]/,
];

const SENTINEL_LIST = SENTINEL_PATTERNS.map(r => r.source);

async function main() {
  console.log(`[phase4] start`);
  console.log(`[phase4] scanning user-facing responses in ${LOG_DIR}`);

  // 收集所有用户最终输出
  const files = [
    '02-bug-repro-turn-1.md',
    '02-bug-repro-turn-2.md',
    '02-bug-repro-turn-3.md',
    '02-bug-repro-turn-4.md',
    '03a-turn-1.md',
    '03a-turn-2.md',
    '03a-turn-3.md',
    '03b-turn-1.md',
    '03b-turn-2.md',
    '03b-turn-3.md',
  ];

  const results = [];
  for (const f of files) {
    const path = `${LOG_DIR}/${f}`;
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');

    // 提取 LLM 响应部分 (在 ``` ... ``` 之间)
    const codeBlockMatch = content.match(/```\n([\s\S]+?)\n```/);
    if (!codeBlockMatch) continue;
    const llmResponse = codeBlockMatch[1];

    // 检查 sentinel
    const hits = [];
    for (let i = 0; i < SENTINEL_PATTERNS.length; i++) {
      const pattern = SENTINEL_PATTERNS[i];
      const match = llmResponse.match(pattern);
      if (match) {
        hits.push({ pattern: SENTINEL_LIST[i], match: match[0] });
      }
    }

    results.push({
      file: f,
      responseLength: llmResponse.length,
      hits,
      clean: hits.length === 0,
    });
  }

  // 输出结果
  let summary = `# Phase 4 - Silent-fix 验证\n\n` +
    `**完成时间**: ${new Date().toISOString()}\n\n` +
    `**目标**: 用户最终输出中，never 出现暴露内部失败状态的 sentinel 词\n\n` +
    `**P0 不变量**: 检索失败/未覆盖/未索引/搜索出错 等内部状态不得暴露给用户\n\n` +
    `## 扫描的 Sentinel 词 (${SENTINEL_PATTERNS.length} 种)\n\n` +
    `\`\`\`\n${SENTINEL_LIST.join('\n')}\n\`\`\`\n\n` +
    `## 用户最终输出扫描结果\n\n` +
    `| 文件 | 响应长度 | Sentinel 命中 | 状态 |\n` +
    `|------|----------|---------------|------|\n`;

  for (const r of results) {
    const status = r.clean ? '✅ clean' : `❌ ${r.hits.length} hit(s)`;
    summary += `| ${r.file} | ${r.responseLength} | ${r.hits.length} | ${status} |\n`;
  }

  // 详细列出 hits
  const dirty = results.filter(r => !r.clean);
  if (dirty.length > 0) {
    summary += `\n## ⚠️ Sentinel 命中详情\n\n`;
    for (const r of dirty) {
      summary += `### ${r.file}\n\n`;
      for (const h of r.hits) {
        summary += `- 模式: \`${h.pattern}\` → 命中: "${h.match}"\n`;
      }
      summary += `\n`;
    }
  }

  const allClean = results.every(r => r.clean);
  summary += `\n## Phase 4 结论\n\n`;
  if (allClean) {
    summary += `✅ **Silent-fix 不变量保持**: 所有 ${results.length} 个用户最终输出均未暴露内部失败状态。\n`;
  } else {
    summary += `❌ **Silent-fix 不变量违反**: ${dirty.length} 个响应包含 sentinel 词，需要修复 formatter / self-verification 逻辑。\n`;
  }

  writeFileSync(`${LOG_DIR}/04-silent-fix-summary.md`, summary);
  console.log(`[phase4] summary written: ${LOG_DIR}/04-silent-fix-summary.md`);
  console.log(`[phase4] scanned: ${results.length} files, all clean: ${allClean}`);

  // Also dump to stdout
  for (const r of results) {
    if (!r.clean) {
      console.log(`[phase4] DIRTY: ${r.file} → ${r.hits.map(h => h.match).join(', ')}`);
    }
  }
}

main().catch(e => {
  console.error(`[phase4] FATAL:`, e);
  process.exit(1);
});
