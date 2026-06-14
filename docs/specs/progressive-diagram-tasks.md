# 任务列表：渐进式分节图表生成

> 配套：[spec](./progressive-diagram-generation.md) | [技术方案](./progressive-diagram-tech-plan.md)
> 阶段：SPECIFY ✅ → PLAN ✅ → **TASKS（本文档）** → IMPLEMENT

## 概览

8 个垂直切片任务，按 A→B→C→D 四阶段依赖排序。每个任务端到端可测，含验收条件 + 验证命令。

---

## 阶段 A：地基（纯新增，无行为变化）

### 任务 A1：`writeExcalidrawJson` 写纯 JSON 中间态

**描述：** 在 excalidraw.ts 新增导出函数，把元素写为 `Excalidraw/filename.excalidraw`（纯 JSON，非 .md）。复用 buildExcalidrawJSON 保证元素格式一致。这是渐进过程的中间态落盘入口。

**验收条件：**
- [ ] `writeExcalidrawJson(filename, elements, context)` 写入 `Excalidraw/<filename>.excalidraw`
- [ ] 文件内容是合法 JSON（`type:excalidraw` + elements + appState）
- [ ] 元素经 buildExcalidrawJSON 处理（字号优化/去重生效）
- [ ] 文件名校验复用现有正则（`/^[\w一-鿿\-].../`）

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] 单测：`npx vitest run tests/unit/agent/tools/excalidraw.test.ts`（补充 writeExcalidrawJson 用例）
- [ ] 全量：`npm run test:run`

**依赖：** 无

**涉及文件：**
- `src/agent/tools/excalidraw.ts`（新增导出函数）
- `tests/unit/agent/tools/excalidraw.test.ts`（补充用例）

**预估范围：** S

---

### 任务 A2：`onDiagramSection` 回调链（三处桥接）

**描述：** 新增 onDiagramSection 回调，贯穿 EngineCallbacks → AgentLoopOptions → engineCallbacks 桥接 → controller。⚠️ 三处都要改，参考 [[agent-callback-bridge]] 教训——漏桥接层会被可选链静默吞掉。本任务只搭管线，controller 实现留空壳（C2 填充）。

**验收条件：**
- [ ] `shared-context.ts` EngineCallbacks 加 `onDiagramSection?: (embed, sectionIndex, totalSections) => void`
- [ ] `types.ts` AgentLoopOptions 加同名可选回调
- [ ] `index.ts` engineCallbacks 桥接转发 `onDiagramSection: callbacks.onDiagramSection`
- [ ] `controller.ts` 加 `onDiagramSection` 空实现（仅 log，C2 填充真实逻辑）
- [ ] grep 三处都有 `onDiagramSection`（防漏桥接）

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] grep 验证：`grep -rn "onDiagramSection" src/agent/ src/views/ | wc -l` ≥ 4
- [ ] 全量单测：`npm run test:run`（现有行为不变）

**依赖：** 无（与 A1 独立，可并行）

**涉及文件：**
- `src/agent/graph/shared-context.ts`
- `src/agent/types.ts`
- `src/agent/index.ts`
- `src/views/sidebar/agent-chat-controller.ts`

**预估范围：** XS

---

### 🔶 检查点 A（A1+A2 完成后）

- [ ] `npm run build` 通过
- [ ] `npm run test:run` 通过（无回归）
- [ ] 发一条普通聊天消息（非画图），行为不变
- [ ] grep 确认 onDiagramSection 桥接完整

---

## 阶段 B：核心（分节生成逻辑）

### 任务 B1：分节大纲规划（planDiagramSections）

**描述：** 新增 DIAGRAM_PLAN_PROMPT + planDiagramSections 函数。一次 invoke 让 LLM 看分析内容，输出分节大纲 JSON（≤5 节）。解析失败返回 null（供 fallback 判断）。

**验收条件：**
- [ ] `DIAGRAM_PLAN_PROMPT` 约束 LLM 输出 `{filename, sections: [{title, content, connectsTo?, yBand}]}`，最多 5 节
- [ ] `planDiagramSections(query, content, model, options)` 返回 `DiagramSectionPlan[] | null`
- [ ] 合法大纲 JSON → 正确解析为 `DiagramSectionPlan[]`
- [ ] 非法 JSON / 缺字段 / 超 5 节 → 返回 null
- [ ] 导出 `DiagramSectionPlan` 类型

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] 新单测：`npx vitest run tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`（先建文件，含 B1 用例）

**依赖：** 无（纯函数，mock model）

**涉及文件：**
- `src/agent/graph/utils/diagram-helper.ts`（新增 prompt + 函数 + 类型）
- `tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`（新建）

**预估范围：** M

---

### 任务 B2：单节生成（generateSection）

**描述：** 新增 DIAGRAM_SECTION_PROMPT + generateSection 函数。给定一节大纲 + 已有元素 id 清单（供跨节箭头引用），invoke 输出该节 elements。返回 ElementDef[]。

