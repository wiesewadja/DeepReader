# Spec：Excalidraw 语义布局引擎

## Objective

为 DeepReader 的 Excalidraw 可视化回复引入**语义布局引擎**，解决当前图形结构单一、所有图都被画成同一棵放射树的问题。

当前问题：
- Prompt 硬编码「中心主题 + 上下/左右放射分层」坐标规则
- 后端只有 `resolveOverlaps` 防撞，没有真正的布局算法
- LLM 既要理解内容、决定结构，又要估算坐标，负担过重

本 spec 的目标：
- 让 LLM 负责**判断内容适合什么布局类型**并输出节点/边关系
- 后端布局引擎负责**自动计算坐标**
- 引入**布局质量评分 + fallback 机制**，避免自动布局比 LLM 原始坐标还差
- 远期支持**组合布局**：一张图的不同区域可采用不同布局

**成功标准（可验证）**：
- Phase 1 支持至少 5 种单一布局：层级树、水平流程图、时间线、放射状概念图、矩阵/四象限
- LLM 可通过新增 `layout` 字段声明布局类型；无该字段时保持现有行为
- 自动布局结果必须经过质量评分，评分不达标时回退到 LLM 原始坐标
- 所有结果仍经过现有 `resolveOverlaps` / `calculateViewport`
- 新增单元测试覆盖主要布局算法与质量评分

## Tech Stack

- TypeScript（项目现有）
- 不引入新的 npm 依赖
- 复用现有 `excalidraw.ts`、`excalidraw-geometry.ts` 的构建流程

## Commands

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 单个测试：`npx vitest run tests/unit/agent/tools/excalidraw-layout.test.ts`
- 开发/热重载：`npm run dev`
- 部署到 test-vault：`npm run deploy`

## Project Structure

```
src/agent/tools/
├── excalidraw.ts                      # 修改：buildExcalidrawJSON 前调用布局引擎
├── excalidraw-geometry.ts             # 现有：重叠推开、视口计算
├── excalidraw-layout.ts               # 新增：布局引擎入口、质量评分、fallback 决策
├── excalidraw-layout-score.ts         # 新增：布局质量评分函数
├── excalidraw-types.ts                # 新增：ElementDef / DiagramLayoutType / LayoutScore 共享类型
└── excalidraw-layouts/                # 新增：各布局算法实现
    ├── index.ts                       # 导出所有布局
    ├── mind-map.ts                    # 左右展开式思维导图（中心 + 多级分支向左右展开）
    ├── hierarchical-tree.ts           # 层级树（近似现有行为）
    ├── flow-horizontal.ts             # 水平流程图（从左到右）
    ├── timeline.ts                    # 时间线（水平）
    ├── radial.ts                      # 放射状概念图
    └── matrix.ts                      # 矩阵 / 四象限

src/agent/graph/utils/
└── diagram-helper.ts                  # 修改：DIAGRAM_SYSTEM_PROMPT 增加 layout 字段说明

tests/unit/agent/tools/
├── excalidraw-layout.test.ts          # 新增：布局算法单元测试
└── excalidraw-layout-score.test.ts    # 新增：布局质量评分测试
```

## 两阶段实现

### Phase 1：单一布局 + 质量回退（本 Spec 核心）

目标：在不破坏现有行为的前提下，让后端具备「按类型自动布局」能力，并保证布局不会比原来更差。共支持 6 种布局类型。

数据流：
```
LLM 输出 JSON
  ├── filename
  ├── layout?: DiagramLayoutType   # 新增可选字段
  └── elements: ElementDef[]

后端处理：
1. 保存原始坐标（originalElements）
2. 如果 layout 有效：
   a. 用对应布局算法重算坐标 → arrangedElements
   b. 对 arrangedElements 执行 resolveOverlaps
   c. 计算 arrangedScore
   d. 对 originalElements 执行 resolveOverlaps → originalResolved
   e. 计算 originalScore
   f. 如果 arrangedScore 同时满足：
      - 重叠面积：arrangedScore.totalOverlapArea <= originalScore.totalOverlapArea * IMPROVEMENT_THRESHOLD
      - 稀疏度：arrangedScore.boundingArea <= originalScore.boundingArea * BOUNDING_AREA_MAX_RATIO
      则使用 arrangedElements
   g. 否则：使用 originalResolved
3. 如果 layout 缺失/无效：对 originalElements 执行 resolveOverlaps
4. 继续 buildExcalidrawJSON 流程（注意：buildExcalidrawJSON 内部不再调用 resolveOverlaps，避免双重防撞破坏布局精度）
```

### Phase 2：组合布局（未来扩展）

目标：一张图的不同区域使用不同布局。例如整体是层级树，但某个主分支内部是时间线。

设计预留（不在 Phase 1 实现）：
- LLM 输出可包含 `regions` 字段，每个 region 指定 `layout` 和所包含元素的 `groupId` 或 `elementIds`
- 布局引擎先按 region 局部布局，再整体协调各 region 位置
- 组合布局同样经过 Phase 1 的质量评分与 fallback

