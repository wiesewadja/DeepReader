/**
 * DeepReader 文件夹建议下拉组件
 * 用于设置界面的文件夹路径输入
 *
 * 延迟初始化：只在用户第一次 focus 输入框时才创建 suggester，
 * 避免 AbstractInputSuggest 构造时干扰已有的 input 值。
 */

import { type App, AbstractInputSuggest, TFolder } from 'obsidian';

class FolderSuggestInner extends AbstractInputSuggest<TFolder> {
	getSuggestions(query: string): TFolder[] {
		const folders = this.app.vault.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder);

		if (!query) return folders;

		return folders.filter(folder =>
			folder.path.toLowerCase().includes(query.toLowerCase()),
		);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createEl('span', { text: folder.path });
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.close();
	}
}

export function attachFolderSuggest(app: App, inputEl: HTMLInputElement): void {
	let created = false;
	inputEl.addEventListener('focus', () => {
		if (!created) {
			created = true;
			new FolderSuggestInner(app, inputEl);
		}
	});
}
