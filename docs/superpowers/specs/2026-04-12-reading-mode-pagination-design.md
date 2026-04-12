# 阅读模式分页设计

**日期**: 2026-04-12
**状态**: 已批准

## 背景

DeepReader 阅读模式以"一个 Markdown 文件 = 一个章节"为单位展示内容，利用 Obsidian 原生 Markdown 预览引擎渲染。当单个章节内容过长（几十页）时，阅读体验不佳 — 用户需要大量滚动，无法像阅读实体书或 Kindle 那样有节奏地翻页。

## 目标

为阅读模式增加**页面级分页**功能，类似 Kindle/macOS Books 的翻页体验。仅阅读模式下生效，不影响 Obsidian 正常浏览。

## 方案选择

| 方案 | 描述 | 结论 |
|------|------|------|
| A: DOM 分页 | 纯前端分割，操作已渲染的 DOM 元素 | **采用** — 不改文件结构，与现有架构兼容 |
| B: Markdown 预分页 | 导出时将大章节拆分为多个文件 | 否 — 破坏现有章节导航，需重新索引 |
| C: 虚拟滚动 | 只渲染可视区域附近的 DOM | 否 — 实现复杂，与 Obsidian 渲染深度耦合 |

## 架构设计

### 组件层级

```
ReadingModeService（现有）
├── SelectionToolbar（现有）  文本选中交互
├── ChapterNav（现有）        章节级导航
└── PagePaginator（新增）     页面级分页
```

### 新增文件

- `src/components/reading-mode/page-paginator.ts` — 分页核心逻辑
- 分页样式追加到 `src/components/reading-mode/reading-mode.css`

### 修改文件

- `src/services/reading-mode-service.ts` — 集成 PagePaginator
- `src/components/reading-mode/chapter-nav.ts` — 键盘快捷键调整

## PagePaginator 类设计

### 核心属性

```typescript
class PagePaginator {
    private pages: Element[][];           // 每页的顶层 DOM 元素数组
    private currentPage: number;          // 当前页码（0-based）
    private totalPages: number;           // 总页数

    // DOM 引用
    private containerEl: HTMLElement;     // .markdown-preview-sizer
    private leftBtnEl: HTMLElement;       // 左侧翻页按钮
    private rightBtnEl: HTMLElement;      // 右侧翻页按钮
    private progressBarEl: HTMLElement;   // 进度条
    private pageIndicatorEl: HTMLElement; // 页码指示器
    private resizeObserver: ResizeObserver;
}
```

### 核心方法

| 方法 | 职责 |
|------|------|
| `paginateAndShow()` | 收集顶层元素，测量高度分组，显示第一页 |
| `showPage(n)` | 隐藏所有页，显示第 n 页，更新进度条 |
| `nextPage()` | 下一页，到达末尾触发章节切换回调 |
| `prevPage()` | 上一页，到达开头触发章节切换回调 |
| `createControls()` | 创建两侧按钮 + 底部进度条 DOM |
| `destroy()` | 移除控制元素，恢复全部 DOM 可见 |

## 动态分页算法

基于视口实际高度动态计算，保证每页内容完整显示、不被截断。

```
1. 收集 .markdown-preview-sizer 的直接子元素（排除 frontmatter、chapter-nav）
2. 计算可用高度：
   可用高度 = 视口高度 - 顶部留白(80px) - 底部留白(120px) - 控件高度(60px)
3. 遍历每个元素：
   - 测量 offsetHeight（实际渲染高度）
   - 如果 当前页累计高度 + 元素高度 <= 可用高度：
       加入当前页
   - 否则：
       封页，该元素归入下一页（保证元素完整，不被截断）
4. 如果总页数 <= 1，不激活分页
```

### 响应式重算

通过 `ResizeObserver` 监听容器和视口变化，防抖 300ms 后重新分页，并恢复到之前的阅读进度位置（按百分比计算对应页码）。

触发重算的场景：
- 窗口大小改变（拖拽、最大化）
- Obsidian 侧边栏展开/收起
- 字体大小变化
- 全屏切换
- 图片加载完成

### 容器控制

分页激活时：
- `.markdown-preview-sizer` 设置 `overflow: hidden`，高度锁定为可用高度
- 非当前页的元素添加 `.deeppdf-page-hidden { display: none !important }`
- 不复制或移动 DOM 节点，只切换显示/隐藏

## 交互设计

### 翻页按钮

两侧半透明圆形按钮，类似 macOS Books：
- `position: fixed`，垂直居中
- 左侧 `<` 右侧 `>`，44px 圆形
- 默认 `opacity: 0.15`，hover 时 `opacity: 0.7`
- 到达边界时按钮消失（`opacity: 0` + `pointer-events: none`）

### 底部进度条

- 细长条形（3px 高），圆角
- 填充色使用 `--interactive-accent`
- 右侧显示页码文字 `3 / 12`
- 位于章节导航栏上方

### 键盘快捷键

统一翻页和翻章为一个交互流：
- **左箭头**：上一页 → 如果已是第一页，跳转上一章
- **右箭头**：下一页 → 如果已是最后一页，跳转下一章

## 与 ReadingModeService 的集成

```typescript
// reading-mode-service.ts 修改点：
class ReadingModeService {
    private paginator: PagePaginator | null;  // 新增

    activate(file) {
        // ... 现有逻辑 ...
        setTimeout(() => {
            this.paginator = new PagePaginator({
                container: previewSizer,
                onNavigatePrev: () => this.navigateToPrev(),
                onNavigateNext: () => this.navigateToNext(),
            });
            this.paginator.paginateAndShow();
            this.chapterNav?.update();
        }, 200);
    }

    deactivate() {
        this.paginator?.destroy();
        this.paginator = null;
        // ... 现有逻辑 ...
    }
}
```

ChapterNav 的键盘快捷键改为通过 PagePaginator 中转：
- 左/右箭头 → 先尝试 `prevPage()`/`nextPage()`
- 翻页到达边界 → 返回 false → ChapterNav 触发章节切换

## 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 内容太短（< 1 页） | `totalPages <= 1` 不激活分页，隐藏按钮和进度条 |
| 单个元素超高（如长表格） | 强制单独一页，允许溢出 |
| 图片加载改变高度 | ResizeObserver 监听，自动重算 |
| 切换章节 | destroy() 旧分页，新文件重新分页 |
| 退出阅读模式 | destroy() 恢复所有元素可见 |
| 高亮/摘录操作 | 正常工作，操作的是当前页可见的 DOM |

## 不做的事情

- 不持久化分页进度（每次打开重新计算）
- 不修改源 Markdown 文件
- 不实现滑动翻页动画（保持简单）
- 不支持用户自定义每页字数（动态高度已自适应）
