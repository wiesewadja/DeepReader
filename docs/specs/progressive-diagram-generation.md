# Spec：渐进式分节图表生成（Progressive Section-by-Section Diagram Generation）

## 目标

**构建什么**：把异步 visualizer 的图表生成从"单次 LLM 调用吐完整 JSON"改为"多节增量生成"——每次 LLM 调用只生成一节元素，逐节追加到内存累计数组并落盘成 `.excalidraw`（纯 JSON），每节完成后更新前端让用户看到图逐步生长；全部完成后一次性转换为 `.excalidraw.md`（Excalidraw 插件原生格式）。

**为什么**：
- 当前单次 `generateDiagram` 让 LLM 一次输出几十个元素的完整 JSON，耗时约 2 分钟，偶发 LLM API 挂死（曾卡 15 分钟）
- 单次大输出易撞 token 上限产生截断坏 JSON
- 用户在占位气泡前等 2 分钟无任何反馈，体验差

**用户是谁**：在 Obsidian 里让奚童"画思维导图/流程图"的读者。

**成功长什么样**：
- 用户发出画图请求后，**首节（中心主题 + 主骨架）在 30 秒内可见**（之前要等 2 分钟才一次性出现）
- 后续每 15-25 秒长出一节，图渐进式生长
- 总耗时不显著增加（甚至因单节输出小、LLM 思考聚焦而略降）
- 不再出现"挂死 15 分钟无反馈"
- 最终产物是 `.excalidraw.md`（与当前一致，保留插件原生格式所有功能）

**参考来源**：[coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) 的 "Section-by-Section Workflow"。该 skill 面向 Claude Code（编码 agent，多轮 Edit 文件）；本 spec 把它的分节思想移植到运行时 agent（LangGraph 单次 invoke 链）。

---

## 核心设计：双格式策略（解法 A）

```
渐进过程：内存累计 elements → 落盘 .excalidraw（纯 JSON）
           ↓ 每节完成
           onDiagramSection → 前端 embed = ![[xxx.excalidraw]]（Obsidian 渲染 JSON）
           ↓ 用户看到图生长
全部完成：累计 elements → buildExcalidrawMd → 落盘 .excalidraw.md
           ↓ 删除中间 .excalidraw
           onDiagramReady → 前端 embed 切换为 ![[xxx.excalidraw.md]]
```

**为什么渐进用 `.excalidraw`（JSON）而非 `.excalidraw.md`**：
- JSON 数组直接 push 元素，真增量；`.excalidraw.md` 的 compressed-json 是整体压缩，无法字节追加
- JSON 中间态可读，便于调试
- 每节只需 `JSON.parse → push → JSON.stringify`，无需 lz-string 解压/重压缩

**为什么最终要转 `.excalidraw.md`**：
- Excalidraw 插件原生格式，支持 OCR / block 链接 / 全文搜索
- 与当前产物一致，用户无感知
- 转换用现有 `buildExcalidrawMd`（已验证不破坏 fontSize）

---

## 命令（Commands）

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 单个测试：`npx vitest run tests/unit/agent/graph/utils/diagram-helper.test.ts`
- 部署：`npm run deploy` → test-vault 的 `deepreader-dev/`
- 实测验证：Obsidian 内发"帮我画一张思维导图..."消息，观察图表气泡渐进生长
- LangSmith trace 分析：用 `langsmith-tracer` skill 查 visualizer 节点耗时

---

## 受影响模块

### `src/agent/graph/utils/diagram-helper.ts`（核心重构）
- 当前：`generateDiagram()` 单次 `model.invoke` → 完整 JSON → excalidrawTool.execute 写 `.excalidraw.md` → 返回 embed
- 新增：`generateDiagramProgressive()` 多节循环
  - **规划阶段**：一次 invoke 让 LLM 输出"分节大纲"（节标题 + 每节内容 + 节间连接 + y 坐标区间）
  - **生成阶段**：按大纲逐节 invoke，每节返回该节的 elements
  - **累积阶段**：每节 elements 合并到内存累计数组，落盘 `.excalidraw`（JSON），触发 `onDiagramSection(embed, i, total)`
  - **收尾阶段**：累计 elements 经 `buildExcalidrawJSON`（字号优化/去重/碰撞检测）→ `buildExcalidrawMd` → 落盘 `.excalidraw.md`，删除中间 `.excalidraw`，返回最终 embed
