# 新书引导按钮实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单个"生成阅读大纲"按钮扩展为 6 个引导按钮，帮助用户快速开始与 AI 对话

**Architecture:** 修改 `MessageList` 组件的 `renderQuickActions()` 方法，添加新的 `onGuidanceClick` 回调，在 `SidebarView` 中处理点击事件并发送对应问题

**Tech Stack:** TypeScript, Obsidian Plugin API, CSS

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `frontend/src/components/message-list/message-list.ts` | UI 组件，渲染 6 个引导按钮 |
| `frontend/src/components/message-list/message-list.css` | 按钮网格布局样式 |
| `frontend/src/views/sidebar-view.ts` | 处理回调，发送问题到 Agent |

---

## Chunk 1: 类型和接口定义

### Task 1: 定义 GuidanceType 和提示词映射

**Files:**
- Modify: `frontend/src/components/message-list/message-list.ts:15-30`

- [ ] **Step 1: 添加 GuidanceType 类型定义**

在 `MessageCallbacks` 接口上方添加：

```typescript
/**
 * 引导按钮类型
 */
export type GuidanceType =
	| 'overview'        // 这本书讲了什么
	| 'core-views'      // 核心观点
	| 'chapter-nav'     // 章节导航
	| 'key-concepts'    // 关键概念
	| 'author-info'     // 作者背景
	| 'explore';        // 探索这本书

/**
 * 引导按钮配置
 */
export interface GuidanceButton {
	type: GuidanceType;
	label: string;
	prompt: string;
}

/**
 * 引导按钮配置列表
 */
export const GUIDANCE_BUTTONS: GuidanceButton[] = [
	{ type: 'overview', label: '这本书讲了什么', prompt: '这本书主要讲了什么内容？请给我一个概览' },
	{ type: 'core-views', label: '核心观点', prompt: '这本书的核心观点和主要论点是什么？' },
	{ type: 'chapter-nav', label: '章节导航', prompt: '请介绍一下这本书的章节结构，帮助我了解全书的框架' },
	{ type: 'key-concepts', label: '关键概念', prompt: '这本书有哪些关键概念和重要术语？' },
	{ type: 'author-info', label: '作者背景', prompt: '请介绍一下这本书的作者及其背景' },
	{
		type: 'explore',
		label: '探索这本书',
		prompt: '用户刚刚开始阅读这本书，请主动发起对话，询问用户想以什么方式阅读：如果想快速了解，可以推荐检视阅读（概览、章节导航）；如果想深入理解，可以推荐分析阅读（重点章节、核心观点）；如果想建立关联，可以推荐主题阅读（与已读书籍对比）。用自然友好的语气，不要过于结构化。'
	},
];
```

- [ ] **Step 2: 扩展 MessageCallbacks 接口**

在 `MessageCallbacks` 接口中添加新的回调：

```typescript
export interface MessageCallbacks {
	/** 重新生成消息 */
	onRegenerate?: (messageId: string) => void;
	/** 复制消息 */
	onCopy?: (messageId: string) => void;
	/** 追问问题点击 */
	onQuestionClick?: (question: string) => void;
	/** 生成阅读大纲点击 */
	onGenerateOutline?: () => void;
	/** 引导按钮点击（新增） */
	onGuidanceClick?: (type: GuidanceType) => void;
	/** 保存摘录 */
	onExcerpt?: (messageId: string, content: ExcerptContent, metadata: ExcerptMetadata) => void;
	/** 引用文字到对话 */
	onQuote?: (text: string) => void;
	/** 删除消息对（删除 AI 回复时同时删除对应的用户问题） */
	onDelete?: (messageId: string) => void;
}
```

- [ ] **Step 3: 运行构建验证类型**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功，无类型错误

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/message-list/message-list.ts
git commit -m "feat: 添加 GuidanceType 类型和提示词配置"
```

---

## Chunk 2: UI 渲染逻辑

### Task 2: 修改 renderQuickActions 方法

**Files:**
- Modify: `frontend/src/components/message-list/message-list.ts:320-361`

- [ ] **Step 1: 重写 renderQuickActions 方法**

将现有的 `renderQuickActions()` 方法替换为：

```typescript
/**
 * 渲染快捷操作按钮
 */
private renderQuickActions(): void {
	if (!this.quickActionsEl) return;

	// 清空现有内容
	this.quickActionsEl.empty();

	// 如果有当前 PDF 名称，显示引导按钮
	if (this.currentPdfName && this.callbacks.onGuidanceClick) {
		// 中心书籍图标
		const centerIcon = this.quickActionsEl.createEl('div', { cls: 'deeppdf-empty-center-icon' });
		centerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`;

		// 按钮网格容器
		const gridContainer = this.quickActionsEl.createEl('div', { cls: 'deeppdf-guidance-grid' });

		// 创建 6 个引导按钮
		GUIDANCE_BUTTONS.forEach((button) => {
			const btn = gridContainer.createEl('button', {
				cls: 'deeppdf-guidance-btn'
			});
			btn.createEl('span', { cls: 'deeppdf-guidance-label', text: button.label });

			// 点击事件
			btn.addEventListener('click', () => {
				this.callbacks.onGuidanceClick?.(button.type);
			});
		});
	} else {
		// 无 PDF 选中时的提示
		const placeholder = this.quickActionsEl.createEl('div', {
			cls: 'deeppdf-empty-placeholder'
		});
		placeholder.createEl('div', { cls: 'deeppdf-empty-icon' }).innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2"></path><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path><path d="M7 12h.01"></path><path d="M12 12h.01"></path><path d="M17 12h.01"></path></svg>`;
		placeholder.createEl('div', { cls: 'deeppdf-empty-title', text: '选择一本书籍开始阅读' });
		placeholder.createEl('div', { cls: 'deeppdf-empty-desc', text: '从左侧列表中选择要阅读的书籍' });
	}
}
```

- [ ] **Step 2: 运行构建验证**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/message-list/message-list.ts
git commit -m "feat: 重写 renderQuickActions 渲染 6 个引导按钮"
```

