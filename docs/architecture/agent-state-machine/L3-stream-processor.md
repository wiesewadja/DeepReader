# L3 — 流处理层

> LangGraph 的 `streamMode: 'updates'` 事件怎么变成 UI 能消费的数据
>
> 状态机层的"输出"是 AsyncIterable<L3 把它切片、分类、转发给回调>。

---

## 1. 现状

### 1.1 角色定位

L3 是 `cognitiveEngine.stream()` 输出与 L0/L1 回调之间的"翻译官 + 调度员"：

| 职责 | 说明 |
|------|------|
| **Chunk 解析** | LangGraph `streamMode: 'updates'` 的 `{ nodeName: stateUpdate }` 结构 |
| **Interrupt 检测** | `__interrupt__` chunk → 标记 HITL 中断 |
| **进度回调分发** | 每个节点状态更新 → `onProgress(nodeName)` |
| **内容回调** | 收集 `formattedOutput` → `onContent(text)` |
| **表情系统集成** | `NODE_ACTION_MAP` → `onHumanizedProgress` |
| **轨迹收集** | `EvalTraceData`（nodesVisited / depth / toolCalls / durationMs） |
| **语音触发** | 流结束后 `voicePipeline(formattedOutput, config, callbacks)` |
| **错误兜底** | 无（错误在 L1 `executeWithStream` 处理） |

### 1.2 主流程

`src/agent/graph/stream-processor.ts` 的 `processGraphStream`：

```typescript
export async function processGraphStream(
  stream,            // AsyncIterable<unknown> 来自 cognitiveEngine.stream()
  callbacks,         // AgentLoopOptions
  config?,           // { configurable }
  voicePipeline?,    // VoicePipelineCallback
): Promise<StreamProcessorResult>
```

处理循环：

```typescript
for await (const chunk of stream) {
  // 1. 检测 interrupt（HITL）
  if ('__interrupt__' in chunk) {
    interruptedNode = { nodeId, content };
    break;
  }

  // 2. 解析 { nodeName: stateUpdate }
  for (const nodeName of Object.keys(chunk)) {
    const stateUpdate = chunk[nodeName];

    // 2.1 进度提示
    onProgress(NODE_STATUS_MAP[nodeName] || nodeName);
    visitedNodes.push(nodeName);

    // 2.2 表情系统
    if (callbacks.onHumanizedProgress) {
      callbacks.onHumanizedProgress({
        mainAction: { type, detail },
        currentReadingLevel: level,
        ...
      });
    }

    // 2.3 流式 formattedOutput
    if (stateUpdate.formattedOutput) {
      formattedOutput = stateUpdate.formattedOutput;
      onContent(formattedOutput);
    }

    // 2.4 轨迹收集
    if (Array.isArray(stateUpdate.toolResultsSnapshot)) {
      lastToolSnapshot = stateUpdate.toolResultsSnapshot;
    }
    if (stateUpdate.depth != null && routedDepth === undefined) {
      routedDepth = stateUpdate.depth;
    }
  }
}

// 流结束后：
if (callbacks.onVoiceReady && formattedOutput && voicePipeline) {
  await voicePipeline(formattedOutput, config ?? {}, callbacks);
}

callbacks.onComplete?.();
```

### 1.3 NODE_STATUS_MAP / NODE_ACTION_MAP

```typescript
const NODE_STATUS_MAP = {
  router: '正在理解你的问题...',
  inspectional: '正在翻阅目录，锁定相关章节...',
  pre_search: '正在快速翻阅相关段落...',
  analytical: '正在深度分析原文...',
  formatter: '正在整理笔记...',
  syntopical: '正在跨书主题分析...',
  visualizer: '正在生成图表...',
};

const NODE_ACTION_MAP = {
  router:       { type: 'thinking',  level: 'elementary' },
  inspectional: { type: 'reading',   level: 'inspectional' },
  pre_search:   { type: 'reading',   level: 'analytical' },
  analytical:   { type: 'reading',   level: 'analytical' },
  formatter:    { type: 'writing',   level: 'analytical' },
  syntopical:   { type: 'reading',   level: 'syntopical' },
  visualizer:   { type: 'writing',   level: 'analytical' },
};
```

**用途分离**：
- `NODE_STATUS_MAP` → 文本状态（给用户看）
- `NODE_ACTION_MAP` → 结构化信号（给表情系统）

### 1.4 EvalTraceData 轨迹收集

```typescript
interface EvalTraceData {
  nodesVisited: string[];                  // 经过的节点顺序
  depth?: number;                          // 最终路由的 depth
  toolCalls: Array<{                       // 工具调用快照
    tool: string;
    args: Record<string, unknown>;
    resultLength: number;                  // originalResultLength（不是压缩后）
  }>;
  durationMs: number;                      // 整流耗时
}
```

