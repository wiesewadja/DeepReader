# Excalidraw 可视化（F-36）

> 让思考可见。用户说"画思维导图"，Agent 在对话中嵌入一张可交互的 Excalidraw 图形。

---

## F-36: VISUALIZER 节点 + Excalidraw 图表生成

- **为什么存在**: 认知引擎产出的结构分析（目录结构、概念关系、主题对比）天然适合图形表达。文字描述一棵树不如画出来；视觉化让用户一眼看到全貌，降低认知负荷。
- **用户故事**: 作为读者，我希望在问"这本书的整体结构是什么"时，奚童不只给文字回答，还自动生成一张思维导图/概念图，我可以直接在 Obsidian 里编辑和二次加工。
- **前置条件**:
  - Obsidian 已安装 Excalidraw 插件
  - Agent 状态机正常运行（至少 S0/S1 已完成）
  - `mainModel` 可用（用于调用 LLM 生成图形 JSON）
- **输入**: 用户消息中包含可视化关键词（正则匹配）
- **输出**: 对话流中追加 `![[Excalidraw/xxx.excalidraw]]` 嵌入，Obsidian 渲染为可交互图形
- **验收标准**:
  - [ ] 11 种关键词全覆盖（思维导图/脑图/流程图/概念图/画X图/可视化展示/可视化/导图/示意图/infographic/图表/知识图谱）
  - [ ] S1/S2/S3 三种深度均能触发可视化
  - [ ] VISUALIZER 失败不阻塞整体流程（safeNode 兜底）
  - [ ] Formatter 不误删嵌入语法（占位符保护）
  - [ ] 碰撞检测覆盖矩形/椭圆/菱形 + 文本独立碰撞
  - [ ] 箭头自动计算边缘交点（不依赖 LLM 精确坐标）
  - [ ] Z-index 排序：shapes > arrows > text
  - [ ] 视口自适应内容范围
  - [ ] 文件写入 Vault 的 `Excalidraw/` 目录
  - [ ] 文件名不含路径穿越字符（安全检查）
- **对应测试**:
  - 单元: `tests/unit/agent/tools/excalidraw.test.ts`（37 个：buildJSON、碰撞检测、语义验证、工具执行、edgeIntersection、z-index、视口、文本碰撞）
  - 单元: `tests/unit/agent/graph/utils/diagram-helper.test.ts`（12 个：关键词匹配、generateDiagram 成功/失败/边界）
  - 单元: `tests/unit/agent/graph/nodes/visualizer.test.ts`（7 个：节点生成、fallback、structuralAnalysis 分支）
  - 单元: `tests/unit/agent/graph/visualization-flow.test.ts`（集成：11 关键词 + 5 路由路径 + safeNode fallback）
  - 单元: `tests/unit/agent/graph/edges.test.ts`（16 个：S1/S2/S3 各深度路由 + 可视化意图判断）
  - E2E: `scripts/e2e-visualizer-full.mjs`（14 场景全覆盖）
- **覆盖状态**: ✅ 强

---

## 架构设计

### 整体流程

```
用户消息 "画个思维导图"
        │
        ▼
Inspectional (含 S0 Router) ──→ 检测到可视化意图（userHasDiagramIntent）
        │
        ▼
S1 / S2 / S3 正常执行（生成分析内容）
        │
        ▼
edges.ts 路由判断：
  routeAfterInspectional (S1后)
  routeAfterPreSearch (S2早停后)
  routeAfterAnalysis (S2/S3后)
        │
        ▼ 有意图
VISUALIZER 节点
  │ 1. 检测关键词（hasDiagramIntent regex）
  │ 2. 调用 diagram-helper.generateDiagram()
  │     └→ LLM 生成元素 JSON
  │     └→ excalidrawTool.execute() 写入 .excalidraw 文件
  │ 3. 返回 embed 追加到 analysisResult
        │
        ▼
S4 Formatter（embed 被 %%EMBED_N%% 占位符保护）
        │
        ▼
用户看到文字回答 + 可交互图形
```

### VISUALIZER 作为集中节点

VISUALIZER 不是散落在 S1/S3 内部的逻辑，而是一个独立的 LangGraph 节点。这个决策基于：

1. **单一职责**：图表生成只关心"分析内容 → 图形"，不关心分析本身怎么来的
2. **复用**：S1/S2/S3 三种深度都能路由到同一个 VISUALIZER
3. **故障隔离**：safeNode 包装，VISUALIZER 失败只 log 不阻塞
4. **维护性**：图表生成逻辑集中在一个文件（`diagram-helper.ts`），改一处全局生效

### 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| VISUALIZER 节点 | `src/agent/graph/nodes/visualizer.ts` | 检测意图 → 调用 diagram-helper → 追加 embed |
| 图表辅助 | `src/agent/graph/utils/diagram-helper.ts` | 意图检测 regex + LLM 调用 + JSON 提取 |
| Excalidraw 工具执行器 | `src/agent/tools/excalidraw.ts` | 元素转换、碰撞检测、文件写入 |
| Excalidraw 工具定义 | `src/agent/tools/definitions/excalidraw.ts` | LangChain tool 包装，设计哲学/布局参数 |
| 几何计算 | `src/agent/tools/excalidraw-geometry.ts` | edgeIntersection、calculateViewport（从 excalidraw.ts 拆出） |
| 路由逻辑 | `src/agent/graph/edges.ts` | `userHasDiagramIntent()` 在三个路由点判断 |

### 路由触发点

VISUALIZER 在三个路由函数中被触发：

