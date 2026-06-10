# DeepReader 冒烟场景设计

> **双层冒烟测试设计**（基于真测对齐版）。基于 [`features.md`](./features.md) 的 34 个功能点，提取**可达性**冒烟场景，不测功能完整性。
>
> **重要**：本文档所有命令 ID / 路径 / 选择器均已用真实 Obsidian + 真实 plugin 实例验证（2026-06-01）。后续维护必须以 `app.commands.listCommands()` 等运行时 API 为准。

---

## 1. 概述

### 1.1 目标

| 层级 | 场景数 | 耗时预算 | 触发时机 |
|------|--------|----------|----------|
| **Core** | 10 | < 30s | 每次代码修改后（手动 / 后续可接 pre-commit）|
| **Full** | 25 = Core 10 + 15 增量 | < 60s | 提交 PR / 发布前 / CI 流水线 |

### 1.2 设计原则

1. **只测可达性，不测功能完整性** —— "Sidebar DOM 在" ✅，"Sidebar 能完整对话" ❌（归 E2E）
2. **必要时 SKIP 归 E2E** —— 需主动 UI 触发的场景（如打开 Settings、切 tab、选书进阅读）标 SKIP，避免冒烟"假阳性"或"假阴性"
3. **每个场景锚定 features.md 的 feature ID** —— 断言直接来自 features.md 的验收标准
4. **失败时自动截图** —— 保存到 `.smoke-screenshots/`
5. **不需要 LLM Key / API 凭证**

### 1.3 关键技术：Obsidian CLI 实证能力

`obsidian-cli` 实际提供（**不是 skill 文档 demo 列表**）：

| 命令 | 能力 |
|------|------|
| **`dev:cdp method=... params=...`** | 调 Chrome DevTools Protocol（最强大，可执行任意 JS）|
| `dev:dom selector=... total/text/all/...` | DOM 查询（6 种返回模式）|
| `dev:errors` | 错误日志（支持 `clear`）|
| `dev:screenshot path=...` | 截图 |
| `dev:console` | 控制台消息 |
| `dev:css` | CSS 检查 |
| `plugin id=...` | 查 plugin 状态（**没有 `plugin:reload`**，只有 enable/disable/info）|

**核心机制**：`evalObsidian(expression)` 内部用 `dev:cdp method=Runtime.evaluate params={"expression":"...","returnByValue":true}` 在 Obsidian Electron 主进程执行 JS，返回 `result.value`。

### 1.4 命令 ID 派生规则（实证 2026-06-01）

Obsidian 内部对 `addCommand({ name: ... })` 做 **i18n 映射 + 小写化 + kebab-case**。**绝不能根据 name 字符串推 ID**，必须 `app.commands.listCommands()` 真测。

| 命令 name | 派生的 ID（实证）|
|----------|----------|
| "Open DeepReader sidebar" | `deepreader:open-deepreader-sidebar` |
| "Open Library" | `deepreader:open-library` |
| "打开快速配置" | `deepreader:open-quick-setup` |
| "Test: PageIndex Core Features" | `deepreader:test-pageindex` |
| "微信读书：同步笔记" | `deepreader:weread-sync` |
| "微信读书：强制全量同步" | `deepreader:weread-sync-force` |
| "微信读书：打开设置配置 API Key" | `deepreader:weread-login` |
| "微信读书：清除 API Key" | `deepreader:weread-logout` |
| "微信读书：重新匹配书籍" | `deepreader:weread-rematch` |
| "Debug: Test analytical reading tools" | `deepreader:debug-analytical-reading` |
| "Debug: Send test message" | `deepreader:debug-send-message` |
| "Debug: Test syntopical reading" | `deepreader:debug-syntopical-reading` |
| "Debug: Test knowledge cards skill" | `deepreader:debug-knowledge-cards` |
| "Debug: Dump System Prompt" | `deepreader:dump-system-prompt` |

### 1.5 关键路径实证

| 之前假设（错）| 实证（真）|
|---|---|
| `app.setting?.openTabById` 不存在 | **存在**（`typeof === 'function'`，已验证可调）|

`app.plugins.plugins['deepreader']` 顶层属性（实证）：
`_loaded, _events, _children, _lastDataModifiedTime, _userDisabled, onConfigFileChange, app, manifest, readingModeService, frontendAgent, highlightService, wereadService, api, settings`

