# 文件夹建议器实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为用户画像设置界面的"笔记目录"字段添加文件夹自动补全功能

**Architecture:** 使用 Obsidian 内置的 `AbstractInputSuggest` API 创建 `FolderSuggest` 类，在设置界面的文本输入框中提供文件夹建议

**Tech Stack:** TypeScript, Obsidian API

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/components/folder-suggest/folder-suggest.ts` | 新增 | 文件夹建议器组件 |
| `src/settings/setting-tab.ts:821-840` | 修改 | 集成文件夹建议器 |

---

## Chunk 1: 创建 FolderSuggest 组件

### Task 1: 创建 FolderSuggest 类

**Files:**
- Create: `src/components/folder-suggest/folder-suggest.ts`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p src/components/folder-suggest
```

- [ ] **Step 2: 创建 FolderSuggest 类**

```typescript
/**
 * DeepReader 文件夹建议下拉组件
 * 用于设置界面的文件夹路径输入
 */

import { App, AbstractInputSuggest, TFolder } from 'obsidian';

/**
 * 文件夹建议下拉组件
 * 提供文件夹搜索和选择功能
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    constructor(app: App, textInputEl: HTMLInputElement) {
        super(app, textInputEl);
    }

    /**
     * 获取文件夹建议列表
     */
    getSuggestions(query: string): TFolder[] {
        const folders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder);
        
        if (!query) return folders;
        
        return folders.filter(folder => 
            folder.path.toLowerCase().includes(query.toLowerCase())
        );
    }

    /**
     * 渲染建议项
     */
    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.createEl('span', { text: folder.path });
    }

    /**
     * 选择建议项
     */
    selectSuggestion(folder: TFolder): void {
        this.setValue(folder.path);
        this.close();
    }
}
```

- [ ] **Step 3: 验证代码**

运行类型检查：
```bash
npm run build
```

预期：无类型错误

---

## Chunk 2: 集成到设置界面

### Task 2: 修改设置界面

**Files:**
- Modify: `src/settings/setting-tab.ts:821-840`

- [ ] **Step 1: 添加导入语句**

在文件顶部添加导入：
```typescript
import { FolderSuggest } from '../components/folder-suggest/folder-suggest';
```

- [ ] **Step 2: 修改 renderProfileSettings 方法**

将第 821-840 行的代码修改为：

```typescript
new Setting(container)
    .setName('笔记目录')
    .setDesc('存放日记、随笔、感悟的 Obsidian 文件夹路径（相对于 Vault 根目录）')
    .addText(text => {
        text
            .setPlaceholder('例如：Journals/随手记')
            .setValue(this.plugin.settings.journalDir)
            .onChange(async (value) => {
                const oldDir = this.plugin.settings.journalDir;
                this.plugin.settings.journalDir = value;
                await this.plugin.saveSettings();

                if (oldDir && oldDir !== value) {
                    const builder = (this.plugin as any).profileBuilder;
                    if (builder) await builder.deleteProfile();
                    new Notice('笔记目录已变更，请重新构建画像');
                }
                (this.plugin as any).profileBuilder = value
                    ? new (require('../services/profile-builder').ProfileBuilder)(this.app, this.plugin.settings)
                    : undefined;
            });
        
        // 添加文件夹建议器
        new FolderSuggest(this.app, text.inputEl);
    });
```

- [ ] **Step 3: 验证代码**

运行类型检查：
```bash
npm run build
```

预期：无类型错误

---

## Chunk 3: 测试验证

### Task 3: 手动测试

- [ ] **Step 1: 启动开发模式**

```bash
npm run dev
```

- [ ] **Step 2: 在 Obsidian 中测试**

1. 打开 Obsidian，加载 test-vault
2. 打开插件设置，进入"用户画像"标签
3. 点击"笔记目录"输入框
4. 输入部分路径（如 "J"），验证是否显示匹配的文件夹
5. 使用键盘上下箭头选择文件夹，验证是否正确填充
6. 点击选择文件夹，验证是否正确设置路径

- [ ] **Step 3: 验证边界情况**

1. 输入不存在的路径，验证显示空状态
2. 清空输入框，验证显示所有文件夹
3. 选择文件夹后，验证 onChange 回调正确触发

---

## 完成

所有任务完成后，运行完整构建验证：

```bash
npm run build
```

预期：构建成功，无错误
