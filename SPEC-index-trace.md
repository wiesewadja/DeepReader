# SPEC: IndexTracer 日志格式重构

## 目标

将索引追踪日志从 **JSON 最终快照** 改为 **时间戳追加日志**，解决三个核心问题：

1. **LLM 调用丢失** — `tree.ts` 的 `generateSummariesForStructure` 处理 N 个节点却只记录 1 次 `onLlmCall`
2. **过程信息丢失** — JSON 快照只有最终状态，无法回溯中间过程
3. **Embedding 调用无记录** — vectorize 阶段的 embedding API 调用未追踪 token 用量

## 当前问题分析

### 调用链与记录点

```
book-indexer.ts
  ├─ tracer.startPhase("parse_document")
  ├─ PageIndex.fromEpub()
  │   └─ tree.ts::generateSummariesForStructure()
  │       ├─ for batch of 8 nodes:
  │       │   └─ chatGPT() ×8  ← 每次调用都有 usage，但没记录
  │       └─ onLlmCall({ purpose, model, durationMs })  ← 只记 1 次，无 tokens
  │   └─ tree.ts::generateDocDescription()
  │       └─ chatGPT()  ← 有 usage，没传给 onLlmCall
  │       └─ onLlmCall({ purpose, model, durationMs })  ← 只记 1 次，无 tokens
  ├─ tracer.startPhase("vectorize")
  │   └─ vectorizeAllLevels()
  │       └─ onEmbedCall({ model, durationMs })  ← 无 tokens
  └─ tracer.finalize(true)
```

### token 用量提取链路断裂（4 层问题）

```
API 响应 { usage: { prompt_tokens, completion_tokens } }
  → chatGPTWithFinishReason() 正确提取为 ChatResult.usage ✓
    → chatGPT() 丢弃 usage，只返回 string                     ← 问题 1
      → tree.ts 不传 inputTokens/outputTokens                  ← 问题 2
        → onLlmCall({ purpose, model, durationMs })             ← 无 token 字段
          → finalize() 用 call.inputTokens ?? 0 聚合            ← 问题 3: undefined → 0
```

问题 1：`chatGPT()` 返回 `string`，丢弃 `ChatResult.usage`
问题 2：`tree.ts` 的 `onLlmCall` 调用只传 `purpose/model/durationMs`，不传 tokens
问题 3：`?? 0` 把 `undefined` 掩盖成 `0`，trace 显示"0 tokens"实际是"没数据"
问题 4：部分 provider（DeepSeek 等）有 `reasoning_tokens`、`cached_tokens` 等额外字段未覆盖

## 方案

### 核心改动：IndexTracer 追加写入时间戳日志

trace 文件改为 **每行一条日志** 的格式，不再维护内存中的完整 JSON 对象。

#### 日志格式

```
2026-05-29T06:20:41.227Z [INFO]  index_start bookId=c9ce4d7b title=优秀的绵羊 fileType=epub model=mimo-v2.5
2026-05-29T06:20:41.227Z [INFO]  phase_start phase=validate
2026-05-29T06:20:41.227Z [INFO]  phase_end phase=validate success=true durationMs=0 fileSizeBytes=310060
2026-05-29T06:20:41.227Z [INFO]  phase_start phase=parse_document
2026-05-29T06:20:41.230Z [INFO]  llm_call purpose=generate_summary model=mimo-v2.5 durationMs=2341 inputTokens=1520 outputTokens=380
2026-05-29T06:20:43.571Z [INFO]  llm_call purpose=generate_summary model=mimo-v2.5 durationMs=1892 inputTokens=1480 outputTokens=350
...
2026-05-29T06:20:55.123Z [INFO]  llm_call purpose=generate_description model=mimo-v2.5 durationMs=2123 inputTokens=2100 outputTokens=450
2026-05-29T06:20:57.346Z [INFO]  phase_end phase=parse_document success=true durationMs=16119 chaptersCount=23
2026-05-29T06:20:57.347Z [INFO]  phase_start phase=save_cover
2026-05-29T06:20:57.347Z [INFO]  phase_end phase=save_cover success=true durationMs=1
...
2026-05-29T06:20:57.641Z [INFO]  embed_call purpose=generate_embedding model=BAAI/bge-m3 durationMs=272 batchSize=128
2026-05-29T06:20:57.822Z [INFO]  index_end success=true totalDurationMs=16596
2026-05-29T06:20:57.822Z [INFO]  llm_summary totalCalls=25 totalInputTokens=38000 totalOutputTokens=8900
```

#### 文件命名

`{bookId}.log`，与现有 `{bookId}.json` 对应。finalize 时同时写 `.json` 摘要保持兼容。

### 改动范围（5 个文件）

#### 1. `src/pageindex/index-tracer.ts` — 重写为追加日志

- 删除内存中的 `IndexTrace` JSON 结构
- 每个方法直接 `appendFile` 一行日志
- `finalize()` 追加汇总行

