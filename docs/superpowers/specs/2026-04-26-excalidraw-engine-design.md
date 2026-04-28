# Excalidraw 专业图示引擎设计

> 日期：2026-04-26
> 状态：修订版（已通过 spec review）

## 背景

DeepReader 当前通过 `excalidraw` 工具支持思维导图和知识图谱生成，但存在以下问题：

- **视觉层次单一** — 只有四级尺寸，未利用 `addRect`/`addDiamond`/`addToGroup` 等原始形状做差异化
- **配色缺乏体系** — 7 色硬编码，无语义色彩映射，子节点与父节点无色彩继承关系
- **连线无标注** — edge 的 `label` 字段读取了但从未渲染，关系语义丢失
- **布局算法粗糙** — 角度硬编码 `0.3 rad`，子节点多了会重叠；知识图谱 `right→left` 连线导致交叉
- **API 利用率低** — `addToGroup`、`addRect`、`addElementsToView` 等全未使用（注：`addFrame` 不在 ExcalidrawAutomate 类型定义中，不可用）
- **场景覆盖窄** — 仅支持 Skill 触发，无按钮触发、自由创作等入口

## 目标

将 Excalidraw 工具从简单的"画图工具"升级为**专业图示引擎**：

1. 两种精品图形（思维导图、知识图谱），具备专业级视觉品质
2. 多场景覆盖：书籍可视化、跨书籍对比、自由创作指令、AI 回复转图
3. LLM 输出语义结构，引擎负责视觉映射，职责分离

## 场景矩阵

| 场景 | 触发方式 | 图形选择 | 数据来源 |
|------|----------|----------|----------|
| 书籍结构可视化 | 自然语言 / Skill | 思维导图 | TOC + 章节摘要 |
| 章节/概念知识图 | 自然语言 / Skill | 知识图谱 | 搜索+阅读结果 |
| 跨书籍对比 | 自然语言 / Skill | 知识图谱（多色分区） | 跨书搜索 |
| 自由创作 | 自然语言 | LLM 智能选择 | 用户描述 |
| AI 回复转图 | 消息按钮 / 指令 | LLM 智能选择 | AI 回复原文 |

---

## 端到端流程

### 场景一：用户点击 AI 消息上的"生成图形"按钮

```
1. 用户阅读完一条 AI 回复，点击消息底部的"生成图形"按钮

2. 系统提示"正在分析内容…"，将 AI 回复原文发给 LLM，
   LLM 判断适合思维导图还是知识图谱，提取语义结构

3. 系统提示"正在生成图形…"，引擎计算布局、分配颜色、选择形状，
   调用 ExcalidrawAutomate 绘制

4. .excalidraw.md 文件写入 DeepReader/Excalidraw/ 目录

5. 消息中出现文件链接卡片，用户点击打开 Excalidraw 编辑器查看和编辑
```

### 场景二：自然语言指令 — 书籍结构

```
1. 用户说"帮我把这本书的知识结构画出来"
2. Agent 意图路由匹配 → 调用 get_document_outline → 逐章阅读提取概念
3. Agent 组装语义数据，调用 excalidraw 工具 action: "draw"
4. 引擎布局 → 渲染 → 写入文件
5. Agent 回复附带文件链接
```

### 场景三：自由创作

```
1. 用户说"画一个关于费曼学习法的思维导图"
2. Agent 意图路由匹配 → 自行构思内容结构
3. 调用 excalidraw 工具 → 引擎布局 → 渲染 → 写入
4. 回复附带文件链接
```

### 场景四：跨书籍对比

```
1. 用户说"对比《思考快与慢》和《噪声》的核心观点"
2. Agent 主题阅读 → 分别搜索两本书 → 提取观点
3. Agent 将两本书观点组织为分组语义数据（group_A / group_B）
4. 调用 excalidraw 工具 → 引擎用不同颜色区域区分 → 渲染 → 写入
5. 回复附带文件链接
```

### 统一落盘规则

- 文件名：`{主题描述}.excalidraw.md`
- 存储目录：`DeepReader/Excalidraw/`
- 写入方式：`ExcalidrawAutomate.create()`
- 写入后：对话框内展示文件链接，用户点击可编辑

---

## 数据接口设计

### 核心原则

LLM 只输出**语义结构**（是什么），引擎决定**视觉属性**（怎么画）。两者通过语义接口解耦。

### 思维导图语义

```typescript
interface MindmapSemantic {
  topic: string;
  summary?: string;
  branches: MindmapBranch[];
  style?: "precise" | "handdrawn" | "sketch";
}

interface MindmapBranch {
  label: string;
  annotation?: string;
  importance?: "high" | "medium" | "low";
  children: MindmapNode[];
}

interface MindmapNode {
  label: string;
  annotation?: string;
  importance?: "high" | "medium" | "low";
  link?: string;
  children?: MindmapNode[];
}
```

