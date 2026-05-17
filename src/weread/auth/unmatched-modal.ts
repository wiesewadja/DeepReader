/**
 * 未匹配书籍 Modal — 同步完成后展示未关联的微信读书书籍
 */

import { Modal, App, Setting } from 'obsidian';

export interface UnmatchedBook {
	bookId: string;
	title: string;
	author: string;
}

export class UnmatchedModal extends Modal {
	constructor(
		app: App,
		private unmatchedBooks: UnmatchedBook[],
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '未关联的微信读书书籍' });

		contentEl.createEl('p', {
			text: `以下 ${this.unmatchedBooks.length} 本微信读书书籍未在 DeepReader 中找到匹配。你可以在 DeepReader 中导入对应书籍后再执行"重新匹配"。`,
		});

		const list = contentEl.createEl('ul');
		for (const book of this.unmatchedBooks) {
			const li = list.createEl('li');
			li.createEl('strong', { text: book.title });
			if (book.author) {
				li.createEl('span', { text: ` — ${book.author}` });
			}
		}

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('知道了')
					.setCta()
					.onClick(() => this.close());
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
