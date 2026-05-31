# 奚童阅读过程实时展示规范

## 1. 背景与目标

**动机**: 让用户看到奚童（书童）的阅读理解过程，学习如何深度阅读书籍。

**目标**: 在侧边栏实时滚动展示阅读感悟气泡，格式化输出开始后气泡自动折叠为"共 N 条阅读感悟，点击展开"。

**设计原则**:
- 奚童是伴读角色，气泡以同伴视角分享发现，语气友好、平等
- 气泡展示阅读理解发现（如"这段和第三章的结论矛盾——标记待反驳"），而非工具调用过程
- 用户可点击展开查看所有感悟，但无需与气泡交互

## 2. 非目标

- 不做用户与气泡的交互（点击仅为展开/收起）
- 不以专家身份教导用户
- 不在气泡中显示原始工具调用（如"调用 read_book_section"）

## 3. 架构流程

### 3.1 实际数据流

```
tool-execution.ts: executeSingleToolCall()
    ↓ 工具执行完成后
    ↓ 返回 ToolResultRecord { toolName, args, result, ... }
    ↓
analytical.ts: 调用 runPlanExecute()
    ↓ 获取 refinedResult.toolResults
    ↓ 设置 stateUpdate.toolResultsSnapshot
    ↓
LangGraph Stream (streamMode: "updates")
    ↓ 节点状态更新包含 toolResultsSnapshot
    ↓
stream-processor.ts: processGraphStream()
    ↓ for each node update:
    ↓   提取 stateUpdate.toolResultsSnapshot
    ↓   转换为 readingSteps[]
    ↓   调用 callbacks.onHumanizedProgress({ readingSteps, ... })
    ↓
agent-chat-controller.ts: onHumanizedProgress 回调
    ↓ 更新 message.readingSteps
    ↓
Message UI: 渲染气泡列表
```

### 3.2 关键文件

| 文件 | 作用 |
|------|------|
| `tool-execution.ts` | `executeSingleToolCall()` 执行工具，返回 `ToolResultRecord` |
| `analytical.ts` | 调用 `runPlanExecute()`，结果写入 `stateUpdate.toolResultsSnapshot` |
| `humanized-types.ts` | `ReadingProgressItem` 类型定义 |
| `stream-processor.ts` | 节点回调中从 `toolResultsSnapshot` 提取 `readingSteps` |
| `agent-chat-controller.ts` | 接收 `onHumanizedProgress`，更新 `message.readingSteps` |
| `Message/index.tsx` | 渲染气泡列表 |

## 4. 详细设计

### 4.1 `readingSteps` 生成逻辑

**问题根源**: `stream-processor.ts` 发送 `readingSteps: []`（始终为空）

**解决方案**: 从 `stateUpdate.toolResultsSnapshot` 提取

```typescript
// stream-processor.ts (修正)
const toolSnapshot = stateUpdate.toolResultsSnapshot as ToolResultSnapshot[] | undefined;
const readingSteps: ReadingProgressItem[] = (toolSnapshot || []).map(ts => {
  const actionFn = TOOL_TO_ACTION[ts.toolName];
  const action = actionFn?.(ts.args, { markdownFiles: [] }) || ts.toolName;
  return { action, status: 'done' as const };
});
```

### 4.2 气泡文案生成 (`TOOL_TO_ACTION`)

**现状**: `humanized-types.ts` 中 `TOOL_TO_ACTION` 将工具名映射为阅读理解发现描述

**需要新增的工具映射**:

```typescript
// humanized-types.ts
TOOL_TO_ACTION: {
  read_book_section: (args) => {
    // args: { node_id, start_line, end_line }
    return `精读 ${args.node_id} 第 ${args.start_line}-${args.end_line} 行`;
  },
  search_book: (args) => {
    // args: { query }
    return `检索关键词「${args.query}」`;
  },
  // ... 其他工具
}
```

