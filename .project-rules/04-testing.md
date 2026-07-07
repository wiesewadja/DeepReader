# 测试策略

## 四层测试架构

DeepReader 采用四层测试架构，按"能用轻量就别用全量"原则选择。

| 层级 | 工具 | 位置 | 命令 | 启动依赖 | 典型时长 |
|------|------|------|------|----------|----------|
| **L1: 单元测试** | Vitest | `tests/unit/` | `npm run test:run` | 无 | ~55s |
| **L2: 冒烟测试** | evalObsidian | `scripts/smoke/checks/` | `npm run smoke:core` | Obsidian 已运行 | ~10-30s |
| **L3: 轻量 E2E** | evalObsidian | `scripts/e2e-light/specs/` | `npm run e2e-light` | Obsidian 已运行 | ~90s |
| **L4: WebdriverIO** | WebdriverIO | `tests/e2e/specs/` | `npx wdio run tests/wdio.conf.ts` | 自动下载 Obsidian | ~5min |

### 决策树

- 改一行想看效果？→ 冒烟（`smoke:core`）
- 验关键用户流程（搜索/同步/导出）？→ 轻量 E2E
- 验多步交互、视觉、跨视图导航？→ WebdriverIO

## L1: 单元测试（Vitest）

```bash
# 监听模式
npm run test

# 单次运行（全量）
npm run test:run

# 分模块运行（推荐）
npx vitest run tests/unit/utils/           # 只跑 utils 模块
npx vitest run tests/unit/agent/           # 只跑 agent 模块
npx vitest run tests/unit/pageindex/       # 只跑 pageindex 模块
npx vitest run tests/unit/components/      # 只跑 components 模块

# 运行单个测试文件
npx vitest run tests/unit/utils/time.test.ts

# UI 界面
npm run test:ui
```

**分模块原则**：先 `git diff` 评估修改了哪些 `src/` 文件，映射到模块后只跑该模块的测试。全量测试仅在跨模块修改、合并前验证、或用户明确要求时执行。

- **配置**: `vitest.config.ts`
- **环境**: `jsdom`，`globals: true`
- **Setup**: `tests/setup.ts` — 在 `HTMLElement.prototype` 上挂载 Obsidian 的 DOM 扩展方法（`addClass`、`createEl`、`empty` 等）。
- **Mock**: `tests/__mocks__/obsidian.ts` 提供 `TFile`、`TFolder`、`App`、`Notice` 等 Mock。
- **路径别名**: `@` → `./src`，`@tests` → `./tests`，`obsidian` → `./tests/__mocks__/obsidian.ts`
- **测试文件位置**:
  - `src/**/__tests__/**/*.test.ts` — 与源码同目录的测试（Agent、PageIndex、Config、Components）。
  - `tests/unit/**/*.test.ts` — 单元测试。

## L2: 冒烟测试

基于轻量 E2E 框架的快速验证套件，确保核心功能未退化。

```bash
# core 11 场景（默认）
npm run smoke:core

# core + full 25 场景
npm run smoke:full

# 指定场景
node scripts/smoke/smoke.mjs --only S-22,S-23

# 跳过环境检查（不推荐）
node scripts/smoke/smoke.mjs --no-env-check
```

- **入口**: `scripts/smoke/smoke.mjs`
- **场景定义**: `scripts/smoke/checks/core/` 和 `scripts/smoke/checks/full/`
- **底层工具**: `scripts/smoke/lib/obsidian-cli.mjs` 的 `evalObsidian()` 函数
- **适用场景**: 部署后快速验证、CI 看门、问题排查
- **环境检查**: 运行前自动检查环境（除非使用 `--no-env-check`）
- **多 vault 支持**: 通过 `TARGET_VAULT` 环境变量指定目标 vault（默认 `test-vault`）
- **典型场景**:
  - S-LD: 插件加载与完整性检查
  - S-22: Sidebar 聊天界面
  - S-23: Library 书库
  - S-24: Quick Setup
  - S-25: Settings 面板

## L3: 轻量 E2E 测试

基于 `scripts/e2e-light/` 的轻量 E2E 框架，通过 `evalObsidian()` 对运行中的 Obsidian 实例执行 JavaScript，无需启动独立的 Obsidian 实例。