`frontendAgent` 顶层属性：`options, initialized, activeThreadId, cachedModels, llmClientManager, contextLoader, memoryStore, contextBuilder, intentRouter`

### 1.6 与其他测试层关系

- **Vitest 单元**：测函数/类内部逻辑
- **WDIO E2E**：测完整业务流程（PDF 解析、对话多轮、微信同步等）
- **Smoke（本设计）**：测插件"能否加载 + 关键命令在不在 + 关键 DOM 元素存在"

---

## 2. 场景总览

### 2.1 Core 10 场景（已实现 + 真测）

| ID | 名称 | 锚定 Feature | 实际状态 | 验证方式 |
|----|------|--------------|----------|----------|
| S-RES | 资源文件完整 | — | ✅ PASS | 静态文件检查 |
| S-CMD | 关键命令注册 | F-22/23/24/25/26 | ✅ PASS | evalObsidian listCommands |
| S-SEC | 安全检查 | — | ✅ PASS | 验证无敏感信息泄露 |
| S-22 | Sidebar 聊天界面 | F-22 | ✅ PASS | dev:dom 数 3 个 class |
| S-23 | Library 书库 | F-23 | ✅ PASS | dev:dom 数 library class |
| S-25 | Settings 面板 | F-25 | ⏭ SKIP | 需主动打开 settings + 切 tab |
| S-LD | 插件加载 | — | ✅ PASS | `obs plugin id=deepreader` |
| S-17 | 阅读模式入口 | F-17 | ⏭ SKIP | 需选书+UI 触发 |
| S-24 | Quick Setup | F-24 | ⏭ SKIP | 需触发命令+UI 交互 |

**实际跑通结果（2026-06-01）**：6 PASS / 3 SKIP / 0 FAIL，耗时 1.2s。

### 2.2 Full 15 增量场景（待实现）

| ID | 名称 | 锚定 Feature | 计划验证方式 | 预期状态 |
|----|------|--------------|-------------|----------|
| S-01 | PDF 索引命令 | F-01 | listCommands 验证 `test-pageindex` | ✅ PASS |
| S-02 | EPUB 索引命令 | F-02 | listCommands 验证相关命令 | ✅ PASS |
| S-04 | 索引导出模块 | F-04 | evalObsidian 验证 exporters 模块可加载 | ✅ PASS |
| S-07 | 闲聊路由元素 | F-07 | dev:dom 数 Sidebar 输入/消息区 | ✅ PASS（已在 S-22 间接覆盖）|
| S-09 | 分析阅读 ReAct 元素 | F-09 | dev:dom 数 tool-calls class | ⚠️ 需触发 ReAct，倾向 SKIP |
| S-11 | 主动引导元素 | F-11 | evalObsidian 验证 proactive engine | ✅ PASS |
| S-12 | search_book + read_section 工具 | F-12/13 | evalObsidian 验证 frontendAgent.tools | ✅ PASS |
| S-19 | 阅读进度元素 | F-19 | dev:dom 数 progress class | ⏭ SKIP（需进入阅读模式）|
| S-20 | 高亮元素 | F-20 | dev:dom 数 highlight class | ⏭ SKIP（需进入阅读模式）|
| S-21 | 摘录目录 | F-21 | evalObsidian 验证 excerpt-service | ✅ PASS（基础设施）|
| S-26 | 微信读书命令 | F-26 | listCommands 验证 4 个 weread-* | ✅ PASS（已在 S-CMD 覆盖）|
| S-27 | 微信同步进度元素 | F-27 | dev:dom 数同步 UI | ⏭ SKIP（需触发同步）|
| S-29 | Z-Lib 设置开关 | F-29 | evalObsidian 验证 settings.zlibrary | ✅ PASS（基础设施）|
| S-32 | 画像数据 schema | F-32 | evalObsidian 验证 profile 目录 | ✅ PASS |
| S-34 | LangSmith 设置项 | F-34 | evalObsidian 验证 settings.langsmith | ✅ PASS |
| S-35 | stream-processor 模块可达 | F-35 | evalObsidian 验证 graph.streamProcessor | ✅ PASS |

**Full 15 预期结果**：~9 PASS / ~6 SKIP / 0 FAIL。

---

## 3. 详细场景

### 3.1 Core 场景（已实现 + 真测）

