# Spec：Organic Scroll Style 有机书卷风

> 将 PRD #1 展开为可落地实现。让 DeepReader 生成的每一张 Excalidraw 图都默认呈现「手绘书卷」质感：有机连线、轻手绘节点、主题自适应纸色背景。

---

## 目标

为 AI 生成的 Excalidraw 图引入统一的 **Organic Scroll Style（有机书卷风）**，解决当前图形只靠配色、连线过于生硬的问题。

本 Spec 不新增布局算法，也不引入用户脚本系统；它是在现有语义布局引擎之后、JSON 构建之前增加一层**风格处理器**，把结构正确但视觉平淡的图转换成有手绘感的图。

## 命令

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 单个测试：`npx vitest run tests/unit/agent/tools/excalidraw-style-processor.test.ts`
- 开发/热重载：`npm run dev`
- 部署到 test-vault：`npm run deploy`
- 切 worktree：`npm run worktree:create feat/organic-scroll-style`

---

## 受影响模块

- `src/agent/tools/excalidraw-style-processor.ts` — 新增，风格处理器核心
- `src/agent/tools/excalidraw-types.ts` — 修改，增加 `semanticColor` 字段、主题类型
- `src/agent/tools/excalidraw.ts` — 修改，`buildExcalidrawJSON` 前调用 style-processor，注入 `appState`
- `src/agent/tools/definitions/excalidraw.ts` — 修改，LLM prompt：颜色改用语义标签
- `src/agent/tools/excalidraw-layout.ts` — 修改，把 theme / layout / 开关传给 processor
- `src/config/settings.ts` — 修改，新增 `enableOrganicScrollStyle` 设置项
- `src/settings/sections/advanced-section.ts` 或 `llm-section.ts` — 修改，添加设置开关 UI
- `tests/unit/agent/tools/excalidraw-style-processor.test.ts` — 新增，处理器单元测试
- `tests/unit/agent/tools/excalidraw.test.ts` — 修改，补充 JSON 构建后包含 customData 的断言
- `scripts/excalidraw-screenshot.mjs` — 修改/复用，生成样例图用于人工审图

---

## 技术约束

- 不引入新的 npm 依赖
- 只依赖 Obsidian Excalidraw 插件对 `customData.strokeOptions` 的私有渲染能力
- 向后兼容：设置关闭时行为与现在完全一致
- 日志用 `utils/logger.ts`
- TypeScript 严格模式

---

## 数据流

```
用户消息 → Router → S1/S2/S3 分析
                          │
                          ▼
                  VISUALIZER 节点
                          │
                          ▼
                  diagram-helper.generateDiagram()
                          │
                          ▼
                  LLM 输出 { filename, layout, elements }
                          │
                          ▼
                  excalidraw-layout.arrangeWithFallback()
                          │
                          ▼
                  excalidraw-style-processor.applyOrganicScrollStyle()
                  输入: ElementDef[], layout, theme, enableOrganicScrollStyle
                  输出: StyledElementDef[], appStateOverrides
                          │
                          ▼
                  excalidraw.buildExcalidrawJSON()
                  注入 appState.viewBackgroundColor
                          │
                          ▼
                  写入 .excalidraw 文件
```

---

## 详细设计

### 1. 风格处理器接口

```typescript
export type ObsidianTheme = 'light' | 'dark';

export type SemanticColor =
  | 'primary'      // 主流程、主节点
  | 'emphasis'     // 重点、起点、关键决策
  | 'success'      // 成功、终点、生长
  | 'warning'      // 警告、备选、冲突
  | 'highlight'    // 高亮、注释
  | 'neutral';     // 默认

export interface StyleProcessorInput {
  elements: ElementDef[];
  layout: DiagramLayoutType;
  theme: ObsidianTheme;
  enabled: boolean;
}

export interface StyleProcessorOutput {
  elements: ElementDef[];
  appStateOverrides: {
    viewBackgroundColor: string;
    // 预留：gridColor, currentItem 等
  };
}

export function applyOrganicScrollStyle(
  input: StyleProcessorInput,
): StyleProcessorOutput;
```