```ts
export class IndexTracer {
  private logPath: string;
  private phaseStartMs: number = 0;
  private currentPhase: string = '';
  private traceStartMs: number = 0;
  // 聚合计数器（用于 finalize 汇总行）
  private llmCallCount: number = 0;
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;

  constructor(bookId, title, filePath, fileType, config, vaultPath, exportName) {
    this.logPath = path.join(getPageindexRoot(vaultPath), "traces", `${exportName}.log`);
    this.traceStartMs = Date.now();
    this.append(`index_start bookId=${bookId} title=${title} fileType=${fileType} model=${config.pageindexModel}`);
  }

  private append(line: string): void {
    const ts = new Date().toISOString();
    fs.appendFile(this.logPath, `${ts} [INFO]  ${line}\n`, 'utf-8').catch(() => {});
  }

  startPhase(name: string): void {
    this.currentPhase = name;
    this.phaseStartMs = Date.now();
    this.append(`phase_start phase=${name}`);
  }

  endPhase(stats?: Record<string, number | string>): void {
    const durationMs = Date.now() - this.phaseStartMs;
    const statsStr = stats ? ' ' + Object.entries(stats).map(([k,v]) => `${k}=${v}`).join(' ') : '';
    this.append(`phase_end phase=${this.currentPhase} success=true durationMs=${durationMs}${statsStr}`);
  }

  failPhase(error: string): void {
    const durationMs = Date.now() - this.phaseStartMs;
    this.append(`phase_end phase=${this.currentPhase} success=false durationMs=${durationMs} error=${error}`);
  }

  recordLlmCall(call: Omit<LlmCallTrace, "phase">): void {
    this.llmCallCount++;
    this.totalInputTokens += call.inputTokens ?? 0;
    this.totalOutputTokens += call.outputTokens ?? 0;
    const tokens = `inputTokens=${call.inputTokens ?? '?'} outputTokens=${call.outputTokens ?? '?'}`;
    this.append(`llm_call purpose=${call.purpose} model=${call.model} durationMs=${call.durationMs} ${tokens}`);
  }

  finalize(success: boolean, error?: string): void {
    const totalMs = Date.now() - this.traceStartMs;
    this.append(`index_end success=${success} totalDurationMs=${totalMs}${error ? ` error=${error}` : ''}`);
    this.append(`llm_summary totalCalls=${this.llmCallCount} totalInputTokens=${this.totalInputTokens} totalOutputTokens=${this.totalOutputTokens}`);
  }
}
```

#### 2. `src/pageindex/core/tree.ts` — 每次 LLM 调用单独记录

`generateSummariesForStructure` 改为在循环内部每次 `chatGPT` 调用后立即记录：

```ts
// 改前：只记录一次
options.onLlmCall?.({ purpose: "generate_summary", model: options.model, durationMs: Date.now() - t0 });

// 改后：每次调用都记录
for (let i = 0; i < nodes.length; i += batchSize) {
  const batch = nodes.slice(i, i + batchSize);
  const results = await Promise.all(
    batch.map((node) => generateNodeSummaryWithUsage(node, options))
  );
  for (let j = 0; j < batch.length; j++) {
    (batch[j] as TreeNode).summary = results[j].content;
    options.onLlmCall?.({
      purpose: "generate_summary",
      model: options.model,
      durationMs: results[j].durationMs,
      inputTokens: results[j].usage?.inputTokens,
      outputTokens: results[j].usage?.outputTokens,
    });
  }
}
```

同理 `generateDocDescription`。

#### 3. `src/pageindex/llm/client.ts` — 暴露 ChatResult

新增 `chatGPTWithUsage`，返回 `ChatResult`（含 usage），供需要 token 追踪的调用方使用：

```ts
export async function chatGPTWithUsage(options: ChatOptions): Promise<ChatResult> {
  return chatGPTWithFinishReason(options);
}
```

`chatGPT` 保持不变（返回 `string`）以兼容现有调用方。

#### 4. `src/pageindex/book-indexer.ts` — 适配新接口

- `vectorizeAllLevels` 的 `onEmbedCall` 回调扩展，包含 embedding 的 input token 计数
- finalize 时不再写 JSON，tracer 内部已经处理

#### 5. `src/pageindex/vault/vectors.ts` — embedding 调用追踪

`generateEmbedding` / `generateEmbeddings` 返回值扩展，包含 token 用量（从 embedding API 的 `usage.prompt_tokens` 提取）。

### 不改动的部分

- **`toc.ts`** — 已正确按次记录并带 token，无需改动
- **`NoopIndexTracer`** — 保持空实现，签名对齐即可
- **`INDEX_TRACE_ENABLED` 开关** — 保持
- **`src/agent/llm-client.ts`** — 前端 Agent 的 LLM 客户端，不涉及 pageindex

## 测试策略

1. **单元测试**：IndexTracer 的 `append` 输出格式验证
2. **E2E 测试**：完整索引后检查 `.log` 文件：
   - `llm_call` 行数 > 2（应为节点数级别）
   - 每行有 `inputTokens` 和 `outputTokens` 非零值
   - `embed_call` 行存在
   - `index_end` 行的 `totalDurationMs` 合理

## 边界

- **始终**：每条日志一行，ISO 时间戳开头
- **始终**：`appendFile` 失败静默处理（不影响索引主流程）
- **始终**：保留 `.json` trace 兼容期（finalize 时同时写 `.json` 摘要）
- **先问**：如果需要改动 `chatGPT` 函数签名（影响范围大），先确认方案
- **不做**：不改 `src/agent/llm-client.ts`
- **不做**：不改已有 `toc.ts` 的记录逻辑