---

## Chunk 3: CSS 样式

### Task 3: 添加引导按钮网格样式

**Files:**
- Modify: `frontend/src/components/message-list/message-list.css`

- [ ] **Step 1: 在文件末尾添加引导按钮样式**

```css
/* ==================== 引导按钮网格 ==================== */

/* 引导按钮网格容器 */
.deeppdf-guidance-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 12px;
	width: 100%;
	max-width: 320px;
	margin-top: 24px;
}

/* 引导按钮样式 */
.deeppdf-guidance-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 12px 16px;
	background: var(--background-secondary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 8px;
	cursor: pointer;
	transition: all 0.15s ease;
	font-size: var(--font-ui-small);
	font-weight: 500;
	color: var(--text-normal);
	text-align: center;
}

.deeppdf-guidance-btn:hover {
	background: var(--background-modifier-hover);
	border-color: var(--interactive-accent);
	transform: translateY(-2px);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.deeppdf-guidance-btn:active {
	transform: translateY(0);
	box-shadow: none;
}

.deeppdf-guidance-label {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* "探索这本书"按钮特殊样式 - 更突出 */
.deeppdf-guidance-btn:last-child {
	background: var(--interactive-accent);
	border-color: var(--interactive-accent);
	color: white;
}

.deeppdf-guidance-btn:last-child:hover {
	background: var(--interactive-accent-hover);
	border-color: var(--interactive-accent-hover);
}

/* 响应式：小屏幕单列 */
@media (max-width: 400px) {
	.deeppdf-guidance-grid {
		grid-template-columns: 1fr;
		max-width: 200px;
	}
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/message-list/message-list.css
git commit -m "style: 添加引导按钮网格布局样式"
```

---

## Chunk 4: 回调处理

### Task 4: 在 SidebarView 中添加回调处理

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

- [ ] **Step 1: 找到 MessageList 初始化位置并添加 onGuidanceClick 回调**

在 `createMessageList()` 方法中，找到 `callbacks` 对象定义，添加 `onGuidanceClick` 回调：

```typescript
const callbacks: MessageCallbacks = {
	// 现有回调...
	onGenerateOutline: () => this.handleGenerateOutline(),
	onQuestionClick: (question) => this.handleQuestionClick(question),
	// 新增：引导按钮点击
	onGuidanceClick: (type) => this.handleGuidanceClick(type),
	// 其他回调...
};
```

- [ ] **Step 2: 添加 handleGuidanceClick 方法**

在 `handleGenerateOutline()` 方法附近添加：

```typescript
/**
 * 处理引导按钮点击
 */
private handleGuidanceClick(type: GuidanceType): void {
	log('[DeepPDF] 引导按钮点击:', type);

	// 查找对应的提示词
	const button = GUIDANCE_BUTTONS.find(b => b.type === type);
	if (!button) {
		warn('[DeepPDF] 未找到引导按钮配置:', type);
		return;
	}

	// 发送问题
	this.sendMessage(button.prompt);
}
```

- [ ] **Step 3: 添加必要的导入**

在文件顶部添加导入：

```typescript
import { MessageList, MessageCallbacks, GuidanceType, GUIDANCE_BUTTONS } from './components/message-list/message-list.js';
```

- [ ] **Step 4: 运行构建验证**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 添加引导按钮点击处理逻辑"
```

---

## Chunk 5: 清理旧代码

### Task 5: 移除旧的 onGenerateOutline 回调（可选）

**Files:**
- Modify: `frontend/src/components/message-list/message-list.ts`
- Modify: `frontend/src/views/sidebar-view.ts`

- [ ] **Step 1: 评估是否保留 onGenerateOutline**

由于 "生成阅读大纲" 功能已被新的引导按钮覆盖，可以考虑：
- 选项 A：保留 `onGenerateOutline` 作为兼容接口
- 选项 B：移除 `onGenerateOutline`，完全使用 `onGuidanceClick`

建议选择 **选项 A**，保持向后兼容，本次不做修改。

- [ ] **Step 2: 最终构建验证**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

- [ ] **Step 3: 最终提交（如有修改）**

```bash
git add -A
git commit -m "refactor: 清理引导按钮相关代码"
```

---

## 验收清单

- [ ] 切换到新书时，显示 6 个引导按钮（2x3 网格）
- [ ] 点击"这本书讲了什么"，AI 回复书籍概览
- [ ] 点击"核心观点"，AI 回复核心论点
- [ ] 点击"章节导航"，AI 回复章节结构
- [ ] 点击"关键概念"，AI 回复术语概念
- [ ] 点击"作者背景"，AI 回复作者信息
- [ ] 点击"探索这本书"，AI 主动发问引导用户
- [ ] 点击任意按钮后，引导按钮区域消失
- [ ] 切换到有对话记录的书籍，不显示引导按钮
- [ ] 样式与现有 UI 风格一致
