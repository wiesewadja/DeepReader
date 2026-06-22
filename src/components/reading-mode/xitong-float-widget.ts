import { MascotFace } from '../reading-topbar/mascot-face.js';
import { App } from 'obsidian';

export class XitongFloatWidget {
	private widgetEl: HTMLElement | null = null;
	private mascotFace: MascotFace | null = null;
	private inputPopupEl: HTMLElement | null = null;
	/** 外部点击关闭监听器；存为成员以便任意关闭路径都能统一移除，避免泄漏 */
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private badgeEl: HTMLElement | null = null;
	private hasUnread: boolean = false;
	private isThinking: boolean = false;

	constructor(
		private app: App,
		private parentEl: HTMLElement,
		private onSubmitQuestion: (question: string) => Promise<void>,
		private onRevealSidebar: () => void
	) {}

	show(): void {
		if (this.widgetEl) return;

		// 创建主容器
		this.widgetEl = this.parentEl.createEl('div', {
			cls: 'deeppdf-xitong-float-widget'
		});

		// 创建表情容器
		const faceContainer = this.widgetEl.createEl('div', {
			cls: 'deeppdf-xitong-float-face-container'
		});

		this.mascotFace = new MascotFace();
		faceContainer.appendChild(this.mascotFace.getElement()!);
		this.mascotFace.setExpression('idle');

		// 创建红点提示元素
		this.badgeEl = this.widgetEl.createEl('div', {
			cls: 'deeppdf-xitong-float-badge'
		});
		this.badgeEl.style.display = 'none';

		// 点击事件
		this.widgetEl.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.hasUnread) {
				this.clearUnread();
				this.onRevealSidebar();
			} else if (!this.isThinking) {
				this.toggleInputPopup();
			}
		});
	}

	hide(): void {
		this.closeInputPopup();
		if (this.mascotFace) {
			this.mascotFace.destroy();
			this.mascotFace = null;
		}
		if (this.badgeEl) {
			this.badgeEl.remove();
			this.badgeEl = null;
		}
		if (this.widgetEl) {
			this.widgetEl.remove();
			this.widgetEl = null;
		}
	}

	setThinking(thinking: boolean): void {
		this.isThinking = thinking;
		if (thinking) {
			this.hasUnread = false;
			this.mascotFace?.setExpression('thinking');
			this.widgetEl?.classList.add('is-thinking');
			if (this.badgeEl) {
				this.badgeEl.style.display = 'none';
			}
		} else {
			this.widgetEl?.classList.remove('is-thinking');
			if (!this.hasUnread) {
				this.mascotFace?.setExpression('idle');
			}
		}
	}

	setUnread(unread: boolean): void {
		this.hasUnread = unread;
		if (unread) {
			this.mascotFace?.setExpression('curious');
			this.widgetEl?.classList.add('has-unread');
			if (this.badgeEl) {
				this.badgeEl.style.display = 'block';
			}
		} else {
			this.widgetEl?.classList.remove('has-unread');
			if (this.badgeEl) {
				this.badgeEl.style.display = 'none';
			}
			if (!this.isThinking) {
				this.mascotFace?.setExpression('idle');
			}
		}
	}

	private clearUnread(): void {
		this.setUnread(false);
	}

	private toggleInputPopup(): void {
		if (this.inputPopupEl) {
			this.closeInputPopup();
		} else {
			this.openInputPopup();
		}
	}

	private openInputPopup(): void {
		if (this.inputPopupEl || !this.widgetEl) return;

		this.inputPopupEl = this.parentEl.createEl('div', {
			cls: 'deeppdf-xitong-float-popup'
		});

		// 阻止点击弹窗关闭弹窗
		this.inputPopupEl.addEventListener('click', (e) => {
			e.stopPropagation();
		});

		const input = this.inputPopupEl.createEl('input', {
			cls: 'deeppdf-xitong-popup-input'
		});
		input.type = 'text';
		input.placeholder = '问奚童...';
		input.focus();

		const sendBtn = this.inputPopupEl.createEl('button', {
			cls: 'deeppdf-xitong-popup-send-btn'
		});
		// 使用纸飞机发送图标
		sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

		const submit = () => {
			const text = input.value.trim();
			if (text) {
				this.onSubmitQuestion(text);
				this.closeInputPopup();
			}
		};

		sendBtn.addEventListener('click', submit);

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.closeInputPopup();
			}
		});

		// 点击其他区域关闭弹窗（handler 存为成员，closeInputPopup 统一移除，避免 Enter/Escape/按钮关闭路径泄漏）
		this.outsideClickHandler = (e: MouseEvent) => {
			if (this.inputPopupEl && !this.inputPopupEl.contains(e.target as Node) && !this.widgetEl?.contains(e.target as Node)) {
				this.closeInputPopup();
			}
		};
		// 延迟绑定，避免当前点击事件触发
		setTimeout(() => {
			if (this.outsideClickHandler) {
				document.addEventListener('click', this.outsideClickHandler);
			}
		}, 0);
	}

	private closeInputPopup(): void {
		if (this.outsideClickHandler) {
			document.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		if (this.inputPopupEl) {
			this.inputPopupEl.remove();
			this.inputPopupEl = null;
		}
	}
}
