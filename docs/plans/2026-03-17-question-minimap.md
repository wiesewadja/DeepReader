# Question Minimap 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在对话消息列表右侧添加 minimap 导航组件，用户可点击快速跳转到对应提问。

**Architecture:** 创建独立的 `QuestionMinimap` 组件，继承 `Component` 基类。组件通过 `containerEl` 引用计算消息位置，监听滚动事件同步视口指示器。集成到 `MessageList` 组件中。

**Tech Stack:** TypeScript, CSS (Obsidian CSS Variables), DOM Events

---

## Task 1: 创建 QuestionMinimap 组件骨架

**Files:**
- Create: `frontend/src/components/question-minimap/index.ts`
- Create: `frontend/src/components/question-minimap/question-minimap.ts`

**Step 1: 创建组件目录**

Run: `mkdir -p frontend/src/components/question-minimap`

**Step 2: 创建 index.ts 导出文件**

```typescript
// frontend/src/components/question-minimap/index.ts
export { QuestionMinimap } from './question-minimap';
export type { QuestionMinimapProps, MinimapBlock } from './question-minimap';
```

**Step 3: 创建 question-minimap.ts 组件骨架**

```typescript
// frontend/src/components/question-minimap/question-minimap.ts
import { Component } from '../component';
import type { MessageData } from '../message/message';

/**
 * Minimap 组件属性
 */
export interface QuestionMinimapProps {
	/** 消息容器元素（用于计算滚动位置） */
	containerEl: HTMLElement;
	/** 点击回调，返回消息 ID */
	onMessageClick: (messageId: string) => void;
}

/**
 * Minimap 块数据
 */
export interface MinimapBlock {
	id: string;
	role: 'user' | 'assistant';
	/** 块在 minimap 中的 Y 位置（像素） */
	top: number;
	/** 块的高度（固定：用户 8px，AI 3px） */
	height: number;
	/** tooltip 内容（仅用户消息） */
	tooltipContent?: string;
}

// 常量定义
const USER_BLOCK_HEIGHT = 8;
const AI_BLOCK_HEIGHT = 3;

/**
 * Question Minimap 组件
 * 在消息列表右侧显示对话导航 minimap
 */
export class QuestionMinimap extends Component {
	private props: QuestionMinimapProps;
	private messages: MessageData[] = [];
	private blocks: MinimapBlock[] = [];
	private trackEl: HTMLElement | null = null;
	private viewportEl: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;
	private isHovering = false;
	private scrollHandler: (() => void) | null = null;

	constructor(props: QuestionMinimapProps) {
		super();
		this.props = props;
		this.el = this.render();
	}

	/**
	 * 渲染组件
	 */
	render(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'deeppdf-question-minimap';
		container.setAttribute('aria-label', '对话导航');

		// 标记轨道
		this.trackEl = container.createEl('div', {
			cls: 'deeppdf-minimap-track'
		});

		// 视口指示器（默认隐藏）
		this.viewportEl = container.createEl('div', {
			cls: 'deeppdf-minimap-viewport deeppdf-minimap-viewport-hidden'
		});

		// Tooltip（默认隐藏）
		this.tooltipEl = container.createEl('div', {
			cls: 'deeppdf-minimap-tooltip deeppdf-minimap-tooltip-hidden'
		});

		// 绑定事件
		this.bindEvents();

		return container;
	}

	/**
	 * 绑定事件
	 */
	private bindEvents(): void {
		if (!this.el) return;

		// hover 显示视口指示器
		this.el.addEventListener('mouseenter', () => {
			this.isHovering = true;
			this.showViewport();
		});

		this.el.addEventListener('mouseleave', () => {
			this.isHovering = false;
			this.hideTooltip();
			this.hideViewport();
		});

		// 滚动同步
		this.scrollHandler = () => {
			if (this.isHovering) {
				this.updateViewportPosition();
			}
		};
		this.props.containerEl.addEventListener('scroll', this.scrollHandler);
	}

	/**
	 * 更新消息数据
	 */
	updateMessages(messages: MessageData[]): void {
		this.messages = messages.filter(m => !m.hidden);
		this.calculateBlocks();
		this.renderBlocks();
	}

	/**
	 * 计算块位置
	 */
	private calculateBlocks(): void {
		if (!this.trackEl) return;

		const minimapHeight = this.trackEl.clientHeight;
		const containerScrollHeight = this.props.containerEl.scrollHeight;

		this.blocks = [];

		for (const msg of this.messages) {
			const msgEl = this.props.containerEl.querySelector(
				`[data-message-id="${msg.id}"]`
			) as HTMLElement;

			if (!msgEl) continue;

			const msgTop = msgEl.offsetTop;
			const topPercent = msgTop / containerScrollHeight;
			const height = msg.role === 'user' ? USER_BLOCK_HEIGHT : AI_BLOCK_HEIGHT;

			this.blocks.push({
				id: msg.id,
				role: msg.role,
				top: topPercent * (minimapHeight - height),
				height,
				tooltipContent:
					msg.role === 'user' ? this.truncateText(msg.content, 30) : undefined,
			});
		}
	}

	/**
	 * 渲染块
	 */
	private renderBlocks(): void {
		if (!this.trackEl) return;

		// 清空现有块
		this.trackEl.empty();

		for (const block of this.blocks) {
			const blockEl = this.trackEl.createEl('div', {
				cls: `deeppdf-minimap-block deeppdf-minimap-block-${block.role}`,
				attr: {
					'data-message-id': block.id,
					style: `top: ${block.top}px; height: ${block.height}px;`,
				},
			});

			// 用户块可交互
			if (block.role === 'user') {
				blockEl.setAttribute('role', 'button');
				blockEl.setAttribute('tabindex', '0');
				blockEl.setAttribute(
					'aria-label',
					`跳转到：${block.tooltipContent}`
				);

				// hover 显示 tooltip
				blockEl.addEventListener('mouseenter', (e) => {
					this.showTooltip(block.tooltipContent || '', e);
				});

				blockEl.addEventListener('mousemove', (e) => {
					this.updateTooltipPosition(e);
				});

				blockEl.addEventListener('mouseleave', () => {
					this.hideTooltip();
				});

				// 点击跳转
				blockEl.addEventListener('click', () => {
					this.hideTooltip();
					this.props.onMessageClick(block.id);
				});

				// 键盘支持
				blockEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						this.hideTooltip();
						this.props.onMessageClick(block.id);
					}
				});
			}
		}
	}

	/**
	 * 显示视口指示器
	 */
	private showViewport(): void {
		if (!this.viewportEl) return;
		this.viewportEl.removeClass('deeppdf-minimap-viewport-hidden');
		this.updateViewportPosition();
	}

	/**
	 * 隐藏视口指示器
	 */
	private hideViewport(): void {
		if (!this.viewportEl) return;
		this.viewportEl.addClass('deeppdf-minimap-viewport-hidden');
	}

	/**
	 * 更新视口位置
	 */
	private updateViewportPosition(): void {
		if (!this.viewportEl || !this.trackEl) return;

		const container = this.props.containerEl;
		const viewportHeight = container.clientHeight;
		const scrollHeight = container.scrollHeight;
		const scrollTop = container.scrollTop;

		const minimapHeight = this.trackEl.clientHeight;
		const viewportPercent = viewportHeight / scrollHeight;
		const scrollTopPercent = scrollTop / scrollHeight;

		const top = scrollTopPercent * minimapHeight;
		const height = Math.max(viewportPercent * minimapHeight, 20);

		this.viewportEl.style.top = `${top}px`;
		this.viewportEl.style.height = `${height}px`;
	}

	/**
	 * 显示 tooltip
	 */
	private showTooltip(content: string, event: MouseEvent): void {
		if (!this.tooltipEl) return;

		this.tooltipEl.textContent = content;
		this.tooltipEl.removeClass('deeppdf-minimap-tooltip-hidden');
		this.updateTooltipPosition(event);
	}

	/**
	 * 更新 tooltip 位置
	 */
	private updateTooltipPosition(event: MouseEvent): void {
		if (!this.tooltipEl) return;

		const x = event.clientX - 10;
		const y = event.clientY + 10;

		this.tooltipEl.style.left = `${x}px`;
		this.tooltipEl.style.top = `${y}px`;
	}

	/**
	 * 隐藏 tooltip
	 */
	private hideTooltip(): void {
		if (!this.tooltipEl) return;
		this.tooltipEl.addClass('deeppdf-minimap-tooltip-hidden');
	}

	/**
	 * 截断文本
	 */
	private truncateText(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength) + '...';
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		// 移除滚动监听
		if (this.scrollHandler) {
			this.props.containerEl.removeEventListener('scroll', this.scrollHandler);
		}
		super.destroy();
	}
}
```

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build 2>&1 | head -50`

Expected: 编译通过或仅有类型错误（待后续修复）

**Step 5: Commit**

```bash
git add frontend/src/components/question-minimap/
git commit -m "feat(minimap): add QuestionMinimap component skeleton

