# 文件夹建议器设计文档

## 背景

用户画像设置界面中的"笔记目录"字段当前使用纯文本输入框，用户需要手动输入文件夹路径。这容易导致输入错误，且用户体验不佳。

## 目标

为"笔记目录"字段添加文件夹自动补全功能，用户输入时自动显示匹配的文件夹建议列表，用户可以选择现有文件夹。

## 约束

- 只允许选择 Vault 中已存在的文件夹，不支持创建新文件夹
- 使用 Obsidian 内置的 `AbstractInputSuggest` API
- 保持与现有代码风格一致

## 实现方案

### 1. 创建 FolderSuggest 类

创建 `src/components/folder-suggest/folder-suggest.ts`，继承 Obsidian 的 `AbstractInputSuggest` 类：

```typescript
import { App, AbstractInputSuggest, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    constructor(app: App, textInputEl: HTMLInputElement) {
        super(app, textInputEl);
    }

    getSuggestions(query: string): TFolder[] {
        const folders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder);
        
        if (!query) return folders;
        
        return folders.filter(folder => 
            folder.path.toLowerCase().includes(query.toLowerCase())
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
```

### 2. 修改设置界面

在 `src/settings/setting-tab.ts` 的 `renderProfileSettings` 方法中，将 `addText` 替换为使用 `FolderSuggest`：

```typescript
new Setting(container)
    .setName('笔记目录')
    .setDesc('存放日记、随笔、感悟的 Obsidian 文件夹路径（相对于 Vault 根目录）')
    .addText(text => {
        text
            .setPlaceholder('例如：Journals/随手记')
            .setValue(this.plugin.settings.journalDir)
            .onChange(async (value) => {
                // 保持原有逻辑不变
            });
        
        // 添加文件夹建议器
        new FolderSuggest(this.app, text.inputEl);
    });
```

### 3. 样式调整

文件夹建议器会使用 Obsidian 默认的建议器样式，无需额外 CSS。

## 验证方法

1. 打开插件设置，进入"用户画像"标签
2. 点击"笔记目录"输入框
3. 输入部分路径（如 "J"），验证是否显示匹配的文件夹
4. 使用键盘上下箭头选择文件夹，验证是否正确填充
5. 点击选择文件夹，验证是否正确设置路径

## 影响范围

- 新增文件：`src/components/folder-suggest/folder-suggest.ts`
- 修改文件：`src/settings/setting-tab.ts`
- 无破坏性变更，不影响现有功能
