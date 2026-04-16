# 阅读模式墨迹层 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阅读模式中叠加持久化墨迹 Canvas，鼠标轨迹留下毛笔墨痕并按页保存，营造翻阅批注书的视觉氛围。

**Architecture:** 新增 `InkLayer` 类挂载到 `.view-content`，Canvas fixed 覆盖视口，mousemove 采集点按需增量绘制。PagePaginator 新增 `onPageChange` 回调触发翻页保存/加载。墨迹存为 JSON（相对坐标百分比）到 `.pageindex/{bookId}/ink/`。

**Tech Stack:** TypeScript, Canvas 2D API, Obsidian Vault API, ResizeObserver

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/components/reading-mode/ink-layer.ts` | 墨迹层：Canvas 管理、点采集、绘制、衰减、持久化 |
| Modify | `src/components/reading-mode/page-paginator.ts` | 新增 `onPageChange` 回调选项 |
| Modify | `src/services/reading-mode-service.ts` | 集成 InkLayer 生命周期（activate/deactivate/翻页） |
| Modify | `src/components/reading-mode/reading-mode.css` | Canvas 层 z-index 样式 |

---

## Chunk 1: InkLayer 核心数据结构与绘制

### Task 1: 创建 InkLayer 基础骨架与类型定义

**Files:**
- Create: `src/components/reading-mode/ink-layer.ts`

- [ ] **Step 1: 创建 ink-layer.ts，定义接口和类型**

```typescript
import { App, Vault } from 'obsidian';
import { serviceLog } from '../../utils/logger.js';

/** 单个墨迹点（相对坐标） */
interface InkPoint {
	x: number;      // 0~1，相对视口宽度百分比
	y: number;      // 0~1，相对视口高度百分比
	speed: number;  // 鼠标速度，用于计算笔宽
	alpha: number;  // 当前透明度
	t: number;      // 时间戳 (ms)
}

/** 持久化数据格式 */
interface InkPageData {
	version: 1;
	points: InkPoint[];
}

/** 构造选项 */
export interface InkLayerOptions {
	container: HTMLElement;
	getBookId: () => string;
	getChapterIndex: () => number;
	getPageIndex: () => number;
	app: App;
}

const INK_DIR = '.pageindex';
const INK_SUBDIR = 'ink';

export class InkLayer {
	private container: HTMLElement;
	private app: App;
	private getBookId: () => string;
	private getChapterIndex: () => number;
	private getPageIndex: () => number;

	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private points: InkPoint[] = [];
	private dirty = false;

	private resizeObserver: ResizeObserver | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private moveHandler: ((e: MouseEvent) => void) | null = null;

	private lastX = 0;
	private lastY = 0;
	private lastTime = 0;
	private active = false;

	constructor(options: InkLayerOptions) {
		this.container = options.container;
		this.app = options.app;
		this.getBookId = options.getBookId;
		this.getChapterIndex = options.getChapterIndex;
		this.getPageIndex = options.getPageIndex;
	}

	activate(): void {
		// placeholder — 后续 task 实现
	}

	deactivate(): void {
		// placeholder — 后续 task 实现
	}

