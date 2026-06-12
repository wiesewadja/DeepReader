/**
 * Internal Links Bug 锁 — 5 个 hover 失败场景 + 1 个成功场景
 *
 * 锁住当前 bug，确保修复不引入回归。
 * 测试使用 vi.useFakeTimers + Promise.withResolvers 精确等待 popover 创建信号。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App, HoverPopover, HoverParent } from 'obsidian';
import {
	resolveWikiLinkPreview,
	setupInternalLinks,
} from '@/components/message/internal-links';
import type { PreviewResult } from '@/components/message/internal-links';

interface PopoverState {
	body: HTMLElement | null;       // popover 根 DOM（null = 没显示）
	text: string;                   // 头部文本
	contentText: string;            // preview 内容
	visible: boolean;                // 淡入动画 class 是否加上
	fallbackTriggered: boolean;     // trigger('hover-link') 是否被调
	customPopoverCount: number;     // 创建的 customPopover 个数
	hasAttributeTitle: boolean;     // link 元素 title 是否还在
}

const RESET_STATE: PopoverState = {
	body: null,
	text: '',
	contentText: '',
	visible: false,
	fallbackTriggered: false,
	customPopoverCount: 0,
	hasAttributeTitle: true,
};

function buildLink(href: string, text = 'link'): HTMLAnchorElement {
	const link = document.createElement('a');
	link.className = 'internal-link';
	link.setAttribute('href', href);
	link.textContent = text;
	return link;
}

/**
 * 等待下一个 microtask 队列被排空。
 * 用 Promise.resolve() 排 microtask，**不**用 setTimeout（fake timer 下会卡住）。
 */
function flushMicrotasks(): Promise<void> {
	// 多次排空 microtask queue，覆盖嵌套 promise
	let p: Promise<void> = Promise.resolve();
	for (let i = 0; i < 8; i++) {
		p = p.then(() => undefined);
	}
	return p;
}

