/**
 * 内部链接处理 — wiki 链接预览和交互增强
 */

import {
	type App,
	MarkdownRenderer,
	Component,
	HoverPopover,
	type HoverParent,
	MarkdownView,
} from 'obsidian';
import { uiLog as log } from '../../utils/logger.js';
import { escapeHtml } from './utils.js';

/** 清理文本中的 block ID 标记（^xxx） */
const cleanBlockIds = (text: string) => text.replace(/\^[a-zA-Z0-9_-]+/g, '').trim();

/** 初始预览最少字符数（约 2-3 个完整段落，需配合 CSS max-height: 360px 溢出产生滚动） */
const INITIAL_PREVIEW_MIN_CHARS = 500;

interface PreviewResult {
	text: string;
	chapterName: string;
	bookName: string;
	/** 剩余未加载的行 */
	remainingLines: string[];
}

/** 从行数组中找到第 index 行所在段落的范围 [start, end) */
function findParagraphRange(lines: string[], index: number): [number, number] {
	let start = index;
	while (start > 0 && lines[start - 1].trim() !== '') start--;
	let end = index;
	while (end < lines.length && lines[end].trim() !== '') end++;
	return [start, end];
}

/** 从 startPos 开始连续取完整段落，直到总字符数 >= minChars 或文件结束 */
function collectParagraphs(lines: string[], startPos: number, minChars: number): { text: string; endPos: number } {
	let pos = startPos;
	let result = '';
	while (pos < lines.length && result.length < minChars) {
		while (pos < lines.length && lines[pos].trim() === '') {
			result += '\n';
			pos++;
		}
		if (pos >= lines.length) break;
		const paraStart = pos;
		while (pos < lines.length && lines[pos].trim() !== '') pos++;
		const para = lines.slice(paraStart, pos).join('\n');
		result += (result && !result.endsWith('\n') ? '\n' : '') + para;
	}
	return { text: result.trim(), endPos: pos };
}

/** 从 remainingLines 中取下一个完整段落 */
function takeNextParagraph(remainingLines: string[]): { paragraph: string; consumed: number } | null {
	let i = 0;
	while (i < remainingLines.length && remainingLines[i].trim() === '') i++;
	if (i >= remainingLines.length) return null;

	const start = i;
	while (i < remainingLines.length && remainingLines[i].trim() !== '') {
		i++;
	}
	return {
		paragraph: remainingLines.slice(start, i).join('\n'),
		consumed: i,
	};
}

/**
 * 解析 wiki 链接并获取预览内容
 */
export async function resolveWikiLinkPreview(app: App, href: string): Promise<PreviewResult | null> {
	const hrefClean = href.includes('|') ? href.split('|')[0] : href;
	const hashIdx = hrefClean.indexOf('#');
	const linkFilePath = hashIdx >= 0 ? hrefClean.slice(0, hashIdx) : hrefClean;
	const rawFragment = hashIdx >= 0 ? hrefClean.slice(hashIdx + 1) : null;
	const blockId = rawFragment?.startsWith('^') ? rawFragment.slice(1) : null;

	const pathParts = linkFilePath.split('/');
	if (pathParts.length < 2) return null;

	const bookName = pathParts[0];
	const fileName = pathParts.slice(1).join('/');

	const vaultRelPath = `DeepReader/${bookName}/${fileName.endsWith('.md') ? fileName : fileName + '.md'}`;
	let content: string;
	try {
		content = await (app.vault as any).adapter.read(vaultRelPath);
	} catch {
		return null;
	}

	// 移除 frontmatter
	content = content.replace(/^---[\s\S]*?---\n/, '');

	// 章节名：去掉前导序号 "14 - 认识财富创造的原理" → "认识财富创造的原理"
	const chapterName = fileName.replace(/\.md$/, '').replace(/^\d+\s*-\s*/, '').trim();

	const lines = content.split('\n');

	let start: number;

	if (blockId) {
		let blockLineIndex = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(blockId)) {
				blockLineIndex = i;
				break;
			}
		}
		if (blockLineIndex === -1) return null;

		// 向上找到段落组的起点（连续非空行的最顶端）
		const [paraStart] = findParagraphRange(lines, blockLineIndex);
		// 再向上扩展一个段落
		start = paraStart;
		if (start > 0) {
			while (start > 0 && lines[start - 1].trim() === '') start--;
			if (start > 0) {
				const [prevStart] = findParagraphRange(lines, start - 1);
				start = prevStart;
			}
		}
	} else {
		start = 0;
	}

	const { text: rawText, endPos } = collectParagraphs(lines, start, INITIAL_PREVIEW_MIN_CHARS);
	const text = cleanBlockIds(rawText);
	return text ? {
		text,
		chapterName,
		bookName,
		remainingLines: lines.slice(endPos),
	} : null;
}

