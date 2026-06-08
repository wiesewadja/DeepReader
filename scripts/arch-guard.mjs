#!/usr/bin/env node
/**
 * arch-guard.mjs — DeepReader 架构守卫
 *
 * 扫描 src/ 下的 import 语句，验证模块依赖方向是否符合架构规则。
 * 规则定义在 DEPENDENCY_RULES 中，可按需扩展。
 *
 * 用法:
 *   node scripts/arch-guard.mjs           # 报告所有违规
 *   node scripts/arch-guard.mjs --diff    # 只报告 git 变更文件中的违规
 *   node scripts/arch-guard.mjs --strict  # 有违规时退出码 1
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

// ─── 依赖方向规则 ───
// source: 源模块 glob 模式（简化为前缀匹配）
// forbidden: 禁止导入的目标模块前缀列表
// reason: 违规原因说明
const DEPENDENCY_RULES = [
  // Components 不能直接依赖 agent 内部（应通过 FrontendAgent.chat()）
  {
    source: 'src/components/',
    forbidden: ['src/agent/graph/', 'src/agent/tools/', 'src/agent/memory/', 'src/agent/router/', 'src/agent/skills/'],
    reason: 'Components 应通过 FrontendAgent.chat() 使用 Agent，不应直接导入内部模块',
  },
  // Components 不能直接依赖 pageindex 内部（应通过 services）
  {
    source: 'src/components/',
    forbidden: ['src/pageindex/parsers/', 'src/pageindex/core/', 'src/pageindex/vault/', 'src/pageindex/bm25.ts'],
    reason: 'Components 应通过 services 层使用 PageIndex，不应直接导入内部模块',
  },
  // Views 不能导入 agent 核心引擎内部（graph/subgraphs/prompts）
  {
    source: 'src/views/',
    forbidden: ['src/agent/graph/subgraphs/', 'src/agent/graph/prompts/', 'src/agent/graph/state.ts', 'src/agent/graph/nodes/'],
    reason: 'Views 不应导入 LangGraph 引擎内部（subgraphs/prompts/nodes），应通过 FrontendAgent.chat()',
  },
  // Views 不能导入 pageindex 解析器内部
  {
    source: 'src/views/',
    forbidden: ['src/pageindex/parsers/', 'src/pageindex/core/', 'src/pageindex/vault/', 'src/pageindex/bm25.ts'],
    reason: 'Views 不应直接导入 PageIndex 内部（parsers/core/vault），应通过 book-indexer 或 paths',
  },
  // Services 不能依赖 views
  {
    source: 'src/services/',
    forbidden: ['src/views/', 'src/components/'],
    reason: 'Services 是底层模块，不应依赖 UI 层（views/components）',
  },
  // Utils 不能依赖任何业务模块
  {
    source: 'src/utils/',
    forbidden: ['src/agent/', 'src/pageindex/', 'src/views/', 'src/components/', 'src/services/', 'src/weread/'],
    reason: 'Utils 是纯工具层，不应依赖任何业务模块',
  },
  // PageIndex 不能依赖 views/components
  {
    source: 'src/pageindex/',
    forbidden: ['src/views/', 'src/components/'],
    reason: 'PageIndex 是数据层，不应依赖 UI 层',
  },
];

// ─── Import 解析 ───

const IMPORT_RE = /import\s+(?:type\s+)?(?:[\w{},\s*]+\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g;
// 动态 import() 调用
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
// re-export 语句
const REEXPORT_RE = /export\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+)['"](\.\.?\/[^'"]+)['"]/g;

function resolveImport(fromFile, importPath) {
  const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const parts = dir.split('/');
  const impParts = importPath.split('/');

  for (const part of impParts) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }

  let resolved = parts.join('/');
  // TS 项目中 .js import 实际对应 .ts 文件
  if (resolved.endsWith('.js')) {
    resolved = resolved.slice(0, -3) + '.ts';
  } else if (!resolved.endsWith('.ts')) {
    resolved += '.ts';
  }
  return resolved;
}

function getImports(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const imports = [];
  let match;
  // 静态 import
  while ((match = IMPORT_RE.exec(content)) !== null) {
    imports.push({
      raw: match[1],
      resolved: resolveImport(filePath, match[1]),
    });
  }
  // 动态 import()
  while ((match = DYNAMIC_IMPORT_RE.exec(content)) !== null) {
    imports.push({
      raw: match[1],
      resolved: resolveImport(filePath, match[1]),
    });
  }
  // re-export
  while ((match = REEXPORT_RE.exec(content)) !== null) {
    imports.push({
      raw: match[1],
      resolved: resolveImport(filePath, match[1]),
    });
  }
  return imports;
}

// ─── 文件扫描 ───

function* walkTsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsFiles(fullPath);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      yield fullPath;
    }
  }
}

function getChangedFiles() {
  try {
    const diff = execSync('git diff --name-only --diff-filter=ACMR HEAD', {
      cwd: ROOT, encoding: 'utf-8',
    }).trim();
    if (!diff) return [];
    return diff.split('\n').filter(f => f.startsWith('src/') && f.endsWith('.ts'));
  } catch {
    return [];
  }
}

// ─── 规则检查 ───

function checkFile(filePath) {
  const relPath = relative(ROOT, filePath);
  const violations = [];
  const imports = getImports(filePath);

  for (const rule of DEPENDENCY_RULES) {
    if (!relPath.startsWith(rule.source)) continue;
    for (const imp of imports) {
      const impRel = relative(ROOT, imp.resolved);
      for (const forbidden of rule.forbidden) {
        if (impRel.startsWith(forbidden)) {
          violations.push({
            file: relPath,
            import: imp.raw,
            target: impRel,
            rule: rule.source,
            reason: rule.reason,
          });
        }
      }
    }
  }

  return violations;
}

// ─── 主程序 ───

function main() {
  const args = process.argv.slice(2);
  const diffOnly = args.includes('--diff');
  const strict = args.includes('--strict');

  const files = diffOnly
    ? getChangedFiles().map(f => join(ROOT, f))
    : [...walkTsFiles(SRC)];

  if (diffOnly && files.length === 0) {
    console.log('✅ arch-guard: 没有检测到变更文件');
    process.exit(0);
  }

  const allViolations = [];
  for (const file of files) {
    try {
      const violations = checkFile(file);
      allViolations.push(...violations);
    } catch (e) {
      // 文件可能不存在（已删除等）
    }
  }

  console.log(`\n🏗️  DeepReader 架构守卫`);
  console.log(`   扫描: ${files.length} 个文件${diffOnly ? ' (仅变更)' : ' (全量)'}`);
  console.log(`   规则: ${DEPENDENCY_RULES.length} 条`);

  if (allViolations.length === 0) {
    console.log('\n✅ 没有发现架构违规');
    process.exit(0);
  }

  // 按规则分组
  const byRule = {};
  for (const v of allViolations) {
    const key = v.reason;
    if (!byRule[key]) byRule[key] = [];
    byRule[key].push(v);
  }

  console.log(`\n⚠️  发现 ${allViolations.length} 个架构违规:\n`);

  for (const [reason, violations] of Object.entries(byRule)) {
    console.log(`  📋 ${reason}`);
    for (const v of violations) {
      console.log(`     ${v.file} → ${v.target}`);
    }
    console.log('');
  }

  if (strict) {
    console.log(`❌ 架构守卫阻断: ${allViolations.length} 个违规未解决`);
    process.exit(1);
  } else {
    console.log(`⚠️  (仅警告，不阻断。使用 --strict 启用阻断模式)`);
    process.exit(0);
  }
}

main();
