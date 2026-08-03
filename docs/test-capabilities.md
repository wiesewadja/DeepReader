# DeepReader 测试能力梳理

## 一、测试架构概览

DeepReader 采用**四层测试架构**，按"能用轻量就别用全量"原则选择。

| 层级 | 工具 | 位置 | 命令 | 启动依赖 | 典型时长 | 使用频率 |
|------|------|------|------|----------|----------|----------|
| **L1: 单元测试** | Vitest | `tests/unit/` | `npm run test:run` | 无 | ~55s | 高 |
| **L2: 冒烟测试** | evalObsidian | `scripts/smoke/checks/` | `npm run smoke:core` | Obsidian 已运行 | ~10-30s | 高 |
| **L3: 轻量 E2E** | evalObsidian | `scripts/e2e-light/specs/` | `npm run e2e-light` | Obsidian 已运行 | ~90s | 高 |
| **L4: WebdriverIO** | WebdriverIO | `tests/e2e/specs/` | `npx wdio run tests/wdio.conf.ts` | 自动下载 Obsidian | ~5min | 低（仅特殊场景）|

## 二、测试覆盖统计

### 2.1 单元测试 (L1)
- **测试文件数量**: 182 个
- **测试用例数量**: 2060 个 (1956 通过, 101 跳过, 3 todo)
- **运行时长**: ~55-83s
- **覆盖模块**:

| 模块 | 测试文件数 | 覆盖子模块 |
|------|-----------|-----------|
| **agent** | 62 | graph (10), prompts (7), router (3), tools (9), utils (4), models (1), 其他 |
| **pageindex** | 27 | core (1), parsers (6), 搜索/索引相关 (20) |
| **services** | 11 | tts (3), highlight, profile, voice, mineru-api 等 |
| **views** | 9 | sidebar (7), library, sidebar-view |
| **weread** | 14 | client, matcher, diff, shelf, template-engine 等 |
| **styles** | 6 | design-tokens, responsive, focus-visible 等 |
| **其他** | 53 | config, utils, components, asr, settings, zlibrary |

### 2.2 冒烟测试 (L2)
- **测试场景数量**: 27 个 (core 11, full 16)
- **核心场景 (core)**:
  - S-LD: 插件加载与完整性检查
  - S-22: Sidebar 聊天界面
  - S-23: Library 书库
  - S-24: Quick Setup
  - S-25: Settings 面板
  - S-17: 阅读模式入口
  - S-CMD: 关键命令注册
  - S-RES: 资源文件完整
  - S-SEC: 安全模块完整性
  - S-PROMPT: Prompt 注册完整性
  - S-RP-ANTI: 阅读进度反例

### 2.3 轻量 E2E (L3)
- **测试规格数量**: 30 个
- **覆盖功能**:
  - **Agent 对话**: langgraph-agent, agent-multiturn-ai-econ, eval-agent, followup-coherence
  - **搜索/索引**: book-search, index-integrity, index-trace, l2-vectorization
  - **PDF/EPUB**: pdf-parsing, pdf-index-export, epub-parsing-quality, epub-index-export, epub-full-pipeline
  - **微信读书**: weread-sync, weread-ui, weread-api-debug
  - **阅读模式**: reading-mode-pagination, last-page-resume, selection-quote, selection-toolbar-delegation
  - **语音**: push-to-talk, voice-persistence
  - **安全**: security-sanitizer, write-note-security, arch-guard-rules
  - **其他**: archive-toggle, excalidraw-visual, pi-detection, scope-nodefilemap, summary-description

### 2.4 WebdriverIO (L4)
- **测试规格数量**: 4 个
- **保留测试**:
  - langgraph-agent.e2e.ts — Agent 对话核心流程
  - early-stop.e2e.ts — 早停机制验证
  - langsmith-trace.e2e.ts — LangSmith trace 验证
  - excalidraw-visual.e2e.ts — 可视化测试

## 三、测试工具 API

### 3.1 evalObsidian
在 Obsidian Electron 环境中执行 JS 并返回结果。

```javascript
import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

// 基础用法
const result = await evalObsidian(`
  (() => {
    const plugin = app.plugins.plugins['deepreader-dev'];
    return { loaded: !!plugin, version: plugin?.manifest?.version };
  })()
`);

// 指定 vault（支持多 vault 场景）
const result = await evalObsidian('app.vault.getName()', { vault: 'test-vault' });
```

