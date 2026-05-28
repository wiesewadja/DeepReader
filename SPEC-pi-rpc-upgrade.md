# SPEC: PI Agent RPC 协议升级

> **版本**: 2.0
> **日期**: 2026-05-28
> **状态**: 待确认
> **前置**: SPEC.md (v1.0) 已实现，E2E 测试验证了 spawn + PATH 修复

---

## 1. Objective

### 目标

将 PI 集成从当前的最小可用 RPC 子集升级到**双模式架构**，充分利用官方 RPC 协议的全部能力：
- **JSON 无状态模式**：用于 PI 检测、版本查询、环境验证（单次 spawn → 退出）
- **RPC 有状态模式**：用于实时 AI 交互、Skill 执行、进度流式推送（长驻进程 + JSONL）

### 问题背景

v1.0 实现暴露了三个关键问题：

1. **Electron 沙箱限制**：`exec`/`execSync` 使用 `/bin/sh` 在 Obsidian renderer 中被阻止 → 必须用 `spawn`
2. **macOS PATH 不完整**：从 Dock 启动的 Obsidian GUI 进程缺少 `/opt/homebrew/bin` → PI 作为 Node.js shebang 脚本找不到 `node`
3. **协议子集过小**：只实现了 `prompt`/`new_session`/`abort` 三个命令，缺少流式文本、Extension UI、自动重试等关键能力

### 核心价值

| 能力 | 当前 v1.0 | 升级后 v2.0 |
|------|----------|------------|
| PI 检测 | `execSync`（Electron 中失败） | `spawn` + PATH 增强（已验证） |
| 进度反馈 | 只显示 tool 名 | 流式文本 delta + tool 进度 |
| 错误恢复 | 无 | `set_auto_retry` 自动重试瞬态错误 |
| 用户交互 | 无 | Extension UI 协议（确认/选择/输入） |
| Token 报告 | 无 | `get_session_stats` 统计消耗和成本 |
| 上下文管理 | 无 | `compact` / `set_auto_compaction` |
| 运行时干预 | 无 | `steer` / `follow_up` 中途介入 |

### 成功标准

1. PI 检测在 Obsidian Electron renderer 中稳定工作（spawn + PATH 增强）
2. Skill 执行过程中，聊天界面实时显示 PI 的流式文本输出
3. PI 请求用户确认时（如覆盖文件），Obsidian 弹出确认对话框
4. 瞬态错误（529/限流）自动重试，用户看到重试进度
5. 每次 Skill 执行后显示 token 消耗和成本
6. 长对话自动 compact，不超出上下文窗口

---

## 2. Architecture

### 双模式架构

```
┌─────────────────────────────────────────────────┐
│                 Obsidian Plugin                  │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │  JSON 无状态模式  │  │   RPC 有状态模式      │ │
│  │                  │  │                      │ │
│  │  pi --version    │  │  pi --mode rpc       │ │
│  │  spawn → 退出    │  │  spawn → 长驻进程     │ │
│  │                  │  │                      │ │
│  │  用途：          │  │  用途：              │ │
│  │  · 安装检测      │  │  · Skill 执行        │ │
│  │  · 版本查询      │  │  · 流式文本          │ │
│  │  · 环境验证      │  │  · 用户交互          │ │
│  │  · 设置页状态    │  │  · 自动重试          │ │
│  └──────────────────┘  └──────────────────────┘ │
│          │                       │               │
│          └───── spawn ──────────┘                │
│                   + buildSpawnEnv()              │
└─────────────────────────────────────────────────┘
```

### 通信协议分层

```
┌────────────────────────────────────────┐
│  Layer 3: Extension UI Protocol        │  ← 新增
│  extension_ui_request/response         │
│  用户确认、选择、输入                   │
├────────────────────────────────────────┤
│  Layer 2: Event Stream                 │  ← 增强
│  message_update (流式 delta)           │  ← 新增
│  tool_execution_update (进度)          │  ← 新增
│  auto_retry_start/end                 │  ← 新增
│  compaction_start/end                 │  ← 新增
├────────────────────────────────────────┤
│  Layer 1: JSONL Command/Response       │  ← 增强
│  prompt, steer, follow_up             │  ← 新增 steer/follow_up
│  set_auto_retry, compact              │  ← 新增
│  get_session_stats, get_state         │  ← 新增
│  new_session, abort                   │  ← 已有
└────────────────────────────────────────┘
```

---

