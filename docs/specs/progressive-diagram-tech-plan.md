# 技术方案：渐进式分节图表生成

> 配套 spec：[progressive-diagram-generation.md](./progressive-diagram-generation.md)
> 阶段：SPECIFY ✅ → **PLAN（本文档）** → TASKS → IMPLEMENT

## 1. 组件依赖图

```
visualizer.ts (节点)
    │
    │ 调用 generateDiagramProgressive（新增）
    ▼
diagram-helper.ts
    │
    ├── planDiagramSections（新增）─ 1 次 invoke 产出大纲
    │       │
    │       └── DIAGRAM_PLAN_PROMPT（新增 prompt）
    │
    ├── generateSection（新增）─ N 次 invoke，每次一节元素
    │       │
    │       └── DIAGRAM_SECTION_PROMPT（新增 prompt，含跨节元素 id 上下文）
    │
    ├── 累积 elements 到内存数组
    │       │
    │       └── writeExcalidrawJson（新增，excalidraw.ts）─ 每节落盘 .excalidraw
    │           └── buildExcalidrawJSON（已有，复用）
    │
    └── 收尾：buildExcalidrawMd（已有）─ 转换 .excalidraw.md + 删中间文件

回调链（三处桥接，参考 [[agent-callback-bridge]]）：
shared-context.ts (EngineCallbacks)
    └─ onDiagramSection（新增）
types.ts (AgentLoopOptions)
    └─ onDiagramSection（新增）
index.ts (engineCallbacks 桥接)  ← ⚠️ 最易漏
    └─ onDiagramSection 转发
controller.ts (实现)
    └─ onDiagramSection：updateMessage 改 content → 触发 embed re-render
```

## 2. 实现顺序（建地基→核心→收尾）

### 阶段 A：地基（无行为变化，纯新增能力）

**A1. `writeExcalidrawJson` 入口**（excalidraw.ts）
- 新增导出函数：接收 filename + elements，写 `Excalidraw/filename.excalidraw`（纯 JSON）
- 复用 `buildExcalidrawJSON`（保证元素格式 + 字号优化 + 去重）
- 单元测试：写文件 → 读回 → 元素属性保留

**A2. `onDiagramSection` 回调链**（三处 + 测试）
- `shared-context.ts` EngineCallbacks 加 `onDiagramSection`
- `types.ts` AgentLoopOptions 加 `onDiagramSection`
- `index.ts` engineCallbacks 桥接转发
- 单元测试：visualizer mock 触发 onDiagramSection，controller 收到

**检查点 A**：构建通过 + 新增单元测试过 + 现有行为不变（发普通消息不受影响）

### 阶段 B：核心（分节生成逻辑）

**B1. `DIAGRAM_PLAN_PROMPT` + `planDiagramSections`**（diagram-helper.ts）
- 新增 prompt：让 LLM 看分析内容，输出分节大纲 JSON（节标题/内容/连接/yBand）
- 新增函数：invoke → 解析大纲 → `DiagramSectionPlan[]`（最多 5 节）
- 解析失败 → 返回 null（触发 fallback）
- 单元测试：mock invoke 返回大纲 JSON，正确解析；非法 JSON 返回 null

**B2. `DIAGRAM_SECTION_PROMPT` + `generateSection`**（diagram-helper.ts）
- 新增 prompt：给定一节的大纲 + 已有元素的 id 清单（供跨节箭头引用），输出该节 elements
- 新增函数：invoke → 解析 elements → 返回 `ElementDef[]`
- 单元测试：mock invoke 返回节元素，正确解析

**B3. `generateDiagramProgressive` 主循环**（diagram-helper.ts）
- 编排：plan → 循环 generateSection → 累积 → 每节 writeExcalidrawJson + onDiagramSection → 收尾 buildExcalidrawMd + 删中间文件
- 单节失败重试 1 次，仍失败跳过
- 每节检查 abortSignal
- 全部失败返回 ''（触发 onDiagramFailed）
- 单元测试：3 节 mock 完整流程；单节失败重试；全部失败；abort 中断

**检查点 B**：generateDiagramProgressive 单元测试全过；单次 generateDiagram 仍可用（未被破坏）

### 阶段 C：接入 + 收尾

**C1. visualizer 节点接入**（visualizer.ts）
- 改为调 `generateDiagramProgressive`，传 onDiagramSection 回调
- watchdog：单节 60s + 总 240s 双阈值
- 大纲解析失败（planDiagramSections 返回 null）→ fallback 到 generateDiagram
- 单元测试：更新 visualizer 测试（onDiagramSection 触发 + fallback 路径）

**C2. controller 渐进更新**（controller.ts）
- `onDiagramSection` 实现：updateMessage 改 content（embed = `![[xxx.excalidraw]]`）+ 状态文案"正在绘制第 N/M 节"
- `onDiagramReady` 收尾：embed 切换为 `![[xxx.excalidraw.md]]`
- abort 时保留中间 `.excalidraw`，气泡提示"已取消，显示部分图"
- 单元测试：onDiagramSection 多次触发，embed 路径正确；onDiagramReady 切换路径

