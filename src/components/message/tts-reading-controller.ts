import { Icons } from '../../utils/icons.js';

/**
 * TTS 朗读控制器
 * 管理 TTS 按钮图标状态切换、朗读段落高亮和自动滚动跟随
 */

export interface TTSReadingHost {
	get el(): HTMLElement | null;
}

interface TTSContentDataset extends DOMStringMap {
	ttsLastParagraphIndex?: string;
}

export class TTSReadingController {
	private host: TTSReadingHost;
	private ttsBtn: HTMLButtonElement | null = null;
	private ttsWaveEl: HTMLElement | null = null;
	private scrollListener: (() => void) | null = null;
	private userScrolled: boolean = false;

	constructor(host: TTSReadingHost) {
		this.host = host;
	}

	/** 由 AIMessage.render() 在创建 ttsWave 后调用 */
	setTtsWaveEl(el: HTMLElement): void {
		this.ttsWaveEl = el;
	}

	/** 由 renderActions() 在创建 ttsBtn 后调用 */
	setTtsBtn(btn: HTMLButtonElement): void {
		this.ttsBtn = btn;
	}

	/** 更新 TTS 按钮图标状态 */
	setState(state: 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused'): void {
		if (this.ttsWaveEl) {
			this.ttsWaveEl.classList.toggle('active', state === 'playing');
		}

		if (this.ttsBtn) {
			switch (state) {
				case 'idle':
					this.ttsBtn.innerHTML = Icons.volume2;
					this.ttsBtn.title = '朗读';
					this.ttsBtn.classList.remove('tts-loading');
					break;
				case 'summarizing':
				case 'tts_loading':
					this.ttsBtn.innerHTML = Icons.spinner;
					this.ttsBtn.title = state === 'summarizing' ? '生成摘要...' : '加载语音...';
					this.ttsBtn.classList.add('tts-loading');
					break;
				case 'playing':
					this.ttsBtn.innerHTML = Icons.audioWave;
					this.ttsBtn.title = '暂停';
					this.ttsBtn.classList.remove('tts-loading');
					break;
				case 'paused':
					this.ttsBtn.innerHTML = Icons.volume2;
					this.ttsBtn.title = '继续';
					this.ttsBtn.classList.remove('tts-loading');
					break;
			}
		}
	}

	/** 朗读进度段落高亮 + 自动滚动跟随 */
	highlightProgress(progress: number): void {
		const contentEl = this.host.el?.querySelector('.deeppdf-message-content') as HTMLElement | null;
		if (!contentEl) return;

		const dataset = contentEl.dataset as TTSContentDataset;

		if (progress < 0) {
			contentEl.querySelectorAll('.deeppdf-tts-reading-paragraph').forEach(el => {
				el.removeClass('deeppdf-tts-reading-paragraph');
			});
			delete dataset.ttsLastParagraphIndex;
			this.detachScrollListener();
			this.userScrolled = false;
			return;
		}

		if (!this.scrollListener) {
			const container = this.findScrollContainer(contentEl);
			if (container) {
				this.scrollListener = () => { this.userScrolled = true; };
				container.addEventListener('scroll', this.scrollListener, { passive: true });
			}
		}

		const allElements = Array.from(contentEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'));
		// 过滤掉包含其他选定元素的容器元素，只保留叶子文本块
		const paragraphs = allElements.filter(el => {
			return !allElements.some(other => other !== el && el.contains(other));
		});
		if (paragraphs.length === 0) return;

		const paragraphInfo: { el: Element; start: number; end: number }[] = [];
		let totalChars = 0;

		for (const p of paragraphs) {
			const text = p.textContent || '';
			const charCount = text.length;
			paragraphInfo.push({ el: p, start: totalChars, end: totalChars + charCount });
			totalChars += charCount;
		}

		if (totalChars === 0) return;

		const currentChar = Math.floor((progress / 100) * totalChars);
		let currentParagraph: Element | null = null;
		let currentIndex = -1;

		for (let i = 0; i < paragraphInfo.length; i++) {
			if (currentChar >= paragraphInfo[i].start && currentChar < paragraphInfo[i].end) {
				currentParagraph = paragraphInfo[i].el;
				currentIndex = i;
				break;
			}
		}

		if (!currentParagraph && progress >= 100) {
			currentParagraph = paragraphInfo[paragraphInfo.length - 1].el;
			currentIndex = paragraphInfo.length - 1;
		}

		if (!currentParagraph) return;

		if (currentIndex !== Number(dataset.ttsLastParagraphIndex)) {
			contentEl.querySelectorAll('.deeppdf-tts-reading-paragraph').forEach(el => {
				el.removeClass('deeppdf-tts-reading-paragraph');
			});
			currentParagraph.addClass('deeppdf-tts-reading-paragraph');
			if (!this.userScrolled) {
				(currentParagraph as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
			dataset.ttsLastParagraphIndex = String(currentIndex);
		}
	}

	/** 直接高亮指定段落索引（无累计误差，更精准） */
	highlightParagraphIndex(index: number): void {
		const contentEl = this.host.el?.querySelector('.deeppdf-message-content') as HTMLElement | null;
		if (!contentEl) return;

		const dataset = contentEl.dataset as TTSContentDataset;

		if (index < 0) {
			contentEl.querySelectorAll('.deeppdf-tts-reading-paragraph').forEach(el => {
				el.removeClass('deeppdf-tts-reading-paragraph');
			});
			delete dataset.ttsLastParagraphIndex;
			this.detachScrollListener();
			this.userScrolled = false;
			return;
		}

		if (!this.scrollListener) {
			const container = this.findScrollContainer(contentEl);
			if (container) {
				this.scrollListener = () => { this.userScrolled = true; };
				container.addEventListener('scroll', this.scrollListener, { passive: true });
			}
		}

		const allElements = Array.from(contentEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'));
		// 过滤掉包含其他选定元素的容器元素，只保留叶子文本块
		const paragraphs = allElements.filter(el => {
			return !allElements.some(other => other !== el && el.contains(other));
		});

		if (paragraphs.length === 0 || index >= paragraphs.length) return;

		const currentParagraph = paragraphs[index];

		if (index !== Number(dataset.ttsLastParagraphIndex)) {
			contentEl.querySelectorAll('.deeppdf-tts-reading-paragraph').forEach(el => {
				el.removeClass('deeppdf-tts-reading-paragraph');
			});
			currentParagraph.addClass('deeppdf-tts-reading-paragraph');
			if (!this.userScrolled) {
				(currentParagraph as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
			dataset.ttsLastParagraphIndex = String(index);
		}
	}

	destroy(): void {
		this.detachScrollListener();
		this.ttsBtn = null;
		this.ttsWaveEl = null;
	}

	private findScrollContainer(el: HTMLElement): HTMLElement | null {
		let node: HTMLElement | null = el;
		while (node) {
			const { overflowY } = getComputedStyle(node);
			if (overflowY === 'auto' || overflowY === 'scroll') return node;
			node = node.parentElement;
		}
		return null;
	}

	private detachScrollListener(): void {
		if (this.scrollListener) {
			const contentEl = this.host.el?.querySelector('.deeppdf-message-content') as HTMLElement | null;
			if (contentEl) {
				const container = this.findScrollContainer(contentEl);
				container?.removeEventListener('scroll', this.scrollListener);
			}
			this.scrollListener = null;
		}
	}
}
