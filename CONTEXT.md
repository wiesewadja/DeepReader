# DeepReader — Agent 认知引擎上下文

LangGraph 四层认知引擎 + FrontendAgent 的领域语言。本文件只记录**本上下文特有的术语**，不收录通用编程概念。

## Language

**SharedContext**:
通过 `config.configurable.sharedContext` 注入所有图节点的**不可变请求上下文**。只放本次对话的输入与依赖（query / history / memory / profile / tool 依赖 / abort 信号）。节点执行中产生、向下游流转的可变数据不在此处，归 LangGraph State。
_Avoid_: 全局状态、god context、runtime config（后者指 mainModel/fastModel 等执行依赖，留 configurable 顶层）

**LangGraph State** (`CognitiveEngineState`):
图执行中节点之间流转的可变数据，由 LangGraph 的 reducer/checkpoint 管理。例如 `tocSummary`、`betterQuestion` 由 inspectional 产出供下游消费，`prevSearchedBlockIds` 在节点间累积。
_Avoid_: 把它和 SharedContext 混称"状态"——前者是运行态、后者是输入

**双轨制** (Dual-track):
同一数据同时挂在 `config.configurable` 顶层和 `configurable.sharedContext` 内部、节点取法不一的反模式。已在 ADR-0001 中收敛为单一来源（sharedContext）。

**输入 = Context / 产出 = State**:
SharedContext 与 LangGraph State 的划界规则。请求的不可变输入归 Context；节点产出且向下流转的可变数据归 State。

**初始种子 vs 运行态** (initial seed vs runtime):
`initialPrevSearchedBlockIds`（Context，从历史抽取的上一轮已检索 block）是种子；`State.prevSearchedBlockIds` 是本轮节点间累积的去重集合。前者只读，后者随执行增长。

**可配置运行时依赖** (configurable runtime deps):
`mainModel` / `fastModel` / `callbacks` / `enableHumanReview` 等 LangGraph 执行依赖，留在 `config.configurable` 顶层，不并入 SharedContext——它们与具体某次对话的业务上下文无关。

**FrontendAgent**:
Agent 的唯一入口（`FrontendAgent.chat()` → `runGraphEngine()` → `stream()`），负责装配 SharedContext 并驱动图执行。

## Decisions

- [ADR-0001: SharedContext 收敛](./docs/adr/0001-shared-context-convergence.md) — 消除双轨制，确立 State/Context 划界，删除 4 个死字段。