- 保留现有 `generateDiagram`（单次版）作为 fallback

### `src/agent/tools/excalidraw.ts`（新增 JSON 落盘入口）
- 当前：`excalidrawTool.execute` 写 `.excalidraw.md`
- 新增：`writeExcalidrawJson(filename, elements, context)` —— 写纯 JSON 到 `Excalidraw/filename.excalidraw`（不带 .md），用于渐进中间态
- 复用 `buildExcalidrawJSON`（保证元素格式一致）

### `src/agent/tools/excalidraw-md.ts`（无改动）
- `buildExcalidrawMd(data)` 保持现状——收尾阶段调用，一次性转换
- 不需要增量读写能力（渐进过程用纯 JSON，不碰 .md）

### `src/agent/graph/nodes/visualizer.ts`（改调用入口）
- 当前：调 `generateDiagram` 单次
- 改为：调 `generateDiagramProgressive`，传入 `onSectionReady` 回调
- watchdog 超时调整：从"整图 180s"改为"单节 60s + 总 240s"双阈值

### `src/agent/graph/shared-context.ts` + `src/agent/types.ts` + `src/agent/index.ts`（新增回调）
- 新增 `onDiagramSection?: (embed: string, sectionIndex: number, totalSections: number) => void`
- ⚠️ **三处都要改**（接口 / 桥接层 engineCallbacks / 实现），参考 [[agent-callback-bridge]] 教训

### `src/views/sidebar/agent-chat-controller.ts`（渐进更新占位气泡）
- `onDiagramSection` 实现：更新同一 `activeDiagramMessageId` 气泡的 embed（首节 embed = `![[xxx.excalidraw]]`）
- 状态文案随节变化：`正在绘制第 2/4 节...`
- `onDiagramReady`（全部完成）：embed 切换为 `![[xxx.excalidraw.md]]`，状态清除，做最终收尾

### `tests/`（新增测试）
- `tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`：分节生成流程
- `tests/unit/agent/tools/excalidraw.test.ts`：补充 `writeExcalidrawJson` 测试
- 更新 `tests/unit/agent/graph/nodes/visualizer.test.ts`：onDiagramSection 回调

---

## 技术约束

- 遵循现有 LangGraph 节点模式（visualizer 仍 fire-and-forget，setTimeout(0) 隔离 async context）
- 文件操作走 Vault API（`adapter.read` / `adapter.write`），不直接 fs
- 日志用 `utils/logger.ts` 的 `agentLog`，不用 console.log
- Agent 唯一入口不变：`FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- TypeScript 严格模式（strictNullChecks）
- 不新增 npm 依赖（lz-string 已有）
- 渐进中间态文件后缀 `.excalidraw`（纯 JSON）；最终产物 `.excalidraw.md`（插件格式）
- 收尾转换必须经过 `buildExcalidrawJSON`（字号优化/去重/碰撞检测），保证视觉质量

---

## 代码风格

```typescript
// 函数命名：动词 + 名词，异步用 async/Promise
export async function generateDiagramProgressive(
  query: string,
  content: string,
  model: BaseChatModel,
  toolContext: ToolContext,
  options: { pdfName?: string; signal?: AbortSignal },
  callbacks: {
    onSectionReady?: (embed: string, sectionIndex: number, totalSections: number) => void;
    onSectionFailed?: (sectionIndex: number, reason: string) => void;
  },
): Promise<string>  // 最终 .excalidraw.md 的 embed，空字符串表示全部失败