### 2. 处理流程

当 `enabled === false` 时，处理器直接返回原元素 + 默认背景色（保持现有行为）。

当 `enabled === true` 时，按以下步骤处理：

1. **颜色归一化**：把 LLM 可能硬编码的 strokeColor / backgroundColor 映射成语义标签（如果已有语义标签则保留）。
2. **节点样式**：
   - `roughness: 1`
   - `strokeWidth: 2`
   - `roundness: { type: 3 }`
   - `fillStyle: 'solid'`
   - 根据 `semanticColor` 和 `theme` 映射到具体色值
3. **连线转换**：
   - 遍历所有 `type === 'arrow' || type === 'line'` 的元素
   - 根据 `startBinding` / `endBinding` 找到连接的两个节点
   - 用现有 `edgeIntersection()` 计算端点（或退回到节点中心）
   - 根据 `layout` 决定路径形状：
     - `mind-map`, `radial`：轻贝塞尔曲线
     - `hierarchical-tree`, `flow-horizontal`, `timeline`, `matrix`：近似直线
   - 生成 `pressures` 数组（马克笔感：中间略细、两端 taper）
   - 将元素转为 `type: 'freedraw'`，写入 `customData.strokeOptions`
4. **文本样式**：
   - 保留现有字号计算
   - 文字颜色根据 theme 反转为深色（light）或浅色（dark）
5. **背景色**：
   - light: `#fffce8`
   - dark: `#1f1d19`

### 3. 有机线参数

默认 Markers 预设：

```typescript
const ORGANIC_LINE_PRESET = {
  thinning: 2,
  smoothing: 0.5,
  streamline: 0.6,
  easing: 'linear',
  start: { taper: true, easing: 'linear', cap: true },
  end: { taper: true, easing: 'linear', cap: false },
};
```

`pressures` 数组长度与 `points` 相同，按两端向中间递减生成，避免所有点压力一致。

### 4. 主题色板

```typescript
const PALETTE: Record<ObsidianTheme, Record<SemanticColor, { stroke: string; fill: string }>> = {
  light: {
    primary:   { stroke: '#1e3a5f', fill: '#e8f0fe' },
    emphasis:  { stroke: '#c53030', fill: '#fde8e8' },
    success:   { stroke: '#1f5e3b', fill: '#e6f4ea' },
    warning:   { stroke: '#b45309', fill: '#fff3e0' },
    highlight: { stroke: '#a16207', fill: '#fef9c3' },
    neutral:   { stroke: '#2c2c2c', fill: '#fdfbf7' },
  },
  dark: {
    primary:   { stroke: '#93c5fd', fill: '#1e3a5f' },
    emphasis:  { stroke: '#fca5a5', fill: '#7f1d1d' },
    success:   { stroke: '#86efac', fill: '#14532d' },
    warning:   { stroke: '#fdba74', fill: '#7c2d12' },
    highlight: { stroke: '#fde047', fill: '#713f12' },
    neutral:   { stroke: '#e5e5e5', fill: '#2a2721' },
  },
};
```

文字颜色：
- light: `#1e293b`
- dark: `#f5f5f0`

### 5. LLM Prompt 改动

在 `createExcalidrawTool` 的 schema 和 description 中：

1. 元素对象增加可选字段：
   ```typescript
   semanticColor: z
     .enum(['primary', 'emphasis', 'success', 'warning', 'highlight', 'neutral'])
     .optional()
     .describe('节点的语义颜色角色，系统会映射到主题适配的具体色值'),
   ```
2. 移除 prompt 中「书卷审美色板」的硬编码 hex 值，改为：
   - 说明 `semanticColor` 的语义
   - 强调「不要写死 hex，用 semanticColor 表达层级」
3. 移除 `roughness: 0` 的硬性要求，改为「样式由系统统一处理，LLM 无需指定 roughness、fillStyle、strokeWidth」

### 6. 设置项

在 `DeepPDFSettings` 中新增：

```typescript
enableOrganicScrollStyle: boolean;
```