**`toolCalls` 来源**：S2/S3 节点的 `toolResultsSnapshot`。每个节点写入时是**覆盖**语义（overwrite reducer），所以 L3 收集到的是**最后一个写入的节点的快照**——也就是 S2 Analytical 的完整工具调用历史。

**`depth` 来源**：取**第一个**不为 undefined 的 depth（"first wins" 语义）。

### 1.5 Interrupt 检测机制

LangGraph HITL 的标准机制是抛 `GraphInterrupt`，但 stream 模式下，interrupt 会以 **`__interrupt__` chunk** 形式出现：

```typescript
if ('__interrupt__' in chunk) {
  const first = Array.isArray(chunk.__interrupt__)
    ? chunk.__interrupt__[0]
    : null;
  if (first?.value) {
    interruptedNode = {
      nodeId: first.value.nodeId || 'unknown',
      content: first.value.content || first.value.question || '',
    };
  }
  break;
}
```

**返回结果**：
```typescript
if (interruptedNode) {
  return { messages: [], interrupted: interruptedNode, traceData };
}
```

**注意**：`messages: []` —— **中断时不返回任何消息**，因为内容还没生成完。UI 层看到 `interrupted` 后会弹窗展示 `content`，让用户审查。

### 1.6 语音管线触发

L3 不直接调 TTS，而是把回调转给 L1 注入的 `voicePipeline`：

```typescript
if (callbacks.onVoiceReady && formattedOutput && voicePipeline) {
  await voicePipeline(formattedOutput, config ?? {}, callbacks);
}
```

**L1 的实现**（`FrontendAgent.createVoicePipelineCallback()`）：
- 从 `config.configurable` 取 `ttsConfig` + `llmConfig`
- 调 `generateVoice(formattedOutput, ttsCfg, llmCfg, options, onChunk)`
- 异步生成音频 → `onVoiceReady({ audioBuffer, duration })`

**注意**：语音生成是**流结束后才启动**的（不是边流边播），且**不阻塞** `onComplete` 回调（虽然 `await voicePipeline()` 看似阻塞，但 L1 内部用 `.then().catch()` 包了一层异步）。

---

## 2. 已知问题

### 2.1 onContent 只取最后覆盖的 formattedOutput

**现象**：
```typescript
if (stateUpdate.formattedOutput && typeof stateUpdate.formattedOutput === 'string') {
  formattedOutput = stateUpdate.formattedOutput;
  onContent(formattedOutput);
}
```

S4 formatter 的 `model.stream()` 会**增量**地更新 `state.formattedOutput`（每个 chunk 都包含截至当前的完整文本），所以 `onContent` 收到的是**累积的全量**。

**问题**：
- 前端收到"全量替换"而不是"增量 token"
- 每收到一次 `onContent` 就重渲整个消息
- 长回复时浪费大量 DOM 操作

**修复方向**（见 §3）：用"diff 模式"——只在 chunk 增长时取 delta。

### 2.2 NODE_STATUS_MAP 是硬编码

**现象**：节点名 → 中文描述的映射是写死在 `stream-processor.ts` 里的常量对象。

**问题**：
- 新增节点时需要改两处（这里 + state-machine-flow.md）
- i18n 困难（多语言支持无法做）
- 文案风格不统一（"正在..."开头是手动约定的）

**优化**：把 NODE_STATUS_MAP 移到 `src/agent/config/prompts-cn.ts` 或 i18n 文件。

### 2.3 onHumanizedProgress 的 overallProgress 写死 0

**现象**：
```typescript
callbacks.onHumanizedProgress({
  mainAction: { type, detail },
  currentReadingLevel: level,
  generatedContent: '',
  overallProgress: 0,  // ⚠️ 永远 0
});
```

**问题**：
- 表情系统拿不到"对话进行到百分之几"
- 推测意图：overallProgress 应该是 `visitedNodes.length / totalExpectedNodes`，但当前实现没算

**根因**：`totalExpectedNodes` 难以预测（不同 depth 走不同路径）。

### 2.4 toolCalls 只保留最后一个节点的快照

**现象**：
```typescript
if (Array.isArray(stateUpdate.toolResultsSnapshot)) {
  lastToolSnapshot = stateUpdate.toolResultsSnapshot as ToolResultSnapshot[];
}
```

`toolResultsSnapshot` 字段的 reducer 是 `overwriteWithDefault`（最后一次写入获胜），所以 L3 收集到的是 S2 Analytical 最终的全量工具调用历史——**S1 INSPECTIONAL 不写 toolResultsSnapshot**，**S3 SYNTOPICAL 写自己的 toolResultsSnapshot**。

**问题**：
- 如果同一对话先走 S2 再走 S3（实际不会，但理论可能），只能看到最后一次的工具调用
- 跨节点的"完整工具调用史"丢了

**修复方向**：用 `messagesStateReducer`（append 语义）改 `toolResultsSnapshot` 的 reducer。

### 2.5 语音触发在 formattedOutput 空时静默

