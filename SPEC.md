# SPEC: #2 ToolContext 子上下文分解

> **版本**: 1.1（修正版）
> **日期**: 2026-05-28
> **状态**: DRAFT

---

## 目标

当前 `ToolContext`（`src/agent/tools/types.ts`）是一个 25 字段的"上帝参数"，混入了至少 6 个不同关注点。每个工具通过闭包接收完整的 `ToolContext`，但没有任何工具使用超过 6 个字段。

本次重构将 `ToolContext` 分解为 5 个聚焦的子上下文接口（SubAgentContext 已随 subagent 删除而移除），让每个工具只声明自己真实依赖的子集。

---

## 子上下文设计

### VaultContext（2 字段）
- `app: App`
- `plugin: DeepReaderPlugin`
- 消费者：8 个工具（search-book, write-note, memory, profile, search-read-books, canvas, search-journal, weread-*）

### BookContext（7 字段）
- `indexId: string`
- `pdfName: string`
- `markdownFiles?: Record<string, string>`
- `localCache?: LocalToolCache`
- `currentNodeId?: string`
- `documentMetadata?: { title?: string; page_count?: number; author?: string }`
- `docDescription?: string`
- 消费者：search-book, read-section, write-note, canvas, excalidraw

### CrossBookContext（4 字段）
- `booklistBookIds?: string[]`
- `crossBookMode?: boolean`
- `bookshelfSummary?: string`
- `indexedBooks?: { id: string; name: string }[]`
- 消费者：search-read-books, syntopical 图节点

### WereadContext（1 字段）
- `wereadClient?: WereadApiClient`
- 消费者：weread-*（5 个工具）
- 注：`_wereadClient` 重命名为 `wereadClient`（子上下文已提供命名空间隔离）

### VisualContext（2 字段）
- `infographicConfig?: InfographicConfig`
- `journalDir?: string`
- 消费者：generate-infographic, search-journal

### 重构后的 ToolContext

```typescript
export interface ToolContext {
  vault: VaultContext;
  book: BookContext;
  crossBook?: CrossBookContext;
  weread?: WereadContext;
  visual?: VisualContext;

  // 图节点专用（向后兼容，后续 PR 可逐步移入图节点专属上下文）
  useLLMTreeSearch?: boolean;
  scopeNodeIds?: string[];
  ttsConfig?: { apiKey: string; baseUrl: string; model?: string; provider?: string };
  llmConfig?: { apiKey: string; baseUrl: string; model?: string };
  mode?: EngineMode;
  proactiveTrigger?: string;
  highlightContext?: string[];
  quotes?: QuoteItem[];
}
```

---

## 关键决策

1. **SubAgentContext 已移除**：SubagentManager 及所有相关文件在 ae975aec 中已删除
2. **sessionId 已移除**：从未被赋值或读取，是 subagent 的残留死代码
3. **DeepReaderPlugin 移入 context/vault.ts**：避免 tools/types.ts ↔ context/vault.ts 循环依赖
4. **Phase 2+3 合并为一个原子提交**：避免中间状态编译失败

---

## 涉及文件

### 新增
| 文件 | 内容 |
|------|------|
| `src/agent/tools/context/vault.ts` | VaultContext + DeepReaderPlugin |
| `src/agent/tools/context/book.ts` | BookContext |
| `src/agent/tools/context/cross-book.ts` | CrossBookContext |
| `src/agent/tools/context/weread.ts` | WereadContext |
| `src/agent/tools/context/visual.ts` | VisualContext |
| `src/agent/tools/context/index.ts` | 统一导出 |

### 修改
| 文件 | 变更 |
|------|------|
| `src/agent/tools/types.ts` | 重构 ToolContext 为嵌套容器，删除 17 个顶层字段 + sessionId |
| `src/agent/tools/index.ts` | createLangChainTools 条件注册路径更新 |
| `src/views/sidebar/agent-chat-controller.ts` | 两处构造站点适配新结构 |
| `src/agent/index.ts` | buildGraphConfigurable 适配新路径 |
| `src/agent/graph/shared-context.ts` | 去重 8 个重复字段 |
| `src/agent/tools/definitions/*.ts`（~14 个工具） | ctx.vault.* / ctx.book.* 路径更新 |

---

## 成功标准

- [ ] ToolContext 不再包含 `app`, `plugin`, `indexId`, `pdfName` 等散落顶层字段
- [ ] 每个子上下文接口字段数 ≤ 7
- [ ] `npm run build` 零错误
- [ ] SharedContext 不再重复 ToolContext 子上下文中的字段
- [ ] `_wereadClient` 重命名为 `wereadClient`
- [ ] grep 验证无残留旧路径（`ctx.app`, `ctx.pdfName`, `ctx._wereadClient`）

## Out of Scope

- VoiceConfig / EngineMode / UserInput / SearchScope 独立子上下文
- ToolExecutor 接口签名变更
- LangGraph State Schema 变更