/**
 * 处理内部链接的点击和悬停事件
 *
 * 此函数为 MarkdownRenderer 渲染的内部链接添加：
 * - 点击：在侧边栏中以只读预览模式打开链接
 * - 悬停+Command：Obsidian 原生预览
 * - 悬停（无按键）：自定义章节预览（只显示引用的章节）
 * @param disableHoverPreview - 禁用 hover preview（用于 AI 流式传输期间）
 * @param observers - 用于跟踪和清理 MutationObserver 的数组（可选）
 */
export function setupInternalLinks(contentEl: HTMLElement, app: App, disableHoverPreview: boolean = false, observers?: MutationObserver[]): void {
	// 让 Obsidian 接管 hover-link 生命周期。
	// 必须是 Obsidian 的某个真实容器（不是普通对象字面量）——
	// 否则 HoverPopover 创建后无法挂载，hover-link trigger 也会失败。
	// 取 MarkdownView 优先，回退到任意 leaf 容器，兜底 document.body。
	const hoverParent: HoverParent = ((): HoverParent => {
		const activeLeaf = app.workspace.getActiveViewOfType(MarkdownView)
			?? (app.workspace.getLeavesOfType('markdown')[0] as unknown as HoverParent | undefined);
		return activeLeaf ?? (document.body as unknown as HoverParent);
	})();

	// Per-link hover 状态（每个 link 独立持有，互不干扰）
	let showTimer: ReturnType<typeof setTimeout> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let activePopover: HoverPopover | null = null;
	let activeComponent: Component | null = null;
	let lastTarget: HTMLElement | null = null;
	let isLoading = false;

	const cleanup = (): void => {
		if (showTimer) { clearTimeout(showTimer); showTimer = null; }
		if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
		if (activePopover) {
			// HoverPopover.unload() 会自动管 hoverEl 移除 + 卸载监听
			activePopover.unload();
			activePopover = null;
		}
		if (activeComponent) {
			activeComponent.unload();
			activeComponent = null;
		}
		lastTarget = null;
};

const links: NodeListOf<HTMLAnchorElement> = contentEl.querySelectorAll('a.internal-link');
links.forEach(link => {
	const href = link.getAttr('href');
	if (!href) return;
		let linkPath = href;
		if (linkPath.includes('|')) {
			linkPath = linkPath.split('|')[0];
		}
		if (linkPath.includes('#')) {
			linkPath = linkPath.split('#')[0];
		}

		const linkedFile = app.metadataCache.getFirstLinkpathDest(linkPath, '');
		if (!linkedFile) {
			link.addClass('is-unresolved');
		}
	// 保留 link.title —— 由 Obsidian HoverPopover 接管 hover-link 生命周期。
	// Bug 2 修复：不再 removeAttribute('title') + MutationObserver 持续删 title
	// （破坏 Obsidian 内部 hover 触发器 + 阻断 fallback trigger('hover-link') 接管）

	// 处理点击事件
		link.addEventListener('click', async (e) => {
			e.preventDefault();

			const readingModeEl = document.querySelector('.deeppdf-reading-mode');
			const isReadingMode = !!readingModeEl;
			const isPaginatedMode = isReadingMode && !!readingModeEl!.querySelector('.markdown-preview-view[style*="--deeppdf-col-width"]');

			const hrefClean = href.includes('|') ? href.split('|')[0] : href;
			const hashIdx = hrefClean.indexOf('#');
			const linkFilePath = hashIdx >= 0 ? hrefClean.slice(0, hashIdx) : hrefClean;
			const rawFragment = hashIdx >= 0 ? hrefClean.slice(hashIdx + 1) : null;
			const blockId = rawFragment?.startsWith('^') ? rawFragment.slice(1) : null;
			const headingFragment = rawFragment && !rawFragment.startsWith('^') ? rawFragment : null;

			const scrollToBlockInCurrentView = (delayMs = 50): void => {
				if (!blockId) return;
				setTimeout(() => {
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const container: Element = activeView?.previewMode?.renderer?.containerEl
						|| activeView?.containerEl
						|| document.body;
					const blockSel = [
						`[id="^${CSS.escape(blockId)}"]`,
						`[data-block-id="${CSS.escape(blockId)}"]`,
						`[id="${CSS.escape(blockId)}"]`,
					].join(', ');
					const target = container.querySelector(blockSel);
					if (target) {
						(target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
						log('[DeepPDF] Scrolled to block:', blockId);
					} else {
						log('[DeepPDF] Block not found in view:', blockId);
					}
				}, delayMs);
			};

			const targetPath = hrefClean || href;
			const isExcalidrawFile = targetPath.endsWith('.excalidraw.md') || targetPath.endsWith('.excalidraw');
			const switchToPreview = () => {
				if (isExcalidrawFile) return;
				setTimeout(() => {
					const activeLeaf = app.workspace.activeLeaf;
					if (activeLeaf) {
						activeLeaf.setViewState({ type: 'markdown', state: { mode: 'preview' } });
					}
				}, 50);
			};

			if (isPaginatedMode) {
				if (!linkFilePath) {
					scrollToBlockInCurrentView(50);
				} else {
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const currentFilePath = activeView?.file?.path || '';
					const targetFile = app.metadataCache.getFirstLinkpathDest(linkFilePath, currentFilePath);

					if (targetFile && targetFile.path === currentFilePath) {
						scrollToBlockInCurrentView(50);
					} else if (targetFile) {
						await app.workspace.openLinkText(hrefClean, currentFilePath, true);
						switchToPreview();
						if (blockId) {
							scrollToBlockInCurrentView(400);
						}
					} else {
						log('[DeepPDF] Target file not found for link:', href);
					}
				}
			} else if (isReadingMode) {
				if (blockId) {
					scrollToBlockInCurrentView(50);
				} else if (headingFragment) {
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const currentFilePath = activeView?.file?.path || '';
					app.workspace.openLinkText(hrefClean, currentFilePath, true);
				} else {
					app.workspace.openLinkText(href, '', true);
				}
				switchToPreview();
			} else {
				app.workspace.openLinkText(href, '', true);
				switchToPreview();
			}
		});

		if (disableHoverPreview) {
			return;
		}

	// 处理悬停事件 — 增强版 DeepReader block 预览（HoverPopover 接管）
	// Bug 修复：始终用 Obsidian HoverPopover，让 Obsidian 自管生命周期。
	// 不再自建 div + document.body.appendChild + 手控 style.position。
	link.addEventListener('mouseenter', (_event: MouseEvent) => {
		if (showTimer) { clearTimeout(showTimer); showTimer = null; }
		if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
		cleanup();
		lastTarget = link;

		showTimer = setTimeout(async () => {
			// 用户可能已移走
			if (lastTarget !== link || isLoading) return;
			isLoading = true;

			// 1. 立刻创建 HoverPopover —— Obsidian 接管挂载 + 显示
			// waitTime=0 表示我们已经异步等了 200ms，立即显示
			const popover = new HoverPopover(hoverParent, link, 0);
			activePopover = popover;

			// 2. 准备 Component 容器（管 MarkdownRenderer 子组件生命周期）
			const component = new Component();
			activeComponent = component;

			// 3. 填 hoverEl 骨架（Obsidian 自管位置 + 动画）
			const root = popover.hoverEl;
			root.classList.add('popover', 'deeppdf-link-preview');
			const headerEl = root.createDiv({ cls: 'deeppdf-link-preview-header' });
			const contentEl = root.createDiv({
				cls: 'deeppdf-link-preview-content markdown-preview-view',
			});
			const footerEl = root.createDiv({
				cls: 'deeppdf-link-preview-footer',
				text: '查看原文 ›',
			});
			footerEl.addEventListener('click', () => link.click());

			// 4. 异步加载内容
			let result: PreviewResult | null = null;
			try {
				result = await resolveWikiLinkPreview(app, href);
			} catch (e) {
				log('[DeepPDF] Preview resolve failed:', e);
			}

			// 二次检查：用户可能已移走
			if (lastTarget !== link || activePopover !== popover) {
				cleanup();
				isLoading = false;
				return;
			}

			if (!result) {
				// 失败：交给 Obsidian 默认 hover-link 处理
				cleanup();
				app.workspace.trigger('hover-link', {
					source: 'deeppdf',
					hoverParent,
					targetEl: link,
					linktext: href,
				});
				isLoading = false;
				return;
			}

			// 5. 填头部 + 内容
			headerEl.innerHTML =
				'<span class="deeppdf-link-preview-book">《' + escapeHtml(result.bookName) + '》</span>' +
				'<span class="deeppdf-link-preview-sep"> · </span>' +
				'<span class="deeppdf-link-preview-chapter-inline">' + escapeHtml(result.chapterName) + '</span>';
			try {
				await MarkdownRenderer.render(app, result.text, contentEl, '', component);
			} catch {
				contentEl.textContent = result.text;
			}

			// 6. 惰性加载（保持原有逻辑）
			let remainingLines = result.remainingLines;
			let isLoadingMore = false;
			contentEl.addEventListener('scroll', async () => {
				if (isLoadingMore || remainingLines.length === 0) return;
				const { scrollTop, scrollHeight, clientHeight } = contentEl;
				if (scrollTop + clientHeight < scrollHeight - 40) return;
				isLoadingMore = true;
				const next = takeNextParagraph(remainingLines);
				if (!next) { isLoadingMore = false; return; }
				remainingLines = remainingLines.slice(next.consumed);
				const cleaned = cleanBlockIds(next.paragraph);
				if (!cleaned) { isLoadingMore = false; return; }
				try {
					const container = document.createElement('div');
					await MarkdownRenderer.render(app, cleaned, container, '', component);
					while (container.firstChild) {
						contentEl.appendChild(container.firstChild);
					}
				} catch {
					const p = document.createElement('p');
					p.textContent = cleaned;
					contentEl.appendChild(p);
				}
				isLoadingMore = false;
			}, { passive: true });

			// 7. 淡入动画
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					root.classList.add('deeppdf-link-preview--visible');
				});
			});

			// 8. 鼠标进 popover 不关闭
			popover.hoverEl.addEventListener('mouseenter', () => {
				if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
			});
			popover.hoverEl.addEventListener('mouseleave', () => {
				hideTimer = setTimeout(() => {
					// 检查鼠标是否在 popover 内
					if (activePopover && activePopover.hoverEl.matches(':hover')) return;
					cleanup();
				}, 300);
			});

			isLoading = false;
		}, 200);
	});

	link.addEventListener('mouseleave', () => {
		if (showTimer) { clearTimeout(showTimer); showTimer = null; }
		hideTimer = setTimeout(() => {
			if (activePopover && activePopover.hoverEl.matches(':hover')) return;
			cleanup();
		}, 300);
	});
});

// HoverPopover 创建是同步的，立即接管显示
// 自定义 class（popover / deeppdf-link-preview / ...）由 CSS 控制视觉
}
