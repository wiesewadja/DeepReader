/**
 * 移动端阅读模式浮动按钮 (FAB)
 *
 * 阅读时右下角显示奚童表情，点击打开对话。
 * 滚动时隐藏，停止后 1.5s 淡入。
 */

import { faceSVG } from '../reading-topbar/mascot-face.js';

export class MobileReadingFab {
	private fabEl: HTMLElement | null = null;
	private faceEl: HTMLElement | null = null;
	private badgeEl: HTMLElement | null = null;
	private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
	private scrollHandler: (() => void) | null = null;

	constructor(
		private onOpenChat: () => void,
	) {}

	show(): void {
		if (this.fabEl) return;

		this.fabEl = document.body.createEl('button', {
			cls: 'deeppdf-reading-fab visible',
		});

		this.faceEl = this.fabEl.createEl('div', { cls: 'deeppdf-fab-face' });
		this.faceEl.innerHTML = faceSVG('idle');

		this.badgeEl = this.fabEl.createEl('span', { cls: 'deeppdf-fab-badge' });
		this.badgeEl.style.display = 'none';

		this.fabEl.addEventListener('click', () => {
			this.onOpenChat();
		});

		this.scrollHandler = () => this.onScroll();
		document.addEventListener('scroll', this.scrollHandler, true);
	}

	hide(): void {
		if (this.scrollHandler) {
			document.removeEventListener('scroll', this.scrollHandler, true);
			this.scrollHandler = null;
		}
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
			this.scrollTimeout = null;
		}
		this.fabEl?.remove();
		this.fabEl = null;
		this.faceEl = null;
		this.badgeEl = null;
	}

	setUnread(hasUnread: boolean): void {
		if (this.badgeEl) {
			this.badgeEl.style.display = hasUnread ? '' : 'none';
		}
		if (this.faceEl) {
			this.faceEl.innerHTML = faceSVG(hasUnread ? 'curious' : 'idle');
		}
	}

	private onScroll(): void {
		if (!this.fabEl) return;
		this.fabEl.classList.remove('visible');
		this.fabEl.classList.add('hidden');
		if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
		this.scrollTimeout = setTimeout(() => {
			if (this.fabEl) {
				this.fabEl.classList.remove('hidden');
				this.fabEl.classList.add('visible');
			}
		}, 1500);
	}

	destroy(): void {
		this.hide();
	}
}