| 路由函数 | 触发条件 | 输入来源 |
|---------|---------|---------|
| `routeAfterInspectional` | depth=1 + 有意图 + S1 无错误 | `structuralAnalysis` |
| `routeAfterPreSearch` | S2 早停 + 有意图 | `earlyStopContent` → `analysisResult` |
| `routeAfterAnalysis` | S2/S3 完成 + 有意图 | `analysisResult` |

**注意**: Proactive 模式和 Socratic 模式不经过 VISUALIZER（by design）。

### 意图检测

```typescript
const DIAGRAM_INTENT_RE =
  /思维导图|脑图|流程图|概念图|画.{0,6}图|可视化展示|可视化|导图|示意图|infographic|图表|知识图谱/;
```

检测对象：原始用户消息（`lastUserMsg`）+ 改写后的查询（`rewrittenQuery`），双重检测防止 Router LLM 剥离关键词。

### 碰撞检测与视觉优化

VISUALIZER 不依赖 LLM 生成精确坐标，而是在系统层面做后处理：

1. **edgeIntersection()** — 计算箭头与形状边缘的精确交点（矩形/椭圆/菱形三种几何体）
2. **Z-index 排序** — shapes(0) < arrows(1) < text(2)，保证文字永远在最上层
3. **calculateViewport()** — 根据所有元素边界自动计算 scrollX/scrollY/zoom
4. **detectTextOverlaps()** — 检测独立文本元素之间的重叠，返回警告

### embed 保护机制

S4 Formatter 会处理 wiki 链接（`[[xxx]]`），但 Excalidraw 嵌入语法 `![[Excalidraw/xxx.excalidraw]]` 不应被修改。保护机制：

1. Formatter 在处理前用 `%%EMBED_N%%` 占位符替换所有嵌入语法
2. 执行所有后处理管线（wiki link 修复、验证、清理）
3. 最后将占位符还原为原始嵌入语法

---

## 支持的图表类型

正则覆盖 11 种关键词，LLM 根据分析内容语义自动选择视觉模式：

| 视觉模式 | 适用场景 | 关键词示例 |
|---------|---------|-----------|
| 扇出（fan-out） | 分类、层次结构 | 思维导图、脑图、导图 |
| 汇聚（convergence） | 总结、归因 | 概念图 |
| 树形（tree） | 层级结构 | 知识图谱 |
| 时间线（timeline） | 流程、步骤 | 流程图、示意图 |
| 循环（spiral） | 迭代、反馈 | — |
| 并列（side-by-side） | 对比 | — |

LLM 不是按关键词硬编码模式，而是根据分析内容的语义选择最合适的视觉表达。

---

## 配置方式

无需额外配置。VISUALIZER 使用 Agent 认知引擎的 `mainModel` 和 `toolContext`，不引入新的外部依赖。

前提条件：
- Obsidian 安装 [Excalidraw 插件](https://github.com/zsviczian/obsidian-excalidraw-plugin)
- 文件输出到 Vault 的 `Excalidraw/` 目录（自动创建）

---

## 已知限制

1. **LLM 坐标质量** — 系统后处理修正了箭头交点，但结构性连接线仍可能穿过文字（取决于 LLM 布局质量）
2. **视口设置** — Obsidian Excalidraw 插件可能不尊重 `scrollX`/`scrollY`/`zoom` 设置
3. **Proactive 模式** — 不经过 VISUALIZER，不会附带图表（by design，proactive 触发时不适合主动生成图形）
4. **S2 Analytical 工具调用路径** — S2 通过 PlanExecute 的工具循环调用 excalidraw，而非 VISUALIZER 节点直接调用；两条路径并存（VISUALIZER 用于 S1/S3/早停，PlanExecute 工具循环用于 S2 深度分析）
5. **图形复杂度上限** — LLM 生成超复杂图形（50+ 元素）时，坐标质量会显著下降

---

## 关键设计决策

1. **VISUALIZER 作为集中节点** — 解耦图表生成与内容分析，单一职责，故障隔离
2. **双重意图检测** — 同时检查原始消息和改写查询，防止 Router LLM 剥离关键词
3. **后处理箭头修正** — 不依赖 LLM 精确坐标，系统级 edgeIntersection 计算更稳健
4. **gap=2** — 箭头与形状的间隙，与参考实现 excalidraw-diagram-skill 保持一致
5. **embed 占位符保护** — 防止 Formatter 的 wiki link 后处理误删嵌入语法
6. **safeNode 包装** — VISUALIZER 失败只 log 不阻塞，保障认知引擎主流程

---

## 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/graph/nodes/visualizer.ts` | VISUALIZER 节点 |
| `src/agent/graph/utils/diagram-helper.ts` | 图表生成辅助 |
| `src/agent/tools/excalidraw.ts` | Excalidraw 工具执行器 |
| `src/agent/tools/excalidraw-geometry.ts` | 几何计算（交点、视口） |
| `src/agent/tools/definitions/excalidraw.ts` | LangChain tool 定义 |
| `src/agent/graph/edges.ts` | 路由逻辑 |
| `src/agent/graph/prompts/router-prompt.ts` | Router 可视化路由规则 |
| `src/agent/graph/prompts/formatter-prompt.ts` | Formatter embed 保护指令 |

---

## 关联文档

- [agent-tools.md](./agent-tools.md) — F-12 ~ F-16 工具层（excalidraw 是第 14 个工具）
- [L4-nodes.md](../architecture/agent-state-machine/L4-nodes.md) — 节点层架构（VISUALIZER 章节）
- [L6-tools.md](../architecture/agent-state-machine/L6-tools.md) — 工具层架构
- [L2-langgraph-state-machine.md](../architecture/agent-state-machine/L2-langgraph-state-machine.md) — 状态机拓扑
