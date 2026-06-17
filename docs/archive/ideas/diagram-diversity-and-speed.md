# 图表多样化 + 生成提速

## Problem Statement

**How might we** 让奚童的画图能力从「一种辐射状分层布局打天下」变成「按需切换思维导图/流程图/时间线/知识图谱」，同时把生成时间从 ~40s 压到 < 20s？

## Recommended Direction

**方案 A：类型路由 + LLM 出语义 + 代码层布局，统一输出 Excalidraw**

### 核心洞察

当前 `DIAGRAM_SYSTEM_PROMPT`（`src/agent/graph/utils/diagram-helper.ts:23`）让 LLM 同时干两件事：

| 工作 | LLM 是否擅长 | 当前 |
|---|---|---|
| **语义工作**：决定节点是什么、怎么连接 | ✅ 擅长 | 在做 |
| **几何工作**：算 x/y 坐标、字号、对齐、避免重叠 | ❌ 不擅长（确定性问题） | **也在做** ← 慢、乱、闪烁的根源 |

**布局是确定性问题，应该用代码（算法）解。** 拆开后：

- LLM 输出从 5000-8000 tokens → 500-1500 tokens（节点+边列表）
- 速度从 ~40s → 5-10s
- 布局质量更高（算法不会算错坐标）
- 扩展图表类型 = 加一个布局算法

### 流程

```
用户提问
  ↓
[规则匹配关键词] ← 强信号直接路由（如「流程图」→flowchart）
  ↓ （无强信号时）
[LLM 分类器] ← 一次轻量调用（~2s），输出 graphType + confidence
  ↓
[对应的 LLM prompt] ← 只让 LLM 输出 { nodes, edges }（500-1500 tokens，~5s）
  ↓
[LayoutStrategy] ← 代码层确定性算法（< 1s）
  ↓
Excalidraw JSON → 渲染（保留可编辑性）
```

**总耗时**：~7-10s（远低于 20s 目标）

### 4 种图表类型与布局策略

| 图表类型 | 触发关键词 | LLM 输出结构 | 布局算法 |
|---|---|---|---|
| **思维导图/概念图** | 思维导图、脑图、概念图、梳理、脉络 | tree（根+子节点） | 辐射（角度分配 + 半径递增） |
| **流程图/决策图** | 流程图、决策、步骤、过程、因果 | DAG（节点+边+决策标签） | 简化分层（Sugiyama-lite，按层数等距 + 同层水平排开） |
| **时间线/对照图** | 时间线、阶段、演化、对比、对照 | 序列（带时间/阶段标签） | 等间距序列 + 标签 |
| **知识图谱/网状关系** | 关系图、知识图谱、网络、关联、影响 | graph（节点+边，无层级） | 圆形/网格分布兜底（不做真正力导向） |

## Key Assumptions to Validate

- [ ] **d3 库兼容性**：spike 验证 Obsidian 渲染进程能跑 d3-hierarchy / d3-force（1 天）。能跑→用库；不能跑→自实现简化版
- [ ] **意图分类准确率 > 80%**：抓 30 个真实样本测分类器（含模糊词），不够则补规则
- [ ] **LLM 小输出确实快**：跑一次 prompt 测速，确认从 40s → < 10s
- [ ] **简化布局算法视觉可接受**：手画 4 种布局 mock，先对齐审美预期

## MVP Scope

| 包含 | 不包含 |
|---|---|
| 4 种图表类型的意图分类（规则 + LLM 兜底） | 用户自定义图表类型 |
| 4 套 LLM prompt（每种类型一个，输出结构化 JSON） | Self-Verification 复杂校验 |
| 4 个布局算法（时间线、辐射、简化分层、简化网状） | 真正的力导向 / 完整 Sugiyama |
| 统一渲染成 Excalidraw | Mermaid 任何形式 |
| 现有 fire-and-forget + 占位机制保留 | 双轨制预览 |
| 类型分类置信度日志 | 用户纠错按钮（下个迭代） |

## Not Doing (and Why)

- **不用 Mermaid**：用户明确要全部 Excalidraw。即便流程图 Mermaid 更快，也不混用，保留可编辑性
- **不做双轨制**：用户不接受「中途换图」（Mermaid 预览→Excalidraw 替换），方案必须一次到位
- **不做真正的力导向布局**：知识图谱用圆形/网格分布兜底，避免性能黑洞
- **不做用户纠错 UI**：MVP 先把「分类准」做扎实，UI 留给下个迭代
- **不重写 visualizer.ts 的 fire-and-forget 机制**：现有的占位/超时/abort 逻辑保留

## 实施路径

### 阶段 0：Spike（先做，1 天）

验证 d3-hierarchy / d3-force 在 Obsidian 渲染进程能跑。结果决定后续是「用库」还是「自实现简化版」。

### 阶段 1：类型分类层（2-3 天）

- 关键词规则路由（强信号）
- LLM 分类器（轻量调用，模糊词兜底）
- 置信度日志

### 阶段 2：4 套 LLM prompt + 布局算法（5-7 天）

- 每种类型一个 prompt，输出 `{ nodes, edges, ... }` 结构化 JSON
- 4 个 LayoutStrategy 实现（基于 spike 结果决定用库还是自实现）
- 替换 `generateDiagram` 的核心逻辑

### 阶段 3：测试与回归（2-3 天）

- 30 个真实样本跑分类准确率
- 4 种类型各 5 个生成样本，人工评估布局质量
- 速度基准（目标 P95 < 15s）

## Open Questions

- 现有的 `generateDiagramProgressive`（已注释回退）要不要彻底删除？还是保留作为「超大图」兜底？
- 意图分类置信度低时，应该让 LLM 反问用户「你想要哪种图」，还是默默用默认 mindmap？MVP 默认后者
- 节点过多的兜底策略：> 20 个节点时是否自动降级到表格或文字总结？

## 相关代码

- `src/agent/graph/nodes/visualizer.ts` — 入口节点（fire-and-forget）
- `src/agent/graph/utils/diagram-helper.ts` — 核心 prompt + 生成逻辑
- `src/agent/tools/excalidraw.ts` — Excalidraw 工具与元素类型
- `src/views/sidebar/agent-chat-controller.ts` — onDiagramStart/Ready/Failed 回调
- `tests/unit/agent/graph/utils/diagram-helper.test.ts` — 现有测试
- `scripts/screenshot-all-diagrams.mjs` — 截图脚本（可用于布局质量回归）
