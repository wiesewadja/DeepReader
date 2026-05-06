---
name: agent-e2e-tester
description: 使用 WebdriverIO + wdio-obsidian-service 端到端测试 LangGraph Agent 的完整 AI 问答流程，包括闲聊、检视阅读、分析阅读（ReAct 循环）、多轮对话等。
---

# LangGraph Agent E2E 测试

验证 DeepReader LangGraph 认知引擎的完整 AI 问答流程。使用真实 LLM API 调用，在隔离的 Obsidian 实例中运行。

## 何时使用

当用户说以下内容时触发：
- "测试 Agent 问答"
- "运行 Agent E2E"
- "验证 AI 对话流程"
- "测试 LangGraph 引擎"
- "E2E 测试 agent"

## 测试架构

```
WDIO (Node.js)
  └── wdio-obsidian-service
        └── Obsidian (隔离 vault)
              └── DeepReader 插件
                    └── LangGraph 认知引擎
                          ├── S0 Router (fast model)
                          ├── S1 Inspectional (fast model)
                          ├── S2 Analytical (main model + ReAct)
                          └── S4 Formatter (main model)
```

## 执行步骤

### Step 1: 环境准备

检查 test-vault 是否包含测试数据：

```bash
ls test-vault/.pageindex/*/tree.json
ls test-vault/DeepReader/
```

如果数据不存在，从真实 vault 拷贝：

```bash
# 拷贝索引数据
cp -r /Users/lizhao/workspace/deepreadertest/.pageindex/{bookId} test-vault/.pageindex/

# 拷贝章节 Markdown 文件
mkdir -p "test-vault/DeepReader/{书名}"
cp -r "/Users/lizhao/workspace/deepreadertest/DeepReader/{书名}/"* "test-vault/DeepReader/{书名}/"
```

确保 `test-vault/.obsidian/plugins/deepreader/` 包含 `manifest.json` 和 `data.json`。

### Step 2: API Key 注入

API Key 必须在 Obsidian 启动**之前**写入 `data.json`。两种来源：

1. **环境变量** `LLM_API_KEY`（优先）
2. **真实 vault** 的 `data.json` 中的 `deepseekApiKey`（回退）

测试脚本在模块加载时自动执行注入（在 WDIO 启动 Obsidian 之前）。

### Step 3: 构建插件

```bash
npm run build
```

确认 `bin/main.js` 是最新的。

### Step 4: 运行测试

```bash
# 运行全部 Agent E2E 测试
npx wdio run wdio.conf.ts --spec tests/specs/langgraph-agent.e2e.ts

# 仅运行某个测试用例（用 grep 过滤）
npx wdio run wdio.conf.ts --spec tests/specs/langgraph-agent.e2e.ts --mochaOpts.grep "depth=0"
```

全局超时 10 分钟（`wdio.conf.ts` 的 `mochaOpts.timeout: 600000`）。

### Step 5: 解读结果

| 测试用例 | 预期 depth | 是否有工具调用 | 典型耗时 |
|----------|-----------|--------------|---------|
| depth=0 闲聊 | 0 | 无 | 5-15s |
| depth=1 检视阅读 | 1 | 无（仅 tree.json） | 15-45s |
| depth=2 分析阅读 | 2 | search_book + read_book_section | 30-120s |
| 多轮对话 | 变化 | 可能有 | 60-180s（两轮） |
| 跨书籍查询 | 变化 | 可能有 | 30-120s |

**常见失败原因：**
- `Missing credentials` → API Key 未注入，检查 data.json
- `Response timeout` → DeepSeek API 响应慢，重试
- `No messages` → sidebar 未正确选中书籍，检查 `selectIndex` 调用
- `Converting circular structure to JSON` → 用了 `getMessages()` 而非 `getMessagesData()`

### Step 6: 智能修复循环

测试失败时：

1. 读取终端输出中的错误堆栈
2. 定位失败点：
   - **凭证错误** → 检查 `createChatModels` 的 `apiKey` 参数（不是 `openAIApiKey`）
   - **流式累加错误** → 检查 sidebar `onContent` 回调用 `=` 还是 `+=`
   - **config 未传播** → 检查所有 LLM `.invoke()`/`.stream()` 调用是否传了 `config`
   - **UI 选择器错误** → 检查 CSS class 是否与源码一致
3. 修改源码 → 重新构建 → 重跑测试

## 测试数据

| 书籍 | bookId | 用途 |
|------|--------|------|
| 纳瓦尔宝典 | `74dca606` | 主测试书籍（depth=0/1/2, 多轮对话） |
| 金钱心理学 | `89e541bc` | 跨书籍验证 |