本 Spec **不实现** Phase 2，但代码结构需预留扩展点（`LayoutContext` 可携带 region 信息）。

## Code Style

```typescript
// 布局类型枚举（与 Prompt 中给 LLM 的选项保持一致）
export type DiagramLayoutType =
  | 'hierarchical-tree'
  | 'flow-horizontal'
  | 'timeline'
  | 'radial'
  | 'matrix';

// 布局评分（越低越好）
export interface LayoutScore {
  totalOverlapArea: number;   // 总重叠面积
  overlapPairs: number;       // 重叠元素对数
  boundingArea: number;       // 整体包围盒面积（用于衡量稀疏度）
  edgeCrossings: number;      // 边交叉数；Phase 1 固定返回 0（在 buildExcalidrawJSON 前无法计算箭头实际坐标）
}

// 布局选项：Phase 1 全用默认值，但接口预留扩展点
export interface LayoutOptions {
  columns?: number;                       // matrix: 列数
  direction?: 'horizontal' | 'vertical';  // flow / timeline
  spacing?: { x: number; y: number };     // 可选间距覆盖
}

// 布局算法接口：接收元素与可选配置，返回坐标已重算的元素数组
export interface LayoutEngine {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[];
}

// 布局引擎入口：识别 layout 字段、评分、fallback
export function arrangeWithFallback(
  elements: ElementDef[],
  layout?: DiagramLayoutType,
): ElementDef[] {
  const originalResolved = resolveOverlaps(elements);

  if (!layout || !LAYOUT_REGISTRY[layout]) {
    return originalResolved;
  }

  const arranged = resolveOverlaps(LAYOUT_REGISTRY[layout].arrange(elements));
  const originalScore = scoreLayout(originalResolved);
  const arrangedScore = scoreLayout(arranged);

  const IMPROVEMENT_THRESHOLD = 0.9;      // 重叠面积必须低 10% 以上
  const BOUNDING_AREA_MAX_RATIO = 3.0;    // 防止零重叠时稀疏度爆炸

  const overlapImproved =
    arrangedScore.totalOverlapArea <= originalScore.totalOverlapArea * IMPROVEMENT_THRESHOLD;
  const boundingAreaOk =
    arrangedScore.boundingArea <= originalScore.boundingArea * BOUNDING_AREA_MAX_RATIO;

  if (overlapImproved && boundingAreaOk) {
    return arranged;
  }

  return originalResolved;
}
```

约定：
- 布局算法只计算**形状和文本**的 `x`、`y`、`width`、`height`；不改动 `id`、`text`、`strokeColor`、`backgroundColor`、binding 关系
- 箭头/线元素的 `x`、`y`、`points` 仍由 `buildExcalidrawJSON` 根据 binding 自动计算，布局算法只负责摆好被绑定的节点
- 所有尺寸仍沿用书卷审美档位：Hero 320×160、Primary 220×110、Secondary 160×80、Tertiary 120×60
- 字号仍由 `computeOptimalFontSize` 自动计算，布局算法不干预

## Layout 类型说明

| 布局 | 适用内容 | 视觉特征 | 与类似布局的区分 |
|------|---------|---------|----------------|
| `mind-map` | 章节结构、概念拆解、发散思维 | 中心主题 + 一级分支**左右交替展开**，二级及以下继续向同侧延伸 | **最常用**；与 `hierarchical-tree` 相比更自由放射，与 `radial` 相比有多级层级 |
| `hierarchical-tree` | 章节结构、概念层级 | 中心主题 + 上下/左右放射分支 | **有多层父子关系**（父→子→孙），适合「书的目录/概念层级」 |
| `flow-horizontal` | 流程、步骤、因果关系 | 从左到右排列，箭头连接 | 强调**顺序/流转**，节点通常链式或分支式 |
| `timeline` | 历史、演变、时间线 | 水平时间轴，节点按时间顺序排列 | LLM 需按时间顺序输出节点；布局引擎只做几何摆放 |
| `radial` | 核心概念向外关联 | 中心圆 + 周围节点呈放射状 | **只有一层放射**（中心→外围），外围节点之间**无父子连接**，适合「核心概念 + 关联词」 |
| `matrix` | 分类、对比、四象限 | 2×2 矩阵，节点落入不同象限 | LLM 需按象限顺序输出节点（如左上→右上→左下→右下）；引擎只做几何摆放 |

## Testing Strategy

- 测试层级：单元测试（Vitest）
- 测试位置：
  - `tests/unit/agent/tools/excalidraw-layout.test.ts`
  - `tests/unit/agent/tools/excalidraw-layout-score.test.ts`
- 覆盖范围：
  - 每种布局算法对典型输入输出合理坐标
  - `arrangeWithFallback` 在 layout 有效/无效/缺失时的行为
  - 质量评分：重叠检测正确、分数可比较
  - Fallback：自动布局结果更差时回退到原始坐标
  - 向后兼容：无 `layout` 字段时行为与现在一致
  - binding 关系在布局后保持不变
