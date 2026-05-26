/**
 * 内部链接处理 — wiki 链接预览和交互增强
 */

import { App, MarkdownRenderer, Component, HoverParent, MarkdownView } from 'obsidian';
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
	const links = contentEl.querySelectorAll('a.internal-link');

	let customPopover: HTMLElement | null = null;
	let popoverComponent: Component | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;

	const hoverParent: HoverParent = {
		hoverPopover: null
	};

	const cleanupPopover = () => {
		if (customPopover) {
			customPopover.classList.remove('deeppdf-link-preview--visible');
			const el = customPopover;
			const comp = popoverComponent;
			customPopover = null;
			popoverComponent = null;
			setTimeout(() => {
				comp?.unload();
				el.remove();
			}, 150);
		}
		if (showTimer) {
			window.clearTimeout(showTimer);
			showTimer = null;
		}
		if (hideTimer) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
	};

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

		link.removeAttribute('title');

		const observer = new MutationObserver(() => {
			if (link.hasAttribute('title')) {
				link.removeAttribute('title');
			}
		});
		observer.observe(link, { attributes: true, attributeFilter: ['title'] });

		if (observers) {
			observers.push(observer);
		}

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

		// 处理悬停事件 — 增强版 DeepReader block 预览（含惰性加载）
		link.addEventListener('mouseenter', (event: MouseEvent) => {
			if (showTimer) { window.clearTimeout(showTimer); showTimer = null; }
			if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = null; }
			cleanupPopover();

			showTimer = window.setTimeout(async () => {
				const result = await resolveWikiLinkPreview(app, href);
				if (result) {
					customPopover = document.createElement('div');
					customPopover.className = 'popover deeppdf-link-preview';

					// 根 Component，管理所有 MarkdownRenderer.render 的子组件生命周期
					popoverComponent = new Component();

					// 头部：书名 · 章节名
					const headerEl = document.createElement('div');
					headerEl.className = 'deeppdf-link-preview-header';
					headerEl.innerHTML =
						'<span class="deeppdf-link-preview-book">《' + escapeHtml(result.bookName) + '》</span>' +
						'<span class="deeppdf-link-preview-sep"> · </span>' +
						'<span class="deeppdf-link-preview-chapter-inline">' + escapeHtml(result.chapterName) + '</span>';
					customPopover.appendChild(headerEl);

					// 正文预览
					const previewContentEl = document.createElement('div');
					previewContentEl.className = 'deeppdf-link-preview-content markdown-preview-view';
					try {
						await MarkdownRenderer.render(app, result.text, previewContentEl, '', popoverComponent);
					} catch {
						previewContentEl.textContent = result.text;
					}
					customPopover.appendChild(previewContentEl);

					// 底部跳转
					const footerEl = document.createElement('div');
					footerEl.className = 'deeppdf-link-preview-footer';
					footerEl.textContent = '查看原文 ›';
					footerEl.addEventListener('click', () => (link as HTMLElement).click());
					customPopover.appendChild(footerEl);

					// 惰性加载：滚动到底部时追加下一段落
					let remainingLines = result.remainingLines;
					let isLoadingMore = false;

					previewContentEl.addEventListener('scroll', async () => {
						if (isLoadingMore || remainingLines.length === 0) return;
						const { scrollTop, scrollHeight, clientHeight } = previewContentEl;
						if (scrollTop + clientHeight < scrollHeight - 40) return;

						isLoadingMore = true;
						const next = takeNextParagraph(remainingLines);
						if (!next) { isLoadingMore = false; return; }

						remainingLines = remainingLines.slice(next.consumed);
						const cleaned = cleanBlockIds(next.paragraph);
						if (!cleaned) { isLoadingMore = false; return; }

						try {
							const container = document.createElement('div');
							await MarkdownRenderer.render(app, cleaned, container, '', popoverComponent!);
							while (container.firstChild) {
								previewContentEl.appendChild(container.firstChild);
							}
						} catch {
							const p = document.createElement('p');
							p.textContent = cleaned;
							previewContentEl.appendChild(p);
						}
						isLoadingMore = false;
					}, { passive: true });

					// 定位
					const linkRect = link.getBoundingClientRect();
					customPopover.style.position = 'fixed';
					const POPOVER_WIDTH = Math.min(400, window.innerWidth * 0.9);
					let leftPos = linkRect.left;
					if (leftPos + POPOVER_WIDTH > window.innerWidth) {
						leftPos = window.innerWidth - POPOVER_WIDTH - 8;
					}
					if (leftPos < 8) leftPos = 8;
					customPopover.style.left = leftPos + 'px';
					customPopover.style.top = (linkRect.bottom + 6) + 'px';
					document.body.appendChild(customPopover);

					// 检测底部溢出 → 向上翻转
					requestAnimationFrame(() => {
						if (!customPopover) return;
						const r = customPopover.getBoundingClientRect();
						if (r.bottom > window.innerHeight - 8) {
							customPopover.style.top = (linkRect.top - r.height - 6) + 'px';
							customPopover.style.transformOrigin = 'bottom';
						}
					});

					// 触发淡入动画
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							if (customPopover) {
								customPopover.classList.add('deeppdf-link-preview--visible');
							}
						});
					});

					customPopover.addEventListener('mouseenter', () => {
						if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = null; }
					});
					customPopover.addEventListener('mouseleave', () => {
						hideTimer = window.setTimeout(() => cleanupPopover(), 300);
					});
				} else {
					app.workspace.trigger('hover-link', {
						event: event,
						source: 'deeppdf',
						hoverParent: hoverParent,
						targetEl: link,
						linktext: href
					});
				}
			}, 200);
		});

		link.addEventListener('mouseleave', () => {
			if (showTimer) { window.clearTimeout(showTimer); showTimer = null; }
			hideTimer = window.setTimeout(() => cleanupPopover(), 300);
		});
	});

}