**参数说明**：
- `expression`: JS 表达式（支持返回 Promise，会自动 await）
- `options.timeout`: 超时时间（默认 30000ms）
- `options.vault`: 目标 vault 名称（默认使用 `TARGET_VAULT` 环境变量或 `test-vault`）

### 3.2 DOM 操作 API
```javascript
import { 
  count, getText, exists, 
  waitForSelector, waitForSelectorGone,
  click, type, screenshot 
} from '../../smoke/lib/obsidian-cli.mjs';

// 统计元素数量
const count = await count('.deeppdf-chat-container');

// 获取文本内容
const text = await getText('.deeppdf-page-num');

// 检查元素是否存在
const exists = await exists('.deeppdf-settings-card');

// 等待元素出现
await waitForSelector('.deeppdf-message-assistant', 10_000);

// 等待元素消失
await waitForSelectorGone('.deeppdf-message-streaming', 60_000);

// 点击元素
await click('.deeppdf-chat-input-send-btn');

// 输入文字
await type('textarea.deeppdf-chat-input-textarea', '你好');

// 截图
await screenshot('./test-vault/screenshot.png');
```

### 3.3 createClient
创建 UX 测试客户端（与 cdp-client 兼容）。

```javascript
import { createClient } from '../../smoke/lib/obsidian-cli.mjs';

const client = createClient();
await client.waitForSelector('.deeppdf-chat-container', 5000);
const count = await client.count('.deeppdf-message-user');
await client.click('.deeppdf-chat-input-send-btn');
```

## 四、测试策略

### 4.1 5 类标准策略

| 任务类型 | 策略 | 推荐层级组合 |
|---------|------|------------|
| **新功能**（垂直切片）| A | 单元 → 冒烟 → 轻量 E2E → WebdriverIO |
| **Bugfix**（Prove-It）| B | 单元 + 冒烟 + 轻量 E2E |
| **重构** | C | 单元 + 冒烟 |
| **性能 / N+1** | D | 单元（含 bench）+ 轻量 E2E 时序 |
| **集成**（WeRead / LLM）| E | 单元 + 标记 requires 的轻量 E2E |

### 4.2 风险评估矩阵

| 风险等级 | 触发条件 | 推荐覆盖 |
|---------|---------|---------|
| **极高** | 核心用户流程（搜索/同步/导出/Agent）| 4 层全跑 |
| **高** | 重构区、Bug 高发区、LangGraph 节点 | 单元（高覆盖）+ 冒烟 + 轻量 E2E |
| **中** | 边缘 UI、配置、新命令 | 单元 + 冒烟 |
| **低** | 工具函数、类型、常量 | 单元 |

### 4.3 决策树

```
改一行想看效果？
  → 冒烟（smoke:core，~10s）

验证插件状态/索引数据（纯数据，无 UI）？
  → 轻量 E2E（e2e-light，~90s）

验证关键用户流程（搜索/同步/导出）？
  → 轻量 E2E（e2e-light，~90s）

验证函数逻辑/组件行为？
  → 单元测试（test:run，~55s）

需要隔离测试环境（CI）？
  → WebdriverIO（wdio，~5min）— 仅在特殊场景使用

需要多步交互、视觉、跨视图导航？
  → 轻量 E2E（e2e-light，~90s）— 优先选择
  → WebdriverIO（wdio，~5min）— 仅当轻量 E2E 无法覆盖时
```

## 五、职责边界矩阵

| 测试场景 | L1 单元 | L2 冒烟 | L3 轻量 | L4 WebdriverIO |
|----------|---------|---------|---------|---------------|
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

## 六、关键约束

### ❌ 禁止事项
- 不用浏览器 MCP / Playwright — 用 `evalObsidian` 或 CDP 注入 JS
- 测试不依赖外部 API — mock LLM、mock WeRead 凭证
- 不用 `console.log` — 用 `utils/logger.ts`
- 不硬编码 vault 路径 — 通过 Vault API（`app.vault.*`）
- 不硬编码 PLUGIN_ID — 从 `tests/lib/constants.mjs` 导入

### ✅ 推荐实践
- 每个测试一个概念 — `describe/it` 组织，中文描述
- Bugfix 先写复现测试（Prove-It 模式）— 失败的测试先于修复
- 真实断言 > 降级通过
- 测试必须分模块执行

