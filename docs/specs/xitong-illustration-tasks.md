# Tasks: 奚童回复配图实现

基于已批准的 `xitong-illustration-plan.md`，拆分为可独立完成的 task。每个任务包含验收标准和验证方式。

## Task 1: 创建 SVG 模板库 `illustration-library.ts`

- **目标**：实现 4 个基础横幅 SVG + 8 个 motif 叠加函数 + 暗色 CSS 变量支持。
- **文件**：
  - `src/components/message/illustration-library.ts`（新建）
  - `src/components/message/message.css`（修改，新增 CSS 变量）
- **验收**：
  - `renderIllustration({ scene: 'study-night', motifs: ['moon'], quote: '...', type: 'hero' })` 返回非空 SVG 字符串。
  - 4 个 scene 和 8 个 motif 组合都能渲染不报错。
  - SVG 中颜色使用 `var(--xitong-bg)`、`var(--xitong-ink)` 等 CSS 变量。
- **验证**：`npm run test:run` 通过新增单元测试；手动打开 HTML 原型检查效果。
- **依赖**：无。

## Task 2: 实现占位符解析与前端渲染

- **目标**：在 `AIMessage` 中解析 `<illustration>` 占位符并替换为 SVG。
- **文件**：
  - `src/components/message/message.ts`（修改）
  - `src/components/message/types.ts`（如需要，新增 IllustrationIntent 类型）
  - `tests/unit/components/message/illustration-render.test.ts`（新建）
- **验收**：
  - 输入文本含 hero 占位符，输出 DOM 中在正确位置出现 `.xitong-illustration-hero`。
  - 输入文本含 inline 占位符，输出 DOM 中出现 `.xitong-illustration-inline`。
  - 未知 scene 回退到 `ink-grind`。
  - Markdown 不会把占位符当普通文本渲染出来。
- **验证**：`npm run test:run`。
- **依赖**：Task 1。

## Task 3: 实现 `illustration-matcher` 和 `quote-trimmer`

- **目标**：根据回复内容选择 scene 和 motifs，并截取金句。
- **文件**：
  - `src/agent/graph/utils/illustration-matcher.ts`（新建）
  - `src/agent/graph/utils/quote-trimmer.ts`（新建）
  - `tests/unit/agent/illustration-matcher.test.ts`（新建）
  - `tests/unit/agent/quote-trimmer.test.ts`（新建）
- **验收**：
  - `"因为作者想表达..."` → scene=`study-night`。
  - `"没关系，慢慢来"` → scene=`plum-tea`。
  - `"总结起来有三点"` → scene=`scroll-summary`。
  - `"月下江边"` → motifs 包含 `moon` 和 `water`。
  - 长句首句截取 ≤12 字；空文本回退默认金句。
- **验证**：`npm run test:run`。
- **依赖**：无。

## Task 4: 创建 `illustrator` 节点并扩展 state

- **目标**：在 LangGraph 中新增 illustrator 节点，同步输出 `illustrationIntent`。
- **文件**：
  - `src/agent/graph/nodes/illustrator.ts`（新建）
  - `src/agent/graph/state.ts`（修改）
  - `tests/unit/agent/illustrator-node.test.ts`（新建，mock state 验证输出）
- **验收**：
  - 输入 mock state 含 `analysisResult`，节点返回 `{ illustrationIntent: { scene, motifs, quote, type: 'hero' } }`。
  - 节点执行时间不依赖 LLM（纯本地计算）。
  - state 类型检查通过。
- **验证**：`npm run test:run` + `npm run typecheck`。
- **依赖**：Task 3。

## Task 5: 修改 `formatter` 插入占位符

- **目标**：formatter 读取 `state.illustrationIntent`，在 `formattedOutput` 中插入 hero 和 inline 占位符。
- **文件**：
  - `src/agent/graph/nodes/formatter.ts`（修改）
  - `tests/unit/agent/formatter-illustration.test.ts`（新建）
- **验收**：
  - 有 intent 时，输出以 `<illustration type="hero" ... />` 开头。
  - 段落数 ≥3 且检测到主题切换时，输出包含 `<illustration type="inline" ... />`。
  - 无 intent 时，formatter 行为与现在一致。
- **验证**：`npm run test:run`。
- **依赖**：Task 2、Task 4。

## Task 6: 接入 LangGraph 路由

- **目标**：把 illustrator 节点注册到 graph，并调整 edges 使 analytical → illustrator → formatter。
- **文件**：
  - `src/agent/graph/index.ts`（修改）
  - `src/agent/graph/edges.ts`（修改）
  - `src/agent/graph/node-names.ts`（如需要，可能已包含）
- **验收**：
  - graph 能正常编译启动。
  - 运行一次真实查询，日志中能看到 illustrator 节点执行且返回 intent。
  - 原有路由（不含配图时）不被破坏。
- **验证**：`npm run deploy` 到 test-vault，发送查询，查看日志。
- **依赖**：Task 4、Task 5。

## Task 7: L3 轻量 E2E 验证

- **目标**：在真实 Obsidian 环境中验证配图渲染和场景正确性。
- **文件**：
  - `tests/e2e-light/agent-illustration.spec.ts`（新建）
- **验收**：
  - 发送分析型问题，DOM 中存在 scene 为 `study-night` 的 hero 配图。
  - 发送安慰型问题，DOM 中存在 scene 为 `plum-tea` 的 hero 配图。
  - 发送长回复，段落间存在 inline 配图。
  - 暗色主题下 SVG 颜色适配。
- **验证**：`npm run e2e-light`。
- **依赖**：Task 2、Task 6。

## Task 8: 性能回归与边界兜底

- **目标**：确保配图不显著拖慢 TTCF，且异常情况下优雅降级。
- **文件**：
  - `src/agent/graph/nodes/illustrator.ts`（修改，增加错误兜底）
  - `src/components/message/message.ts`（修改，增加占位符解析异常兜底）
- **验收**：
  - illustrator 节点异常时返回 `null`，formatter 继续输出无配图回复。
  - 占位符解析异常时保留原始文本，不崩溃。
  - 连续 5 次查询 TTCF 平均增加 < 200ms。
- **验证**：手动计时 + E2E 日志。
- **依赖**：Task 6、Task 7。

## 执行顺序

```
Task 1 ──┐
         ├──▶ Task 2 ──┐
Task 3 ──┐              │
         ├──▶ Task 4 ──┼──▶ Task 5 ──▶ Task 6 ──▶ Task 7 ──▶ Task 8
Task 3 ──┘              │
                        │
                   （formatter 需要前端渲染和 intent 输出）
```

## 最小可启动集（MVS）

如果时间有限，优先完成 Task 1 + Task 3 + Task 4 + Task 5 + Task 6，即可在 test-vault 中看到基础效果。Task 2 可以简化成直接字符串替换（不经过复杂 DOM 渲染），Task 7/8 后续补齐。