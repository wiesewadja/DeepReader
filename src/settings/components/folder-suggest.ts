/**
 * Folder suggestion modal — based on Obsidian FuzzySuggestModal.
 */

import { App, FuzzySuggestModal, TFolder } from 'obsidian';

export class FolderSuggestModal extends FuzzySuggestModal<string> {
  private onSelect: (path: string) => void;

  constructor(app: App, onSelect: (path: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder('输入关键词筛选文件夹…');
    this.setInstructions([
      { command: '↑↓', purpose: '导航' },
      { command: '↵', purpose: '选择' },
      { command: 'esc', purpose: '取消' },
    ]);
  }

  getItems(): string[] {
    const folders: string[] = [];
    const recurse = (folder: TFolder) => {
      folders.push(folder.path);
      for (const child of folder.children) {
        if (child instanceof TFolder) recurse(child);
      }
    };
    recurse(this.app.vault.getRoot());
    folders.sort((a, b) => a.localeCompare(b));
    return folders;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onSelect(item);
  }
}
