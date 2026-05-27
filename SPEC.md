# SPEC: #1 死代码清理 — SubagentManager + runAgentLoop + 废弃字段

> **版本**: 1.0
> **日期**: 2026-05-27
> **状态**: 实施中

---

## 背景

LangGraph 路径 (`runGraphEngine`) 已完全替代旧的 `runAgentLoop` 路径。但旧路径的代码仍保留，造成约 1,390 行僵尸代码：

- `SubagentManager` 被初始化但无法接收任务（`create_sub_agent` 未注册为 LangChain 工具）
- `runAgentLoop` 内部第 525 行无条件 throw，ReAct 循环不可达
- `create_sub_agent` / `check_sub_agent` 工具无法在 LangGraph 路径中产生实际效果
- SharedContext 有 5 个已迁移到 CognitiveEngineState 的废弃字段

---

## 变更范围

### 删除文件

| 文件 | 行数 | 原因 |
|------|------|------|
| `src/agent/agent-loop.ts` | 635 | 仅被 SubagentManager 使用，内部不可达 |
| `src/agent/subagent/` 目录（全部文件） | ~523 | 僵尸子系统 |
| `src/agent/tools/create-sub-agent.ts` | 210 | 工具定义无生产调用路径 |
| `src/agent/tools/definitions/sub-agent.ts` | ~20 | LangChain 包装，无实际效果 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/agent/index.ts` | 删除 `runAgentLoop` 导入、`SubagentManager` 导入/字段/`setupSubagentManager()`、`reloadContext()`、`filterToolDefinitions()` |
| `src/agent/graph/shared-context.ts` | 删除 5 个废弃字段：`depth`, `standaloneQuery`, `scopeNodeIds`, `structuralAnalysis`, `analysisResult` |
| `src/agent/tools/index.ts` | 删除 `createSubAgentTool` 导出、`createCheckSubAgentTool` 导入和注册 |
| `src/views/sidebar/agent-chat-controller.ts` | 删除 `setupSubagentManager(context)` 调用 |
| `src/agent/tools/types.ts` | 删除 `ToolContext.subagentManager` 字段 |
| `src/agent/ui/humanized-types.ts` | 删除 sub-agent 相关映射 |

### 不删除

- `LLMClient` / `LLMClientManager`（被 `MemoryConsolidator` 使用）
- `ToolExecutor` 接口（所有工具的核心接口）
- SharedContext 的 `tocSummary`, `betterQuestion`, `pdfName`（仍被 analytical 节点读取）

---

## 验证

1. `npm run build` 无报错
2. `npm run test:run` 全部通过
3. grep 确认无残留引用