## 3. 涉及文件

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/agent/pi/pi-config.ts` | 重写检测逻辑（spawn 替换 execSync），新增 `buildSpawnEnv()`、`getCandidatePaths()`、缓存机制 |
| `src/agent/pi/pi-client.ts` | 大幅增强 RPC 客户端：新增命令方法、Extension UI 处理、流式事件分发 |
| `src/agent/pi/types.ts` | 新增命令类型、事件类型、Extension UI 类型、统计类型 |
| `src/agent/pi/pi-manager.ts` | 集成 auto_retry、compact、stats、Extension UI bridge |
| `src/agent/pi/pi-context.ts` | 微调（无结构性变更） |
| `src/agent/index.ts` | 处理 Extension UI 请求（弹出 Obsidian 确认框）、展示流式进度 |
| `src/config/settings.ts` | 确认 `customPiPath` 字段已存在 |
| `src/settings/sections/advanced-section.ts` | 确认 spawn 方案已到位 |

### 不变更

| 文件 | 原因 |
|------|------|
| `src/agent/router/` | 路由逻辑不变 |
| LangGraph 认知引擎 | 不修改核心图结构 |

---

## 4. 详细设计

### 4.1 JSON 无状态模式：PI 检测（`pi-config.ts`）

**当前问题**：`execSync('pi --version')` 在 Obsidian Electron renderer 中被阻止。

**修复方案**（已在 `fix/pi-agent-bugfix` 分支验证）：

```typescript
// 核心变更：
// 1. execSync → spawn（绕过 /bin/sh 限制）
// 2. buildSpawnEnv() 增强 PATH（解决 macOS GUI 进程找不到 node 的问题）
// 3. PI --version 输出到 stderr（需要合并 stdout + stderr）
// 4. 候选路径列表 + 5 分钟缓存

async function tryDetect(cliPath: string, env: NodeJS.ProcessEnv): Promise<DetectResult> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { output += d.toString(); });
    child.on('error', () => resolve({ available: false }));
    child.on('close', (code) => {
      if (code === 0 && /^\d+\.\d+\.\d+/.test(output.trim())) {
        resolve({ available: true, version: output.trim(), path: cliPath });
      } else {
        resolve({ available: false });
      }
    });
  });
}

export function buildSpawnEnv(): NodeJS.ProcessEnv {
  const homeDir = homedir();
  const extraPaths = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homeDir, '.npm-global/bin'),
    join(homeDir, '.local/bin'),
  ];
  const existingPath = (process.env.PATH ?? '').split(':');
  return {
    ...process.env,
    PATH: [...new Set([...extraPaths, ...existingPath])].join(':'),
  };
}
```

### 4.2 RPC 有状态模式：增强客户端（`pi-client.ts`）

#### 4.2.1 新增命令方法

```typescript
// 流式 prompt：返回 AsyncIterable 而非一次性 agent_end
async *sendPromptStream(
  message: string,
  options?: { images?: ImageContent[]; timeoutMs?: number },
): AsyncGenerator<PiEvent, void, void> {
  this.sendCommand({ type: 'prompt', message, images: options?.images });

  const eventQueue: PiEvent[] = [];
  let resolveWait: (() => void) | null = null;
  let done = false;

  const handler = (event: PiEvent) => {
    if (event.type === 'agent_end') {
      done = true;
      this.off(handler);
    }
    eventQueue.push(event);
    resolveWait?.();
  };
  this.on(handler);

  try {
    while (!done) {
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
      if (!done) {
        await new Promise<void>((r) => { resolveWait = r; });
      }
    }
    // Drain remaining
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }
  } finally {
    this.off(handler);
  }
}

// 中途介入
async steer(message: string): Promise<void>;
async followUp(message: string): Promise<void>;

// 错误恢复
async setAutoRetry(enabled: boolean): Promise<void>;

// 上下文管理
async compact(customInstructions?: string): Promise<CompactResult>;
async setAutoCompaction(enabled: boolean): Promise<void>;

// 统计
async getSessionStats(): Promise<SessionStatsResult>;
async getState(): Promise<StateResult>;