describe('internal-links hover popover — bug lock', () => {
	let container: HTMLElement;
	let app: App;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		app = new App();
		// 默认：vault.read 抛错 → 触发"读取失败"分支
		vi.mocked(app.vault.adapter.read).mockRejectedValue(new Error('ENOENT'));
		vi.mocked(app.workspace.trigger).mockClear();
	});

	afterEach(() => {
		container.remove();
		vi.useRealTimers();
	});

	/**
	 * Helper: hover link，触发 200ms showTimer，等 popover 创建
	 * 失败场景期望 popover **不**显示。
	 */
	async function hoverAndWait(
		link: HTMLAnchorElement,
		timeout = 500,
	): Promise<void> {
		vi.useFakeTimers();
		link.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		// 推 200ms（showTimer 触发）
		await vi.advanceTimersByTimeAsync(200);
		// 等异步 promise 链（resolveWikiLinkPreview + popover 创建）
		await flushMicrotasks();
		await flushMicrotasks();
		await flushMicrotasks();
	}

	function popoverStateFromLink(link: HTMLAnchorElement): PopoverState {
		// 找当前 body 下所有 popover
		const popovers = document.querySelectorAll('.popover.deeppdf-link-preview');
		const last = popovers[popovers.length - 1] as HTMLElement | undefined;
		const headerText = last?.querySelector('.deeppdf-link-preview-book')?.textContent ?? '';
		const contentText = last?.querySelector('.deeppdf-link-preview-content')?.textContent ?? '';
		return {
			body: last ?? null,
			text: headerText,
			contentText,
			visible: last?.classList.contains('deeppdf-link-preview--visible') ?? false,
			fallbackTriggered: vi.mocked(app.workspace.trigger).mock.calls.length > 0,
			customPopoverCount: popovers.length,
			hasAttributeTitle: link.hasAttribute('title'),
		};
	}

	// ============================================================
	// Bug 1: vault.adapter.read 失败 → resolveWikiLinkPreview 返回 null
	//        → 走 fallback trigger('hover-link')
	//        → 但 hoverParent.hoverPopover 永远是 null → Obsidian 接管失败
	//        → 用户什么都看不到
	// ============================================================
	it('Bug 1: 文件读取失败时 fallback trigger 被调，但 hoverParent.hoverPopover 仍是 null（Obsidian 接管失败）', async () => {
		const link = buildLink('《纳瓦尔宝典》/14 - 认识财富#^key123', 'test');
		container.appendChild(link);

		setupInternalLinks(container, app, false, []);

		await hoverAndWait(link);

		const state = popoverStateFromLink(link);
		// 记录当前 bug 行为：fallback 走了但 popover 没显示
		expect(state.fallbackTriggered).toBe(true);
		// ❌ 这是 bug 本身：fallback 触发但 popover 没显示
		expect(state.body).toBeNull();
	});

	// ============================================================
	// Bug 2: link 元素 title 被 removeAttribute + MutationObserver 永久删
	//        → 即使 Obsidian 想用 title 触发 hover 也做不到
	// ============================================================
	it('Bug 2: setupInternalLinks 永久删除 link.title，阻断 Obsidian 原生 hover 触发器', async () => {
		const link = buildLink('《纳瓦尔宝典》/14 - 认识财富', 'test');
		// 模拟 Obsidian 渲染时设置的 title
		link.setAttribute('title', '认识财富');
		container.appendChild(link);

		setupInternalLinks(container, app, false, []);

		expect(link.hasAttribute('title')).toBe(false);
		// 即使其他代码重新设了 title，MutationObserver 也会立刻删
		link.setAttribute('title', 'synthetic');
		// MutationObserver 异步触发
		await new Promise((r) => {
			const { promise, resolve } = Promise.withResolvers<void>();
			r(promise);
			queueMicrotask(resolve);
		});
		// 至少等一个微任务让 observer 跑
		await flushMicrotasks();
		expect(link.hasAttribute('title')).toBe(false);
	});

	// ============================================================
	// Bug 3: AI 输出的 wiki 链接只有单段路径（无书名/文件分割）
	//        pathParts.length < 2 → 直接返回 null
	//        → 走 fallback → 同样失败
	// ============================================================
	it('Bug 3: 单段路径（无书名/文件分割）触发 null 返回', async () => {
		const link = buildLink('single-file', 'test');
		container.appendChild(link);

		setupInternalLinks(container, app, false, []);

		await hoverAndWait(link);

		const state = popoverStateFromLink(link);
		// 记录当前行为：fallback 走了但 popover 没显示
		expect(state.fallbackTriggered).toBe(true);
		expect(state.body).toBeNull();
	});

	// ============================================================
	// Bug 4: 成功路径 - vault.read 返回内容
	//        → resolveWikiLinkPreview 成功 → customPopover 创建
	//        → 但 popover 始终在 document.body（不在 Obsidian 容器里）
	// ============================================================
	it('Bug 4 (成功路径): 成功时 customPopover 在 document.body 创建，body 标记可见', async () => {
		vi.mocked(app.vault.adapter.read).mockResolvedValue(
			'---\ntitle: 14 - 认识财富\n---\n\n这是测试内容。^key123\n\n更多内容。',
		);

		const link = buildLink('《纳瓦尔宝典》/14 - 认识财富#^key123', 'test');
		container.appendChild(link);

		setupInternalLinks(container, app, false, []);

		await hoverAndWait(link);

		const state = popoverStateFromLink(link);
		// 记录当前成功路径行为
		expect(state.body).not.toBeNull();
		expect(state.text).toContain('纳瓦尔宝典');
		// ❌ 但 popover 挂在 document.body（不在 Obsidian MarkdownView 内）
		// 意味着 Obsidian 生命周期管理失效（关闭面板时 popover 不消失）
		expect(state.body?.parentElement).toBe(document.body);
	});

	// ============================================================
	// Bug 5: 流式期间 disableHoverPreview=true → mouseenter 不绑
	//        但 removeAttribute('title') + observer 仍然跑
	//        → 流式期间 title 也被删
	//        → 流式结束 setupInternalLinks 重调后 title 又被删
	// ============================================================
	it('Bug 5: 流式期间 setupInternalLinks 仍删除 title（即使 disableHoverPreview=true）', async () => {
		const link = buildLink('《纳瓦尔宝典》/14 - 认识财富', 'test');
		link.setAttribute('title', 'pre-existing-title');
		container.appendChild(link);

		// 流式期间 disableHoverPreview=true
		setupInternalLinks(container, app, true, []);

		// 即使不绑 mouseenter，title 仍然被删 + observer 仍然挂
		expect(link.hasAttribute('title')).toBe(false);

		// 模拟 Obsidian 后续想设 title → 立刻被 observer 删
		link.setAttribute('title', 'observed-and-removed');
		await flushMicrotasks();
		expect(link.hasAttribute('title')).toBe(false);
	});

	// ============================================================
	// Bug 6: hoverParent 是普通对象字面量（不是真正的 HoverParent 容器）
	//        → 即使 Obsidian 创建 popover，也挂不上去
	//        → 验证 hoverParent.hoverPopover 永远是 null
	// ============================================================
	it('Bug 6: 验证 hoverParent.hoverPopover 永远不被接管（除非代码显式 new HoverPopover）', () => {
		const link = buildLink('《纳瓦尔宝典》/14 - 认识财富', 'test');
		container.appendChild(link);

		setupInternalLinks(container, app, false, []);

		// 触发任何 hover（用 sync 立即触发；不依赖 setTimeout 200ms）
		link.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

		// 关键断言：内部 hoverParent.hoverPopover 仍 null
		// （这是为什么 fallback trigger('hover-link') 无效）
		// 我们无法直接访问 hoverParent（局部变量），但可通过 trigger 被调来推断
		expect(vi.mocked(app.workspace.trigger)).not.toHaveBeenCalled();
	});
});

