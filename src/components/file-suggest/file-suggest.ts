/**
 * DeepPDF 文件建议下拉组件
 * 用于 @ 提及和 [[]] 链接时的文件搜索
 */

import { type App, type TFile } from 'obsidian';

export interface FileSuggestOptions {
	app: App;
	/** 选择文件回调 */
	onSelect: (file: TFile) => void;
	/** 最大显示数量 */
	maxResults?: number;
}

/**
 * 文件建议下拉组件
 * 提供文件搜索和选择功能
 */
export class FileSuggest {
	private app: App;
	private onSelect: (file: TFile) => void;
	private maxResults: number;
	private el: HTMLElement | null = null;
	private visible: boolean = false;
	private files: TFile[] = [];
	private selectedIndex: number = 0;

	constructor(options: FileSuggestOptions) {
		this.app = options.app;
		this.onSelect = options.onSelect;
		this.maxResults = options.maxResults || 10;
		this.el = this.createDropdown();
	}

	/**
	 * 创建下拉菜单容器
	 */
	private createDropdown(): HTMLElement {
		const dropdown = document.createElement('div');
		dropdown.className = 'deeppdf-file-suggest';
		dropdown.style.display = 'none';
		document.body.appendChild(dropdown);
		return dropdown;
	}

	/**
	 * 搜索并显示结果
	 */
	search(query: string): void {
		this.files = this.searchFiles(query);
		this.selectedIndex = 0;
		this.renderResults();
		if (this.files.length > 0) {
			this.show();
		} else {
			this.hide();
		}
	}

	/**
	 * 搜索文件
	 */
	private searchFiles(query: string): TFile[] {
		const allFiles = this.app.vault.getMarkdownFiles();
		const queryLower = query.toLowerCase().trim();

		// 如果查询为空，返回最近修改的文件
		if (!queryLower) {
			return allFiles
				.sort((a, b) => b.stat.mtime - a.stat.mtime)
				.slice(0, this.maxResults);
		}

		// 搜索文件名和路径
		return allFiles
			.filter(file => {
				const basenameLower = file.basename.toLowerCase();
				const pathLower = file.path.toLowerCase();
				return basenameLower.includes(queryLower) || pathLower.includes(queryLower);
			})
			.sort((a, b) => {
				// 优先匹配文件名开头
				const aStartsWith = a.basename.toLowerCase().startsWith(queryLower);
				const bStartsWith = b.basename.toLowerCase().startsWith(queryLower);
				if (aStartsWith && !bStartsWith) return -1;
				if (!aStartsWith && bStartsWith) return 1;
				// 其次按修改时间排序
				return b.stat.mtime - a.stat.mtime;
			})
			.slice(0, this.maxResults);
	}

	/**
	 * 渲染搜索结果
	 */
	private renderResults(): void {
		if (!this.el) return;

		this.el.innerHTML = '';

		if (this.files.length === 0) {
			this.el.innerHTML = '<div class="deeppdf-file-suggest-empty">没有找到匹配的文件</div>';
			return;
		}

		this.files.forEach((file, index) => {
			const item = document.createElement('div');
			item.className = 'deeppdf-file-suggest-item';
			if (index === this.selectedIndex) {
				item.classList.add('selected');
			}

			// 图标 + 文件名 + 路径
			item.innerHTML = `
				<span class="deeppdf-file-suggest-icon">📄</span>
				<span class="deeppdf-file-suggest-name">${this.escapeHtml(file.basename)}</span>
				<span class="deeppdf-file-suggest-path">${this.escapeHtml(file.parent?.path || '/')}</span>
			`;

			item.addEventListener('click', () => {
				this.selectFile(index);
			});

			item.addEventListener('mouseenter', () => {
				this.selectedIndex = index;
				this.updateSelection();
			});

			this.el!.appendChild(item);
		});
	}

	/**
	 * 更新选中状态
	 */
	private updateSelection(): void {
		if (!this.el) return;

		const items = this.el.querySelectorAll('.deeppdf-file-suggest-item');
		items.forEach((item, index) => {
			if (index === this.selectedIndex) {
				item.classList.add('selected');
			} else {
				item.classList.remove('selected');
			}
		});
	}

	/**
	 * 选择文件
	 */
	selectFile(index: number): void {
		if (index >= 0 && index < this.files.length) {
			this.onSelect(this.files[index]);
			this.hide();
		}
	}

	/**
	 * 选择当前选中的文件
	 */
	selectCurrent(): void {
		if (this.visible && this.files.length > 0) {
			this.selectFile(this.selectedIndex);
		}
	}

	/**
	 * 键盘导航
	 * @returns 是否处理了该事件
	 */
	handleKeydown(event: KeyboardEvent): boolean {
		if (!this.visible) return false;

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				this.selectedIndex = Math.min(this.selectedIndex + 1, this.files.length - 1);
				this.updateSelection();
				this.scrollToSelected();
				return true;

			case 'ArrowUp':
				event.preventDefault();
				this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
				this.updateSelection();
				this.scrollToSelected();
				return true;

			case 'Enter':
			case 'Tab':
				event.preventDefault();
				this.selectFile(this.selectedIndex);
				return true;

			case 'Escape':
				this.hide();
				return true;

			default:
				return false;
		}
	}

	/**
	 * 滚动到选中项
	 */
	private scrollToSelected(): void {
		if (!this.el) return;

		const selectedItem = this.el.querySelector('.deeppdf-file-suggest-item.selected');
		if (selectedItem) {
			selectedItem.scrollIntoView({ block: 'nearest' });
		}
	}

	/**
	 * 显示下拉菜单
	 */
	show(): void {
		if (this.el && this.files.length > 0) {
			this.el.style.display = 'block';
			this.visible = true;
		}
	}

	/**
	 * 隐藏下拉菜单
	 */
	hide(): void {
		if (this.el) {
			this.el.style.display = 'none';
			this.visible = false;
		}
	}

	/**
	 * 定位下拉菜单
	 */
	setPosition(x: number, y: number, anchorTop?: number): void {
		if (!this.el) return;

		const dropdownHeight = this.el.offsetHeight || 300;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		let posX = x;
		let posY = y;

		// 如果右边超出，向左调整
		if (x + 300 > viewportWidth) {
			posX = viewportWidth - 310;
		}

		// 如果下边空间不足，在输入框上方显示
		if (posY + dropdownHeight > viewportHeight) {
			// anchorTop 是输入框顶部位置，下拉框底部对齐到输入框上方（留 4px 间距）
			posY = (anchorTop ?? posY) - dropdownHeight - 4;
			this.el.style.transformOrigin = 'bottom left';
		} else {
			this.el.style.transformOrigin = 'top left';
		}

		// 确保不超出屏幕顶部
		posY = Math.max(10, posY);

		this.el.style.left = `${Math.max(10, posX)}px`;
		this.el.style.top = `${posY}px`;
	}

	/**
	 * 是否可见
	 */
	isVisible(): boolean {
		return this.visible;
	}

	/**
	 * HTML 转义
	 */
	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * 销毁组件
	 */
	destroy(): void {
		if (this.el && this.el.parentNode) {
			this.el.parentNode.removeChild(this.el);
		}
		this.el = null;
		this.files = [];
	}
}