- Create index.ts with exports
- Create question-minimap.ts with basic structure
- Implement block calculation and rendering
- Add hover tooltip and viewport indicator
- Support keyboard navigation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 添加 Minimap 样式

**Files:**
- Create: `frontend/src/components/question-minimap/question-minimap.css`
- Modify: `frontend/src/styles/main.css`

**Step 1: 创建 minimap 样式文件**

```css
/* frontend/src/components/question-minimap/question-minimap.css */

/* ==================== Minimap 容器 ==================== */

.deeppdf-question-minimap {
	position: absolute;
	right: 0;
	top: 0;
	bottom: 0;
	width: 18px;
	display: flex;
	flex-direction: column;
	padding: 4px 2px;
	pointer-events: none;
}

.deeppdf-question-minimap:hover {
	pointer-events: auto;
}

/* ==================== 标记轨道 ==================== */

.deeppdf-minimap-track {
	flex: 1;
	position: relative;
	width: 14px;
	margin: 0 auto;
}

/* ==================== 消息块 ==================== */

.deeppdf-minimap-block {
	position: absolute;
	left: 0;
	width: 100%;
	border-radius: 2px;
	transition: opacity 0.15s ease;
}

/* 用户消息块 - 深色 */
.deeppdf-minimap-block-user {
	background: var(--text-muted);
	cursor: pointer;
}

.deeppdf-minimap-block-user:hover {
	background: var(--text-normal);
	opacity: 0.9;
}

/* AI 消息块 - 浅色 */
.deeppdf-minimap-block-assistant {
	background: var(--background-modifier-hover);
	cursor: default;
}

/* ==================== 视口指示器 ==================== */

.deeppdf-minimap-viewport {
	position: absolute;
	left: 0;
	width: 100%;
	background: var(--text-faint);
	border-radius: 2px;
	opacity: 0.3;
	pointer-events: none;
	transition: opacity 0.15s ease;
}

.deeppdf-minimap-viewport-hidden {
	opacity: 0;
}

/* ==================== Tooltip ==================== */

.deeppdf-minimap-tooltip {
	position: fixed;
	max-width: 200px;
	padding: 6px 10px;
	font-size: 12px;
	color: var(--text-normal);
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	pointer-events: none;
	z-index: 1000;
	word-break: break-word;
	transition: opacity 0.1s ease;
}

.deeppdf-minimap-tooltip-hidden {
	opacity: 0;
	visibility: hidden;
}

/* ==================== 响应式 ==================== */

@media (max-width: 640px) {
	.deeppdf-question-minimap {
		width: 14px;
	}

	.deeppdf-minimap-track {
		width: 10px;
	}
}
```

