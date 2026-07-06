# 移动端兼容

移动端（Capacitor Obsidian，iOS/Android）无完整 Node.js polyfill，开发时极易引入"桌面正常、移动端加载即崩"的问题。本规则定义约束、正确做法与护栏。

## 硬约束

移动端运行时相对桌面端的缺失：

1. **不识别 `node:` 前缀**（polyfill 只匹配裸名 `fs` / `path` 等）
2. **`fs/promises` 子路径不保证可用**
3. **完全没有 `child_process`**
4. **第零条（最致命）**：任何模块**顶层**对 Node 核心模块的静态 `import` / `require`，会在 `main.js` 加载阶段执行 → 插件加载即崩（不是某功能失效，是整个插件起不来）

> 关键推论：约束 1–3 是"调用时才崩"，第零条是"加载即崩"。**第零条是改造的真正目标**——只要顶层不出现 Node 模块引用，加载就能过；运行时调用靠"移动端不会走到那条代码路径"（双轨：桌面用 Node，移动用 Vault adapter）规避。

## 第三方库陷阱

某些 npm 包（如 **`adm-zip`**）在自身模块顶层 `require("fs")` / `require("path")`。业务代码若静态 `import` 它，esbuild 会把它打进 main bundle，加载阶段执行其顶层 require → 移动端加载即崩。

这类库**不能静态 import**，必须懒加载。

## 正确做法

### 唯一门面：`src/utils/node-compat.ts`

业务代码访问 Node 模块 / 危险第三方库，**统一走门面的惰性工厂**：

```ts
import { nodeAdmZip } from "../../utils/node-compat.js";
import type { AdmZip } from "../../utils/node-compat.js";  // 类型标注

const zip = new (nodeAdmZip()(input);   // 首次调用才 require，加载阶段不触发
```

新增需要懒加载的模块（fs sync 版、path、crypto、os、child_process、其它危险第三方库）请**加到 `node-compat.ts`**，不要在业务文件里再贴 `getX() { return require(...) }` 样板。

> 现有 `src/utils/node-fs.ts` 提供 `nodeFs()`（fs/promises 懒加载），与 `node-compat.ts` 同属兼容层。后续 55 处 `getPath()` / `getFs()` 散落样板会逐步迁入门面。

### 动态加载模块（例外）

通过 dynamic import / esbuild external 在运行时按需加载的模块（如 `pageindex/unified.ts`、`pageindex/vault/compiler*.ts`），**不在 main.js 加载阶段执行**，其顶层 `import fs` 不会触发加载崩。这些模块在 `eslint.config.mjs` 的 overrides 里豁免。**新增文件不要加进豁免列表**——默认禁止静态 import Node 模块。

## 护栏（双重防护）

### 1. ESLint（写代码时即拦）

`@typescript-eslint/no-restricted-imports`（error）禁止业务代码静态 `import`：
- Node 核心模块：`fs` / `path` / `crypto` / `os` / `child_process` / `fs/promises`（含 `node:` 前缀）
- 危险第三方库：`adm-zip`

`allowTypeImports: true`：type-only import（`import type X`）不引入运行时依赖，放行。

### 2. 加载冒烟（build 期兜底）

```bash
npm run check:mobile-load      # 独立跑
npm run build:bundle           # 已自动串入
```

`scripts/mobile-load-check.cjs` 拦截 Node 核心模块 require，加载 `bin/main.js`：加载阶段触发被拦截的 require 即 exit 1。能 catch ESLint 漏网的场景（如新引入的第三方库顶层 require）。

> 这一层是最终判据——它基于真实 bundle，把"移动端真机才发现"变成"`npm run build` 就发现"。

## 检查清单（改 pageindex / tts / agent / 服务层时自查）

- [ ] 我是否**静态 `import`** 了 Node 核心模块或 `adm-zip`？→ 改走 `node-compat.ts`
- [ ] 我新引入的第三方库是否在顶层 `require` Node 模块？→ 查库源码，必要时懒加载
- [ ] 改完 `npm run build:bundle` 是否通过加载冒烟？