**注意**: 当前 `TOOL_TO_ACTION` 返回的是纯描述文本，但用户期望看到"阅读理解发现"而非工具操作。需要扩展为更智能的语义理解。

### 4.3 UI 渲染行为

**格式化输出开始时**:
- `formatter` 节点开始输出时，调用 `onHumanizedProgress`
- 此时 `readingSteps` 已累积了之前所有节点的工具调用结果
- UI 检测到 `formatter` 节点进入，将气泡区域切换为折叠态

**折叠态显示**:
```
共 N 条阅读感悟，点击展开
```

**展开态显示**:
```
① 精读第一章 第12-18行 — 发现本段与第三章结论存在逻辑矛盾
② 检索关键词「主体性」— 在第三章找到3处相关论述
③ ...
```

### 4.4 状态流转

```
[analytical 节点]
  ↓ 工具执行完成，readingSteps 累积
  ↓ 调用 onHumanizedProgress({ readingSteps })
  ↓
[inspectional/pre_search/analytical 节点]
  ↓ 持续累积 readingSteps
  ↓ 调用 onHumanizedProgress({ readingSteps })
  ↓
[formatter 节点]
  ↓ 调用 onHumanizedProgress({ readingSteps, mainAction: { type: 'writing' } })
  ↓ UI 切换为折叠态
  ↓ 格式化输出内容通过 onContent 回调发送
  ↓
[END]
```

## 5. 实现步骤

### Step 1: 修复 `stream-processor.ts` 读取 `readingSteps`

**文件**: `src/agent/graph/stream-processor.ts`

**修改**: 从 `stateUpdate.toolResultsSnapshot` 提取 `readingSteps`

```typescript
// 在节点回调处理中（约第102-110行）
if (action && callbacks.onHumanizedProgress) {
  const toolSnapshot = stateUpdate.toolResultsSnapshot as ToolResultSnapshot[] | undefined;
  const readingSteps: ReadingProgressItem[] = (toolSnapshot || []).map(ts => ({
    action: ts.toolName, // TODO: 后续替换为 TOOL_TO_ACTION 映射
    status: 'done' as const,
  }));

  callbacks.onHumanizedProgress({
    mainAction: { type: action.type as any, detail: getNodeStatus(nodeName) },
    readingSteps, // ← 从 toolResultsSnapshot 提取
    currentReadingLevel: action.level,
    generatedContent: '',
    overallProgress: 0,
  });
}
```

### Step 2: 扩展 `TOOL_TO_ACTION` 映射

**文件**: `src/agent/ui/humanized-types.ts`

**修改**: 为 `read_book_section` 和 `search_book` 添加映射，返回更智能的阅读发现描述

### Step 3: 修改 Message UI 渲染逻辑

**文件**: `src/views/sidebar/ChatMessage/Message/index.tsx`

**修改**:
1. 接收 `readingSteps` prop
2. 渲染为编号列表气泡
3. 格式化输出开始时自动折叠
4. 点击可展开/收起

### Step 4: 调整气泡语义（可选增强）

**问题**: 当前工具映射返回的是"操作描述"而非"阅读理解发现"

**改进方向**:
- 在 `tool-execution.ts` 的 `executeSingleToolCall` 返回后，分析工具结果提取语义
- 例如: `read_book_section` 返回内容后，检测是否包含与前文矛盾的观点
- 这需要更复杂的 LLM 分析，超出当前 scope

## 6. 风险与限制

1. **实时性**: `toolResultsSnapshot` 在节点结束时才可用，非真正实时
2. **语义深度**: 当前只展示工具操作，未展示真正的"阅读理解发现"
3. **跨节点累积**: 需要确保 `readingSteps` 在多轮节点调用间正确累积

## 7. 测试计划

1. 端到端测试: 发送阅读问题，验证侧边栏显示气泡列表
2. 折叠测试: formatter 开始输出后气泡自动折叠
3. 展开测试: 点击展开可查看所有感悟
4. 累积测试: 多个节点的工具调用均出现在列表中