**现象**：
```typescript
if (callbacks.onVoiceReady && formattedOutput && voicePipeline) {
  await voicePipeline(formattedOutput, config ?? {}, callbacks);
}
```

如果 `formattedOutput` 为空（节点全降级），语音不会触发——**用户可能期待"对话结束就有语音"**。

**根因**：语音是"对最终输出的朗读"，输出为空就没意义。但用户配置"开启语音"时可能没意识到这点。

### 2.6 EvalTraceData 不包含错误信息

**现象**：`EvalTraceData` 字段只有 nodesVisited / depth / toolCalls / durationMs，**没有** `nodeErrors` / `interrupted`。

**问题**：
- Eval 跑分时无法直接看出"这次对话降级了几次"
- 调试时需要从 LangSmith trace 反查

**修复方向**：在 `EvalTraceData` 里追加 `nodeErrors: Record<string, NodeError>`。

---

## 3. 优化探讨

### 3.1 onContent 的增量模式

**问题**：当前 onContent 是"全量替换"。

**方案**：
- L3 维护 `lastFormattedOutput` 状态
- 每次 chunk 来时比较 `newFormatted.length` 与 `lastFormatted.length`
- 如果 `newFormatted` 是 `lastFormatted` 的前缀（`startsWith`），取 delta 推 `onDelta`
- 否则全量推 `onContent`（保护容错）

**收益**：
- 前端可以做"打字机"动画
- 减少 DOM 重渲次数（4-10x 性能提升，长文本场景）

**风险**：依赖 LLM 不"回改"前缀（DeepSeek 等 thinking 模型偶尔会回删重写）。

### 3.2 节点状态机的"已知节点"枚举化

把 `NODE_STATUS_MAP` / `NODE_ACTION_MAP` 改成由 `NODE_NAMES` + 一个 metadata 文件生成：

```typescript
// node-metadata.ts
export const NODE_METADATA: Record<NodeName, { status: string; action: Action }> = {
  router: { status: '正在理解你的问题...', action: { type: 'thinking', level: 'elementary' } },
  // ...
};
```

**收益**：
- 新增节点时 TypeScript 强校验（漏写 metadata 会编译报错）
- 便于做 i18n / 用户自定义文案

### 3.3 overallProgress 估算

**方案**：根据 visitedNodes + 期望路径估算：
- depth=0：router → formatter（2 节点）→ 50%/100%
- depth=1：router → inspectional → formatter（3 节点）→ 33%/66%/100%
- depth=2：router → inspectional → pre_search → analytical → formatter（5 节点）→ 20%/40%/60%/80%/100%
- depth=3：router → syntopical → formatter（3 节点）→ 33%/66%/100%

**问题**：analytical 节点内部还有 ReAct 循环（多次 LLM 调用），单节点"权重"不对等。

**临时方案**：analytical 节点在 0-80% 内做 sub-progress（基于 toolCalls 次数 / maxToolCalls）。

### 3.4 toolResultsSnapshot 改成 append 语义

**当前 reducer**：
```typescript
toolResultsSnapshot: Annotation<ToolResultSnapshot[]>(overwriteWithDefault([])),
```

**建议**：
```typescript
toolResultsSnapshot: Annotation<ToolResultSnapshot[]>({
  reducer: (a, b) => [...a, ...b],  // append
  default: () => [],
}),
```

**注意**：这会**打破** S2 Analytical 内部的"overwrite 累积"行为（节点内每次循环覆盖），需要重新设计 analytical 节点如何累加。

### 3.5 EvalTraceData 扩展

**建议字段**：
```typescript
interface EvalTraceData {
  nodesVisited: string[];
  depth?: number;
  toolCalls: ToolCallSnapshot[];
  durationMs: number;
  // 新增：
  nodeErrors: Record<string, NodeError | string>;
  interrupted: boolean;
  crossBookMode: boolean;
  wassProactive: boolean;
}
```

**收益**：Eval 跑分能直接看到降级链、中断点、模式。

### 3.6 流式节点的"已结束"信号

**问题**：当前 L3 没有"图执行已结束"的显式信号，只有 `onComplete`（无内容）。

**方案**：返回 `streamMetadata: { endNode: string, totalNodes: number, endedAt: number }`，让 UI 能精确做收尾动画。

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/graph/stream-processor.ts` | 主文件（`processGraphStream`） |
| `src/agent/graph/voice-pipeline.ts` | 语音管线（被 L1 注入） |
| `src/services/tts/streaming-voice-player.ts` | 流式语音播放器（L0 持有） |
| `src/services/tts/tts-service.ts` | TTS 服务（含 `mergeAudioChunks`） |

## 5. 关联文档

- L1 FrontendAgent 入口层 — `processGraphStream` 被 `executeWithStream` 调用
- L2 LangGraph 状态机层 — `cognitiveEngine.stream()` 是 L3 的输入源
- L4 节点层 — 每个节点写入的 state 字段决定了 L3 的回调内容
- L8 基础设施层 — `ITracer` / Voice Pipeline 实现