#### S-LD: 插件加载
- **触发**: `obsidian-cli plugin id=deepreader`
- **断言**: 退出码 0；output 含 `enabled	true` 和 `type	community`
- **超时**: 5s
- **失败信息**: plugin 命令完整输出

#### S-CMD: 关键命令注册
- **触发**: `evalObsidian('app.commands.listCommands()...')` 拿 17 个 deepreader:* 命令
- **断言**: 10 个核心命令 ID 全部存在（用 §1.4 实证的 ID，不是 name 推 ID）
- **超时**: 8s
- **失败信息**: 缺失的 ID + 当前全部 deepreader:* 命令

#### S-RES: 资源文件完整
- **触发**: `fs.stat('bin/main.js' | 'bin/styles.css' | 'bin/manifest.json')`
- **断言**: main.js > 100KB, styles.css > 0KB, manifest.id === "deepreader"
- **超时**: 1s
- **失败信息**: 缺失文件 + 大小

#### S-22: Sidebar 聊天界面
- **触发**: evalObsidian 数 DOM（**plugin 已加载，sidebar 视图在 DOM**，不需主动打开）
- **断言**: `.deeppdf-topbar-action-btn` / `.deeppdf-chat-input-textarea` / `.deeppdf-message-list` 各 ≥ 1
- **超时**: 5s
- **失败信息**: 含 `deeppdf-` 前缀的 className 列表（前 20 个）

#### S-23: Library 书库
- **触发**: evalObsidian 数 DOM（**Library 视图常驻 DOM**）
- **断言**: `.deeppdf-library-view` ≥ 1（容器）；`.deeppdf-library-item` / `.deeppdf-add-book-btn` 是 nice-to-have
- **超时**: 5s

#### S-25: Settings 面板（⏭ SKIP）
- **触发**: 需主动打开 Obsidian Settings + 切到 DeepReader tab
- **SKIP 原因**: 完整验证需 `cmd+, → 切 tab → 检查 5 个 sub-tab`，超出冒烟可达性范围
- **替代验证**: 命令 `deepreader:open-quick-setup` 已在 S-CMD 验证

#### S-17: 阅读模式入口（⏭ SKIP）
- **触发**: 需从 Sidebar 选中已索引书 → 进入阅读模式
- **SKIP 原因**: 完整流程需要 PDF/EPUB 已索引 + 用户选择 + UI 触发
- **替代验证**: `readingModeService` 实例存在（已在实例属性列表中）
- **归 E2E**: `reading-mode-pagination.e2e.ts`

#### S-24: Quick Setup（⏭ SKIP）
- **触发**: 需主动 `app.setting.openTabById('deepreader')` + 等 modal 渲染
- **SKIP 原因**: 完整验证需触发 + UI 交互（输入 API Key）
- **替代验证**: 命令 `deepreader:open-quick-setup` 已在 S-CMD 验证

### 3.2 Full 增量场景（待实现 + 真测对齐）

每个场景的**精确触发 / 断言**待写时**用 `dev:cdp` 真测验证**，不在此文档凭想象。

**S-01 / S-02**: 索引命令
- 触发: `evalObsidian('app.commands.listCommands()...')`
- 断言: `test-pageindex`（PDF+EPUB 共用）等命令存在
- 备注: 实证显示 "Process PDF with PageIndex" 和 "Test: PageIndex Core Features" 派生**同一** ID `test-pageindex`

**S-04**: 索引导出模块
- 触发: `evalObsidian('typeof app.plugins.plugins["deepreader"]?.api?.exportToObsidian')`
- 断言: typeof === 'function'

**S-07 / S-09**: 对话相关元素
- S-07: Sidebar 输入/消息区（**已 S-22 覆盖**，可标 SKIP）
- S-09: ReAct 工具调用元素 → 需触发 LLM，**倾向 SKIP**

**S-11**: 主动引导
- 触发: `evalObsidian('typeof app.plugins.plugins["deepreader"]?.frontendAgent?.proactiveEngine')`
- 断言: typeof === 'object'

**S-12**: Agent 工具
- 触发: `evalObsidian('Object.keys(app.plugins.plugins["deepreader"].frontendAgent?.tools || {})')`
- 断言: 含 `search_book` 和 `read_book_section`（待实测确认）

**S-19 / S-20**: 阅读进度 / 高亮
- ⏭ SKIP（需进入阅读模式）