### 知识图谱语义

```typescript
interface GraphSemantic {
  title: string;
  groups?: GraphGroup[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  style?: "precise" | "handdrawn" | "sketch";
}

interface GraphGroup {
  id: string;
  label: string;
}

interface GraphNode {
  id: string;
  label: string;
  type?: "concept" | "person" | "event" | "book" | "theme";
  group?: string;
  importance?: "core" | "major" | "minor";
  annotation?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  type?: "hierarchy" | "causal" | "comparison" | "temporal" | "association";
  direction?: "directed" | "undirected" | "bidirectional";
}
```

### 语义字段的设计意图

| 字段 | 作用 |
|------|------|
| `importance` | 驱动节点大小和边框粗细 |
| `type` | 驱动形状选择（椭圆、圆角矩形、菱形等） |
| `annotation` | 渲染为节点下方的补充说明小字 |
| `group` | 驱动容器框和分区颜色 |
| `edge.label` | 渲染为连线中点的文字标注 |
| `edge.type` | 驱动线条样式（实线、虚线、点线）和箭头方向 |
| `style` | 控制 roughness（精确/微手绘/明显手绘） |

---

## 专业样式系统

### 色彩体系

分支色从 HSL 色轮均匀分配，子节点继承父分支色相，透明度递减：

```
分支 1 → 蓝色   stroke #1971c2  fill #a5d8ff
分支 2 → 绿色   stroke #2f9e44  fill #b2f2bb
分支 3 → 橙色   stroke #e8590c  fill #ffc078
分支 4 → 紫色   stroke #9c36b5  fill #eebefa
分支 5 → 红色   stroke #c92a2a  fill #ffc9c9
分支 6 → 青色   stroke #087f5b  fill #96f2d7
分支 7 → 黄绿   stroke #5c940d  fill #d8f5a2

子节点透明度递减：Level 2 → 75%，Level 3 → 50%
中心节点：stroke #1a1a2e  fill #ffe066
```

### 形状层级

思维导图：

| 层级 | 形状 | 尺寸 | 字号 |
|------|------|------|------|
| 中心主题 | 椭圆 | 280×80 | 20 加粗 |
| 分支 | 圆角矩形 | 200×55 | 16 |
| 子节点 | 矩形 | 160×45 | 14 |
| 叶子节点 | 矩形 | 130×38 | 13 |
| annotation | 纯文本无框 | — | 11 浅灰 |

知识图谱：

| type | 形状 |
|------|------|
| concept | 圆角矩形 |
| person | 椭圆 |
| event | 菱形 |
| book | 矩形（双线边框） |
| theme | 圆角矩形（强调色） |

importance 映射尺寸：`core` → 200×60，`major` → 160×50，`minor` → 120×40。

### 线条与连接

| edge.type | 线型 | 箭头 | 线宽 |
|-----------|------|------|------|
| hierarchy | 实线 | 单向 | 2 |
| causal | 实线 | 单向 | 2.5 |
| comparison | 虚线 | 双向 | 1.5 |
| temporal | 点线 | 单向 | 1.5 |
| association | 实线 | 无 | 1 |

层级线条粗细：中心→分支 3px，分支→子节点 2px，子节点→叶子 1.5px。

edge.label 渲染方案（`connectObjects` 不支持文字参数的变通）：
1. 计算连线中点坐标：`midX = (nodeA.x + nodeB.x) / 2`，`midY = (nodeA.y + nodeB.y) / 2`
2. 偏移 15px 避免遮挡连线
3. 在中点位置先画一个 `addRect`（白色填充，无边框，尺寸按文字长度估算）
4. 再用 `addText` 在同一位置渲染 label 文字（字号 11）
5. 将 rect + text 通过 `addToGroup` 与连线绑定为一组

### 分组容器

每个 group 渲染为一个背景矩形（使用 `addRect` + `addText`，不使用 `addFrame` 因该 API 不存在于当前类型定义）：
- 颜色 = 该组主色的极浅版本（opacity 15%）
- 1px 虚线边框
- 顶部标题文字（字号 14 加粗，通过 `addText` 渲染）
- 自动包住组内所有节点 + 30px 内边距
- 通过 `addToGroup` 将组内所有节点 ID 传入，实现逻辑分组

### roughness 风格

- `precise` → roughness 0（直线直角，适合学术内容）
- `handdrawn` → roughness 1（微手绘感，默认）
- `sketch` → roughness 2（明显手绘，适合创意内容）

---

## 布局引擎

### 思维导图：子树角度预算算法

