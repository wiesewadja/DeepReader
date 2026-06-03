/**
 * 多选模式控制器
 * 管理多选状态、确认栏和主题阅读确认
 */

import type { IndexListItem, Booklist } from '../../types/index.js';
import { stripFileExtension } from '../../types/index.js';

export interface MultiSelectCallbacks {
	getIndexes: () => IndexListItem[];
	getCoverCache: () => Map<string, string>;
	containerEl: HTMLElement;
	options: {
		onStartThematicReading?: (booklist: Booklist, reenter?: boolean) => void;
	};
	onRenderGrid: () => void;
	onExitMultiSelect: () => void;
	onHandleBatchArchive: () => void;
}

export class MultiSelectController {
	static readonly MAX_MULTI_SELECT = 5;

	private _multiSelectMode: boolean = false;
	private _selectedBookIds: Set<string> = new Set();
	private _confirmBarEl: HTMLElement | null = null;

	constructor(
		private callbacks: MultiSelectCallbacks,
		private getShowArchived: () => boolean,
	) {}

	isActive(): boolean { return this._multiSelectMode; }
	getSelectedBookIds(): Set<string> { return this._selectedBookIds; }

	toggleMultiSelectMode(): void {
		if (this._multiSelectMode) {
			this.exitMultiSelectMode();
		} else {
			this._multiSelectMode = true;
			this._selectedBookIds.clear();
			this.callbacks.onRenderGrid();
			this.showConfirmBar();
		}
	}

	exitMultiSelectMode(): void {
		this._multiSelectMode = false;
		this._selectedBookIds.clear();
		this.hideConfirmBar();
		this.callbacks.onRenderGrid();
	}

	toggleBookSelection(indexId: string, card: HTMLElement): void {
		if (this._selectedBookIds.has(indexId)) {
			this._selectedBookIds.delete(indexId);
		} else {
			if (this._selectedBookIds.size >= MultiSelectController.MAX_MULTI_SELECT) return;
			this._selectedBookIds.add(indexId);
		}
		this.callbacks.onRenderGrid();
		this.updateConfirmBar();
	}

	showConfirmBar(): void {
		this.hideConfirmBar();
		const container = this.callbacks.containerEl;
		this._confirmBarEl = container.createDiv({ cls: 'deeppdf-lib-multi-confirm-bar' });
		this.updateConfirmBar();
	}

	updateConfirmBar(): void {
		if (!this._confirmBarEl) return;
		const count = this._selectedBookIds.size;
		this._confirmBarEl.empty();

		this._confirmBarEl.createDiv({ cls: 'deeppdf-lib-multi-count', text: `已选 ${count} 本` });

		if (count >= 2) {
			const startBtn = this._confirmBarEl.createEl('button', { cls: 'deeppdf-lib-multi-start-btn' });
			startBtn.textContent = '开始主题阅读';
			startBtn.addEventListener('click', () => this.confirmThematicReading());
		}

		if (count >= 1) {
			const archiveBtn = this._confirmBarEl.createEl('button', { cls: 'deeppdf-lib-multi-start-btn' });
			archiveBtn.textContent = this.getShowArchived() ? `取消归档 ${count} 本` : `归档 ${count} 本`;
			archiveBtn.addEventListener('click', () => this.callbacks.onHandleBatchArchive());
		}

		const cancelBtn = this._confirmBarEl.createEl('button', { cls: 'deeppdf-lib-multi-cancel-btn' });
		cancelBtn.textContent = '取消';
		cancelBtn.addEventListener('click', () => this.exitMultiSelectMode());
	}

	hideConfirmBar(): void {
		if (this._confirmBarEl) {
			this._confirmBarEl.remove();
			this._confirmBarEl = null;
		}
	}

	confirmThematicReading(): void {
		if (this._selectedBookIds.size < 2) return;
		const bookIds = Array.from(this._selectedBookIds);
		const bookNames = bookIds.map(id => {
			const idx = this.callbacks.getIndexes().find(i => i.id === id);
			const name = idx?.pdf_name || id;
			return stripFileExtension(name);
		});
		const displayName = `${bookNames[0]}等${bookNames.length}本书`;
		const items = bookIds.map(id => {
			const idx = this.callbacks.getIndexes().find(i => i.id === id);
			const name = stripFileExtension(idx?.pdf_name || id);
			return {
				id,
				name,
				author: idx?.author,
				coverUrl: this.callbacks.getCoverCache().get(id) || undefined,
			};
		});
		const booklist: Booklist = {
			id: `booklist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			name: displayName,
			bookIds,
			bookNames,
			createdAt: new Date().toISOString(),
			items,
		};
		this.callbacks.options.onStartThematicReading?.(booklist);
		this.exitMultiSelectMode();
	}
}