// 模型管理
async setModel(provider: string, modelId: string): Promise<void>;
async getAvailableModels(): Promise<Model[]>;
```

#### 4.2.2 Extension UI 协议处理

PI 可能通过 `extension_ui_request` 请求用户交互。RPC 客户端需要：
1. 识别 `extension_ui_request` 事件
2. 通知上层（PiProcessManager → FrontendAgent → Obsidian UI）
3. 等待用户操作
4. 发送 `extension_ui_response` 回 PI

```typescript
// 在 dispatch() 中新增处理
private dispatch(event: PiEvent): void {
  // ... 现有 response 处理 ...

  // Extension UI 请求 → 特殊处理
  if (event.type === 'extension_ui_request') {
    this.handleExtensionUiRequest(event as PiExtensionUiRequestEvent);
    return;
  }

  // 广播给所有 handler
  for (const handler of this.handlers) {
    handler(event);
  }
}

private extensionUiHandler:
  ((request: PiExtensionUiRequestEvent) => Promise<PiExtensionUiResponse>) | null = null;

onExtensionUiRequest(
  handler: (req: PiExtensionUiRequestEvent) => Promise<PiExtensionUiResponse>,
): void {
  this.extensionUiHandler = handler;
}

private handleExtensionUiRequest(req: PiExtensionUiRequestEvent): void {
  // fire-and-forget 类型（notify, setStatus, setWidget, setTitle, set_editor_text）
  // 不需要响应，直接广播给 UI 层
  const fireAndForget = ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'];
  if (fireAndForget.includes(req.method)) {
    for (const handler of this.handlers) {
      handler(req);
    }
    return;
  }

  // dialog 类型（select, confirm, input, editor）→ 等待用户响应
  if (this.extensionUiHandler) {
    this.extensionUiHandler(req).then((resp) => {
      this.sendCommand(resp);
    });
  } else {
    // 无 handler → 取消
    this.sendCommand({
      type: 'extension_ui_response',
      id: req.id,
      cancelled: true,
    });
  }
}
```

### 4.3 新增类型定义（`types.ts`）

```typescript
// ─── 新增命令类型 ───

export interface PiSteerCommand {
  type: 'steer';
  message: string;
  images?: ImageContent[];
  id?: string;
}

export interface PiFollowUpCommand {
  type: 'follow_up';
  message: string;
  images?: ImageContent[];
  id?: string;
}

export interface PiSetAutoRetryCommand {
  type: 'set_auto_retry';
  enabled: boolean;
  id?: string;
}

export interface PiCompactCommand {
  type: 'compact';
  customInstructions?: string;
  id?: string;
}

export interface PiSetAutoCompactionCommand {
  type: 'set_auto_compaction';
  enabled: boolean;
  id?: string;
}

export interface PiGetSessionStatsCommand {
  type: 'get_session_stats';
  id?: string;
}

export interface PiGetStateCommand {
  type: 'get_state';
  id?: string;
}

export interface PiSetModelCommand {
  type: 'set_model';
  provider: string;
  modelId: string;
  id?: string;
}

export interface PiGetAvailableModelsCommand {
  type: 'get_available_models';
  id?: string;
}

export interface PiSetThinkingLevelCommand {
  type: 'set_thinking_level';
  level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  id?: string;
}

// ─── 新增事件类型 ───

export interface PiTurnStartEvent { type: 'turn_start'; }
export interface PiTurnEndEvent {
  type: 'turn_end';
  message: unknown;
  toolResults: unknown[];
}

export interface PiMessageStartEvent { type: 'message_start'; message: unknown; }
export interface PiMessageEndEvent { type: 'message_end'; message: unknown; }

export interface PiToolExecutionUpdateEvent {
  type: 'tool_execution_update';
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  partialResult: { content: Array<{ type: string; text?: string }>; details: unknown };
}

export interface PiCompactionStartEvent {
  type: 'compaction_start';
  reason: 'manual' | 'threshold' | 'overflow';
}
export interface PiCompactionEndEvent {
  type: 'compaction_end';
  reason: 'manual' | 'threshold' | 'overflow';
  result: { summary: string; firstKeptEntryId: string; tokensBefore: number } | null;
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}

export interface PiAutoRetryStartEvent {
  type: 'auto_retry_start';
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}
export interface PiAutoRetryEndEvent {
  type: 'auto_retry_end';
  success: boolean;
  attempt: number;
  finalError?: string;
}

// ─── Extension UI 类型 ───

export interface PiExtensionUiRequestEvent {
  type: 'extension_ui_request';
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor' | 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text';
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  notifyType?: 'info' | 'warning' | 'error';
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: 'aboveEditor' | 'belowEditor';
  text?: string;
}

export interface PiExtensionUiResponse {
  type: 'extension_ui_response';
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

// ─── 统计类型 ───

export interface SessionStatsResult {
  sessionFile: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number;
    contextWindow: number;
    percent: number;
  };
}