- 不依赖外部 API：所有测试使用纯内存数组

## Boundaries

**Always**
- 跑 `npm run test:run` 和 `npm run build` 再提交
- 新增布局算法必须配套单元测试
- 保持现有书卷审美设置（色板、字号四档、fontFamily 5、roughness 0）
- 任何自动布局结果都必须经过质量评分，不比 LLM 原始坐标差
- 修改后更新本 spec 中「受影响文件」与「成功标准」

**Ask First**
- 新增 npm 依赖
- 修改 Prompt 中除 `layout` 字段外的核心布局/审美规则
- 重启渐进式分节生成方案
- 进入 Phase 2 实现组合布局
- 添加超过 5 种布局类型

**Never**
- 删除或绕过现有 `resolveOverlaps` / `calculateViewport`
- 让自动布局无条件覆盖 LLM 原始坐标（必须经过评分 fallback）
- 修改 `.excalidraw` 文件格式或 embed 语法
- 删除渐进式分节生成的代码（保持 `@deprecated` 状态）
- 修改 `writeExcalidrawJson` 的布局逻辑（该函数已 deprecated，Phase 1 不涉及）

## Success Criteria

1. `src/agent/tools/excalidraw-types.ts` 存在，导出 `ElementDef`、`DiagramLayoutType`、`LayoutScore`、`LayoutOptions`、`LayoutEngine`
2. `src/agent/tools/excalidraw-layout.ts` 存在，导出 `arrangeWithFallback`
3. `src/agent/tools/excalidraw-layout-score.ts` 存在，导出 `scoreLayout` 与 `LayoutScore`
4. `src/agent/tools/excalidraw-layouts/` 目录存在，包含 6 种布局实现
5. `src/agent/tools/excalidraw.ts` 中 `buildExcalidrawJSON` 内部不再调用 `resolveOverlaps`，由 `arrangeWithFallback` 统一负责
6. LLM 输出可包含 `layout` 字段，取值在受控枚举内；非法值 fallback 到默认行为
7. 无 `layout` 字段时，行为与现在完全一致（向后兼容）
8. 自动布局后必须评分，评分不达标时回退到 LLM 原始坐标（仅 resolveOverlaps）
9. 新增单元测试覆盖主要布局算法（含 mind-map）、评分函数、fallback 逻辑
10. `npm run build` 通过
11. `npm run test:run` 通过

## Open Questions

1. **评分阈值**：`IMPROVEMENT_THRESHOLD = 0.9`（自动布局总重叠面积必须比原始坐标低 10% 以上才采用）与 `BOUNDING_AREA_MAX_RATIO = 3.0`（自动布局包围盒面积不能超过原始坐标 3 倍）是否合理？是否需要根据元素数量动态调整？
2. **时间线/矩阵的额外语义**：Phase 1 约定：LLM 必须按时间顺序或象限顺序输出节点，布局引擎只负责几何摆放，不做语义排序。未来如需语义排序，作为 Phase 1.5 独立研究。时间线是否需要 LLM 提供显式 `timestamp` 标签？矩阵是否需要 `quadrant` 标签？建议 Phase 1 不强制要求，让 LLM 通过 `text` 自然表达。
3. **布局类型扩展**：是否需要在 Prompt 中给 LLM 提供「布局选择指南」（例如「流程/步骤 → flow-horizontal」「时间演变 → timeline」「分类对比 → matrix」）？建议加入，减少 LLM 误判。
4. **视觉验收**：自动布局后的图是否需要在真实 Obsidian 中做人工抽查？当前项目有 `test-output/excalidraw-screenshots/` 目录，是否复用？
5. **Phase 2 触发条件**：Phase 1 跑通并验证有效后，再启动组合布局？还是一开始就预留接口？
6. **`edgeCrossings` 处理**：Phase 1 `LayoutScore.edgeCrossings` 固定返回 0，因为 buildExcalidrawJSON 之前无法确定箭头实际坐标。是否可接受？

## Assumptions I'm Making

1. 保留现有的单次 `generateDiagram` 流程，不重启渐进式分节生成方案
2. 布局引擎放在后端 TypeScript 中实现，不引入新的 npm 依赖
3. LLM 仍然输出 Excalidraw 元素 JSON，但增加一个可选的 `layout` 字段
4. 先实现 Phase 1（6 种单一布局 + 质量 fallback），Phase 2（组合布局）作为预留扩展
5. 现有审美设置（色板、字号四档、fontFamily 5、roughness 0）保持不变
6. 向后兼容：LLM 不输出 `layout` 时，行为与现在完全一致
7. 自动布局不保证 100% 完美，通过「评分 + fallback」机制防止退化

→ 如果以上假设有误，请现在纠正；否则我按此继续进入 Plan / Tasks 阶段。