## 关键 API 与选择器

### WDIO 操作 API

```typescript
// 执行 Obsidian 命令
await browser.executeObsidianCommand('deepreader:open-deepreader-sidebar');

// 在 Obsidian 环境执行 JS（无法引用外部变量）
await browser.executeObsidian(({ app }, arg1: string) => {
  // 这里的代码在 Obsidian 浏览器环境中执行
  return result;
}, arg1Value);

// 获取浏览器控制台日志
const logs = await browser.getLogs('browser');
```

### CSS 选择器

| 元素 | 选择器 |
|------|--------|
| 聊天输入框 | `textarea.deeppdf-chat-input-textarea` |
| 发送按钮 | `button.deeppdf-chat-input-send-btn` |
| Sidebar 标识 | `.deeppdf-topbar-action-btn` |
| 流式状态 class | `deeppdf-chat-input-streaming` |

### 内部 API

| 方法 | 用途 |
|------|------|
| `view.selectIndex(bookId)` | 选择书籍索引 |
| `view.messageList.getMessagesData()` | 获取消息（纯数据，无循环引用） |
| `view.messageList.clearMessages()` | 清空聊天历史 |
| `view.isAiStreaming` | 检查是否正在流式输出 |
| `plugin.settings.deepseekApiKey` | 读取 API Key |
| `plugin.resetFrontendAgent()` | 重置 Agent 实例 |

### `this.timeout()` 注意事项

在 Mocha + WDIO 环境中，**必须用 `function()` 声明 `it()`/`before()` 回调**，不能用箭头函数。箭头函数不绑定 `this`，导致 `this.timeout()` 报错。

```typescript
// 正确
it('test', async function () { ... });

// 错误 — this.timeout is not a function
it('test', async () => { ... });
```

## LangSmith 追踪集成

E2E 测试集成了 LangSmith 追踪，可以从 LangSmith REST API 获取 Agent 的执行过程并做出评判。

### 配置注入

API Key 自动从真实 vault 的 `data.json` 读取，或从环境变量 `LANGSMITH_API_KEY` 注入。测试启动时会将以下配置写入 `test-vault/data.json`：

- `langsmithApiKey`: LangSmith API Key
- `langsmithProject`: 项目名（默认 `DeepReader`）
- `langsmithEnabled: true`

### Trace 获取与分析

每个测试用例结束后，调用 `getTraceAnalysis()` 从 LangSmith REST API 获取最近的 runs：

```
GET https://api.smith.langchain.com/api/v1/runs
  ?session_name={project}
  &start_time_gte={since}
  &order_by=-start_time
  &limit=50
Headers: x-api-key: {apiKey}
```

返回的 `TraceAnalysis` 包含：

| 字段 | 说明 |
|------|------|
| `totalRuns` | 总 run 数量 |
| `runTypes` | 各类型计数（chain/llm/tool） |
| `nodeNames` | LangGraph 节点列表 |
| `toolCalls` | 工具调用名称列表 |
| `executionTimeMs` | 根 chain 执行耗时 |
| `hasRouter/S1/S2/S4` | 布尔值，标识各阶段是否执行 |
| `errors` | 错误列表 |

### 各测试用例的 Trace 断言

| 测试用例 | 预期 LangGraph 路径 | 预期工具调用 |
|----------|-------------------|------------|
| depth=0 闲聊 | Router + Formatter | 无 |
| depth=1 检视阅读 | Router + Inspectional + Formatter | 无 |
| depth=2 分析阅读 | Router + Inspectional + Analytical + Formatter | search_book, read_book_section |
| 多轮对话 | 至少 2 次 chain 执行 | 可能有 |
| 跨书籍查询 | 完整路径 | 可能有 |

## 注意事项

1. **API Key 安全**: 不要在代码或 git 中硬编码 API Key。通过环境变量或真实 vault 读取。
2. **WDIO 隔离**: `wdio-obsidian-service` 会把 test-vault 拷贝到临时目录运行，不会修改原始 test-vault。
3. **参数传递**: `browser.executeObsidian` 的回调在浏览器环境执行，无法引用 Node.js 变量。通过第二个参数传递。
4. **循环引用**: `getMessages()` 返回的 Message 对象包含 DOM 引用，不能序列化。必须用 `getMessagesData()` 获取纯数据。
5. **API 波动**: DeepSeek API 响应时间不稳定，depth=2 测试可能偶尔超时。重跑通常能通过。