// ─── 图片内容 ───

export interface ImageContent {
  type: 'image';
  data: string;        // base64-encoded
  mimeType: string;
}
```

### 4.4 PiProcessManager 增强（`pi-manager.ts`）

```typescript
// 新增功能：

// 1. 启动时启用 auto_retry
async start(config: PiConfig): Promise<void> {
  // ... 现有启动逻辑 ...
  await this.rpcClient.setAutoRetry(true);  // 瞬态错误自动重试
}

// 2. Extension UI bridge：PI 请求 → Obsidian Notice/Modal
setupExtensionUiBridge(): void {
  this.rpcClient.onExtensionUiRequest(async (req) => {
    switch (req.method) {
      case 'confirm': {
        const confirmed = await showObsidianConfirm(req.title ?? '确认', req.message);
        return { type: 'extension_ui_response', id: req.id, confirmed };
      }
      case 'select': {
        const value = await showObsidianSelect(req.title ?? '请选择', req.options ?? []);
        if (value === null) {
          return { type: 'extension_ui_response', id: req.id, cancelled: true };
        }
        return { type: 'extension_ui_response', id: req.id, value };
      }
      case 'notify': {
        const noticeType = req.notifyType ?? 'info';
        new Notice(`[PI] ${req.message}`, noticeType === 'error' ? 0 : 5000);
        // fire-and-forget, 不需要响应（但类型要求返回，这里不应该到这里）
        return { type: 'extension_ui_response', id: req.id, cancelled: true };
      }
      default:
        return { type: 'extension_ui_response', id: req.id, cancelled: true };
    }
  });
}

// 3. 执行完成后获取统计
async executeSkill(...): Promise<PiExecutionResult> {
  // ... 现有执行逻辑 ...

  // 成功后获取统计
  try {
    const stats = await this.rpcClient.getSessionStats();
    result.stats = stats;
  } catch {
    // 统计获取失败不影响结果
  }

  return result;
}

// 4. 上下文窗口管理
async checkAndCompact(): Promise<void> {
  const state = await this.rpcClient.getState();
  if (state.autoCompactionEnabled) return;  // 已启用自动 compact

  const stats = await this.rpcClient.getSessionStats();
  if (stats.contextUsage && stats.contextUsage.percent > 80) {
    await this.rpcClient.compact('保留阅读分析相关的关键信息');
  }
}
```

### 4.5 FrontendAgent 集成（`index.ts`）

```typescript
// handleSkillRequest 增强：
// 1. 流式文本推送到聊天界面
// 2. Extension UI 请求转发到 Obsidian Modal
// 3. 执行完成后显示 token 统计