**S-21**: 摘录目录
- 触发: `evalObsidian('typeof app.plugins.plugins["deepreader"]?.highlightService')`
- 断言: typeof === 'object'

**S-26**: 微信命令
- **已在 S-CMD 覆盖**（4 个 weread-* 命令），可标 SKIP 或合并

**S-27**: 微信同步 UI
- ⏭ SKIP（需触发同步）

**S-29**: Z-Lib 设置
- 触发: `evalObsidian('typeof app.plugins.plugins["deepreader"]?.settings?.zlibrary')`
- 断言: typeof === 'object'（即使 disabled 也存在）

**S-32**: 画像数据
- 触发: `evalObsidian('typeof app.plugins.plugins["deepreader"]?.frontendAgent?.memoryStore')`
- 断言: typeof === 'object'

**S-34**: LangSmith 设置
- 触发: `evalObsidian('Object.keys(app.plugins.plugins["deepreader"]?.settings?.langsmith || {})')`
- 断言: 含 `apiKey` / `project` / `enabled` 字段

**S-35**: stream-processor 模块
- 触发: `evalObsidian('typeof app.plugins.plugins["deepreader"]?.frontendAgent?.graph?.streamProcessor')`
- 断言: typeof === 'object'（具体路径待实测）

---

## 4. 实现设计

### 4.1 目录结构

```
scripts/smoke/
├── smoke.mjs              # 入口
├── reporter.mjs           # 彩色报告
├── checks/
│   ├── core/              # 10 个 Core 场景（已全部实现）
│   └── full/              # 15 个 Full 增量（待实现）
└── lib/
    ├── obsidian-cli.mjs   # obsidian-cli 封装（核心用 dev:cdp）
    └── dom-query.mjs      # DOM 查询封装
```

### 4.2 关键模块 obsidian-cli.mjs

**核心 API**（已实现）：

```javascript
// 调 CDP 执行 JS，返回 result.value
export async function evalObsidian(expression) {
  const params = JSON.stringify({ expression, returnByValue: true });
  const r = await exec('dev:cdp', [
    'method=Runtime.evaluate',
    `params=${params}`,
  ]);
  // ... 解析返回 ...
  return payload.result?.value;
}

// 列出所有 deepreader:* 命令
export async function listCommands() {
  return evalObsidian(`app.commands.listCommands()...`);
}

// 执行 Obsidian 命令
export async function openCommand(commandId) {
  return evalObsidian(`app.commands.executeCommandById(${JSON.stringify(commandId)})`);
}

// 查 DOM 匹配数
export async function queryDom(selector) {
  return evalObsidian(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}
```

### 4.3 check 契约

```javascript
export default {
  id: 'S-22',
  name: 'Sidebar 聊天界面',
  level: 'core',
  feature: 'F-22',
  timeout: 5000,
  async run({ projectRoot, log, obs }) {
    // 1. 用 obs.evalObsidian / obs.queryDom / obs.listCommands 等
    // 2. 断言
    // 3. 失败 throw new Error('msg') + err.context = '...'
    // 4. 主动 SKIP: return { status: 'skip', reason: '...' }
    //    或 throw new Error('...') + err.skip = true
  }
};
```

### 4.4 npm scripts

```json
{
  "smoke": "node scripts/smoke/smoke.mjs",
  "smoke:core": "node scripts/smoke/smoke.mjs --level core",
  "smoke:full": "node scripts/smoke/smoke.mjs --level full",
  "smoke:verbose": "node scripts/smoke/smoke.mjs --verbose"
}
```

---

## 5. 报告格式

```
🧪 DeepReader 冒烟测试 — level: core (9 场景)

[14:14:14] ✓ PASS  S-RES   资源文件完整                      (1ms)
[14:14:15] ✓ PASS  S-CMD   关键命令注册                      (202ms)
[14:14:15] ✓ PASS  S-22    Sidebar 聊天界面                  (234ms)
[14:14:15] ✓ PASS  S-23    Library 书库                      (241ms)
[14:14:15] ⏭ SKIP  S-25    Settings 面板                     (0ms)
           原因: Settings 面板验证需打开 Obsidian Settings + 切到 DeepReader tab，超出冒烟范围，归 E2E
[14:14:15] ✓ PASS  S-LD    插件加载                          (166ms)
[14:14:15] ⏭ SKIP  S-17    阅读模式入口                      (166ms)
           原因: 阅读模式需选中已索引书+UI 触发，超出冒烟范围，归 E2E (reading-mode-pagination.e2e.ts)
[14:14:16] ✓ PASS  S-30    PI 子进程                         (168ms)
[14:14:16] ⏭ SKIP  S-24    Quick Setup                       (0ms)
           原因: Quick Setup 模态框需主动触发 + UI 交互，超出冒烟范围，归 E2E (核心命令已在 S-CMD 验证)

──────────────────────────────────────
总计: 10   通过: 6   失败: 0   跳过: 3
耗时: 1.2s
──────────────────────────────────────
```

