#!/usr/bin/env node
/**
 * 移动端加载冒烟护栏（mobile-load-check）
 *
 * 目的：catch "插件在移动端加载即崩" 类问题，避免只在真机/上架后才暴露。
 *
 * 原理：移动端 Capacitor Obsidian 无完整 Node polyfill。任何在 main.js 加载阶段
 *   （模块顶层求值）执行的 require("fs" / "path" / "crypto" / "os" / "child_process")
 *   都会导致插件加载即崩。本脚本在 Node 环境里拦截这些 require，然后加载 bin/main.js：
 *     - 加载阶段触发被拦截的 require  → 测试失败（exit 1）
 *     - 加载阶段未触发                → 通过（其它 stub 不全导致的错误忽略）
 *
 * 触发场景示例：
 *   - 业务代码 `import * as fs from "fs"`（顶层静态 import）
 *   - 第三方库（如 adm-zip）顶层 require("fs")，且被业务代码静态 import
 *
 * 用法：node scripts/mobile-load-check.cjs   （需先 npm run build:bundle 生成 bin/main.js）
 */
"use strict";

const Module = require("module");
const path = require("path");

const BLOCKED = new Set([
  "fs", "path", "crypto", "os", "child_process", "fs/promises",
  "node:fs", "node:path", "node:crypto", "node:os", "node:child_process", "node:fs/promises",
]);

// external 模块用空 stub（obsidian/electron/codemirror/lezer 等运行时由 Obsidian 提供）
const STUB = new Set([
  "obsidian", "electron",
  "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands",
  "@codemirror/language", "@codemirror/lint", "@codemirror/search",
  "@codemirror/state", "@codemirror/view",
  "@lezer/common", "@lezer/highlight", "@lezer/lr",
]);

const triggerStack = [];
const origRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  const bare = id.replace(/^node:/, "");
  const base = bare.split("/")[0];
  if (BLOCKED.has(bare) || BLOCKED.has(base)) {
    triggerStack.push(id);
    throw new Error(`[mobile-load-check] 加载阶段触发 Node 核心模块 require: ${id}`);
  }
  if (STUB.has(base)) {
    return { __esModule: true, default: function () {}, };
  }
  return origRequire.apply(this, arguments);
};

// 极简 window stub（bundle 顶部 banner 会访问 window.PDFJS）
globalThis.window = globalThis.window || {};
globalThis.window.PDFJS = globalThis.window.PDFJS || {};

const bundlePath = path.resolve(__dirname, "..", "bin", "main.js");

try {
  require(bundlePath);
  console.log("✅ mobile-load-check 通过：加载阶段未触发任何 Node 核心模块 require");
} catch (e) {
  if (triggerStack.length > 0) {
    console.error("❌ mobile-load-check 失败：加载阶段触发被拦截的 Node 模块");
    console.error("   触发链:", triggerStack.join(" → "));
    console.error("   修复方向：把对应静态 import 改成 utils/node-compat.ts 的惰性工厂，");
    console.error("            或函数内 require()，确保加载阶段不执行。");
    process.exit(1);
  }
  // 非 Node 模块错误（obsidian stub 不全等）不计入失败
  console.log("⚠️  加载阶段未触发 Node 模块 require（冒烟目标达成）；");
  console.log("   后续非 Node 错误（stub 不全，可忽略）:", e.message);
  console.log("✅ mobile-load-check 通过");
} finally {
  Module.prototype.require = origRequire;
}
