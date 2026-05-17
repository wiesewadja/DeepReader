/**
 * 未匹配书籍 Modal — 同步完成后展示未关联的微信读书书籍
 */

import { Modal, App, Setting, Notice } from 'obsidian';

export interface UnmatchedBook {
	bookId: string;
	title: string;
	author: string;
}

export class UnmatchedModal extends Modal {
	private onLink?: (bookId: string, filePath: string) => Promise<void>;

	constructor(
		app: App,
		private unmatchedBooks: UnmatchedBook[],
		onLink?: (bookId: string, filePath: string) => Promise<void>,
	) {
		super(app);
		this.onLink = onLink;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '未关联的微信读书书籍' });

		contentEl.createEl('p', {
			text: `以下 ${this.unmatchedBooks.length} 本微信读书书籍未在 DeepReader 中找到匹配。你可以在 DeepReader 中导入对应书籍后再执行"重新匹配"，或点击"手动关联"选择已有书籍。`,
		});

		// 书籍列表 — 固定高度 + 滚动，防止列表过长超出屏幕
		const listContainer = contentEl.createDiv({
			cls: 'deeppdf-unmatched-list-container',
		});
		const list = listContainer.createEl('ul', { cls: 'deeppdf-unmatched-list' });

		for (const book of this.unmatchedBooks) {
			const li = list.createEl('li', { cls: 'deeppdf-unmatched-item' });
			const info = li.createDiv({ cls: 'deeppdf-unmatched-info' });
			info.createEl('strong', { text: book.title });
			if (book.author) {
				info.createEl('span', { cls: 'deeppdf-unmatched-author', text: ` — ${book.author}` });
			}
			// 手动关联按钮
			const linkBtn = li.createEl('button', {
				cls: 'deeppdf-unmatched-link-btn',
				text: '手动关联',
			});
			linkBtn.addEventListener('click', () => {
				this.handleManualLink(book);
			});
		}

		// 底部引导提示
		contentEl.createEl('p', {
			cls: 'deeppdf-unmatched-hint',
			text: '提示：匹配基于书名相似度。如果书名差异较大（如翻译版本不同），可以使用手动关联功能。',
		});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('知道了')
					.setCta()
					.onClick(() => this.close());
			});
	}

	private async handleManualLink(book: UnmatchedBook) {
		// 打开 Obsidian 文件选择器让用户选择对应的书籍文件
		const { FuzzySuggestModal } = await import('obsidian');

		const picker = new (class extends FuzzySuggestModal<string> {
			private parent: UnmatchedModal;
			private book: UnmatchedBook;
			private files: string[];

			constructor(app: App, parent: UnmatchedModal, book: UnmatchedBook, files: string[]) {
				super(app);
				this.parent = parent;
				this.book = book;
				this.files = files;
				this.setPlaceholder(`选择与"${book.title}"对应的书籍...`);
			}

			getItems(): string[] {
				return this.files;
			}

			getItemText(item: string): string {
				return item;
			}

			async onChooseItem(item: string): Promise<void> {
				try {
					// 写入映射关系到 weread mapping
					const plugin = (this.app as any).plugins?.plugins?.['deepreader'] as any;
					if (plugin?.wereadMapping) {
						plugin.wereadMapping[book.bookId] = item;
						await plugin.saveSettings?.();
						new Notice(`已关联"${book.title}" → ${item}`);
					}
				} catch (e: any) {
					new Notice(`关联失败：${e.message}`);
				}
			}
		})(this.app, this, book, this.getBookFiles());

		picker.open();
	}

	private getBookFiles(): string[] {
		const files = this.app.vault.getFiles();
		return files
			.filter((f) => f.extension === 'pdf' || f.extension === 'epub')
			.map((f) => f.path)
			.sort();
	}

	onClose() {
		this.contentEl.empty();
	}
}