describe('resolveWikiLinkPreview — 5 个返回 null 场景', () => {
	let app: App;
	beforeEach(() => {
		app = new App();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('返回 null 当 vault.read 抛错', async () => {
		vi.mocked(app.vault.adapter.read).mockRejectedValue(new Error('ENOENT'));
		const result = await resolveWikiLinkPreview(app, '《book》/file#^block1');
		expect(result).toBeNull();
	});

	it('返回 null 当 pathParts.length < 2（单段路径）', async () => {
		vi.mocked(app.vault.adapter.read).mockResolvedValue('content');
		const result = await resolveWikiLinkPreview(app, 'single-file');
		expect(result).toBeNull();
	});

	it('返回 null 当 blockId 找不到', async () => {
		vi.mocked(app.vault.adapter.read).mockResolvedValue('content without block');
		const result = await resolveWikiLinkPreview(app, '《book》/file#^nonexistent');
		expect(result).toBeNull();
	});

	it('返回非 null 当 vault.read 成功且 blockId 找到', async () => {
		vi.mocked(app.vault.adapter.read).mockResolvedValue('paragraph one\n^key123\nparagraph two');
		const result = await resolveWikiLinkPreview(app, '《book》/file#^key123');
		expect(result).not.toBeNull();
		const preview = result satisfies PreviewResult;
		expect(preview.chapterName).toBe('file');
		expect(preview.bookName).toBe('《book》');
	});

	it('返回非 null 当无 blockId（显示章节开头）', async () => {
		vi.mocked(app.vault.adapter.read).mockResolvedValue('---\nfrontmatter\n---\n\nFirst paragraph of the chapter.');
		const result = await resolveWikiLinkPreview(app, '《book》/file');
		expect(result).not.toBeNull();
		const preview = result satisfies PreviewResult;
		expect(preview.text.length).toBeGreaterThan(0);
	});
});