async handleSkillRequest(...) {
  // ... 现有上下文构造 ...

  // 设置 Extension UI bridge
  this.piManager.setupExtensionUiBridge();

  // 流式执行
  let lastText = '';
  for await (const event of this.piManager.rpcClient.sendPromptStream(prompt)) {
    switch (event.type) {
      case 'message_update': {
        const delta = event.assistantMessageEvent;
        if (delta?.type === 'text_delta' && delta.delta) {
          callbacks.onToken?.(delta.delta);
        }
        break;
      }
      case 'tool_execution_start':
        onProgress?.(`PI 正在使用 ${event.toolName} 工具...`);
        break;
      case 'auto_retry_start':
        onProgress?.(`遇到临时错误，自动重试 (${event.attempt}/${event.maxAttempts})...`);
        break;
    }
  }

  // 获取统计并显示
  const stats = await this.piManager.getSessionStats();
  if (stats) {
    callbacks.onToken?.(`\n\n---\n📊 Token 消耗: ${stats.tokens.total.toLocaleString()} | 费用: $${stats.cost.toFixed(4)}`);
  }
}
```

---

## 5. npm 包名修正

当前代码使用 `@mariozechner/pi-coding-agent`，但 E2E 测试更新日志显示实际包名为 `@earendil-works/pi-coding-agent`。

**需要确认**：运行 `npm info @earendil-works/pi-coding-agent` 和 `npm info @mariozechner/pi-coding-agent` 确定正确的包名，然后统一修改。

---

## 6. Implementation Phases

### Phase 1: 检测修复 + spawn 统一（合并 bugfix 分支）

**改动**：`pi-config.ts`, `advanced-section.ts`

1. 合并 `fix/pi-agent-bugfix` 分支的 spawn 修复
2. `pi-config.ts`：`execSync` → `spawn` + `buildSpawnEnv()` + 候选路径
3. `advanced-section.ts`：安装/更新操作也使用 `spawn` + `buildSpawnEnv()`
4. 新增 `customPiPath` 设置字段

**验证**：E2E 测试通过（PI 检测 + 更新）

### Phase 2: RPC 客户端协议升级

**改动**：`types.ts`, `pi-client.ts`

1. 扩展 `PiCommand` 联合类型，新增所有命令
2. 扩展 `PiEvent` 联合类型，新增所有事件
3. `PiRpcClient` 新增命令方法（steer, followUp, setAutoRetry, compact, getSessionStats, getState, setModel）
4. 实现流式 `sendPromptStream()` (AsyncGenerator)
5. 实现 Extension UI 协议处理

**验证**：单元测试覆盖新增命令和事件解析

### Phase 3: PiProcessManager 增强

**改动**：`pi-manager.ts`

1. 启动时启用 `set_auto_retry`
2. 实现 Extension UI bridge（PI 请求 → Obsidian Notice/Modal）
3. 执行后获取 `get_session_stats` 统计
4. 长对话时调用 `compact`

**验证**：集成测试验证自动重试和统计获取

### Phase 4: FrontendAgent 流式集成

**改动**：`index.ts`

1. `handleSkillRequest` 使用 `sendPromptStream` 替代 `sendPrompt`
2. 流式 delta 推送到聊天界面
3. Extension UI 事件转发到 Obsidian Modal
4. 执行完成后显示 token 统计信息

**验证**：E2E 测试验证流式输出和用户交互

---

## 7. Boundaries

### Must Do

- spawn 替换 execSync 的检测修复
- 完整命令/事件类型定义
- 流式 prompt（AsyncGenerator）
- Extension UI 协议处理
- auto_retry 启用
- session_stats 统计展示

### Ask First

- 是否实现 `bash` RPC 命令（当前不开放 bash 工具，但 `bash` 命令可以让 PI 在受限环境中执行预定义命令）
- 是否需要 `setModel`/`getAvailableModels` 的 UI（让用户在 PI 执行中切换模型）
- Extension UI 的 `notify` 事件是否需要特殊展示（除了 Obsidian Notice 之外）
- `compaction_start/end` 事件是否需要通知用户（"正在压缩上下文..."）

### Never Do

- 不修改 LangGraph 阅读认知引擎的核心图结构
- 不给 PI 开放 `bash` 工具（保持只读工具白名单）
- 不实现多 PI 进程并发
- 不将 PI SDK 作为 npm 依赖打包进插件
- 不使用 Node `readline`（它把 U+2028/U+2029 当换行符）

---

## Appendix: 官方 RPC 命令速查

### 我们使用的命令

| 命令 | 类型 | 阶段 |
|------|------|------|
| `prompt` | 核心 | Phase 2 |
| `new_session` | 核心 | 已有 |
| `abort` | 核心 | 已有 |
| `steer` | 中途介入 | Phase 2 |
| `follow_up` | 中途介入 | Phase 2 |
| `set_auto_retry` | 错误恢复 | Phase 3 |
| `compact` | 上下文管理 | Phase 3 |
| `set_auto_compaction` | 上下文管理 | Phase 3 |
| `get_session_stats` | 统计 | Phase 3 |
| `get_state` | 状态查询 | Phase 3 |

### 我们订阅的事件

| 事件 | 类型 | 阶段 |
|------|------|------|
| `agent_start/end` | 生命周期 | 已有 |
| `message_update` | 流式文本 | Phase 2 |
| `tool_execution_start/update/end` | 工具进度 | Phase 2+ |
| `auto_retry_start/end` | 重试状态 | Phase 3 |
| `compaction_start/end` | 压缩状态 | Phase 3 |
| `extension_ui_request` | 用户交互 | Phase 3 |
| `extension_error` | 错误 | Phase 3 |

### 暂不使用的命令

| 命令 | 原因 |
|------|------|
| `bash` | 安全策略：不开放 shell |
| `cycle_model` | 非交互式场景不需要 |
| `set_thinking_level` | 暂不需要动态调整 |
| `export_html` | 暂不需要导出 |
| `fork`/`clone`/`switch_session` | 会话管理暂不需要 |
| `get_messages`/`get_last_assistant_text` | 可通过 agent_end 获取 |
| `set_session_name` | 暂不需要命名 |
| `set_steering_mode`/`set_follow_up_mode` | 使用默认 mode 即可 |