```bash
# 运行所有轻量 E2E 测试
npm run e2e-light

# 运行单个测试
node scripts/e2e-light/run.mjs --spec scripts/e2e-light/specs/<name>.spec.mjs
```

- **框架入口**: `scripts/e2e-light/run.mjs`
- **测试文件**: `scripts/e2e-light/specs/*.spec.mjs`
- **底层工具**: `scripts/smoke/lib/obsidian-cli.mjs` 的 `evalObsidian()` 函数
- **适用场景**: 索引质量验证、Agent 对话测试、微信读书集成、阅读模式分页等
- **优势**: 比完整 WebdriverIO E2E 快一个数量级，适合开发过程中快速验证
- **环境检查**: 运行前自动检查环境
- **多 vault 支持**: 通过 `TARGET_VAULT` 环境变量指定目标 vault（默认 `test-vault`）
- **典型测试**:
  - `langgraph-agent.spec.mjs` — Agent 三层对话
  - `pdf-parsing.spec.mjs` — PDF 解析质量
  - `epub-index-export.spec.mjs` — EPUB 索引导出
  - `book-search.spec.mjs` — 书籍搜索功能
  - `index-integrity.spec.mjs` — 索引完整性检查
  - `selection-quote.spec.mjs` — 文本选择引用卡片

## L4: WebdriverIO E2E 测试

仅用于需要真实 UI 交互的测试场景。

```bash
# 全量
npx wdio run tests/wdio.conf.ts

# 单个 spec
npx wdio run tests/wdio.conf.ts --spec tests/e2e/specs/<file>.e2e.ts
```

- **配置**: `tests/wdio.conf.ts`
- **测试文件**: `tests/e2e/specs/**/*.e2e.ts`
- **Obsidian 选项**: 使用 `./test-vault` 作为 Vault，`./bin` 作为插件目录。
- **超时**: 10 分钟（LLM 摘要多章节耗时较长）。
- **缓存目录**: `.obsidian-cache/`（安装器、Obsidian 应用、版本信息）。
- **适用场景**:
  - 多步交互（点击 → 输入 → 等待 → 验证）
  - 视觉验证（截图对比）
  - 跨视图导航（侧栏 → 设置 → 阅读模式）
- **保留的测试**:
  - `langgraph-agent.e2e.ts` — Agent 对话核心流程
  - `early-stop.e2e.ts` — 早停机制验证
  - `langsmith-trace.e2e.ts` — LangSmith trace 验证

## 职责边界矩阵

| 测试场景 | L1 单元 | L2 冒烟 | L3 轻量 | L4 WebdriverIO |
|----------|---------|---------|---------|----------------|
| 函数逻辑 | ✅ | ❌ | ❌ | ❌ |
| 插件加载 | ❌ | ✅ | ✅ | ✅ |
| 命令注册 | ❌ | ✅ | ❌ | ❌ |
| PDF/EPUB 解析 | ✅ | ❌ | ✅ | ✅ |
| 索引质量 | ❌ | ❌ | ✅ | ✅ |
| Agent 对话 (API) | ❌ | ❌ | ✅ | ✅ |
| Agent 对话 (UI) | ❌ | ❌ | ❌ | ✅ |
| 多步交互流程 | ❌ | ❌ | ❌ | ✅ |
| 视觉/截图验证 | ❌ | ❌ | ❌ | ✅ |
| 跨视图导航 | ❌ | ❌ | ❌ | ✅ |

## 环境配置

### 一键配置

```bash
npm run setup:test-env      # 完整配置（自动修复）
npm run setup:test-env:check  # 仅检查
```

### 环境检查已集成到测试脚本

| 测试脚本 | 环境检查 | 跳过选项 |
|----------|----------|----------|
| `npm run smoke:core` | ✅ 自动检查 | `--no-env-check` |
| `npm run smoke:full` | ✅ 自动检查 | `--no-env-check` |
| `npm run e2e-light` | ✅ 自动检查 | 无 |

### 多 vault 支持

通过 `TARGET_VAULT` 环境变量指定目标 vault（默认 `test-vault`）：

```bash
# 使用默认 vault
npm run smoke:core

# 指定其他 vault
TARGET_VAULT=my-vault npm run smoke:core
```

## 重点覆盖

PageIndex API、Agent Tools、搜索质量。
