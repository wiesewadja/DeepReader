/**
 * 内部链接处理 — wiki 链接预览和交互增强
 */

import { App, MarkdownRenderer, Component, HoverParent, MarkdownView } from 'obsidian';
import { uiLog as log } from '../../utils/logger.js';

/**
 * 解析 wiki 链接并获取预览内容
 *
 * 从 vault 中读取 DeepReader 导出的 markdown 文件，
 * 提取 block ID 附近的上下文（前后各 ~100 字）
 */
export async function resolveWikiLinkPreview(app: App, href: string): Promise<{ text: string; chapterName: string } | null> {
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

	// 清理文本中的 block ID 标记（^xxx）
	const cleanBlockIds = (text: string) => text.replace(/\^[a-zA-Z0-9_-]+/g, '').trim();

	if (blockId) {
		const lines = content.split('\n');
		let blockLineIndex = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(blockId)) {
				blockLineIndex = i;
				break;
			}
		}
		if (blockLineIndex === -1) return null;

		// 前后各 ~100 字
		let start = blockLineIndex;
		let end = blockLineIndex + 1;
		let charCount = 0;
		while (end < lines.length && charCount < 100) {
			charCount += lines[end].length + 1;
			end++;
		}
		charCount = 0;
		while (start > 0 && charCount < 100) {
			start--;
			charCount += lines[start].length + 1;
		}

		const text = cleanBlockIds(lines.slice(start, end).join('\n'));
		return text ? { text, chapterName } : null;
	}

	// 无 block ID，显示章节开头
	const text = cleanBlockIds(content.slice(0, 200));
	return text ? { text, chapterName } : null;
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

	// 用于自定义预览
	let customPopover: HTMLElement | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;

	// 持久的 HoverParent，让 Obsidian Page Preview 能正确管理 popover 生命周期
	const hoverParent: HoverParent = {
		hoverPopover: null
	};

	// 清理 popover 的函数
	const cleanupPopover = () => {
		if (customPopover) {
			customPopover.remove();
			customPopover = null;
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

		// 检测链接指向的文件是否存在于 vault 中
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

		// 移除浏览器原生的 title tooltip，避免双重提示
		link.removeAttribute('title');

		// 使用 MutationObserver 监听并持续移除 title（防止 Obsidian 重新添加）
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

			// 检测阅读模式状态
			const readingModeEl = document.querySelector('.deeppdf-reading-mode');
			const isReadingMode = !!readingModeEl;
			const isPaginatedMode = isReadingMode && !!readingModeEl!.querySelector('.markdown-preview-view[style*="--deeppdf-col-width"]');

			// 从 href 中提取文件路径和 block ID
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

		// 如果禁用 hover preview（AI 流式传输期间），则跳过 hover 事件设置
		if (disableHoverPreview) {
			return;
		}

		// 处理悬停事件 - 复用 Obsidian popover 样式，增强 DeepReader block 预览
		link.addEventListener('mouseenter', (event: MouseEvent) => {
			if (showTimer) { window.clearTimeout(showTimer); showTimer = null; }
			if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = null; }
			cleanupPopover();

			showTimer = window.setTimeout(async () => {
				const result = await resolveWikiLinkPreview(app, href);
				if (result) {
					customPopover = document.createElement('div');
					customPopover.className = 'popover deeppdf-link-preview';

					const previewContentEl = document.createElement('div');
					previewContentEl.className = 'deeppdf-link-preview-content markdown-preview-view';
					try {
						await MarkdownRenderer.render(app, result.text, previewContentEl, '', new Component());
					} catch {
						previewContentEl.textContent = result.text;
					}
					customPopover.appendChild(previewContentEl);

					const chapterEl = document.createElement('div');
					chapterEl.className = 'deeppdf-link-preview-chapter';
					chapterEl.textContent = result.chapterName;
					customPopover.appendChild(chapterEl);

					const linkRect = link.getBoundingClientRect();
					customPopover.style.position = 'fixed';

					const popoverWidth = 400;
					let leftPos = linkRect.left;
					if (leftPos + popoverWidth > window.innerWidth) {
						leftPos = window.innerWidth - popoverWidth - 8;
					}
					if (leftPos < 8) leftPos = 8;

					customPopover.style.left = leftPos + 'px';
					customPopover.style.top = (linkRect.bottom + 6) + 'px';
					document.body.appendChild(customPopover);

					requestAnimationFrame(() => {
						if (!customPopover) return;
						const r = customPopover.getBoundingClientRect();
						if (r.bottom > window.innerHeight) {
							customPopover.style.top = (linkRect.top - r.height - 6) + 'px';
						}
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
