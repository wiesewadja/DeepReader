# 阅读模式墨迹层设计

## 目标

在阅读模式中叠加持久化墨迹层，让用户阅读时鼠标轨迹留下类似毛笔的墨痕，营造"翻阅一本自己批注过的书"的视觉氛围。

## 核心设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 墨迹性质 | 视觉氛围（非输入工具） | 模拟纸质书翻阅痕迹 |
| 衰减策略 | 慢衰减 + 叠加增强 | 短期淡痕营造氛围，反复停留处始终浓 |
| 存储格式 | JSON 点序列（相对坐标百分比） | 窗口 resize 后可重新适配 |
| Canvas 定位 | fixed 定位，覆盖视口可见区域 | CSS 多列横向滚动，Canvas 只需覆盖当前可见列 |
| 绘制策略 | 按需绘制，非持续 rAF 循环 | 墨迹持久化无需每帧清空重绘 |
| 与现有墨痕的关系 | 独立模块，不复用 message.ts 代码 | 两处场景不同，各自演化 |

## 一、Canvas 定位策略

阅读模式使用 CSS 多列横向滚动（`column-width` + `column-gap` + `scrollLeft`）。每一"页"是视口宽度的一列。

**Canvas 挂载到 `.view-content` 上，使用 `position: fixed`**，宽高等于视口可见区域。Canvas 不随 scrollLeft 移动——它始终覆盖当前可见的那一列内容。

这意味着 Canvas 坐标系就是视口坐标系，`clientX/clientY` 到 Canvas 坐标的转换无需考虑滚动偏移。

## 二、墨迹渲染

Canvas 覆盖在阅读内容上方（`pointer-events: none`），不影响文字选择和点击。

### 绘制算法（复用现有逻辑）

- `mousemove` 采集点：`{ x, y, t, speed }`
- 速度决定笔宽：慢 = 粗（模拟毛笔按压），快 = 细
- 颜色：暗红 `rgba(178, 34, 34, ...)`
- 基础笔宽 4.5px，速度因子 `max(0.15, 1 - speed * 0.8)`

### 绘制策略：按需绘制

不同于 message.ts 中的持续 rAF 循环（因为墨迹 1.2s 消失需要每帧重绘），阅读模式墨迹是持久的，不需要每帧清空重绘。

**绘制时机**：只在有新 `mousemove` 点时增量绘制新线段，不清空 Canvas。衰减效果在保存时批量计算（见第四节）。

### 衰减机制

- 新笔迹初始透明度 0.6
- 衰减计算**惰性执行**：仅在翻页保存时，遍历所有点，根据 `t` 计算经过时间，更新 `alpha` 值
- 每分钟衰减 2%（约 25 分钟降到 10%）
- 同一区域（10px 半径内）多次笔迹叠加，透明度取 `min(1, sum)`
- 加载已有墨迹时，先计算衰减再绘制，展示"旧墨迹变淡"的效果

### 墨迹晕染

保留现有晕染效果：当透明度 > 0.3 时，在笔迹点周围绘制淡墨圆（`rgba(178, 34, 34, alpha * 0.12)`），模拟墨水洇开。

### 性能保护

- 每页最大点数上限 2000，超出后合并相近点（距离 < 3px 的相邻点取平均）
- 仅在有新 mousemove 事件时才触发增量绘制，无持续 rAF 循环

## 三、数据结构

每页墨迹存储为 JSON 文件。

**路径**：`.pageindex/{bookId}/ink/{chapterFileIndex}-{pageIndex}.json`

`chapterFileIndex` 使用章节文件名前缀数字（如 `01` → `1`），由 `ReadingModeService.getChapterNavigation().currentIndex` 提供（1-based）。文件名前缀是稳定的章节标识，不随文件夹内容变化。

```json
{
  "version": 1,
  "points": [
    { "x": 0.35, "y": 0.12, "speed": 0.8, "alpha": 0.6, "t": 1713254400000 },
    { "x": 0.36, "y": 0.13, "speed": 0.3, "alpha": 0.7, "t": 1713254400050 }
  ]
}
```

- `x`、`y`：相对视口可见区域的百分比（0~1），加载时乘以当前 Canvas 尺寸还原
- `speed`：绘制时用于计算笔宽
- `alpha`：保存时计算后的透明度（已含衰减），加载后在此基础上继续衰减
- `t`：时间戳（ms），用于计算衰减时长

空页面（无墨迹）不创建文件。加载时文件不存在视为空页。

## 四、页面绑定与翻页

### PagePaginator 改动

`PagePaginator` 当前没有页面变更回调。需在 `PagePaginatorOptions` 中新增：

```typescript
interface PagePaginatorOptions {
  // ... 现有字段
  onPageChange?: (oldPage: number, newPage: number) => void;
}
```

