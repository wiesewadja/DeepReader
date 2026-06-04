# xiting-mcp-server：完整计划

> 本文是 Project A（Hermes 端基础设施）+ Project B（DeepReader 端集成）+ Project C（端到端验证）的合并 spec，按 A→B→C 顺序实施。

---

## 决策表（已与用户确认）

| 维度 | 决定 |
|------|------|
| 进程模型 | DeepReader onload spawn，onunload kill |
| 配置位置 | `~/.hermes/config.yaml` 顶层 `xiting:` profile |
| profile 字段 | provider / model / api_key / system_prompt / vault_path |
| 工具命名 | `xiting_*` 前缀（4 工具） |
| 工具实现 | mcp_server 进程内自实现（不调 hermes_chat） |
| 路径约束 | vault_path 强制白名单 |
| 启动方式 | DeepReader onload spawn `hermes mcp agent-serve --profile xiting` |
| 通信协议 | stdio JSON-RPC（MCP stdio transport） |

---

# Project A: Hermes 端暴露 xiting_* 4 工具

**目标**：`hermes mcp agent-serve --profile xiting` 启动后，能通过 stdio 给任何 MCP client 暴露 4 个 xiting 工具。

**改的文件**（全在 Hermes 侧）：
- `~/.hermes/config.yaml`（+10 行）
- `~/.hermes/hermes-agent/mcp_server/entry.py`（+15 行）
- `~/.hermes/hermes-agent/mcp_server/tools.py`（+330 行）

**不动**：Hermes CLI、gateway、hermes_chat、通用 hermes_* 工具。

**验收**（独立可测，不依赖 DeepReader）：
- A1: `cat ~/.hermes/config.yaml | grep -A 8 "^xiting:"` 看到 5 字段
- A2: `python -m mcp_server --help | grep profile` 看到 `--profile` 参数
- A3: `HERMES_MCP_PROFILE=xiting python -c "from mcp_server.tools import _resolve_xiting_profile; print(_resolve_xiting_profile())"` 拿到 5 字段
- A4: `python -m mcp_server --list-tools` 输出 10 个工具（6 hermes_* + 4 xiting_*）
- A5: mcporter 注册 `hermes mcp agent-serve --profile xiting`，list 4 个 xiting_*
- A6: mcporter call `xiting_user_profile scope=preferences` 返回 USER.md 命中
- A7: mcporter call `xiting_render_diagram` 传 `output_filename: ../../etc/passwd`，handler 报错不写
- A8: mcporter call `xiting_chat message="ping"`，返回 LLM 真实回复

## Step 1: config.yaml 加 xiting profile（+10 行）

```yaml
xiting:
  provider: minimax-cn
  model: MiniMax-M3
  api_key: ""
  system_prompt: |
    你是奚童读书伴读助手，隶属于 DeepReader 深度阅读插件。
    职责：
    - 帮用户整理读书笔记、生成可视化图表
    - 维护并理解用户阅读画像
    - 回答读书相关问题
    约束：
    - 所有输出文件必须写到 vault_path 白名单内
    - 不调用任何对外副作用工具（不发消息、不下载书）
    - 使用中文输出
  vault_path: /Users/lizhao/Nutstore Files/昭见森2030
```

## Step 2: entry.py 加 `--profile`（+15 行）

argparse 加 `--profile`，main 里写 `os.environ["HERMES_MCP_PROFILE"] = args.profile`。

## Step 3: tools.py 加 `_resolve_xiting_profile()`（+30 行）

```python
def _resolve_xiting_profile():
    profile_name = os.environ.get("HERMES_MCP_PROFILE", "").strip()
    if not profile_name: return None
    with open(os.path.join(get_hermes_home(), "config.yaml")) as f:
        cfg = yaml.safe_load(f) or {}
    profile = cfg.get(profile_name)
    return profile if isinstance(profile, dict) else None
```

## Step 4: tools.py 加 4 工具（+300 行）

TOOL_MANIFEST 追加 4 schema。每个 handler 自实现 LLM 客户端（`httpx` POST `base_url/v1/chat/completions`）。写文件必须过 `_safe_join(vault_path, rel)` 防越界。

