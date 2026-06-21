/**
 * 内部链接处理 — wiki 链接预览和交互增强
 */

import { type App, MarkdownRenderer, Component, type HoverParent, MarkdownView } from 'obsidian';
import { uiLog as log } from '../../utils/logger.js';
import { escapeHtml } from './utils.js';
import { decompressFromBase64 } from 'lz-string';

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

	// 同步清理 popover —— 之前 setTimeout(150ms) 在反复 hover 时会和
	// 下一次 mouseenter 异步创建竞态，触发 comp?.unload() 在已卸载 Component
	// 上跑 → Obsidian 内部栈累加 → 闪退。
	const cleanupPopover = () => {
		if (customPopover) {
			const el = customPopover;
			const comp = popoverComponent;
			customPopover = null;
			popoverComponent = null;
			// 同步卸载
			comp?.unload();
			el.remove();
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

		// 不再 removeAttribute('title') + MutationObserver 持续删：
		// Obsidian 内部依赖 title 做 hover 触发，删除会阻断 fallback trigger('hover-link')。
		// 之前会引发：Obsidian 内部栈累加 → 反复 hover 闪退。
		// （参见 docs/test-strategies/early-stop-golden-cases.md Bug 2 修复说明）

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

	// Hook click events on Excalidraw embeds rendered inside messages (using event delegation for robustness)
	contentEl.addEventListener('click', async (e) => {
		let target = e.target as HTMLElement | null;
		while (target && target !== contentEl) {
			const src = target.getAttribute('src');
			const isExcalidrawEmbed = src && (
				src.toLowerCase().includes('excalidraw') ||
				src.endsWith('.excalidraw.md') ||
				src.endsWith('.excalidraw')
			);
			const isExcalidrawImg = target.classList.contains('excalidraw-embedded-img') || 
				(target.tagName === 'svg' && target.classList.contains('excalidraw-svg')) ||
				!!target.closest('svg.excalidraw-svg') || 
				!!target.closest('.excalidraw-embedded-img') ||
				(target.closest('iframe') && !!target.closest('iframe')?.getAttribute('src')?.toLowerCase().includes('excalidraw'));

			if (isExcalidrawEmbed) {
				e.preventDefault();
				e.stopPropagation();
				log('[DeepPDF] Opening excalidraw embed:', src);
				const file = app.metadataCache.getFirstLinkpathDest(src, '');
				if (file) {
					await app.workspace.getLeaf(true).openFile(file);
				} else {
					const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
					const currentFilePath = activeView?.file?.path || '';
					await app.workspace.openLinkText(src, currentFilePath, true);
				}
				return;
			}

			if (isExcalidrawImg) {
				const parentEmbed = target.closest('.internal-embed, .markdown-embed');
				const parentSrc = parentEmbed?.getAttribute('src');
				if (parentSrc && (
					parentSrc.toLowerCase().includes('excalidraw') ||
					parentSrc.endsWith('.excalidraw.md') ||
					parentSrc.endsWith('.excalidraw')
				)) {
					e.preventDefault();
					e.stopPropagation();
					log('[DeepPDF] Opening excalidraw embed (img):', parentSrc);
					const file = app.metadataCache.getFirstLinkpathDest(parentSrc, '');
					if (file) {
						await app.workspace.getLeaf(true).openFile(file);
					} else {
						const activeView = app.workspace.getActiveViewOfType(MarkdownView) as any;
						const currentFilePath = activeView?.file?.path || '';
						await app.workspace.openLinkText(parentSrc, currentFilePath, true);
					}
					return;
				}
			}

			target = target.parentElement;
		}
	});

	// Retry config: covers the indexing/parsing window right after the file is created —
	// the plugin's native embed renderer often shows an empty {"type":"excalidraw/clipboard"...}
	// placeholder because metadataCache hasn't indexed the new .excalidraw.md yet.
	const MAX_EMBED_RETRIES = 3;
	const EMBED_RETRY_DELAY_MS = 300;

	/**
	 * Try ONCE to render a single excalidraw embed as an SVG via ExcalidrawAutomate.
	 * Resolves true on success, false otherwise (caller decides whether to retry).
	 * Does NOT touch concurrency markers — the caller manages the in-flight lock.
	 */
	const tryRenderEmbed = async (embedEl: HTMLElement): Promise<boolean> => {
		const src = embedEl.getAttribute('src');
		if (!src) return false;

		// Resolve the file: metadataCache first, then direct-path fallback to bypass indexing delay
		let file = app.metadataCache.getFirstLinkpathDest(src, '');
		if (!file) {
			const possiblePaths = [src, src + '.md', src + '.excalidraw.md', src + '.excalidraw'];
			for (const p of possiblePaths) {
				const abstractFile = app.vault.getAbstractFileByPath(p);
				if (abstractFile && 'extension' in abstractFile) {
					file = abstractFile as any;
					break;
				}
			}
		}
		if (!file) return false;

		const ea = (window as any).ExcalidrawAutomate;
		if (!ea) {
			log('[DeepPDF] ExcalidrawAutomate not found, skipping embed render');
			return false;
		}

		// Parse scene: ExcalidrawAutomate first, then manual decompression fallback
		// (covers the window where the plugin hasn't indexed the freshly-created file yet)
		let scene: any = null;
		try {
			ea.reset();
			scene = await ea.getSceneFromFile(file);
		} catch (err) {
			log('[DeepPDF] ea.getSceneFromFile failed, attempting manual decompression fallback', err);
			try {
				const content = await app.vault.read(file);
				scene = parseExcalidrawFileContent(content);
			} catch (fallbackErr) {
				log('[DeepPDF] Manual decompression fallback failed:', fallbackErr);
			}
		}

		// Empty/missing scene (typical right after creation, before indexing) → signal retry
		if (!scene || !scene.elements || scene.elements.length === 0) {
			return false;
		}

		try {
			ea.reset();
			for (const el of scene.elements) {
				ea.elementsDict[el.id] = el;
			}
			if (scene.appState && scene.appState.viewBackgroundColor) {
				if (!ea.canvas) ea.canvas = {};
				ea.canvas.viewBackgroundColor = scene.appState.viewBackgroundColor;
			}
			const svg = await ea.createSVG();
			if (svg) {
				svg.classList.add('excalidraw-svg');
				// innerHTML='' wipes any native placeholder (e.g. the {"type":"excalidraw/clipboard"...} text)
				embedEl.innerHTML = '';
				embedEl.appendChild(svg);
				embedEl.setAttribute('data-dr-rendered', 'svg');
				log('[DeepPDF] Programmatically rendered excalidraw embed:', src);
				return true;
			}
		} catch (err) {
			log('[DeepPDF] Failed to render excalidraw embed:', err);
		}
		return false;
	};

	/**
	 * Render one embed with bounded retry. Concurrency-safe against the MutationObserver
	 * firing processExcalidrawEmbeds repeatedly: the first pass (attempt 0) acquires an
	 * in-flight lock (data-dr-inflight); self-scheduled retries (attempt>0) skip the lock
	 * and keep it held until success or exhaustion.
	 */
	const renderEmbedWithRetry = (embedEl: HTMLElement, attempt = 0): void => {
		// Already rendered by the native extension → don't compete with it
		if (embedEl.querySelector('svg.excalidraw-svg, img.excalidraw-svg, .excalidraw-svg, .excalidraw-embedded-img')) {
			return;
		}
		// Already rendered by DeepReader → done
		if (embedEl.getAttribute('data-dr-rendered') === 'svg') {
			return;
		}
		// First pass only: bail if another pass is already in flight (observer storm guard)
		if (attempt === 0 && embedEl.getAttribute('data-dr-inflight') === '1') {
			return;
		}
		embedEl.setAttribute('data-dr-inflight', '1');

		tryRenderEmbed(embedEl).then((ok) => {
			if (ok) {
				embedEl.removeAttribute('data-dr-inflight');
				return;
			}
			if (attempt < MAX_EMBED_RETRIES) {
				// Keep the in-flight lock held across the retry delay (self-scheduled → skips lock check)
				window.setTimeout(() => renderEmbedWithRetry(embedEl, attempt + 1), EMBED_RETRY_DELAY_MS);
			} else {
				embedEl.removeAttribute('data-dr-inflight');
				log('[DeepPDF] Excalidraw embed render exhausted retries:', embedEl.getAttribute('src'));
			}
		}).catch((err) => {
			embedEl.removeAttribute('data-dr-inflight');
			log('[DeepPDF] renderEmbedWithRetry unexpected error:', err);
		});
	};

	// Post-process excalidraw embeds to render them as SVG drawings via ExcalidrawAutomate API.
	// Native embed rendering of freshly-created .excalidraw.md files is unreliable (async parsing
	// race), so DeepReader renders the SVG itself with retry and only falls back when the native
	// renderer has already produced an svg.excalidraw-svg.
	const processExcalidrawEmbeds = () => {
		const excalidrawEmbeds = contentEl.querySelectorAll('.internal-embed[src*="excalidraw" i], .markdown-embed[src*="excalidraw" i]');
		excalidrawEmbeds.forEach((embedEl) => {
			renderEmbedWithRetry(embedEl as HTMLElement);
		});
	};

	// 1. Initial processing for any embeds that are already loaded
	processExcalidrawEmbeds();

	// 2. Set up observer on the parent contentEl to capture future transclusion loading/replacements
	const observer = new MutationObserver(() => {
		processExcalidrawEmbeds();
	});
	observer.observe(contentEl, { 
		childList: true, 
		subtree: true,
		attributes: true,
		attributeFilter: ['class']
	});
	if (observers) {
		observers.push(observer);
	}
}

/**
 * Parses the compressed Excalidraw drawing JSON inside an `.excalidraw.md` Markdown wrapper.
 */
function parseExcalidrawMdContent(content: string): any {
	const lines = content.split('\n');
	let base64 = '';
	let inBlock = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('```compressed-json')) {
			inBlock = true;
			continue;
		}
		if (inBlock && trimmed.startsWith('```')) {
			inBlock = false;
			break;
		}
		if (inBlock) {
			base64 += trimmed;
		}
	}
	if (!base64) return null;
	const decompressed = decompressFromBase64(base64);
	if (!decompressed) return null;
	return JSON.parse(decompressed);
}

/**
 * Automatically detects format (JSON or Markdown) and parses Excalidraw drawing data.
 */
function parseExcalidrawFileContent(content: string): any {
	const trimmed = content.trim();
	if (trimmed.startsWith('{')) {
		return JSON.parse(trimmed);
	}
	return parseExcalidrawMdContent(content);
}