**Step 2: 导入样式到 main.css**

在 `frontend/src/styles/main.css` 的导入区域添加：

```css
@import url('../components/question-minimap/question-minimap.css');
```

**Step 3: 验证样式编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build 2>&1 | head -30`

Expected: 编译通过

**Step 4: Commit**

```bash
git add frontend/src/components/question-minimap/question-minimap.css frontend/src/styles/main.css
git commit -m "style(minimap): add minimap CSS styles

- Add container, track, block styles
- User block: muted text color, interactive
- AI block: subtle background, non-interactive
- Viewport indicator: faint text, show on hover
- Tooltip: fixed position with shadow

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 集成 Minimap 到 MessageList

**Files:**
- Modify: `frontend/src/components/message-list/message-list.ts`
- Modify: `frontend/src/components/message-list/message-list.css`

**Step 1: 在 message-list.ts 中导入 minimap**

在文件顶部添加导入：

```typescript
import { QuestionMinimap } from '../question-minimap';
```

**Step 2: 添加 minimap 属性**

在 `MessageList` 类中添加属性：

```typescript
export class MessageList extends Component {
	private messages: Map<string, Message> = new Map();
	private messagesContainer: HTMLElement | null = null;
	private emptyState: HTMLElement | null = null;
	private quickActionsEl: HTMLElement | null = null;
	private callbacks: MessageCallbacks;
	private app?: App;
	private currentPdfName: string = '';
	private minimap: QuestionMinimap | null = null;  // 添加这行
```

**Step 3: 在 render() 中创建 minimap**

修改 `render()` 方法，在返回 container 之前添加：

```typescript
	render(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-message-list');

		// 消息容器
		this.messagesContainer = container.createEl('div', {
			cls: 'deeppdf-messages-container'
		});

		// 空状态
		this.emptyState = container.createEl('div', {
			cls: 'deeppdf-empty-state'
		});

		// 快捷操作区域（包含所有内容）
		this.quickActionsEl = this.emptyState.createEl('div', {
			cls: 'deeppdf-quick-actions'
		});

		// 创建 minimap（在消息容器后）
		this.minimap = new QuestionMinimap({
			containerEl: this.messagesContainer,
			onMessageClick: (id) => this.scrollToMessage(id),
		});
		container.appendChild(this.minimap.getElement());

		// 初始显示空状态
		this.updateEmptyState();

		this.el = container;
		return container;
	}
```

