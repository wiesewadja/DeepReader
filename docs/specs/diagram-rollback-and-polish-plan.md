# Plan：图表生成回退 + 速度/UI 优化

> 背景：渐进式分节生成实测失败（首图更慢、布局乱、闪烁、字体报错）。本 plan 回退到单次生成，并在此基础上做速度 + UI 优化。
> 参考：`Drawing 2026-06-13 17.19.57.excalidraw.md`（手绘效果好，fontFamily 5 无字体问题）

## 问题诊断（实测结论）

| 问题 | 根因 |
|------|------|
| 首图反而更慢（90s vs 单次 40s） | 渐进式 plan invoke(35s) + section1 invoke(35s) 串行，比单次一次 invoke 还慢 |
| UI 越画越乱 | 分节盲画，每节 LLM 独立决定坐标，节间无全局协调 |
| 每次更新闪烁 | embed 是整体图片快照，每节 updateMessage 触发全量重渲染 |
| 字体报错 Cascadia | fontFamily 3 需加载 woff2 data URL，高频重渲染触发加载竞争 |
| UX 无提示 | onDiagramSection 改 content 时状态文案被 embed 渲染覆盖 |

## 核心决策

**回退到单次 generateDiagram**，但保留渐进式代码（不删，未来若解决"局部更新"可重启）。

在单次基础上优化三个维度：速度、字体、布局。

---

## 优化项

### 优化 1：字体修复（fontFamily 3 → 5）—— 解决字体报错

**改 `src/agent/tools/excalidraw.ts`**：
- `toExcalidrawElement` line 279：`base.fontFamily = 3` → `5`
- DIAGRAM_SYSTEM_PROMPT / DIAGRAM_SECTION_PROMPT 里 fontFamily 提示改为 5
- 参考：`Drawing 2026-06-13` 用 fontFamily 5，中文清晰无报错

**fontFamily 5 是什么**：Excalidraw 内置的中文友好字体（系统可用），无需加载外部 woff2，渲染稳定。

**影响**：消除 `Failed to load font "Cascadia"` 报错；中文显示更清晰。

### 优化 2：速度提升（单次 invoke ~40s → 目标 ~20s）

单次生成慢的主因是 **LLM 输出 token 多**（完整 JSON 几十个元素）+ **GLM 深度推理**。优化方向：

**2a. 限制元素数量上限**（改 prompt + excalidraw.ts 校验）
- 当前上限 200，实际 LLM 常生成 60+ 元素 → 输出 token 巨大
- 降到 **30 个元素上限**（思维导图够用：1 中心 + 4-6 分支 + 每分支 2-3 子节点 + 箭头）
- prompt 明确："最多 30 个元素，宁简勿繁"

**2b. 简化 prompt**（减少 LLM 思考量）
- 当前 DIAGRAM_SYSTEM_PROMPT 很长（色板/布局/字号层级/形状语义...），LLM 要消化
- 精简为核心规则 + 1 个示例图

**2c. 降低 reasoning（如模型支持）**
- 检查 ChatOpenAI 配置，画图调用可考虑 `temperature: 0.5` + 禁用深度推理（若 GLM 支持）

**验收**：首图 TTCF < 25 秒（当前 ~40s）

### 优化 3：布局质量（减少重叠/错位）

单次生成时 LLM 看全图，本身比渐进式协调。额外加固：

**3a. 强化 prompt 布局约束**
- 明确"中心放正中，分支按 4 方向（上下左右）均匀辐射"
- 给坐标模板："中心 (500,400)，上分支 (300,150)，下分支 (300,650)..."

**3b. 落盘前碰撞检测兜底**
- buildExcalidrawJSON 已有 detectOverlaps，但只产 warning 不修正
- 增强：检测到严重重叠（>30% 面积）时自动微调坐标（复用 resolveOverlaps）

**验收**：生成的图无明显元素重叠（视觉检查）

### 优化 4：UX 提示（占位气泡状态文案）

即使单次生成也要 ~20-25s，用户需知道在画图：

**改 `src/views/sidebar/agent-chat-controller.ts`**：
- onDiagramStart 时占位气泡显示"让我画张图给你看..."（已有）
- 保留这个状态直到 onDiagramReady（单次生成中间不更新）
- 不再调 onDiagramSection（回退掉）

**验收**：画图期间占位气泡持续显示"画图中"，无闪烁

---

## 改动清单

### 回退（visualizer 节点）
- `src/agent/graph/nodes/visualizer.ts`：改回调 `generateDiagramProgressive` → `generateDiagram`（单次）
- 删除 onDiagramSection 透传逻辑
- watchdog 改回 180s（单次不需要 240s）
- **保留** generateDiagramProgressive 代码（标注 `@deprecated 未接入，待局部更新方案成熟后重启`）

### 字体修复
- `src/agent/tools/excalidraw.ts`：fontFamily 3 → 5
- prompt 里 fontFamily 提示同步改

### 速度优化
- `src/agent/tools/excalidraw.ts`：元素上限 200 → 30
- `src/agent/graph/utils/diagram-helper.ts`：DIAGRAM_SYSTEM_PROMPT 精简 + 元素数约束
- 可选：`src/agent/models/chat-model.ts`：画图 invoke 的 temperature

### 布局加固
- prompt 加坐标模板
- 可选：excalidraw-geometry.ts 的 resolveOverlaps 加重叠自动微调

### UX
- controller：onDiagramSection 回退为空（或删除），占位气泡保持"画图中"状态

### 测试
- 更新 excalidraw.test.ts：fontFamily 断言 3 → 5
- 更新 diagram-helper.test.ts：embed 路径断言
- 更新 visualizer.test.ts：移除 onDiagramSection 测试，恢复单次调用测试

### 清理
- 删除 onDiagramSection 回调链（shared-context / types / index / controller）—— 既然回退不用了，移除避免死代码
- 保留 generateDiagramProgressive / planDiagramSections / generateSection（供未来）

---

## 风险

| 风险 | 应对 |
|------|------|
| 元素上限 30 导致图过于简陋 | 实测调整；30 对思维导图够用，复杂图可后续放宽 |
| fontFamily 5 在某些主题下显示不同 | 实测确认；5 是 Excalidraw 内置，兼容性好 |
| 速度优化不达 25s | 优先 2a（元素数），效果最直接；2b/2c 是补充 |

---

## 验证

1. `npm run build` + `npm run test:run`
2. 部署实测：画图消息 → 首图 < 25s + 无字体报错 + 无闪烁 + 布局整齐
3. 对比 `Drawing 2026-06-13` 的视觉效果（fontFamily 5 一致性）
