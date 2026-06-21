/**
 * 全屏展示控制器
 *
 * 管理 AIMessage 的全屏展示模式：分页翻页、翻信导航。
 */

import { type App, MarkdownRenderer, Component } from 'obsidian';
import { setupInternalLinks } from './internal-links.js';
import { parseAgentContent } from './parse-agent-content.js';
import type { MessageData } from './types.js';

export interface FullscreenHost {
	get el(): HTMLElement | null;
	get data(): MessageData;
	get app(): App | undefined;
}

export class FullscreenController {
	private host: FullscreenHost;
	private observers: MutationObserver[];

	private fullscreenOverlay: HTMLElement | null = null;
	private fullscreenPage = 0;
	private fullscreenPages: HTMLElement[][] = [];
	private getAllMessages: (() => MessageData[]) | null;
	private getCurrentBookInfo: (() => { coverUrl: string | null; author: string | null; bookName: string | null }) | null;
	private fullscreenKeyHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor(
		host: FullscreenHost,
		observers: MutationObserver[],
		getAllMessages: (() => MessageData[]) | null,
		getCurrentBookInfo: (() => { coverUrl: string | null; author: string | null; bookName: string | null }) | null,
	) {
		this.host = host;
		this.observers = observers;
		this.getAllMessages = getAllMessages;
		this.getCurrentBookInfo = getCurrentBookInfo;
	}