**检查点 C**：构建 + 全量单元测试通过

### 阶段 D：实测验证

**D1. 部署 + Obsidian 实测**
- 发画图消息，观察：首节 30s 内可见、图渐进生长、最终切到 .excalidraw.md
- LangSmith trace 验证每节 invoke 耗时
- 验证 embed re-render 确实生效（图真的在长，不是卡在首节）

**D2. 边界场景实测**
- 单节失败场景（mock 或观察 LLM 偶发失败）
- abort 中断
- 总超时

## 3. 关键技术细节

### 3.1 分节大纲 schema

```typescript
interface DiagramSectionPlan {
  title: string;           // "中心主题" / "动力系统分支"
  content: string;         // 该节要表达的要点（来自分析内容）
  connectsTo?: string[];   // 需箭头连接的其他节 title（跨节绑定）
  yBand: [number, number]; // y 坐标区间，避免节间重叠
}
```

LLM 输出示例：
```json
{
  "filename": "自卑与超越核心概念体系",
  "sections": [
    {"title":"中心主题","content":"阿德勒个体心理学：自卑感是动力源","yBand":[280,420]},
    {"title":"动力系统","content":"自卑→补偿→优越感追求","connectsTo":["中心主题"],"yBand":[100,240]},
    ...
  ]
}
```

### 3.2 跨节箭头绑定

- 大纲阶段：LLM 在 `connectsTo` 声明节间关系
- 生成阶段：DIAGRAM_SECTION_PROMPT 注入"已有元素的 id 清单"（前序节的 shape id）
- 约定 id 前缀：`sec1_center`、`sec2_node1`（节序号 + 描述），LLM 引用时可读
- 收尾 buildExcalidrawJSON 会校验 binding 有效性（现有 validateSemantics）

### 3.3 增量落盘 + 收尾转换

```
节1 完成：cumulative = [sec1 元素]
  → writeExcalidrawJson(file, cumulative) → Excalidraw/file.excalidraw
  → onDiagramSection("![[Excalidraw/file.excalidraw]]", 1, total)

节2 完成：cumulative = [sec1, sec2 元素]
  → writeExcalidrawJson(file, cumulative) → 覆盖 file.excalidraw
  → onDiagramSection("![[Excalidraw/file.excalidraw]]", 2, total)

全部完成：
  → buildExcalidrawJSON(cumulative) → buildExcalidrawMd → Excalidraw/file.excalidraw.md
  → adapter.remove("Excalidraw/file.excalidraw")
  → return "![[Excalidraw/file.excalidraw.md]]"
```

注意：每节落盘都过一遍 buildExcalidrawJSON（字号优化/去重/碰撞检测），保证中间态视觉质量。收尾再过一次 buildExcalidrawMd 转格式。

### 3.4 embed re-render 机制

实测确认 embed 是 `excalidraw-embedded-img`（图片快照），不自动刷新。controller 的 onDiagramSection 必须：
- `updateMessage(id, { content: newEmbed, ... })` 改 content
- message 组件 update 路径检测到 content 变化 → 重新走 markdown 渲染 → Obsidian 重新生成 embed 快照

实现阶段需 TDD 验证：updateMessage 后 embed DOM 确实更新（svg 内容变化）。

### 3.5 fallback 路径

```
generateDiagramProgressive:
  plan = planDiagramSections(...)
  if (!plan || plan.length === 0):
    log('大纲解析失败，fallback 到单次生成')
    return generateDiagram(...)  // 保留的旧路径
  ...分节循环...
```

## 4. 风险与应对

| 风险 | 阶段 | 应对 |
|------|------|------|
| embed re-render 不生效（updateMessage 后快照不更新） | D1 | 若失效，方案 B：onDiagramSection 时给 embed 加随机 query 参数强制刷新（`![[file.excalidraw#t=123]]`），或用 message 组件强制重建 DOM |
| 大纲质量差 | B1 | prompt 强约束 + 示例；fallback 到单次 |
| 跨节箭头 id 对不上 | B2 | prompt 注入已有 id 清单 + 约定前缀；validateSemantics 兜底 |
| 总耗时超 1.2 倍 | D1 | 减少节数 / 规划用 fastModel（决策 1 可回退） |
| 单节 invoke 也慢（LLM 本身慢） | D1 | 这是 LLM 侧问题，非架构问题；watchdog 兜底不卡死 |

## 5. 并行/串行

- **必须串行**：B1→B2→B3（plan/section/主循环层层依赖）；C1→C2（接入→controller）
- **可并行**：A1（writeExcalidrawJson）与 A2（回调链）互相独立，可并行
- **串行依赖链**：A1+A2 → B1 → B2 → B3 → C1 → C2 → D

## 6. 验证检查点

| 检查点 | 位置 | 通过标准 |
|--------|------|---------|
| A | A1+A2 完 | 构建过 + 新测试过 + 现有行为不变 |
| B | B3 完 | generateDiagramProgressive 单测全过 + 单次版未破坏 |
| C | C2 完 | 全量单测过 |
| D | 实测完 | 首节 30s 可见 + 图渐进生长 + 最终 .excalidraw.md 正确 |