## 七、环境配置

### 7.1 一键配置（推荐）

```bash
# 完整配置（自动修复所有问题）
npm run setup:test-env

# 仅检查（不修复，报告问题）
npm run setup:test-env:check
```

### 7.2 环境检查已集成到测试脚本

| 测试脚本 | 环境检查 | 跳过选项 |
|----------|----------|----------|
| `npm run smoke:core` | ✅ 自动检查 | `--no-env-check` |
| `npm run smoke:full` | ✅ 自动检查 | `--no-env-check` |
| `npm run e2e-light` | ✅ 自动检查 | 无 |

**运行测试时会自动检查环境**，如果环境不就绪会提示：
- 错误原因
- 修复建议（运行 `npm run setup:test-env`）

### 7.3 多 vault 支持

**问题**：当 Obsidian 同时运行多个 vault 时，CLI 会默认连接最近打开的 vault，导致测试无法连接到 test-vault。

**解决方案**：Obsidian CLI 现在会指定 `vault=test-vault` 参数，确保即使有多个实例也能正确连接。

**配置**：通过 `TARGET_VAULT` 环境变量可以指定目标 vault（默认 `test-vault`）。

```bash
# 使用默认 vault
npm run smoke:core

# 指定其他 vault
TARGET_VAULT=my-vault npm run smoke:core
```

### 7.4 环境依赖

| 依赖项 | 冒烟测试 | 轻量 E2E | 检查方式 |
|--------|----------|----------|----------|
| Obsidian 已运行 | ✅ 必需 | ✅ 必需 | `pgrep -x "Obsidian"` |
| 插件已加载 | ✅ 必需 | ✅ 必需 | `evalObsidian()` |
| 索引文件完整 | ❌ 不检查 | ✅ 必需 | `evalObsidian()` |
| API Key 已配置 | ❌ 不检查 | ✅ 必需 | `evalObsidian()` |

### 7.5 自动修复

| 问题 | 修复方式 |
|------|----------|
| 目录不存在 | `mkdir -p` 创建 |
| 插件未启用 | 修改 `community-plugins.json` |
| Obsidian 未运行 | `open -a Obsidian.app` 启动 |
| Obsidian 连接失败 | 等待启动完成 |
| 插件未加载 | 重启插件 |
| 索引文件缺失 | 触发重新索引 |
| API Key 未配置 | 从环境变量读取并配置 |

## 八、测试命令快速参考

```bash
# 环境配置
npm run setup:test-env              # 一键配置测试环境
npm run setup:test-env:check        # 仅检查环境状态

# 单元测试
npm run test:run                    # 运行所有单元测试
npx vitest run tests/unit/agent/    # 运行特定模块

# 冒烟测试
npm run smoke:core                  # 核心场景 (11 个)
npm run smoke:full                  # 完整场景 (27 个)
node scripts/smoke/smoke.mjs --only S-22,S-23  # 指定场景

# 轻量 E2E
npm run e2e-light                   # 运行所有轻量 E2E
node scripts/e2e-light/run.mjs --spec scripts/e2e-light/specs/<name>.spec.mjs  # 运行单个测试

# WebdriverIO
npx wdio run tests/wdio.conf.ts     # 运行所有 WebdriverIO 测试
npx wdio run tests/wdio.conf.ts --spec tests/e2e/specs/<file>.e2e.ts  # 运行单个测试

# 部署验证
npm run deploy                      # 部署到 test-vault
npm run verify-deploy               # 验证部署
```

## 九、调度流

1. 改完代码 → `npm run test:run`（快速验证）
2. 需要验证运行时行为 → `npm run smoke:core`（冒烟测试）
3. 验证完整流程 → `npm run e2e-light`（轻量 E2E）
4. 验证多步 UI 交互 → `npx wdio run tests/wdio.conf.ts`（WebdriverIO）

## 十、相关 Skills

| Skill | 何时用 |
|-------|--------|
| `obsidian-quick-test` | 运行时验证：快速 check（30 秒）+ TDD 循环 |
| `obsidian-e2e-tester` | 选 E2E 层（冒烟 / 轻量 / 全量三层决策）|
| `obsidian-advanced-agent` | 深度调试（状态探针、DOM 断言、命令模拟）|
| `deepreader-eval-gen` | 生成奚童对话质量评估 spec |
| `langsmith-tracer` | LangSmith trace 分析 |