### 4a. xiting_render_diagram — 绘图
inputSchema: book_title / book_author / section / analysis_data / diagram_type (mindmap|flowchart|concept_map|timeline) / output_filename
输出: vault-relative excalidraw.md 路径

### 4b. xiting_write_note — 写读书笔记
inputSchema: book_title / book_author / section / user_request / source_content / output_filename
输出: vault-relative .md 路径

### 4c. xiting_user_profile — 拉用户画像
inputSchema: scope (full|preferences|history|style) / limit
输出: USER.md 命中 + recent sessions + 阅读风格

### 4d. xiting_chat — 多轮聊
inputSchema: message / session_id (续接) / model (覆盖)
输出: LLM 真实回复

`_safe_join(vault_path, rel_path)` 用 `os.path.realpath` + `startswith` 拒绝逃逸。

---

# Project B: DeepReader 集成 xiting MCP client

**前置**：A 完成。

**改的文件**（全在 DeepReader 侧）：
- `src/agent/mcp/XitingMcpClient.ts`（新建 +80 行）
- `src/agent/mcp/types.ts`（新建 +30 行）
- `src/main.ts`（+5 行）
- `src/agent/graph/nodes/visualizer.ts`（替换占位 +30 行）

**验收**（独立可测，前提 A 完成）：
- B1: `npm run build` 无 TS 错误
- B2: `npm run test:run` 全过
- B3: 启动 Obsidian，看到日志 `[INFO] Xiting MCP server connected`
- B4: chat 说"为最近这本书画个思维导图"，vault 出现 excalidraw 文件
- B5: 关闭 Obsidian，子进程被 kill，无 orphan

## Step 5: XitingMcpClient.ts（新建 +80 行）

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class XitingMcpClient {
  private client: Client | null = null;
  private ready: Promise<void> | null = null;

  async ensureStarted(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this._start();
    return this.ready;
  }

  private async _start(): Promise<void> {
    const transport = new StdioClientTransport({
      command: 'hermes',
      args: ['mcp', 'agent-serve', '--profile', 'xiting'],
      env: { ...process.env, HERMES_MCP_PROFILE: 'xiting' },
    });
    this.client = new Client({ name: 'deepreader', version: '1.0.0' }, { capabilities: {} });
    await this.client.connect(transport);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureStarted();
    if (!this.client) throw new Error('xiting MCP client not connected');
    return this.client.callTool({ name, arguments: args });
  }

  async shutdown(): Promise<void> {
    if (this.client) await this.client.close();
    this.client = null;
    this.ready = null;
  }
}

export const xitingMcpClient = new XitingMcpClient();
```

## Step 6: main.ts onload/onunload（+5 行）

```typescript
// onload 末尾
await xitingMcpClient.ensureStarted();
log('[DeepReader] Xiting MCP server connected');

// onunload 开头
await xitingMcpClient.shutdown();
log('[DeepReader] Xiting MCP server disconnected');
```

## Step 7: visualizer.ts 替换占位（+30 行）

直接调 `xitingMcpClient.callTool('xiting_render_diagram', {...})`，**不**保留 fallback。

---

# Project C: 端到端验证

**前置**：A + B 完成。

- C1: 启动 Obsidian
- C2: 日志 `[INFO] Xiting MCP server connected`
- C3: chat 调"画图"
- C4: vault 出现 excalidraw 文件
- C5: visualizer 不再返回占位
- C6: 杀 Obsidian，hermes 子进程无 orphan

---

## 风险

### Project A
- 低：config + entry 都是小改
- 中：4 工具的 LLM 客户端是新增代码
- 中：vault_path 路径校验要 robust（防 symlink attack）

### Project B
- 低：@modelcontextprotocol/sdk 0.5.0 已装
- 中：Obsidian 启动时 PATH 不含 hermes（参考 PI 的 buildSpawnEnv）
- 低：visualizer 替换是局部改动

### Project C
- 中：LLM 输出格式与 visualizer 解析对得上否

---

## 范围外（明确排除）

- Hermes HTTP transport
- 4 工具之外的 xiting 工具
- xiting user profile 自动更新
- 流式响应
- PI 复活（保持 branch refactor/remove-pi-and-visualization）
- Hermes CLI / gateway 改动