	onPageChange(_oldPage: number, _newPage: number): void {
		// placeholder — 后续 task 实现
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/reading-mode/ink-layer.ts
git commit -m "feat(ink-layer): scaffold InkLayer class with types"
```

---

### Task 2: 实现 Canvas 创建与 mousemove 采集

**Files:**
- Modify: `src/components/reading-mode/ink-layer.ts`

- [ ] **Step 1: 实现 activate() — 创建 Canvas，挂载 mousemove**

在 `activate()` 中：
1. 创建 `<canvas>` 元素，设置 `position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2;`
2. 挂载到 `this.container`（`.view-content`）
3. 设置 canvas 宽高为 `window.innerWidth` × `window.innerHeight`
4. 注册 `window.addEventListener('mousemove', this.moveHandler)` 采集点
5. 设置 `this.active = true`

mousemove handler：
1. 采样节流：距离上次 < 8ms 则跳过
2. 计算 speed = distance / dt
3. 将 `clientX / window.innerWidth` 和 `clientY / window.innerHeight` 存为相对坐标
4. 推入 `this.points`，设置 `this.dirty = true`
5. 调用 `drawSegment(prevPoint, currPoint)` 增量绘制

```typescript
activate(): void {
	if (this.active) return;

	this.canvas = document.createElement('canvas');
	this.canvas.className = 'deeppdf-ink-layer-canvas';
	this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
	this.container.appendChild(this.canvas);
	this.ctx = this.canvas.getContext('2d');
	this.resizeCanvas();

	this.lastX = 0;
	this.lastY = 0;
	this.lastTime = 0;

	this.moveHandler = (e: MouseEvent) => {
		const now = performance.now();
		const dt = now - this.lastTime;
		if (dt < 8) return;

		const dx = e.clientX - this.lastX;
		const dy = e.clientY - this.lastY;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < 2) return;

		const speed = dt > 0 ? dist / dt : 0;
		const point: InkPoint = {
			x: e.clientX / window.innerWidth,
			y: e.clientY / window.innerHeight,
			speed,
			alpha: 0.6,
			t: now,
		};
		this.points.push(point);
		this.dirty = true;

		if (this.points.length >= 2) {
			this.drawSegment(this.points[this.points.length - 2], point);
		}

		this.lastX = e.clientX;
		this.lastY = e.clientY;
		this.lastTime = now;

		this.scheduleAutoSave();
	};

	window.addEventListener('mousemove', this.moveHandler);
	this.setupResizeObserver();
	this.active = true;
	serviceLog('[InkLayer] Activated');
}
```

- [ ] **Step 2: 实现 drawSegment() — 增量绘制单条线段**

```typescript
private drawSegment(prev: InkPoint, curr: InkPoint): void {
	const ctx = this.ctx;
	if (!ctx || !this.canvas) return;

	const w = this.canvas.width;
	const h = this.canvas.height;

	const baseWidth = 4.5;
	const speedFactor = Math.max(0.15, 1 - curr.speed * 0.8);
	const width = baseWidth * speedFactor * (0.3 + curr.alpha * 0.7);

	ctx.beginPath();
	ctx.moveTo(prev.x * w, prev.y * h);
	ctx.lineTo(curr.x * w, curr.y * h);
	ctx.strokeStyle = `rgba(178, 34, 34, ${curr.alpha * 0.6})`;
	ctx.lineWidth = width;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();

	// 墨迹晕染
	if (curr.alpha > 0.3) {
		ctx.beginPath();
		ctx.arc(curr.x * w, curr.y * h, width * 0.8, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(178, 34, 34, ${curr.alpha * 0.12})`;
		ctx.fill();
	}
}
```

- [ ] **Step 3: 实现 resizeCanvas() 和 ResizeObserver**

```typescript
private resizeCanvas(): void {
	if (!this.canvas) return;
	this.canvas.width = window.innerWidth;
	this.canvas.height = window.innerHeight;
}

private setupResizeObserver(): void {
	this.teardownResizeObserver();
	this.resizeObserver = new ResizeObserver(() => {
		if (!this.active) return;
		const oldPoints = [...this.points];
		this.resizeCanvas();
		this.points = oldPoints;
		this.redraw();
	});
	this.resizeObserver.observe(this.container);
}

private teardownResizeObserver(): void {
	this.resizeObserver?.disconnect();
	this.resizeObserver = null;
}
```

- [ ] **Step 4: 实现 redraw() — 全量重绘（resize/加载时调用）**

```typescript
private redraw(): void {
	const ctx = this.ctx;
	if (!ctx || !this.canvas) return;
	ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	for (let i = 1; i < this.points.length; i++) {
		this.drawSegment(this.points[i - 1], this.points[i]);
	}
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/reading-mode/ink-layer.ts
git commit -m "feat(ink-layer): canvas creation, mousemove capture, incremental draw"
```

---

## Chunk 2: 持久化与页面切换

### Task 3: 实现墨迹文件的保存与加载

**Files:**
- Modify: `src/components/reading-mode/ink-layer.ts`

- [ ] **Step 1: 实现文件路径生成与保存逻辑**

```typescript
private getInkDir(): string {
	const bookId = this.getBookId();
	return `${INK_DIR}/${bookId}/${INK_SUBDIR}`;
}

private getInkPath(pageIndex: number): string {
	const chapterIndex = this.getChapterIndex();
	return `${this.getInkDir()}/${chapterIndex}-${pageIndex}.json`;
}

private async ensureDir(dirPath: string): Promise<void> {
	const { Vault } = await import('obsidian');
	if (this.app.vault.adapter.exists(dirPath)) return;
	// 递归创建目录
	const parts = dirPath.split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await this.app.vault.adapter.exists(current))) {
			await this.app.vault.adapter.mkdir(current);
		}
	}
}

async savePage(pageIndex: number): Promise<void> {
	if (!this.dirty || this.points.length === 0) return;

	this.applyDecay();

	const data: InkPageData = {
		version: 1,
		points: this.points,
	};

	const dir = this.getInkDir();
	await this.ensureDir(dir);

	const path = this.getInkPath(pageIndex);
	await this.app.vault.adapter.write(path, JSON.stringify(data));
	this.dirty = false;
	serviceLog(`[InkLayer] Saved ${this.points.length} points to ${path}`);
}

async loadPage(pageIndex: number): Promise<void> {
	this.points = [];
	if (!this.ctx || !this.canvas) return;

	const path = this.getInkPath(pageIndex);
	const exists = await this.app.vault.adapter.exists(path);
	if (!exists) {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		return;
	}

	try {
		const raw = await this.app.vault.adapter.read(path);
		const data = JSON.parse(raw) as InkPageData;
		if (data.version === 1 && Array.isArray(data.points)) {
			this.applyDecayToPoints(data.points);
			this.points = data.points;
			this.redraw();
			serviceLog(`[InkLayer] Loaded ${this.points.length} points from ${path}`);
		}
	} catch (err) {
		serviceLog.warn(`[InkLayer] Failed to load ink data: ${path}`, err);
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}
}
```

- [ ] **Step 2: 实现惰性衰减计算**

```typescript
private applyDecay(): void {
	this.applyDecayToPoints(this.points);
	// 衰减后清除 alpha 过低的点
	this.points = this.points.filter(p => p.alpha > 0.02);
}

private applyDecayToPoints(pts: InkPoint[]): void {
	const now = Date.now();
	const DECAY_RATE = 0.02 / 60000; // 每分钟衰减 2%
	for (const p of pts) {
		const elapsed = now - p.t;
		p.alpha = Math.max(0, p.alpha - elapsed * DECAY_RATE);
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/reading-mode/ink-layer.ts
git commit -m "feat(ink-layer): save/load ink data with decay calculation"
```

---

### Task 4: 实现翻页、deactivate 和自动保存

**Files:**
- Modify: `src/components/reading-mode/ink-layer.ts`

- [ ] **Step 1: 实现 onPageChange() 和 deactivate()**

```typescript
async onPageChange(oldPage: number, newPage: number): Promise<void> {
	if (!this.active) return;
	await this.savePage(oldPage);
	this.cancelAutoSave();
	this.dirty = false;
	await this.loadPage(newPage);
}

async deactivate(): Promise<void> {
	if (!this.active) return;

	// 保存当前页
	const page = this.getPageIndex();
	await this.savePage(page);

	// 清理
	this.cancelAutoSave();
	if (this.moveHandler) {
		window.removeEventListener('mousemove', this.moveHandler);
		this.moveHandler = null;
	}
	this.teardownResizeObserver();
	this.canvas?.remove();
	this.canvas = null;
	this.ctx = null;
	this.points = [];
	this.dirty = false;
	this.active = false;
	serviceLog('[InkLayer] Deactivated');
}
```

- [ ] **Step 2: 实现 debounce 自动保存**

```typescript
private scheduleAutoSave(): void {
	if (this.debounceTimer) clearTimeout(this.debounceTimer);
	const capturedPage = this.getPageIndex();
	this.debounceTimer = setTimeout(async () => {
		if (!this.active || !this.dirty) return;
		// 检查页码是否变化，变化说明翻页已保存过
		if (this.getPageIndex() !== capturedPage) return;
		await this.savePage(capturedPage);
		this.dirty = false;
	}, 5000);
}

private cancelAutoSave(): void {
	if (this.debounceTimer) {
		clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/reading-mode/ink-layer.ts
git commit -m "feat(ink-layer): page change, deactivate, debounce auto-save"
```

---

## Chunk 3: PagePaginator 回调与 ReadingModeService 集成

### Task 5: PagePaginator 新增 onPageChange 回调

**Files:**
- Modify: `src/components/reading-mode/page-paginator.ts:11-15` (接口)
- Modify: `src/components/reading-mode/page-paginator.ts:186-199` (updateCurrentPageFromScroll)

- [ ] **Step 1: 在 PagePaginatorOptions 新增 onPageChange**

在 `PagePaginatorOptions` 接口中添加：

```typescript
export interface PagePaginatorOptions {
	container: HTMLElement;
	onNavigatePrev: () => Promise<boolean>;
	onNavigateNext: () => Promise<boolean>;
	onPageChange?: (oldPage: number, newPage: number) => void;
}
```

在构造函数中保存：

```typescript
constructor(options: PagePaginatorOptions) {
	this.container = options.container;
	this.onNavigatePrev = options.onNavigatePrev;
	this.onNavigateNext = options.onNavigateNext;
	this.onPageChange = options.onPageChange || null;
	// ... 现有代码
}
```

新增字段：

```typescript
private onPageChange: ((oldPage: number, newPage: number) => void) | null;
```

- [ ] **Step 2: 在 updateCurrentPageFromScroll 中触发回调**

```typescript
private updateCurrentPageFromScroll(): void {
	if (!this.scrollView) return;

	const scrollLeft = this.scrollView.scrollLeft;
	const viewWidth = this.scrollView.clientWidth;
	if (viewWidth === 0) return;

	const newPage = Math.round(scrollLeft / viewWidth) + 1;

	if (newPage !== this._currentPage) {
		const oldPage = this._currentPage;
		this._currentPage = newPage;
		this.onPageChange?.(oldPage, newPage);
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/reading-mode/page-paginator.ts
git commit -m "feat(paginator): add onPageChange callback option"
```

---

### Task 6: ReadingModeService 集成 InkLayer

**Files:**
- Modify: `src/services/reading-mode-service.ts`

- [ ] **Step 1: 导入 InkLayer 并添加字段**

文件顶部添加导入：

```typescript
import { InkLayer } from '../components/reading-mode/ink-layer.js';
```

类中新增字段：

```typescript
private inkLayer: InkLayer | null = null;
private currentBookId: string = '';
```

- [ ] **Step 2: 在 activate() 中创建 InkLayer**

在 `activate()` 方法中，`notifyBookDetected(file)` 之后添加：

```typescript
// 初始化墨迹层
this.initInkLayer(file);
```

新增方法：

```typescript
private initInkLayer(file: TFile): void {
	this.inkLayer?.deactivate();
	this.inkLayer = null;

	const cache = this.app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;
	const indexId = frontmatter?.index_id || frontmatter?.pdf_index_id || '';

	// bookId: 如果有 indexId 用前 8 位，否则用书籍文件夹名 hash
	this.currentBookId = indexId || '';

	if (!this.currentBookId) return; // 没有 bookId 则不启用墨迹

	this.inkLayer = new InkLayer({
		container: this.getContainer(),
		getBookId: () => this.currentBookId,
		getChapterIndex: () => this.getChapterNavigation()?.currentIndex ?? 1,
		getPageIndex: () => this.paginator?.getCurrentPage() ?? 1,
		app: this.app,
	});

	// 延迟激活，等分页器就绪后
	if (this.style === 'paginated' && this.paginator) {
		this.inkLayer.activate();
		this.inkLayer.loadPage(this.paginator.getCurrentPage());
	}
}

private getContainer(): HTMLElement {
	const view = this.app.workspace.getActiveViewOfType(MarkdownView);
	return view?.containerEl.querySelector('.view-content') as HTMLElement
		|| document.body;
}
```

- [ ] **Step 3: 修改 waitForRenderAndInitPaginator 传入 onPageChange**

修改 `waitForRenderAndInitPaginator()` 中创建 PagePaginator 的部分：

```typescript
this.paginator = new PagePaginator({
	container,
	onNavigatePrev: () => this.navigateToPrev(),
	onNavigateNext: () => this.navigateToNext(),
	onPageChange: (oldPage, newPage) => {
		this.inkLayer?.onPageChange(oldPage, newPage);
	},
});
this.paginator.paginateAndShow();

// 分页器就绪后激活墨迹层
if (this.inkLayer && !this.inkLayer['active']) {
	this.inkLayer.activate();
	this.inkLayer.loadPage(this.paginator.getCurrentPage());
}
```

- [ ] **Step 4: 在 deactivate() 中清理 InkLayer**

在 `deactivate()` 中 `this.paginator?.destroy()` 之后添加：

```typescript
await this.inkLayer?.deactivate();
this.inkLayer = null;
```

注意 `deactivate()` 需要改为 `async`：

```typescript
async deactivate(): Promise<void> {
```

- [ ] **Step 5: 在 stop() 中清理**

在 `stop()` 方法末尾添加：

```typescript
if (this.inkLayer) {
	await this.inkLayer.deactivate();
	this.inkLayer = null;
}
```

`stop()` 也需要改为 `async`。调用处（`main.ts`）如果直接调用 `stop()` 也需要加 `await`。

- [ ] **Step 6: Commit**

```bash
git add src/services/reading-mode-service.ts
git commit -m "feat(reading-mode): integrate InkLayer lifecycle with service"
```

---

### Task 7: CSS 样式

**Files:**
- Modify: `src/components/reading-mode/reading-mode.css`

- [ ] **Step 1: 添加 Canvas 层样式**

```css
/* 墨迹层 Canvas */
.deeppdf-ink-layer-canvas {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	z-index: 2;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/reading-mode/reading-mode.css
git commit -m "feat(ink-layer): add canvas CSS styles"
```

---

## Chunk 4: 验证与收尾

### Task 8: 构建验证

- [ ] **Step 1: 构建项目，确认无编译错误**

```bash
cd /Users/lizhao/workspace/DeepReader
npm run sync-version && npm run copy-css && node esbuild.config.mjs production
```

Expected: 构建成功，无错误

- [ ] **Step 2: 部署到测试 vault**

```bash
npm run deploy && obsidian plugin:reload id=deepreader
```

- [ ] **Step 3: 手动验证**

1. 在 Obsidian 中打开一本已索引的书
2. 阅读模式激活后，移动鼠标 — 应看到暗红墨迹留在页面上
3. 翻到下一页 — 墨迹应保存，新页面干净
4. 翻回上一页 — 墨迹应恢复显示
5. 调整窗口大小 — 墨迹应按比例重绘
6. 切换到其他文件再切回 — 墨迹应恢复

- [ ] **Step 4: 检查 `.pageindex/{bookId}/ink/` 目录下是否生成了 JSON 文件**

```bash
ls -la /Users/lizhao/workspace/deepreadertest/.pageindex/*/ink/
```

Expected: 有 `{chapterIndex}-{pageIndex}.json` 文件