**验收条件：**
- [ ] `DIAGRAM_SECTION_PROMPT` 注入：本节大纲 + 前序节已有元素 id 清单 + 布局规则（yBand 约束）
- [ ] `generateSection(section, existingIds, model, options)` 返回 `ElementDef[]`（空数组表示失败）
- [ ] 合法 elements JSON → 正确解析
- [ ] 非法 JSON → 返回空数组
- [ ] prompt 明确约定 id 前缀（`secN_xxx`）便于跨节引用

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] 单测：`npx vitest run tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`（补充 B2 用例）

**依赖：** B1（用 DiagramSectionPlan 类型）

**涉及文件：**
- `src/agent/graph/utils/diagram-helper.ts`
- `tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`

**预估范围：** M

---

### 任务 B3：渐进生成主循环（generateDiagramProgressive）

**描述：** 编排完整流程：plan → 循环 generateSection → 累积元素 → 每节 writeExcalidrawJson + onDiagramSection → 收尾 buildExcalidrawMd + 删中间文件。单节失败重试 1 次，仍失败跳过。大纲失败 fallback 到单次 generateDiagram。

**验收条件：**
- [ ] `generateDiagramProgressive(query, content, model, ctx, options, callbacks)` 返回最终 `.excalidraw.md` embed（空串=全失败）
- [ ] 3 节 mock：累积 = 全部元素；onDiagramSection 触发 3 次（embed 路径含 .excalidraw）
- [ ] 单节首次失败 + 重试成功 → 最终包含该节
- [ ] 单节重试仍失败 → 跳过该节，继续后续节
- [ ] 全部节失败 → 返回 ''（调用方触发 onDiagramFailed）
- [ ] 大纲解析失败 → fallback 调用现有 `generateDiagram`，返回其结果
- [ ] 收尾：写 `.excalidraw.md` + 删中间 `.excalidraw` + 返回 `.excalidraw.md` embed
- [ ] 每节检查 abortSignal，aborted 则停止后续节
- [ ] 单节 invoke 透传 watchdog signal

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] 单测：`npx vitest run tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`（补充 B3 全部用例）
- [ ] 现有单次版未破坏：`npx vitest run tests/unit/agent/graph/utils/diagram-helper.test.ts`

**依赖：** A1（writeExcalidrawJson）、B1（planDiagramSections）、B2（generateSection）

**涉及文件：**
- `src/agent/graph/utils/diagram-helper.ts`
- `tests/unit/agent/graph/utils/diagram-helper-progressive.test.ts`

**预估范围：** M

---

### 🔶 检查点 B（B3 完成后）

- [ ] `npm run build` 通过
- [ ] diagram-helper-progressive 单测全过
- [ ] diagram-helper（单次版）单测全过，未被破坏
- [ ] generateDiagramProgressive 可独立调用（mock 环境）

---

## 阶段 C：接入（连通前后端）

### 任务 C1：visualizer 节点接入渐进生成

**描述：** visualizer 改为调 generateDiagramProgressive，传入 onDiagramSection 回调透传给 callbacks。watchdog 改双阈值（单节 60s + 总 240s）。大纲失败 fallback 自动走单次版。

**验收条件：**
- [ ] visualizer 调 `generateDiagramProgressive`，透传 `onSectionReady` → `callbacks.onDiagramSection`
- [ ] watchdog：总超时 240s 触发 onDiagramFailed（复用现有失败路径）
- [ ] generateDiagramProgressive 内部 fallback 已处理大纲失败，visualizer 无需额外判断
- [ ] abort 行为保留（用户中断停止后续节）
- [ ] visualizer 测试更新：mock generateDiagramProgressive，验证 onDiagramSection 透传

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] 单测：`npx vitest run tests/unit/agent/graph/nodes/visualizer.test.ts`

**依赖：** A2（回调链）、B3（generateDiagramProgressive）

**涉及文件：**
- `src/agent/graph/nodes/visualizer.ts`
- `tests/unit/agent/graph/nodes/visualizer.test.ts`

**预估范围：** S

---

### 任务 C2：controller 渐进更新占位气泡

**描述：** controller 实现 onDiagramSection：updateMessage 改 content（embed=`![[xxx.excalidraw]]`）+ 状态文案"正在绘制第 N/M 节"，触发 embed re-render。onDiagramReady 收尾切换 embed 为 `.excalidraw.md`。abort 保留中间文件 + 提示部分图。

**验收条件：**
- [ ] `onDiagramSection(embed, i, total)`：updateMessage 改 content 为 embed，currentStatus 为"正在绘制第 i/total 节..."
- [ ] 多次 onDiagramSection 调用，同一 activeDiagramMessageId 气泡 content 持续更新
- [ ] `onDiagramReady`（最终）：embed 切换为 `![[xxx.excalidraw.md]]`，清状态，activeDiagramMessageId 置 null
- [ ] 状态机复用现有 diagramPending/diagramCompleted（与 onDiagramReady/onDiagramFailed 协调时序）
- [ ] abort 时（stopGeneration）：保留中间 `.excalidraw`，占位气泡显示"已取消，显示部分图"

**验证方法：**
- [ ] 构建：`npm run build`
- [ ] 全量单测：`npm run test:run`