**Step 4: 在 addMessage() 中更新 minimap**

修改 `addMessage()` 方法，在 `this.updateEmptyState()` 之后添加：

```typescript
		// 更新 minimap
		this.updateMinimap();

		return message;
	}
```

**Step 5: 添加 updateMinimap 方法**

在类中添加新方法：

```typescript
	/**
	 * 更新 minimap
	 */
	private updateMinimap(): void {
		if (this.minimap) {
			// 延迟更新，等待 DOM 渲染完成
			requestAnimationFrame(() => {
				this.minimap?.updateMessages(this.getMessagesData());
			});
		}
	}
```

**Step 6: 在 removeMessage() 中更新 minimap**

修改 `removeMessage()` 方法，在 `this.updateEmptyState()` 之后添加：

```typescript
		// 更新 minimap
		this.updateMinimap();
	}
```

**Step 7: 在 destroy() 中销毁 minimap**

修改 `destroy()` 方法：

```typescript
	override destroy(): void {
		// 销毁 minimap
		if (this.minimap) {
			this.minimap.destroy();
			this.minimap = null;
		}

		// 销毁所有消息
		this.messages.forEach(message => {
			const el = message.getElement();
			if (el && el.parentNode) {
				el.parentNode.removeChild(el);
			}
		});

		// 清空存储
		this.messages.clear();

		// 调用父类销毁方法
		super.destroy();
	}
```

**Step 8: 调整 message-list.css 布局**

在 `frontend/src/components/message-list/message-list.css` 中修改 `.deeppdf-message-list`：

```css
.deeppdf-message-list {
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
	position: relative;
}

/* 消息容器留出 minimap 空间 */
.deeppdf-messages-container {
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 16px 1% 80px 1%;
	padding-right: 22px; /* 为 minimap 留空间 */
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	scrollbar-width: thin;
	scrollbar-color: var(--background-modifier-border) transparent;
}
```

**Step 9: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build 2>&1 | head -50`

Expected: 编译通过

**Step 10: Commit**

```bash
git add frontend/src/components/message-list/
git commit -m "feat(minimap): integrate QuestionMinimap into MessageList

- Import and create minimap in render()
- Update minimap on message add/remove
- Destroy minimap on component destroy
- Adjust CSS for minimap spacing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 确保 Message 元素有 data-message-id 属性

**Files:**
- Modify: `frontend/src/components/message/message.ts`

**Step 1: 检查现有实现**

Run: `grep -n "data-message-id" /Users/lizhao/workspace/DeepReader/frontend/src/components/message/message.ts`

Expected: 如果已有则跳过此任务

**Step 2: 在消息元素上添加 data-message-id**

找到创建消息容器的位置，添加 `data-message-id` 属性。搜索 `createEl` 或类似创建 DOM 的代码。

在 `createMessage` 函数或 `Message` 类的 `render` 方法中，确保容器元素有：

```typescript
container.setAttribute('data-message-id', this.data.id);
```

**Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build 2>&1 | head -30`

**Step 4: Commit**

```bash
git add frontend/src/components/message/message.ts
git commit -m "feat(message): add data-message-id attribute for minimap

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 手动测试

**Step 1: 构建前端**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`

**Step 2: 部署到测试 vault**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run deploy && obsidian plugin:reload id=deepreader`

**Step 3: 在 Obsidian 中测试**

测试用例：
1. 打开 DeepReader，选择一个 PDF
2. 发送多个问题（至少 3 个）
3. 验证 minimap 右侧显示
4. 验证用户块（深色）和 AI 块（浅色）
5. hover 用户块，验证 tooltip 显示
6. 点击用户块，验证跳转到对应消息
7. hover minimap，验证视口指示器显示
8. 滚动消息列表，验证视口指示器同步

**Step 4: 记录测试结果**

---

## Task 6: 修复发现的问题

（根据测试结果补充）

---

## 最终 Commit

```bash
git add -A
git commit -m "feat: add Question Minimap navigation component

- Create minimap showing user questions and AI responses
- User blocks (8px, muted color) with tooltip on hover
- AI blocks (3px, subtle color) for visual balance
- Viewport indicator shows on hover
- Click user block to scroll to message
- Keyboard navigation support (Tab + Enter)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