// 分节大纲类型
interface DiagramSectionPlan {
  title: string;          // 节标题（如"中心主题"、"动力系统分支"）
  content: string;        // 该节要表达的内容要点
  connectsTo?: string[];  // 该节需要连接到的其他节标题（用于跨节箭头）
  yBand: [number, number]; // 该节的 y 坐标区间（避免节间重叠）
}
```

错误处理：单节失败不抛出中断，记录原因继续下一节；全部失败才返回空字符串。

---

## 测试策略

### 测试层级
- **单元测试（Vitest）**：分节生成逻辑、JSON 落盘、跨节绑定
- **实测验证（Obsidian）**：发画图消息观察渐进生长
- **LangSmith trace**：验证每节 invoke 的耗时和 token

### 测试位置
- `tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`
- `tests/unit/agent/tools/excalidraw.test.ts`（补充 writeExcalidrawJson）
- `tests/unit/agent/graph/nodes/visualizer.test.ts`（补充 onDiagramSection）

### 覆盖范围（关键用例）
1. **分节大纲解析**：LLM 返回大纲 JSON，正确解析为 `DiagramSectionPlan[]`
2. **逐节生成累积**：3 节 mock，每节 invoke 返回部分元素，内存累计 = 全部元素
3. **JSON 落盘**：每节完成写 `.excalidraw`（JSON），文件内容随节增长
4. **收尾转换**：累计元素 → `buildExcalidrawJSON` → `buildExcalidrawMd` → `.excalidraw.md`，fontSize 保留
5. **中间文件清理**：收尾后 `.excalidraw` 被删除，只留 `.excalidraw.md`
6. **跨节箭头绑定**：节2 的箭头 startBinding 指向节1 的元素 id，合并后绑定有效
7. **单节失败重试**：节2 首次失败、重试成功 → 最终包含节2
8. **单节彻底失败**：节2 重试仍失败 → 跳过节2，仍返回节1+节3 的 embed
9. **onDiagramSection 多次触发**：N 节触发 N 次，sectionIndex 递增，embed 路径为 `.excalidraw`
10. **onDiagramReady 最终 embed**：路径为 `.excalidraw.md`（非 `.excalidraw`）
11. **abort 中断**：用户在节2 生成中 abort → 停止后续节，已生成节保留
12. **大纲解析失败 fallback**：LLM 没返回有效大纲 → 回退到单次 `generateDiagram`

### 不依赖外部 API
- mock `model.invoke` 返回预设的分节 JSON
- mock `toolContext.vault.app.vault.adapter` 的 read/write

---

## 边界

### Always（必须做）
- 跑 `npm run test:run` 和 `npm run build` 再提交
- 遵循命名约定（camelCase 函数、PascalCase 类型）
- 边界处校验输入（节大纲为空、elements 为空等）
- 新增方法写 JSDoc
- 每节 invoke 都检查 abortSignal
- 收尾后删除中间 `.excalidraw` 文件（不残留）
- 保留现有 `generateDiagram`（单次版）作为 fallback

### Ask First（先问用户）
- 改 DIAGRAM_SYSTEM_PROMPT 的分节策略（影响所有图）
- 改 watchdog 超时阈值
- 改 `.excalidraw.md` 文件格式

### Never（禁止）
- 提交密钥到 git
- 修改 `bin/` 下的构建产物
- 删除失败的测试用例（除非确认是误测）
- console.log 替代 utils/logger.ts
- 绕过 Obsidian Vault API 直接 fs 操作
- 节与节并行生成（必须串行，因跨节绑定依赖）
- 残留中间 `.excalidraw` 文件（收尾必须清理）

---

## 验收标准

### 功能性
1. ✅ 发出画图请求后，**首节在 30 秒内**通过 `onDiagramSection` 更新到占位气泡（embed = `![[xxx.excalidraw]]`，用户看到中心骨架）
2. ✅ 后续每节完成都触发 `onDiagramSection`，占位气泡状态文案显示"正在绘制第 N/M 节..."
3. ✅ 全部节完成后，`onDiagramReady` 触发，embed 切换为 `![[xxx.excalidraw.md]]`（最终格式）
4. ✅ 最终 `.excalidraw.md` 文件视觉质量不低于当前单次生成（字号优化、去重、布局保留）
5. ✅ 中间 `.excalidraw` 文件被删除，只留 `.excalidraw.md`
6. ✅ 跨节箭头正确连接（节2 的箭头指向节1 的元素，渲染时不悬空）

### 健壮性
7. ✅ 单节 LLM 失败 → 自动重试 1 次 → 仍失败则跳过该节，继续后续节，最终返回已生成节的 embed
8. ✅ 单节超时（60s）→ 触发该节 abort + 重试，不卡死整图
9. ✅ 总超时（240s）→ 触发 onDiagramFailed，占位气泡显示失败提示（复用现有失败路径）
10. ✅ 用户中途 abort → 停止后续节，已生成节保留显示（中间 `.excalidraw` 可保留或清理，倾向于保留让用户看到部分图）
11. ✅ 分节大纲解析失败 → fallback 到单次 `generateDiagram`（保留旧路径）

### 性能
12. ✅ 首节 TTCF（首字节响应时间）< 30 秒（当前整体 2 分钟）
13. ✅ 总耗时不超过当前单次生成的 1.2 倍（允许大纲规划开销）
14. ✅ 每节 invoke 的输出 token < 单次完整生成的 1/3（避免单节也撞上限）

### 回归
15. ✅ 现有 `excalidrawTool.execute` 单次生成路径不被破坏（S2 Analytical 仍可用）
16. ✅ 现有 excalidraw-md / excalidraw-fontsize / excalidraw-dedup 测试全过
17. ✅ visualizer 现有 abort / watchdog / onDiagramFailed 逻辑保留

---

## 设计决策（已定）

### 决策 1：分节由 LLM 规划，不强制按书 TOC
- **选择**：先让 LLM 看分析内容输出分节大纲，再按大纲逐节生成
- **理由**：书的 TOC 未必适合可视化；LLM 根据内容自然分节更灵活
- **代价**：多一次"规划 invoke"（轻量，~5-10s）

### 决策 2：渐进用 `.excalidraw`（JSON），完成转 `.excalidraw.md`（解法 A）
- **选择**：渐进过程落盘纯 JSON，收尾一次性转插件格式
- **理由**：JSON 增量简单（push）、可调试、性能好；`.excalidraw.md` 整体压缩无法字节追加
- **代价**：完成时有一次 embed 路径切换（`.excalidraw` → `.excalidraw.md`，Obsidian 重新渲染，可能闪一下）

### 决策 3：节间串行，不并行
- **选择**：节1 完成才开始节2
- **理由**：节2 可能需要箭头连接节1 的元素，必须等节1 的元素 id 确定
- **代价**：总耗时 = 各节耗时之和（但每节小，总和与单次大 invoke 相当）

### 决策 4：不引入渲染验证循环
- **选择**：不做 skill 的 render → 看图 → 修 循环
- **理由**：运行时 agent 看不到渲染图；多模态审图成本高
- **代价**：无法自动修正视觉缺陷（依赖现有碰撞检测 + 字号优化）

### 决策 5：保留单次 generateDiagram 作为 fallback
- **选择**：不删 `generateDiagram`，大纲解析失败时回退
- **理由**：降低重构风险

---

## 待确认问题

（已全部定稿，见下方决策）

---

## 已定决策（待确认问题的结论）

1. **分节规划用 mainModel**（与生成阶段一致，保证大纲质量）
2. **节数上限 5 节**（中心 + 4 个主分支，超出由 LLM 合并）
3. **Obsidian 嵌入刷新**：实测确认 embed 是图片快照不自动刷新；每次 onDiagramSection 主动 updateMessage 触发 re-render
4. **首节替换占位 loading 动画**：首节 onDiagramSection 时，占位气泡从"loading dots"变成"首节 embed + 继续绘制中状态条"
5. **abort 时保留中间 `.excalidraw`**：让用户看到已生成的部分图，占位气泡提示"已取消，显示部分图"

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| Obsidian embed 是图片快照，不随文件变化自动刷新 | **中**（已澄清） | 不依赖自动刷新；每次 onDiagramSection 主动 updateMessage 改 content 触发 re-render。实现阶段 TDD 确认 embed 快照更新 |
| embed 路径切换（`.excalidraw`→`.excalidraw.md`）时渲染闪烁 | 中 | updateMessage 主动触发 re-render；若闪烁明显，可在切换时显示极简 loading 过渡 |
| LLM 分节大纲质量差（节切得不合理） | 中 | prompt 强约束大纲格式；fallback 到单次生成 |
| 跨节箭头 binding 的 elementId 对不上 | 中 | 大纲阶段约定节标题作为 id 前缀（如 `sec1_center`）；生成阶段 prompt 提示可用的跨节元素 id |
| 总耗时反而增加（大纲 + 多节 > 单次） | 中 | 验收标准 13 限制 1.2 倍；若超标，减少节数或用 fastModel 规划 |
| 中间 `.excalidraw` 文件残留（异常中断未清理） | 低 | try/finally 确保清理；abort 时按决策保留 |

---

## 非目标（Out of Scope）

- 渲染验证循环（多模态审图）—— 未来增强
- 并行节生成 —— 复杂度高，收益不确定
- 用户手动选择分节 —— 自动分节即可
- 图表编辑器（用户改图）—— 独立功能
- 非 Excalidraw 格式图表（Mermaid 等）—— 独立功能