```
分支数约束：3-7（由 Skill prompt 和 Zod schema 共同约束）

1. 计算每个分支的子树权重
   weight = 1 + 所有后代节点数 × 权重系数

2. 按权重分配角度扇区
   分支角度 = (分支权重 / 总权重) × 2π
   最小扇区 = π/4（3-7 分支范围内不会触发 2π 总量冲突：
     最坏情况 7×π/4 ≈ 5.50 < 2π ≈ 6.28，安全）

3. 从正上方（-π/2）顺时针排列

4. 子节点方向适配：
   左/右分支 → 子节点纵向展开
   上/下分支 → 子节点横向展开

5. 层级距离：
   中心→分支 350px
   分支→子节点 220px
   子节点→叶子 160px

6. 同级间距 = 节点高度 + 50px

7. annotation 空间预留：
   含 annotation 的节点，同级间距额外 +20px（11px 字高 + 8px 间隙）

8. 碰撞检测（后处理）：
   布局计算完成后，遍历所有节点对，检测矩形重叠
   如有重叠，将被遮挡节点沿远离中心方向外移至无重叠位置
```

### 知识图谱：分组布局算法

```
分支数上限：7（超过 7 个分组时，LLM 应合并次要分组）

有分组时：
  1. 分组区域分配
     - 分组数 ≤ 3：水平排列，每组宽度 = 画布宽度 / 分组数
     - 分组数 4-6：2 行网格，上行 ceil(N/2)，下行 floor(N/2)
     - 分组数 = 7：2 行网格（4+3）
     - 组间间距 300px
     - 起始坐标 (200, 200)

  2. 组内布局（同心环）
     - core 节点放在组区域中心 (groupCenterX, groupCenterY)
     - major 节点均匀分布在半径 200px 的环上
       每个节点角度 = 2π × i / majorCount
     - minor 节点均匀分布在半径 400px 的环上
       每个节点角度 = 2π × i / minorCount
     - 同级节点间距最小 150px

  3. 分组容器框
     - 遍历组内所有节点坐标，计算包络矩形
     - 扩展 30px 内边距
     - 用 addRect 绘制背景 + addText 绘制标题

无分组时：
  1. 将节点按 importance 分为三层
  2. core 节点在画布中心 (canvasW/2, canvasH/2)
  3. major 节点在半径 300px 的环上均匀分布
  4. minor 节点在半径 550px 的环上均匀分布

连线优化：
  根据两个节点的实际相对位置，计算四种连接方式 (top/bottom/left/right) 的距离，
  选择最短的那一对作为 connectObjects 的参数：
  if |dx| > |dy|: 水平连接（左节点 right → 右节点 left）
  else: 垂直连接（上节点 bottom → 下节点 top）

边标签定位：
  midX = (nodeA.x + nodeB.x) / 2
  midY = (nodeA.y + nodeB.y) / 2
  偏移 15px 后放置 addRect(白底) + addText(label)
```

---

## 工具接口

### 新增 action: "draw"

```typescript
// Zod schema
action: "draw"
diagramType: "mindmap" | "knowledge_graph"
data: MindmapSemantic | GraphSemantic   // 根据 diagramType 选择
filename?: string
style?: "precise" | "handdrawn" | "sketch"
```

### 旧接口兼容

- `action: "mindmap"` → 通过适配器转换为 `MindmapSemantic` 后走新引擎
  - 适配器处理：`string` 子节点 → `{ label: string }`，缺省字段填默认值
  - 适配逻辑放在 `excalidraw-engine/index.ts` 中
- `action: "knowledge_graph"` → 通过适配器转换为 `GraphSemantic` 后走新引擎
- `action: "check"` → 不变
- `action: "create"` → 不变

---

## 消息按钮

在 AI 消息底部操作栏添加"生成图形"按钮：

- **位置**：复制、TTS、摘录等按钮之后
- **图标**：图形/节点图标
- **隐藏条件**：回复内容 < 50 字，或 Excalidraw 插件未安装

### 按钮触发的完整数据流（subagent 模式）

按钮触发使用独立的 subagent 流程，可以调用搜索/阅读工具补充信息后再生成图形。

```
AIMessage 组件
  │
  │ 用户点击"生成图形"按钮
  │
  ▼
SidebarView.handleVisualize(messageId: string)
  │
  │ 1. 获取该 messageId 对应的 AI 回复原文 content
  │ 2. 按钮状态更新为 loading("分析中…")
  │
  ▼
FrontendAgent.visualizeContent(content: string, callbacks)
  │
  │ 启动一个 subagent（类似 create_sub_agent 机制）：
  │
  │ System Prompt:
  │   "你是一个图示生成助手。根据用户提供的 AI 回复内容，
  │    判断适合思维导图还是知识图谱。
  │    你可以使用搜索和阅读工具补充信息，丰富图形内容。
  │    分析完成后，调用 excalidraw 工具（action: "draw"）生成图形。"
  │
  │ 可用工具：hybrid_search, read_section, inspect_toc, excalidraw
  │
  │ subagent 执行流程：
  │   1. 分析内容，判断 diagramType
  │   2. 如需补充：调用搜索/阅读工具获取更多内容
  │   3. 组装语义数据，调用 excalidraw 工具 action: "draw"
  │
  │ callbacks:
  │   onProgress("分析中…") / onProgress("搜索补充内容…") / onProgress("生成图形…")
  │   onComplete(filePath) → 成功，返回文件路径
  │   onError(message) → 失败
  │
  ▼
SidebarView 收到结果
  │
  │ 成功：按钮消失，消息中追加文件链接卡片
  │ 失败：Toast 提示错误信息，按钮恢复可点击状态
  │
  ▼
结束
```