在 `updateCurrentPageFromScroll()` 检测到页码变化时触发此回调。

### 翻页流程

1. `onPageChange(oldPage, newPage)` 触发
2. InkLayer 保存 oldPage：将当前 Canvas 点序列序列化为 JSON（惰性计算衰减后）
3. 清空 Canvas
4. InkLayer 加载 newPage：读取 JSON 文件，计算加载时衰减，绘制到 Canvas
5. 继续在新页上采集墨迹

### 章节切换

章节切换通过 `leaf.openFile()` 完成，触发 `deactivate()` → `activate()`。InkLayer 实例在 `deactivate()` 中保存当前页后销毁，新章节 `activate()` 时创建新实例。

### 窗口 resize

InkLayer 使用自己的 ResizeObserver 监听 Canvas 容器。resize 时：
1. 将当前点序列保存到临时变量
2. 调整 Canvas 尺寸
3. 用保存的点序列重新绘制（相对坐标 × 新尺寸）

## 五、持久化时机

| 时机 | 操作 | 说明 |
|------|------|------|
| 翻页 | 保存旧页，加载新页 | `onPageChange` 回调 |
| 切换章节 | 保存当前页 | `deactivate()` 内部自动调用 |
| 离开阅读模式 | 保存当前页 | `deactivate()` 内部自动调用 |
| debounce 5 秒 | 自动保存当前页 | debounce 回调中检查：是否有新笔迹 && 页码未变，满足条件才写入 |

debounce 竞态处理：debounce 回调捕获启动时的 `pageIndex`，触发时比较当前页码，不一致则跳过（翻页已保存过）。

## 六、模块结构

### 新增文件

- `src/components/reading-mode/ink-layer.ts` — 墨迹层类

### 修改文件

- `src/components/reading-mode/page-paginator.ts` — 新增 `onPageChange` 回调选项
- `src/services/reading-mode-service.ts` — 集成 InkLayer 生命周期

### InkLayer 类接口

```typescript
interface InkLayerOptions {
  container: HTMLElement;       // Canvas 挂载的容器（.view-content）
  bookId: string;               // 书籍 ID（SHA-256 hash 前 8 位）
  getChapterIndex: () => number; // 动态获取当前章节索引（避免过期）
  getPageIndex: () => number;    // 动态获取当前页码
  vault: Vault;                  // Obsidian Vault API 用于文件读写
}

class InkLayer {
  constructor(options: InkLayerOptions)

  // 生命周期
  activate(): void        // 创建 Canvas（fixed 定位），挂载 mousemove，加载当前页墨迹
  deactivate(): void      // 保存当前页，清理 Canvas、事件监听、ResizeObserver
  destroy(): void         // deactivate 后移除 DOM 元素

  // 页面切换（由 onPageChange 回调调用）
  onPageChange(oldPage: number, newPage: number): void

  // 内部
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private points: InkPoint[]
  private dirty: boolean  // 是否有未保存的新笔迹

  private onMove(e: MouseEvent): void
  private drawSegment(from: InkPoint, to: InkPoint): void  // 增量绘制
  private redraw(): void                                    // 全量重绘（resize/加载时）
  private applyDecay(): void                                // 惰性衰减计算
  private savePage(pageIndex: number): Promise<void>
  private loadPage(pageIndex: number): Promise<void>
  private getInkPath(chapterIndex: number, pageIndex: number): string
}
```

`chapterIndex` 和 `pageIndex` 通过函数动态获取，而非构造时缓存，避免章节/页面切换后值过期。

### 集成点

- `ReadingModeService.activate()` → 创建 `InkLayer` 实例并调用 `activate()`
- `ReadingModeService.deactivate()` → 调用 `inkLayer.deactivate()`
- `PagePaginator` 构造参数新增 `onPageChange` → 调用 `inkLayer.onPageChange()`
- InkLayer 自带 ResizeObserver 监听容器尺寸变化

### 不改动的部分

- `message.ts` 中的墨痕效果保持不变（全屏面板装饰用途）
- 现有的高亮（`<mark>`）、摘录、选文字功能不受影响

## 七、边界情况

| 场景 | 处理 |
|------|------|
| 空页面（无墨迹） | 不创建文件，加载时文件不存在视为空页 |
| 首页向左 / 末页向右 | 触发章节导航，走 deactivate → activate 流程 |
| debounce 进行中章节切换 | deactivate 保存当前页，debounce 回调检查实例是否已销毁 |
| Canvas 容器高度为 0 | 不激活墨迹层，不采集不绘制 |
| 文件读取失败（损坏的 JSON） | 忽略错误，视为空页，console.warn 记录 |

## 八、存储估算

- 每页约 200-500 个采集点
- 每个点约 50 字节 JSON
- 每页约 10-25 KB
- 一本 300 页的书约 3-7.5 MB
- 可接受，无需压缩优化