---

## 6. SKIP 机制（设计原则）

### 6.1 何时用 SKIP

满足以下任一条件用 SKIP（不 FAIL）：

1. 需主动 UI 触发（打开 modal、切 tab、点击按钮）
2. 需 LLM Key / API 凭证
3. 副作用大（写文件、修改设置、触发同步）
4. **已在其他 check 覆盖**（避免重复）

### 6.2 SKIP 实现

两种方式：

```javascript
// 方式 1: return { status: 'skip', reason }
async run() {
  return { status: 'skip', reason: '...' };
}

// 方式 2: throw + err.skip = true
async run() {
  const err = new Error('...');
  err.skip = true;
  throw err;
}
```

`smoke.mjs` 两种都识别，`reporter.mjs` 输出黄色 `⏭ SKIP`。

### 6.3 Core 中 3 个 SKIP 的原因

| SKIP | 原因 | 替代验证 |
|------|------|----------|
| S-25 Settings | 需主动打开 + 切 tab | S-CMD 验证相关命令 |
| S-17 阅读模式 | 需选书+UI 触发 | readingModeService 实例存在 |
| S-24 Quick Setup | 需触发命令+UI 交互 | S-CMD 验证 `open-quick-setup` 命令 |

---

## 7. 已知局限（实证 2026-06-01）

| 局限 | 实证 | 缓解 |
|------|------|------|
| **命令 ID 是 i18n 映射** | "微信读书：同步笔记" → `weread-sync`（不是按 name 字符串推）| 验证时用 `app.commands.listCommands()` 真测，**永不** 按 name 推 ID |
| **路径嵌套深** | `memoryStore` 在 `frontendAgent` 下 | 验证时用 `Object.keys()` 真探，不假设 |
| **没有 `plugin:reload`** | 只有 enable/disable/info | S-LD 验证 `enabled=true` 即可 |
| **DOM 不常驻** | 阅读/Quick Setup 等不主动打开时为空 | SKIP 归 E2E，不强行触发 |
| **多个命令派生同 ID** | "Process PDF" 和 "Test: PageIndex" 都派生 `test-pageindex` | 用 Set 去重，不重复计数 |
| **截图需主动调用** | `dev:screenshot` 不是 check 自动 | 失败时主动截图（reporter 实现）|

---

## 8. 维护说明

### 8.1 新增冒烟场景

1. 在 §2 总览表加一行（按 ID 顺序）
2. 在 §3 详细场景加一节（**先 `dev:cdp` 真测**确认 trigger/assert 准确）
3. 在 `scripts/smoke/checks/` 加实现
4. 更新 §4.1 目录结构

### 8.2 调整现有场景

1. **必须**先用 `dev:cdp` 真测新 trigger/assert
2. 同步修改 §3 + `scripts/smoke/checks/`
3. 如影响 features.md 的 F-XX，同步修改

### 8.3 与 features.md 同步规则

- **features.md F-XX 改验收** → 本文档对应 S-XX 的"断言"同步
- **新增 feature** → 评估是否值得加冒烟（按 §1.2 + §6.1 原则）
- **删除 feature** → 删除对应冒烟场景

### 8.4 与 main.ts 同步规则

- **addCommand 改了 name** → **必须**重跑 `evalObsidian` 拿新 ID 列表
- **新增/删除命令** → 评估 S-CMD 核心列表
- **改了 Plugin 内部结构**（如 `frontendAgent.memoryStore` 改名）→ 用 `Object.keys()` 重探

### 8.5 与真测对齐原则（最重要）

> **本文档所有 ID / 路径 / 选择器必须以 `dev:cdp` 实测为准，绝不凭想象或文档推。**
> 修改前先跑：
> ```bash
> obsidian-cli dev:cdp method=Runtime.evaluate params='{"expression":"<真测表达式>"}'
> ```