### 关键实现细节

- `AIMessage` 构造函数新增 `onVisualize?: (messageId: string) => void` 回调
- `FrontendAgent.visualizeContent()` 创建一个独立的 subagent 会话，复用现有 subagent 基础设施
- subagent 可调用的工具限定为：`hybrid_search`、`read_section`、`inspect_toc`、`excalidraw`（搜索+阅读+绘图）
- subagent 最多迭代 5 次（防止无限循环）
- 进度通过回调实时更新到按钮状态
- 错误处理：subagent 超时或失败 → Toast 提示，按钮恢复
- `style` 优先级规则：工具接口层的 `style` 覆盖语义数据中的 `style`

---

## Skill 集成

### 现有 skill 改造

- `topic-mindmap`：工具调用改为 `action: "draw"`，prompt 指导 LLM 按 `MindmapSemantic` schema 组织，强调 `importance` 和 `annotation`
- `book-mindmap`：同上，深度选择映射到 importance 分配策略

### 新增 skill

- `smart-visualize`：触发短语"画个图/可视化/用图表示/转成图"，LLM 自行判断 diagramType，适用于自由创作场景

---

## 渲染器职责边界

`renderer.ts` 是唯一与 `ExcalidrawAutomate` 交互的模块。它的输入是**纯数据对象**（包含坐标、尺寸、颜色等所有样式信息），而非依赖全局 `ea.style` 命令式状态。

```
styles.ts 的输出 → StyleResult（纯数据）
                    ↓
layout-*.ts 的输出 → LayoutResult（坐标+尺寸）
                    ↓
renderer.ts 接收 StyleResult + LayoutResult → 调用 ExcalidrawAutomate API

renderer 内部流程：
1. ea.clear()
2. 遍历布局结果，对每个节点：
   - 根据形状类型调用 addText(addRect/addDiamond/addEllipse) + addText
   - 每次调用前设置 ea.style 为该节点的样式数据
3. 遍历边：
   - connectObjects() 连接节点
   - 有 edge.label 时：addRect(白底) + addText(label)
4. 遍历分组：
   - addRect(背景) + addText(标题) + addToGroup(组内元素)
5. ea.create({ filename, foldername })
```

## 规模限制

- 思维导图：最多 7 个分支，每分支最多 5 个子节点，最多 3 层嵌套
- 知识图谱：建议节点总数 ≤ 80，边数 ≤ 120
- 超出限制时 LLM 应合并/裁剪内容，引擎不做硬截断
- 单次渲染时间应 < 5 秒（ExcalidrawAutomate DOM 操作性能考虑）

## 文件结构

```
src/agent/tools/
├── excalidraw.ts                  # [改造] 精简为分发器
├── excalidraw-engine/
│   ├── index.ts                   # 引擎主入口
│   ├── layout-mindmap.ts          # 思维导图布局算法
│   ├── layout-graph.ts            # 知识图谱布局算法
│   ├── styles.ts                  # 专业样式系统
│   ├── renderer.ts                # ExcalidrawAutomate 渲染器
│   └── types.ts                   # 引擎类型定义
├── definitions/excalidraw.ts      # [改造] 新增 draw schema
└── ...

src/components/message/message.ts  # [改造] 添加生成图形按钮
src/views/sidebar-view.ts          # [改造] 添加按钮回调逻辑
src/built-in-skills.ts             # [改造] 更新 skill prompt
src/agent/router/intent-rules.json # [微调] 扩展匹配模式
```

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `excalidraw-engine/` (6 文件) | 新增 | 引擎核心 |
| `agent/tools/excalidraw.ts` | 改造 | 精简为分发器，调用引擎 |
| `agent/tools/definitions/excalidraw.ts` | 改造 | 新增 draw 动作 schema |
| `components/message/message.ts` | 改造 | 添加生成图形按钮 |
| `views/sidebar-view.ts` | 改造 | 添加按钮回调 + LLM 解析调用 |
| `built-in-skills.ts` | 改造 | 更新 skill prompt |
| `agent/router/intent-rules.json` | 微调 | 扩展可视化相关匹配模式 |