	openFullscreen(): void {
		if (this.fullscreenOverlay) return;
		this.fullscreenPage = 0;
		this.fullscreenPages = [];

		const data = this.host.data;
		const app = this.host.app;
		if (!app) return;

		// ── 翻信数据准备 ──
		const allMsgs = this.getAllMessages?.() || [];
		const aiMessages = allMsgs.filter(m => m.role === 'assistant' && !m.isStreaming);
		let currentLetterIdx = aiMessages.findIndex(m => m.id === data.id);
		if (currentLetterIdx === -1) currentLetterIdx = 0;

		// ── 创建覆盖层 ──
		const overlay = document.body.createEl('div', { cls: 'deeppdf-fullscreen-overlay' });
		const panel = overlay.createEl('div', { cls: 'deeppdf-fullscreen-panel' });

		// ── 工具栏 ──
		const toolbar = panel.createEl('div', { cls: 'deeppdf-fullscreen-toolbar' });
		const toolbarLeft = toolbar.createEl('div', { cls: 'deeppdf-fullscreen-toolbar-left' });

		const currentMsg = aiMessages[currentLetterIdx] || data;
		const globalBookInfo = this.getCurrentBookInfo?.() || { coverUrl: null, author: null, bookName: null };
		const coverUrl = currentMsg.bookCoverUrl || globalBookInfo.coverUrl;
		const bookName = currentMsg.pdfName || globalBookInfo.bookName;
		const bookAuthor = currentMsg.bookAuthor || globalBookInfo.author;

		const bookInfoContainer = toolbarLeft.createEl('div', { cls: 'deeppdf-fullscreen-book-info' });

		const bookCoverEl = bookInfoContainer.createEl('div', { cls: 'deeppdf-fullscreen-book-cover' });
		if (coverUrl) {
			bookCoverEl.innerHTML = `<img src="${coverUrl}" alt="书籍封面" />`;
			bookCoverEl.addClass('has-cover');
		} else {
			bookCoverEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
		}

		const bookTextInfo = bookInfoContainer.createEl('div', { cls: 'deeppdf-fullscreen-book-text' });
		bookTextInfo.createEl('span', { cls: 'deeppdf-fullscreen-book-title', text: bookName || '未知书籍' });
		bookTextInfo.createEl('span', { cls: 'deeppdf-fullscreen-book-author', text: bookAuthor || '' });

		toolbarLeft.createEl('span', { cls: 'deeppdf-fullscreen-title', text: '奚童来信' });
		const questionEl = toolbarLeft.createEl('span', { cls: 'deeppdf-fullscreen-question', text: currentMsg.question || '' });

		const toolbarRight = toolbar.createEl('div', { cls: 'deeppdf-fullscreen-toolbar-right' });
		const pageInfo = toolbarRight.createEl('span', { cls: 'deeppdf-fullscreen-page-info' });
		const prevBtn = toolbarRight.createEl('button', { cls: 'deeppdf-fullscreen-nav-btn' });
		prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
		prevBtn.title = "上一页";
		prevBtn.style.opacity = '0.3';
		const nextBtn = toolbarRight.createEl('button', { cls: 'deeppdf-fullscreen-nav-btn' });
		nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
		nextBtn.title = "下一页";
		const closeBtn = toolbarRight.createEl('button', { cls: 'deeppdf-fullscreen-close-btn' });
		closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
		closeBtn.title = "关闭";

		// ── 侧边浮动翻信箭头 ──
		const letterArrowSvg = (direction: 'left' | 'right') =>
			`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${
				direction === 'left'
					? '<path d="m15 18-6-6 6-6"/><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>'
					: '<path d="m9 18 6-6-6-6"/><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>'
			}</svg>`;

		const prevLetterBtn = panel.createEl('button', { cls: 'deeppdf-fullscreen-letter-nav deeppdf-fullscreen-letter-prev' });
		prevLetterBtn.innerHTML = letterArrowSvg('left');
		prevLetterBtn.title = "上一封";
		if (currentLetterIdx <= 0) prevLetterBtn.style.display = 'none';

		const nextLetterBtn = panel.createEl('button', { cls: 'deeppdf-fullscreen-letter-nav deeppdf-fullscreen-letter-next' });
		nextLetterBtn.innerHTML = letterArrowSvg('right');
		nextLetterBtn.title = "下一封";
		if (currentLetterIdx >= aiMessages.length - 1) nextLetterBtn.style.display = 'none';

		// ── 内容区域 ──
		const contentArea = panel.createEl('div', { cls: 'deeppdf-fullscreen-content-area' });

		// ── 分页 + 渲染闭包（支持翻信时重新调用） ──
		let currentPages: HTMLElement[][] = [];

		const paginateContent = (rawContent: string, sourcePath: string, onDone?: () => void) => {
			const tempDiv = contentArea.createEl('div', { cls: ['deeppdf-fullscreen-content-area'] });
			tempDiv.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;';

			const doPaginate = () => {
				const children = Array.from(tempDiv.children) as HTMLElement[];
				if (children.length === 0) { tempDiv.remove(); currentPages = []; onDone?.(); return; }

				requestAnimationFrame(() => {
					tempDiv.remove();
					const pages: HTMLElement[][] = [];
					let remaining = [...children];

					while (remaining.length > 0) {
						contentArea.empty();
						for (const el of remaining) contentArea.appendChild(el);

						if (contentArea.scrollWidth <= contentArea.clientWidth) {
							pages.push([...remaining]);
							remaining = [];
							break;
						}
						while (contentArea.scrollWidth > contentArea.clientWidth && contentArea.children.length > 1) {
							const last = contentArea.children[contentArea.children.length - 1] as HTMLElement;
							contentArea.removeChild(last);
						}
						const pageElems = Array.from(contentArea.children) as HTMLElement[];
						remaining = remaining.slice(pageElems.length);
						pages.push(pageElems);
					}

					currentPages = pages;
					this.fullscreenPages = pages as any;
					this.fullscreenPage = 0;
					renderPage(0);
					onDone?.();
				});
			};

			MarkdownRenderer.render(app, rawContent, tempDiv, sourcePath, new Component()).then(() => doPaginate());
		};

		const renderPage = (idx: number) => {
			contentArea.addClass('deeppdf-page-fading');
			setTimeout(() => {
				contentArea.empty();
				const pg = currentPages[idx];
				if (pg) {
					for (const el of pg) contentArea.appendChild(el);
					setupInternalLinks(contentArea, app, false, this.observers);
				}
				pageInfo.textContent = currentPages.length > 1 ? `${idx + 1} / ${currentPages.length}` : '';
				prevBtn.style.opacity = idx > 0 ? '1' : '0.3';
				nextBtn.style.opacity = idx < currentPages.length - 1 ? '1' : '0.3';
				prevBtn.style.pointerEvents = idx > 0 ? 'auto' : 'none';
				nextBtn.style.pointerEvents = idx < currentPages.length - 1 ? 'auto' : 'none';
				contentArea.removeClass('deeppdf-page-fading');
			}, 150);
		};

		// ── 初始渲染 ──
		const initialMsg = aiMessages[currentLetterIdx];
		const { cleanedContent: initialContent } = parseAgentContent(initialMsg?.content || data.content);
		paginateContent(initialContent, initialMsg?.pdfName || data.pdfName || '');

		// ── 翻页按钮 ──
		prevBtn.addEventListener('click', () => {
			if (this.fullscreenPage > 0) { this.fullscreenPage--; renderPage(this.fullscreenPage); }
		});
		nextBtn.addEventListener('click', () => {
			if (this.fullscreenPage < currentPages.length - 1) { this.fullscreenPage++; renderPage(this.fullscreenPage); }
		});

		// ── 翻信按钮 ──
		const bookCoverRef = toolbarLeft.querySelector('.deeppdf-fullscreen-book-cover') as HTMLElement;
		const bookTitleRef = toolbarLeft.querySelector('.deeppdf-fullscreen-book-title') as HTMLElement;
		const bookAuthorRef = toolbarLeft.querySelector('.deeppdf-fullscreen-book-author') as HTMLElement;

		const updateBookInfo = (msg: MessageData) => {
			const globalInfo = this.getCurrentBookInfo?.() || { coverUrl: null, author: null, bookName: null };
			const msgCoverUrl = msg.bookCoverUrl || globalInfo.coverUrl;
			const msgBookName = msg.pdfName || globalInfo.bookName;
			const msgAuthor = msg.bookAuthor || globalInfo.author;

			if (bookCoverRef) {
				if (msgCoverUrl) {
					bookCoverRef.innerHTML = `<img src="${msgCoverUrl}" alt="书籍封面" />`;
					bookCoverRef.addClass('has-cover');
				} else {
					bookCoverRef.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;
					bookCoverRef.removeClass('has-cover');
				}
			}
			if (bookTitleRef) bookTitleRef.textContent = msgBookName || '未知书籍';
			if (bookAuthorRef) bookAuthorRef.textContent = msgAuthor || '';
		};

		const navigateToLetter = (targetIdx: number) => {
			if (targetIdx < 0 || targetIdx >= aiMessages.length || targetIdx === currentLetterIdx) return;

			const direction = targetIdx > currentLetterIdx ? 'left' : 'right';
			contentArea.addClass(`deeppdf-flip-${direction}-out`);

			setTimeout(() => {
				currentLetterIdx = targetIdx;
				const target = aiMessages[currentLetterIdx];

				questionEl.textContent = target.question || '';
				updateBookInfo(target);

				prevLetterBtn.style.display = currentLetterIdx > 0 ? '' : 'none';
				nextLetterBtn.style.display = currentLetterIdx < aiMessages.length - 1 ? '' : 'none';

				const { cleanedContent } = parseAgentContent(target.content);
				contentArea.removeClass(`deeppdf-flip-${direction}-out`);
				paginateContent(cleanedContent, target.pdfName || '', () => {
					contentArea.addClass(`deeppdf-flip-${direction}-in`);
					setTimeout(() => contentArea.removeClass(`deeppdf-flip-${direction}-in`), 300);
				});
			}, 200);
		};
		prevLetterBtn.addEventListener('click', () => navigateToLetter(currentLetterIdx - 1));
		nextLetterBtn.addEventListener('click', () => navigateToLetter(currentLetterIdx + 1));

		// ── 事件 ──
		const close = () => this.closeFullscreen();
		closeBtn.addEventListener('click', close);
		overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
		panel.addEventListener('mousedown', (e) => e.stopPropagation());
		panel.addEventListener('click', (e) => e.stopPropagation());

		this.fullscreenKeyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
			else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && (e.ctrlKey || e.metaKey)) {
				e.preventDefault(); e.stopImmediatePropagation(); nextLetterBtn.click();
			}
			else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && (e.ctrlKey || e.metaKey)) {
				e.preventDefault(); e.stopImmediatePropagation(); prevLetterBtn.click();
			}
			else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
				e.preventDefault(); e.stopImmediatePropagation(); nextBtn.click();
			}
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
				e.preventDefault(); e.stopImmediatePropagation(); prevBtn.click();
			}
		};
		document.addEventListener('keydown', this.fullscreenKeyHandler, true);

		this.fullscreenOverlay = overlay;
		requestAnimationFrame(() => overlay.addClass('deeppdf-fullscreen-open'));

	}

	closeFullscreen(): void {
		if (!this.fullscreenOverlay) return;
		if (this.fullscreenKeyHandler) {
			document.removeEventListener('keydown', this.fullscreenKeyHandler, true);
			this.fullscreenKeyHandler = null;
		}
		this.fullscreenOverlay.removeClass('deeppdf-fullscreen-open');
		const overlay = this.fullscreenOverlay;
		this.fullscreenOverlay = null;
		setTimeout(() => overlay.remove(), 300);
	}

	destroy(): void {
		this.closeFullscreen();
	}
}
