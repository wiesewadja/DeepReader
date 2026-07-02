# SharedContext 收敛：消除双轨制，确立 State/Context 划界

**Status**: accepted
**Date**: 2026-07-02

## Context

`SharedContext` 通过 `config.configurable.sharedContext` 注入所有 LangGraph 节点。重构前它名义上是 11 字段的"共享上下文"，但代码审查揭示出三类比"宽接口"更尖锐的问题：

1. **双轨制**。`chatHistory`、`toolContext` 同时挂在 `config.configurable` 顶层和 `configurable.sharedContext` 内部；节点取法不统一（`inspectional` 取顶层 `chatHistory`，`formatter` 取 `ctx.chatHistory`；`syntopical` 同一函数内既取顶层 `toolContext` 又取 `ctx.toolContext`）。这是 bug 温床。
2. **State vs Context 职责重叠**。`tocSummary`、`betterQuestion` 既是 LangGraph State 字段（由 inspectional 节点产出），又出现在 SharedContext 接口里；节点用 `ctx?.x ?? state.x` 兜底。
3. **死字段**。`s2ToolResults`（无填充、无消费）、`tocSummary`/`betterQuestion`（接口有、`createSharedContext` 从不填充，ctx 侧永远 undefined）、`llmClientManager`（仅 index.ts 自存自取，节点零消费）。

另发现一个被松散类型掩盖的真实 bug：`visualizer.ts` 从顶层 `configurable.abortSignal` 取值，但 `buildConfigurable` 从未在顶层塞该键 → 取到 `undefined`，用户取消信号对图表生成失效。收敛类型后此问题立即暴露。

## Decision

1. **单一来源**：业务上下文统一从 `config.configurable.sharedContext` 取。删除 `buildConfigurable` 顶层重复的 `chatHistory`、`toolContext` 键。运行时基础设施（`mainModel`/`fastModel`/`callbacks`/`enableHumanReview`）保留在顶层——它们是 LangGraph 执行依赖，与本次对话的业务上下文无关，不属于 SharedContext。
2. **划界原则：输入 = Context，产出 = State**。请求的不可变输入/依赖（query、history、memory、profile、tool 依赖、abort 信号）归 SharedContext；节点执行中产生、向下游流转的可变数据（`tocSummary`、`betterQuestion`、运行态 `prevSearchedBlockIds`）归 LangGraph State。
3. **删除死字段**：`s2ToolResults`、`tocSummary`、`betterQuestion`、`llmClientManager` 从 SharedContext 接口移除。节点里 `ctx?.tocSummary ?? state.tocSummary` 简化为 `state.tocSummary`。
4. **种子 vs 运行态显式分离**：`prevSearchedBlockIds`（在 ctx 中）改名 `initialPrevSearchedBlockIds`，明确"初始种子"语义；运行中累积的去重集合仍走 State.prevSearchedBlockIds。
5. **顺手修复 abortSignal bug**：`visualizer` 改读 `ctx.abortSignal`（该值本就由 `createSharedContext` 填充），既统一来源又恢复取消信号。
6. **顺手修复 syntopical 守卫 bug**：`if (!toolContext?.app)` 历史笔误，`ToolContext` 顶层无 `app`（应为 `vault.app`），原代码因 configurable 松散类型未报错。改为 `!toolContext?.vault?.app`。

## Considered Options

- **拆 3 个窄接口（SearchContext / PromptContext / RuntimeContext）**：拒绝。收敛 + 删死字段后 ctx 仅 8 字段，已不算宽；`toolContext`/`recentHistorySummaries` 横跨多个分组，切分不干净；拆分要在 `buildConfigurable` 组装多对象 + 每节点取多键，机械复杂度反增；测试 mock 单对象比多对象更简。窄接口可在未来 ctx 再次膨胀时重新评估。
- **把 mainModel/fastModel/callbacks 也并入 SharedContext 形成 RequestEnvelope**：拒绝。它们与业务上下文语义不同层，混入会让 ctx 膨胀且模糊职责。顶层留这些键不构成"双轨"（无同名重复）。

## Consequences

- `SharedContext` 从 11 字段降至 8 字段：`rawUserQuery`、`chatHistory`、`memoryContext`、`userProfileSummary`、`recentHistorySummaries`、`initialPrevSearchedBlockIds`、`toolContext`、`abortSignal`。
- 节点不再从 `configurable` 顶层取 `chatHistory`/`toolContext`/`abortSignal`，新增业务上下文字段时应加进 `SharedContext` 而非顶层。
- `syntopical` 守卫修复后，跨书主题阅读路径将真正执行节点逻辑（此前守卫恒为真、节点 early return 空结果）——需在跨书场景下回归验证。
- 取消图表生成（abort）在 visualizer 路径重新生效，需验证用户中止时图表不再继续生成。

## 验证状态（2026-07-02）

动态验证经 `evalBackdoor` 通道（真实 LLM）执行：

- ✅ **depth=2 分析阅读**：48.8s 真实对话通过，覆盖改动最多的 analytical/pre-search/inspectional 节点（全走 ctx 取数），formatter 输出含正确 wiki 链接。
- ✅ **visualizer 节点执行**：trace `["inspectional","visualizer","formatter"]` 证节点在真实链路跑通、ctx 改动未致崩溃。
- ⏸ **syntopical 跨书 / visualizer abortSignal 生效**：`evalBackdoor` 通道先天不注入 `crossBook` 与 `abortSignal`（`context` 仅单书、`opts` 无 signal），这两个场景在 ad-hoc 探针里触发不了，**以代码审查兜底**——signal 路径单一无分支（`buildConfigurable → SharedContext.abortSignal → ctx.abortSignal`），守卫修复是纯类型修正（`.app`→`.vault?.app`）、节点内部逻辑未动，且 syntopical 此前恒 early-return 故"恢复执行"等价于首次启用，下游问题属预存潜伏而非本次引入。

这两条是**有意搁置**的已知项，非遗漏：要动态确证需扩展 evalBackdoor（注入 crossBook + abortSignal）或走 sidebar UI 手动实测，留待该路径 deemed 高频或再次改动时补。
