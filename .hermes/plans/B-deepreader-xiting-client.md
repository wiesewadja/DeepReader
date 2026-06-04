# Plan B: DeepReader 集成 xiting MCP client

> 独立项目，**依赖** Plan A 完成。改的文件全在 DeepReader 侧。
> 4 个文件：1 新建、1 替换、2 微调。约 +115 行 TS。

---

## 目标

DeepReader 插件启动后，作为 MCP client 通过 stdio 调 Hermes 暴露的 4 个 xiting 工具。Obsidian 启动 → spawn 子进程 → 多轮调工具 → 关闭时 kill 子进程。

**前置**：Plan A 已完成（`hermes mcp agent-serve --profile xiting` 可独立起 stdio server）。

---

## 3 步实施

### Step 1: 新建 `src/agent/mcp/XitingMcpClient.ts`（+80 行）

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

### Step 2: `src/main.ts` onload/onunload（+5 行）

```typescript
// onload 末尾
await xitingMcpClient.ensureStarted();
log('[DeepReader] Xiting MCP server connected');

// onunload 开头
await xitingMcpClient.shutdown();
log('[DeepReader] Xiting MCP server disconnected');
```

Obsidian 启动时 PATH 不含 hermes 二进制的问题——`@modelcontextprotocol/sdk` 的 `StdioClientTransport` 内部用 `child_process.spawn`，会从 `process.env.PATH` 找。**参考 `pi-config.ts:buildSpawnEnv()` 补 PATH**（如 `/opt/homebrew/bin`、`/usr/local/bin`）。

### Step 3: 替换 `src/agent/graph/nodes/visualizer.ts` 占位（+30 行）

当前是占位 return 文案。替换为：

```typescript
import { xitingMcpClient } from '../../mcp/XitingMcpClient.js';

export async function visualizerNode(
  state: CognitiveEngineState,
  _config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const { analysisResult, structuralAnalysis, rewrittenQuery, pdfName } = state;
  const sourceContent = analysisResult || structuralAnalysis || '';
  if (!sourceContent) {
    return { analysisResult: '图表生成失败: 缺少分析内容' };
  }

  try {
    const result = await xitingMcpClient.callTool('xiting_render_diagram', {
      book_title: pdfName || 'unknown',
      book_author: '',
      section: rewrittenQuery || 'summary',
      analysis_data: sourceContent,
      diagram_type: 'mindmap',
    });
    const payload = JSON.parse((result as any).content[0].text);
    return { analysisResult: `图表已生成: ${payload.output_path}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { analysisResult: `图表生成失败: ${msg}` };
  }
}
```

**硬切换**：不保留 fallback。xiting MCP 挂了 = visualizer 报错。

---

## 验收清单

- [ ] B1: `npm run build` 无 TS 错误
- [ ] B2: `npm run test:run` 全过（mock mcp client 单元测）
- [ ] B3: 启动 Obsidian，看到日志 `[INFO] Xiting MCP server connected`
- [ ] B4: chat 说"为最近这本书画个思维导图"，vault 出现 excalidraw 文件
- [ ] B5: 关闭 Obsidian，日志看到 `Xiting MCP server disconnected`，子进程被 kill

---

## 风险

- 低：`@modelcontextprotocol/sdk` 0.5.0 已装
- 中：Obsidian 启动时 PATH 不含 hermes（参考 `pi-config.ts:buildSpawnEnv` 解决）
- 低：visualizer 替换是局部改动

## 范围外

- xiting_* 之外的工具集成
- visualizer fallback 路径
- LangGraph 其他 node 改造
- PI 复活（保持 branch `refactor/remove-pi-and-visualization`）