**依赖：** A2（回调签名）、C1（visualizer 透传）

**涉及文件：**
- `src/views/sidebar/agent-chat-controller.ts`
- `src/components/message/message.ts`（若 updateMessage 重渲染 embed 需调整，TDD 验证）

**预估范围：** M

---

### 🔶 检查点 C（C2 完成后）

- [ ] `npm run build` 通过
- [ ] `npm run test:run` 通过（无回归，预存在的 empty-state/aria 失败除外）
- [ ] 部署：`npm run deploy`
- [ ] code review：onDiagramSection 三处桥接完整（grep 验证）

---

## 阶段 D：实测验证

### 任务 D1：Obsidian 实测渐进生长

**描述：** 部署后在 Obsidian 发画图消息，验证渐进生长全流程。重点验证 embed re-render 是否真生效（最大实现期风险）。

**验收条件：**
- [ ] 发"帮我画一张思维导图..."，首节 30s 内占位气泡出现 embed（非空 loading）
- [ ] 后续每节完成，气泡 embed 内容变化（图在长，svg 元素数递增）
- [ ] 状态文案显示"正在绘制第 N/M 节..."
- [ ] 全部完成后，embed 切换为 `.excalidraw.md`（检查文件存在 + embed 渲染）
- [ ] 中间 `.excalidraw` 被删除
- [ ] LangSmith trace 显示多次 invoke（plan + sections），单节 invoke < 30s
- [ ] **embed re-render 风险验证**：若 updateMessage 后图不刷新，启用预案（embed 加随机参数 / 强制重建 DOM）

**验证方法：**
- [ ] 部署：`npm run deploy` + `location.reload()`
- [ ] Obsidian 内发消息 + DOM 监控（obsidian-cli eval 观察 svg 元素数变化）
- [ ] LangSmith trace：`langsmith-tracer` skill 分析

**依赖：** C2

**涉及文件：** 无（纯验证，若发现问题回头改 C2/message.ts）

**预估范围：** S（验证为主，可能引发 C2 回修）

---

### 任务 D2：边界场景实测

**描述：** 验证健壮性场景：单节失败、abort 中断、总超时。

**验收条件：**
- [ ] 单节 LLM 失败（观察偶发或 mock）→ 重试 1 次 → 仍失败跳过，图含已生成节
- [ ] 用户中途点停止 → 后续节停止，已生成节保留显示 + "已取消，显示部分图"提示
- [ ] 总超时 240s → onDiagramFailed 触发，占位气泡显示失败提示（复用现有路径）
- [ ] 大纲解析失败 → fallback 单次生成（观察日志"大纲解析失败，fallback"）

**验证方法：**
- [ ] Obsidian 内操作 + 日志观察
- [ ] 总超时可用临时短超时（如 30s）验证触发

**依赖：** D1

**涉及文件：** 无（纯验证）

**预估范围：** S

---

### 🔶 检查点 D（全部完成）

- [ ] 首节 30s 可见，图渐进生长
- [ ] 最终 `.excalidraw.md` 视觉质量达标（字号/布局/去重）
- [ ] 边界场景全部通过
- [ ] 总耗时 ≤ 单次版 1.2 倍（LangSmith 对比）
- [ ] 可提交审查

---

## 任务依赖图

```
A1 (writeExcalidrawJson) ──┐
                            ├──→ B3 ──→ C1 ──→ C2 ──→ D1 ──→ D2
A2 (回调链) ──→ B1 ──→ B2 ──┘       ↑
                  ↑                  └── A2（回调链）
                  └── B3 也依赖 A2 的回调签名
```

**串行关键路径**：A2 → B1 → B2 → B3 → C1 → C2 → D1 → D2
**可并行**：A1 与 A2 独立（但 A1 小，串行做也无妨）

## 尺寸汇总

| 任务 | 尺寸 | 说明 |
|------|------|------|
| A1 | S | 1 函数 + 测试 |
| A2 | XS | 4 处加签名（无逻辑） |
| B1 | M | prompt + 解析函数 + 类型 + 测试 |
| B2 | M | prompt + 生成函数 + 测试 |
| B3 | M | 主循环编排 + 多场景测试 |
| C1 | S | 节点改调用 + watchdog |
| C2 | M | controller 状态机 + re-render |
| D1 | S | 实测（可能引发回修） |
| D2 | S | 边界实测 |

无 L/XL 任务。总预估：约 2 个聚焦会话（~3-4 小时 Agent 工作）。

## 风险与应对（实现期）

| 风险 | 触发任务 | 应对 |
|------|---------|------|
| embed re-render 不生效 | D1 | 预案：embed 加随机参数 `![[file.excalidraw#t=N]]` 或 message 强制重建 DOM |
| 总耗时超 1.2 倍 | D1 | 减少节数上限 / 规划改 fastModel（回退决策 1） |
| 跨节箭头 id 对不上 | B2/D1 | prompt 强化 id 前缀约定 + validateSemantics 兜底 |
| LLM 大纲质量差 | B1/D1 | fallback 单次版（已内置） |