默认值 `true`。

在设置页「Agent / 可视化」或「高级」分类下增加 Toggle：

> **使用有机书卷风生成图表**  
> 开启后，AI 生成的思维导图、流程图等 Excalidraw 图将采用手绘连线、轻手绘节点和纸色背景。关闭后恢复原有简洁风格。

### 7. 主题来源

- 优先从 `app.vault.getConfig('theme')` 或 Obsidian 当前 CSS 变量读取主题
- 若无法可靠检测，默认 `'light'`
- 主题变化不影响已生成的旧图

---

## 测试策略

### 单元测试

`tests/unit/agent/tools/excalidraw-style-processor.test.ts`：

- `enabled=false` 时元素不变、背景色为默认值
- `enabled=true` 时：
  - 所有 arrow/line 转为 freedraw
  - freedraw 元素包含 `customData.strokeOptions` 且参数符合预设
  - 节点 `roughness === 1`
  - `appState.viewBackgroundColor` 随 theme 变化
  - `semanticColor` 正确映射到主题色
  - 极短连线有退化处理（不崩溃）

### 集成测试

`tests/unit/agent/tools/excalidraw.test.ts` 补充：

- `buildExcalidrawJSON` 接收 style-processor 输出后，生成的 JSON 能被 `JSON.parse` 且 `elements` 包含有效 freedraw
- 关闭开关后 JSON 与改造前一致（回归）

### 视觉回归

复用 `scripts/excalidraw-screenshot.mjs` 或 `tests/e2e/specs/excalidraw-visual.e2e.ts`：

- 固定 3 张样例图：mind-map、flow-horizontal、matrix
- 生成后自动截图，存入 `test-output/excalidraw-screenshots/`
- 作为 PR 附件或人工审图入口

### 人工验收

- 在 test-vault 生成样例图
- 在 Obsidian light/dark 主题下分别打开
- 确认：连线有笔意、节点不花、文字可读、背景不刺眼

---

## 边界

**Always**
- 跑 `npm run test:run` 和 `npm run build` 再提交
- 新增方法写 JSDoc
- 修改后同步更新本 spec 的「受影响模块」

**Ask First**
- 新增 npm 依赖
- 修改 `.excalidraw` 文件格式或 embed 语法
- 改变 layout 引擎的输出接口
- 添加新的语义颜色角色

**Never**
- 删除或绕过现有 `resolveOverlaps` / `calculateViewport`
- 让风格处理无条件覆盖 LLM 原始坐标
- 修改 `writeExcalidrawJson`（已 deprecated）
- 提交未经验证的视觉改动到主分支

---

## 验收标准

1. `src/agent/tools/excalidraw-style-processor.ts` 存在并导出 `applyOrganicScrollStyle`
2. `ElementDef` 支持可选 `semanticColor` 字段
3. LLM prompt 不再硬编码 hex 色值，改用语义颜色标签
4. `buildExcalidrawJSON` 输出的 JSON 在开启开关时包含 `customData.strokeOptions`
5. 所有布局生成的图都应用有机书卷风
6. 关闭设置开关后，生成图与改造前行为一致
7. light/dark 主题下背景色和文字色正确切换
8. 新增单元测试覆盖 style-processor 主要分支
9. `npm run build` 通过
10. `npm run test:run` 通过

---

## Open Questions

1. `customData.strokeOptions` 在 Excalidraw 插件不同版本间是否稳定？是否需要版本检测或 graceful fallback？
2. 流程图/时间轴去掉箭头后，用户是否能通过布局清晰识别方向？是否需要 A/B 测试？
3. 是否需要为 `hierarchical-tree` 也使用曲线，还是保持直线？
4. 中文书法字体是否未来要加入？本阶段保持 Excalidraw 默认字体。

---

## 假设

1. 用户已安装 Obsidian Excalidraw 插件且版本支持 `customData.strokeOptions`
2. 风格处理器只在 AI 生成路径生效，不处理用户手动创建的图
3. 本次不改动现有 6 种布局算法，只改后处理
4. 旧图不追溯更新
