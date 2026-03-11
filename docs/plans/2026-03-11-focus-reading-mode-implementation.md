# 阅读聚焦模式实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepReader 阅读模式添加聚焦功能，视口内的段落高亮显示并支持 Apple Books 风格字体，视口外的内容淡化。

**Architecture:**
- 聚焦模式**依赖阅读模式**，只在 `deeppdf-reading-mode` 激活时生效
- 使用 IntersectionObserver API 检测段落是否在视口内
- 通过 CSS 类切换实现聚焦/淡化效果
- 设置存储在插件 settings 中，支持自动启用
- 通过阅读顶栏按钮和快捷键 `f` 切换

**Tech Stack:** TypeScript, CSS, IntersectionObserver API, Obsidian Plugin API

**依赖关系图:**
```
阅读模式 (deeppdf-reading-mode)
    └── 聚焦模式 (deeppdf-focus-mode)  ← 必须在阅读模式激活后才能启用
```

---

## Task 1: 添加聚焦模式 CSS 样式

**Files:**
- Modify: `frontend/src/components/reading-mode/reading-mode.css`

**Step 1: 添加聚焦模式 CSS 变量和基础样式**

在 `reading-mode.css` 文件末尾添加以下样式：

```css
/* ==================== 聚焦模式 (Focus Mode) ==================== */
/* 聚焦模式依赖阅读模式，只在 .deeppdf-reading-mode 存在时生效 */

/* CSS 变量定义 */
.deeppdf-reading-mode.deeppdf-focus-mode {
    --deeppdf-unfocused-level: 0.2;
    --deeppdf-focus-font: "Iowan Old Style", "Charter", "Georgia", "Times New Roman", serif;
    --deeppdf-focus-font-size: 18px;
    --deeppdf-focus-line-height: 1.9;
}

/* 淡化视口外的内容 - 只针对阅读视图中的直接子元素 */
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view > div > p,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view > div > li,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view > div > blockquote {
    opacity: var(--deeppdf-unfocused-level, 0.2);
    transition: opacity 0.4s ease, font-size 0.3s ease, line-height 0.3s ease;
}

/* 视口内可见的内容 - 高亮显示 */
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view > div > p.deeppdf-in-view,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view > div > li.deeppdf-in-view,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view > div > blockquote.deeppdf-in-view {
    opacity: 1;
    font-family: var(--deeppdf-focus-font);
    font-size: var(--deeppdf-focus-font-size);
    line-height: var(--deeppdf-focus-line-height);
}

/* 标题半透明显示 */
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view h1,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view h2,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view h3 {
    opacity: 0.6;
    transition: opacity 0.4s ease;
}

/* 代码块和表格保持可见 */
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view pre,
.deeppdf-reading-mode.deeppdf-focus-mode .markdown-preview-view table {
    opacity: 0.5;
    transition: opacity 0.4s ease;
}
```

**Step 2: 验证 CSS 文件语法**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功，无 CSS 相关错误

**Step 3: Commit**

```bash
git add frontend/src/components/reading-mode/reading-mode.css
git commit -m "feat(reading-mode): add focus mode CSS styles"
```

---

## Task 2: 创建 FocusModeService 服务

**Files:**
- Create: `frontend/src/services/focus-mode-service.ts`

**Step 1: 创建 FocusModeService 服务文件**

创建文件 `frontend/src/services/focus-mode-service.ts`：

```typescript
/**
 * 聚焦模式服务
 * 使用 IntersectionObserver 检测视口内的段落，实现聚焦阅读效果
 *
 * 依赖：聚焦模式必须在阅读模式激活后才能启用
 */

import { serviceLog } from '../utils/logger.js';

export type FocusFontFamily = 'iowan' | 'charter' | 'georgia' | 'athelas' | 'seravek';

export interface FocusModeSettings {
    enabled: boolean;
    autoEnable: boolean;  // 自动启用（打开章节时自动开启聚焦模式）
    unfocusedLevel: number;
    fontFamily: FocusFontFamily;
    fontSize: number;
    lineHeight: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusModeSettings = {
    enabled: false,
    autoEnable: false,
    unfocusedLevel: 0.2,
    fontFamily: 'iowan',
    fontSize: 18,
    lineHeight: 1.9,
};

export const FONT_FAMILIES: Record<FocusFontFamily, string> = {
    iowan: '"Iowan Old Style", "Charter", "Georgia", serif',
    charter: '"Charter", "Iowan Old Style", "Georgia", serif',
    georgia: '"Georgia", "Times New Roman", serif',
    athelas: '"Athelas", "Charter", "Georgia", serif',
    seravek: '"Seravek", "Avenir Next", sans-serif',
};

export class FocusModeService {
    private settings: FocusModeSettings;
    private observer: IntersectionObserver | null = null;
    private isActive: boolean = false;
    private styleElement: HTMLStyleElement | null = null;
    private onSettingsChange?: (settings: FocusModeSettings) => void;

    constructor(settings: Partial<FocusModeSettings> = {}) {
        this.settings = { ...DEFAULT_FOCUS_SETTINGS, ...settings };
    }

    /**
     * 设置回调函数
     */
    setOnSettingsChange(callback: (settings: FocusModeSettings) => void): void {
        this.onSettingsChange = callback;
    }

    /**
     * 获取当前设置
     */
    getSettings(): FocusModeSettings {
        return { ...this.settings };
    }

    /**
     * 更新设置
     */
    updateSettings(updates: Partial<FocusModeSettings>): void {
        this.settings = { ...this.settings, ...updates };

        // 如果更新了非 enabled 的设置，且当前已激活，则应用样式
        if (this.isActive) {
            this.applyFontStyles();
        }

        this.onSettingsChange?.(this.settings);
        serviceLog('[FocusMode] Settings updated:', updates);
    }

    /**
     * 切换聚焦模式
     */
    toggle(): boolean {
        this.settings.enabled = !this.settings.enabled;
        if (this.settings.enabled) {
            this.activate();
        } else {
            this.deactivate();
        }
        this.onSettingsChange?.(this.settings);
        return this.settings.enabled;
    }

    /**
     * 启用聚焦模式
     */
    enable(): void {
        if (!this.settings.enabled) {
            this.settings.enabled = true;
            this.activate();
            this.onSettingsChange?.(this.settings);
        }
    }

    /**
     * 禁用聚焦模式
     */
    disable(): void {
        if (this.settings.enabled) {
            this.settings.enabled = false;
            this.deactivate();
            this.onSettingsChange?.(this.settings);
        }
    }

    /**
     * 激活聚焦模式（内部方法）
     */
    private activate(): void {
        if (this.isActive) return;

        // 添加 body 类
        document.body.classList.add('deeppdf-focus-mode');
        this.isActive = true;

        // 注入字体样式
        this.injectStyles();
        this.applyFontStyles();

        // 设置 IntersectionObserver
        this.setupObserver();

        serviceLog('[FocusMode] Activated');
    }

    /**
     * 停用聚焦模式（内部方法）
     */
    private deactivate(): void {
        if (!this.isActive) return;

        // 移除 body 类
        document.body.classList.remove('deeppdf-focus-mode');
        this.isActive = false;

        // 移除所有聚焦类
        this.clearAllFocusClasses();

        // 断开 observer
        this.disconnectObserver();

        // 移除样式
        this.removeStyles();

        serviceLog('[FocusMode] Deactivated');
    }

    /**
     * 注入样式元素
     */
    private injectStyles(): void {
        if (this.styleElement) return;

        this.styleElement = document.createElement('style');
        this.styleElement.id = 'deeppdf-focus-mode-styles';
        document.head.appendChild(this.styleElement);
    }

    /**
     * 应用字体样式
     */
    private applyFontStyles(): void {
        if (!this.styleElement) return;

        const fontFamily = FONT_FAMILIES[this.settings.fontFamily];
        this.styleElement.textContent = `
            .deeppdf-reading-mode.deeppdf-focus-mode {
                --deeppdf-unfocused-level: ${this.settings.unfocusedLevel};
                --deeppdf-focus-font: ${fontFamily};
                --deeppdf-focus-font-size: ${this.settings.fontSize}px;
                --deeppdf-focus-line-height: ${this.settings.lineHeight};
            }
        `;
    }

    /**
     * 移除样式元素
     */
    private removeStyles(): void {
        if (this.styleElement) {
            this.styleElement.remove();
            this.styleElement = null;
        }
    }

    /**
     * 设置 IntersectionObserver
     */
    private setupObserver(): void {
        if (this.observer) {
            this.disconnectObserver();
        }

        const options: IntersectionObserverInit = {
            root: null,
            rootMargin: '-10% 0px -10% 0px', // 视口上下各留 10% 边距
            threshold: 0.1, // 10% 可见时触发
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('deeppdf-in-view');
                } else {
                    entry.target.classList.remove('deeppdf-in-view');
                }
            });
        }, options);

        // 观察所有段落
        this.observeElements();
    }

    /**
     * 观察阅读视图中的段落元素
     */
    private observeElements(): void {
        const previewView = document.querySelector('.deeppdf-reading-mode .markdown-preview-view');
        if (!previewView) {
            serviceLog('[FocusMode] Preview view not found');
            return;
        }

        // 只选择直接子元素中的段落，避免影响消息列表等
        const elements = previewView.querySelectorAll(':scope > div > p, :scope > div > li, :scope > div > blockquote');
        elements.forEach(el => {
            this.observer?.observe(el);
        });
        serviceLog('[FocusMode] Observing', elements.length, 'elements');
    }

    /**
     * 清除所有聚焦类
     */
    private clearAllFocusClasses(): void {
        const elements = document.querySelectorAll('.deeppdf-in-view');
        elements.forEach(el => {
            el.classList.remove('deeppdf-in-view');
        });
    }

    /**
     * 断开 IntersectionObserver
     */
    private disconnectObserver(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    /**
     * 刷新观察（当内容变化时调用）
     */
    refresh(): void {
        if (!this.isActive) return;

        this.clearAllFocusClasses();
        this.disconnectObserver();
        this.setupObserver();
        serviceLog('[FocusMode] Refreshed observer');
    }

    /**
     * 检查是否应该自动启用
     */
    shouldAutoEnable(): boolean {
        return this.settings.autoEnable;
    }

    /**
     * 销毁服务
     */
    destroy(): void {
        this.deactivate();
        serviceLog('[FocusMode] Destroyed');
    }
}
```

**Step 2: 验证 TypeScript 编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功，无类型错误

**Step 3: Commit**

```bash
git add frontend/src/services/focus-mode-service.ts
git commit -m "feat(reading-mode): add FocusModeService with IntersectionObserver"
```

---

## Task 3: 集成 FocusModeService 到 ReadingModeService

**Files:**
- Modify: `frontend/src/services/reading-mode-service.ts`

**Step 1: 导入并初始化 FocusModeService**

在文件顶部的导入区域（约第 1-9 行）添加：

```typescript
import { FocusModeService, FocusModeSettings, DEFAULT_FOCUS_SETTINGS, FocusFontFamily } from './focus-mode-service.js';
```

在 `ReadingModeService` 类的属性区域（约第 27-35 行）添加：

```typescript
    private chapterNav: ChapterNav | null = null;
    private callbacks: ReadingModeCallbacks | null = null;
    private focusModeService: FocusModeService | null = null;  // 新增
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;  // 新增（为 Task 7 准备）
```

修改 `constructor` 方法（约第 36-39 行）：

```typescript
    constructor(app: App, callbacks?: ReadingModeCallbacks) {
        this.app = app;
        this.callbacks = callbacks || null;
        this.focusModeService = new FocusModeService();
    }
```

**Step 2: 添加聚焦模式公共方法**

在 `ReadingModeService` 类中，在 `setCallbacks` 方法后（约第 51 行后）添加：

```typescript
    /**
     * 获取聚焦模式服务
     */
    getFocusModeService(): FocusModeService | null {
        return this.focusModeService;
    }

    /**
     * 切换聚焦模式
     * @returns 切换后的状态
     */
    toggleFocusMode(): boolean {
        if (!this.focusModeService) return false;
        const enabled = this.focusModeService.toggle();
        return enabled;
    }

    /**
     * 更新聚焦模式设置
     */
    updateFocusModeSettings(settings: Partial<FocusModeSettings>): void {
        if (!this.focusModeService) return;
        this.focusModeService.updateSettings(settings);
    }

    /**
     * 获取聚焦模式设置
     */
    getFocusModeSettings(): FocusModeSettings {
        return this.focusModeService?.getSettings() || DEFAULT_FOCUS_SETTINGS;
    }
```

**Step 3: 在 activate 方法中自动启用聚焦模式**

找到 `activate` 方法（约第 95-122 行），在 `this.notifyBookDetected(file);` 之后添加：

```typescript
    activate(file: TFile): void {
        // ... 现有代码 ...

        // 通知书籍检测回调
        this.notifyBookDetected(file);

        // 自动启用聚焦模式（如果设置了 autoEnable）
        if (this.focusModeService?.shouldAutoEnable()) {
            this.focusModeService.enable();
        }

        // 刷新聚焦模式观察（延迟执行，等待内容渲染）
        setTimeout(() => {
            this.focusModeService?.refresh();
        }, 200);

        serviceLog('[ReadingMode] Activated for:', file.path);
    }
```

**Step 4: 修改 deactivate 方法**

修改 `deactivate` 方法（约第 164-172 行）：

```typescript
    deactivate(): void {
        if (!this.isActive) return;

        // 停用聚焦模式（但不改变 enabled 设置，下次激活时恢复）
        if (this.focusModeService) {
            this.focusModeService.deactivate();
        }

        document.body.classList.remove('deeppdf-reading-mode');
        this.chapterNav?.hide();
        this.isActive = false;
        this.currentFile = null;
        serviceLog('[ReadingMode] Deactivated');
    }
```

**Step 5: 修改 stop 方法**

修改 `stop` 方法（约第 221-235 行）：

```typescript
    stop(): void {
        this.deactivate();
        this.removeKeydownHandler();  // Task 7 添加
        if (this.fileOpenHandler) {
            this.app.workspace.offref(this.fileOpenHandler);
            this.fileOpenHandler = null;
        }
        if (this.selectionToolbar) {
            this.selectionToolbar.destroy();
            this.selectionToolbar = null;
        }
        if (this.chapterNav) {
            this.chapterNav.destroy();
            this.chapterNav = null;
        }
        if (this.focusModeService) {
            this.focusModeService.destroy();
            this.focusModeService = null;
        }
    }
```

**Step 6: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 7: Commit**

```bash
git add frontend/src/services/reading-mode-service.ts
git commit -m "feat(reading-mode): integrate FocusModeService with auto-enable support"
```

---

## Task 4: 添加设置持久化

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 在 DeepPDFSettings 接口中添加聚焦模式设置**

在 `DeepPDFSettings` 接口中（约第 17-32 行），在 `lastDeepSearchMode` 后添加：

```typescript
    lastDeepSearchMode: boolean;  // 上次是否启用深度思考模式
    // 聚焦模式设置
    focusModeEnabled: boolean;      // 聚焦模式是否启用
    focusModeAutoEnable: boolean;   // 打开章节时自动启用聚焦模式
    focusModeUnfocusedLevel: number;
    focusModeFontFamily: string;
    focusModeFontSize: number;
    focusModeLineHeight: number;
}
```

**Step 2: 在 DEFAULT_SETTINGS 中添加默认值**

在 `DEFAULT_SETTINGS` 对象中（约第 34-51 行），在 `lastDeepSearchMode` 后添加：

```typescript
    lastDeepSearchMode: false,
    // 聚焦模式默认值
    focusModeEnabled: false,
    focusModeAutoEnable: false,  // 默认不自动启用
    focusModeUnfocusedLevel: 0.2,
    focusModeFontFamily: 'iowan',
    focusModeFontSize: 18,
    focusModeLineHeight: 1.9,
};
```

**Step 3: 在 ReadingModeService 初始化时应用设置**

找到 `readingModeService` 初始化部分（约第 204-228 行），修改为：

```typescript
        // 初始化阅读模式服务
        const readingModeCallbacks: ReadingModeCallbacks = {
            onQuote: (text: string) => {
                this.activateView();
                setTimeout(() => {
                    this.app.workspace.trigger('deeppdf:quote-selection', text);
                }, 100);
            },
            onExcerpt: (text: string) => {
                this.app.workspace.trigger('deeppdf:excerpt-selection', text);
            },
            onSaveHighlight: async (text: string, color: HighlightColorId) => {
                await this.saveHighlightToFile(text, color);
            },
            onRemoveHighlight: async (text: string) => {
                await this.removeHighlightFromFile(text);
            },
            onBookDetected: (indexId: string, bookName: string) => {
                this.switchToBook(indexId, bookName);
            },
        };

        this.readingModeService = new ReadingModeService(this.app, readingModeCallbacks);

        // 应用聚焦模式设置
        const focusService = this.readingModeService.getFocusModeService();
        if (focusService) {
            focusService.updateSettings({
                enabled: this.settings.focusModeEnabled,
                autoEnable: this.settings.focusModeAutoEnable,
                unfocusedLevel: this.settings.focusModeUnfocusedLevel,
                fontFamily: this.settings.focusModeFontFamily as FocusFontFamily,
                fontSize: this.settings.focusModeFontSize,
                lineHeight: this.settings.focusModeLineHeight,
            });

            // 设置设置变更回调
            focusService.setOnSettingsChange((settings) => {
                this.settings.focusModeEnabled = settings.enabled;
                this.settings.focusModeAutoEnable = settings.autoEnable;
                this.settings.focusModeUnfocusedLevel = settings.unfocusedLevel;
                this.settings.focusModeFontFamily = settings.fontFamily;
                this.settings.focusModeFontSize = settings.fontSize;
                this.settings.focusModeLineHeight = settings.lineHeight;
                this.saveSettings();
            });
        }

        this.readingModeService.start();
        serviceLog('[DeepPDF] Reading mode service started');
```

**Step 4: 在文件顶部添加类型导入**

在 `import` 区域添加：

```typescript
import type { FocusFontFamily } from './services/focus-mode-service.js';
```

**Step 5: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 6: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat(reading-mode): persist focus mode settings with auto-enable option"
```

---

## Task 5: 在阅读顶栏添加聚焦模式按钮

**Files:**
- Modify: `frontend/src/components/reading-topbar/reading-topbar.ts`
- Modify: `frontend/src/components/reading-topbar/reading-topbar.css`

**Step 1: 更新 ReadingTopbarOptions 接口**

在 `reading-topbar.ts` 中的 `ReadingTopbarOptions` 接口（约第 10-14 行）添加：

```typescript
export interface ReadingTopbarOptions {
    onOpenLibrary?: () => void;
    onNewChat?: () => void;
    onOpenSettings?: () => void;
    onToggleFocusMode?: () => void;  // 新增
}
```

**Step 2: 添加聚焦模式按钮属性**

在 `ReadingTopbar` 类的属性区域（约第 17-24 行）添加：

```typescript
    private dropdownMenu: HTMLElement | null = null;
    private isDropdownOpen: boolean = false;
    private focusModeBtn: HTMLElement | null = null;  // 新增
    private isFocusModeEnabled: boolean = false;      // 新增
    private handleGlobalClick: (e: MouseEvent) => void;
```

**Step 3: 在 render 方法中添加聚焦模式按钮**

在 `render` 方法中，找到 `rightSection.appendChild(actionBtn);` 之前（约第 119 行），添加：

```typescript
        // 聚焦模式按钮
        this.focusModeBtn = document.createElement('button');
        this.focusModeBtn.className = 'deeppdf-focus-mode-btn';
        this.focusModeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v2m0 16v2M2 12h2m16 0h2"></path></svg>`;
        this.focusModeBtn.title = '聚焦模式';
        this.focusModeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.options.onToggleFocusMode?.();
        });
        rightSection.insertBefore(this.focusModeBtn, actionBtn);
```

**Step 4: 添加设置聚焦模式状态的方法**

在 `ReadingTopbar` 类中，在 `setConnectionStatus` 方法后添加：

```typescript
    /**
     * 设置聚焦模式状态
     */
    setFocusMode(enabled: boolean): void {
        this.isFocusModeEnabled = enabled;
        if (this.focusModeBtn) {
            if (enabled) {
                this.focusModeBtn.classList.add('active');
                this.focusModeBtn.title = '聚焦模式 (已启用)';
            } else {
                this.focusModeBtn.classList.remove('active');
                this.focusModeBtn.title = '聚焦模式';
            }
        }
    }
```

**Step 5: 在 destroy 方法中清理**

修改 `destroy` 方法，添加 `focusModeBtn` 清理：

```typescript
    destroy(): void {
        if (this.handleGlobalClick) {
            document.removeEventListener('click', this.handleGlobalClick);
        }
        this.bookCoverEl = null;
        this.bookTitleEl = null;
        this.bookAuthorEl = null;
        this.statusDot = null;
        this.dropdownMenu = null;
        this.focusModeBtn = null;  // 新增
        super.destroy();
    }
```

**Step 6: 添加按钮 CSS 样式**

在 `reading-topbar.css` 文件末尾添加：

```css
/* 聚焦模式按钮 */
.deeppdf-focus-mode-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
}

.deeppdf-focus-mode-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
}

.deeppdf-focus-mode-btn.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
}

.deeppdf-focus-mode-btn.active:hover {
    background: var(--interactive-accent-hover);
}

.deeppdf-focus-mode-btn svg {
    width: 14px;
    height: 14px;
}
```

**Step 7: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 8: Commit**

```bash
git add frontend/src/components/reading-topbar/reading-topbar.ts frontend/src/components/reading-topbar/reading-topbar.css
git commit -m "feat(reading-topbar): add focus mode toggle button"
```

---

## Task 6: 连接顶栏按钮与聚焦模式服务

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 在 SidebarView 中添加 onToggleFocusMode 回调**

找到 `createReadingTopbar` 方法中的 `new ReadingTopbar` 调用（约第 628 行），添加 `onToggleFocusMode` 回调：

```typescript
    private createReadingTopbar(container: HTMLElement) {
        this.readingTopbar = new ReadingTopbar({
            onOpenLibrary: () => this.openLibraryModal(),
            onNewChat: () => this.handleNewChat(),
            onOpenSettings: () => {
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById('deeppdf');
                }
            },
            onToggleFocusMode: () => this.toggleFocusMode(),  // 新增
        });
        container.appendChild(this.readingTopbar.getElement());
    }
```

**Step 2: 添加 toggleFocusMode 方法**

在 `SidebarView` 类中添加方法（建议放在 `handleNewChat` 方法附近）：

```typescript
    /**
     * 切换聚焦模式
     */
    private toggleFocusMode(): void {
        if (!this.plugin?.readingModeService) return;

        const focusService = this.plugin.readingModeService.getFocusModeService();
        if (!focusService) return;

        const enabled = focusService.toggle();
        this.readingTopbar?.setFocusMode(enabled);
    }
```

**Step 3: 在设置书籍信息时同步聚焦模式状态**

找到设置书籍信息的方法（如 `updateBookInfo` 或类似），在末尾添加聚焦模式状态同步：

```typescript
    // 在设置书籍信息后，同步聚焦模式状态
    const focusService = this.plugin?.readingModeService?.getFocusModeService();
    if (focusService) {
        const settings = focusService.getSettings();
        this.readingTopbar?.setFocusMode(settings.enabled);
    }
```

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 5: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(sidebar): connect focus mode button to service"
```

---

## Task 7: 添加快捷键支持

**Files:**
- Modify: `frontend/src/services/reading-mode-service.ts`
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 在 ReadingModeService 中添加键盘事件监听**

在 `ReadingModeService` 类中添加键盘事件监听方法：

```typescript
    /**
     * 设置键盘快捷键监听
     */
    private setupKeydownHandler(): void {
        if (this.keydownHandler) return;

        this.keydownHandler = (e: KeyboardEvent) => {
            // 只在阅读模式激活时响应
            if (!this.isActive) return;

            // 按 f 键切换聚焦模式
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // 检查是否在输入框中
                const activeEl = document.activeElement;
                if (activeEl && (
                    activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'TEXTAREA' ||
                    activeEl.getAttribute('contenteditable') === 'true'
                )) {
                    return;
                }

                e.preventDefault();
                const enabled = this.toggleFocusMode();

                // 通过事件通知 UI 更新
                document.body.dispatchEvent(new CustomEvent('deeppdf:focus-mode-change', {
                    detail: { enabled }
                }));
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    /**
     * 移除键盘快捷键监听
     */
    private removeKeydownHandler(): void {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
    }
```

**Step 2: 在 start 方法中调用键盘监听**

修改 `start` 方法，在 `this.initChapterNav();` 后添加：

```typescript
    start(): void {
        serviceLog('[DeepPDF] ReadingMode service starting...');

        // 初始化悬浮工具栏
        if (this.callbacks) {
            this.initSelectionToolbar();
        }

        // 初始化章节导航
        this.initChapterNav();

        // 初始化键盘快捷键
        this.setupKeydownHandler();

        this.fileOpenHandler = this.app.workspace.on('file-open', (file) => {
            // ... 其余代码不变
        });
        // ...
    }
```

**Step 3: 在 SidebarView 中监听事件更新 UI**

在 `SidebarView` 类中添加属性（用于正确移除事件监听器）：

```typescript
    private boundHandleFocusModeChange: ((e: Event) => void) | null = null;
```

添加事件监听设置和清理方法：

```typescript
    /**
     * 设置聚焦模式变化监听
     */
    private setupFocusModeListener(): void {
        this.boundHandleFocusModeChange = this.handleFocusModeChange.bind(this);
        document.body.addEventListener('deeppdf:focus-mode-change', this.boundHandleFocusModeChange);
    }

    /**
     * 处理聚焦模式变化事件
     */
    private handleFocusModeChange(e: Event): void {
        const customEvent = e as CustomEvent<{ enabled: boolean }>;
        const { enabled } = customEvent.detail;
        this.readingTopbar?.setFocusMode(enabled);
    }

    /**
     * 移除聚焦模式变化监听
     */
    private removeFocusModeListener(): void {
        if (this.boundHandleFocusModeChange) {
            document.body.removeEventListener('deeppdf:focus-mode-change', this.boundHandleFocusModeChange);
            this.boundHandleFocusModeChange = null;
        }
    }
```

在 `SidebarView` 的初始化方法中调用 `setupFocusModeListener()`，在销毁方法中调用 `removeFocusModeListener()`。

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 5: Commit**

```bash
git add frontend/src/services/reading-mode-service.ts frontend/src/views/sidebar-view.ts
git commit -m "feat(reading-mode): add keyboard shortcut 'f' for focus mode toggle"
```

---

## Task 8: 添加设置面板配置项

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 在设置面板中添加聚焦模式配置**

在 `DeepPDFSettingTab` 的 `display` 方法中，找到 "启用调试日志" 设置之后（约第 1038 行），添加：

```typescript
        new Setting(containerEl)
            .setName("启用调试日志")
            .setDesc("开启后会在控制台输出详细运行日志，用于问题排查。默认关闭以减少日志噪音。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugLog)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugLog = value;
                    await this.plugin.saveSettings();
                }));

        // 聚焦模式设置区域
        containerEl.createEl('h2', { text: '阅读聚焦模式' });

        new Setting(containerEl)
            .setName("自动启用聚焦模式")
            .setDesc("打开章节时自动启用聚焦模式")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.focusModeAutoEnable)
                .onChange(async (value) => {
                    this.plugin.settings.focusModeAutoEnable = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.updateFocusModeSettings({ autoEnable: value });
                }));

        new Setting(containerEl)
            .setName("启用聚焦模式")
            .setDesc("手动切换聚焦模式（也可按 f 键快速切换）")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.focusModeEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.focusModeEnabled = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.updateFocusModeSettings({ enabled: value });
                }));

        new Setting(containerEl)
            .setName("淡化程度")
            .setDesc("非聚焦内容的透明度（0.1 = 最淡，0.5 = 较清晰）")
            .addSlider(slider => slider
                .setLimits(0.1, 0.5, 0.05)
                .setValue(this.plugin.settings.focusModeUnfocusedLevel)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.focusModeUnfocusedLevel = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.updateFocusModeSettings({ unfocusedLevel: value });
                }));

        new Setting(containerEl)
            .setName("聚焦字体")
            .setDesc("选择聚焦段落的显示字体")
            .addDropdown(dropdown => dropdown
                .addOption("iowan", "Iowan Old Style（推荐）")
                .addOption("charter", "Charter")
                .addOption("georgia", "Georgia")
                .addOption("athelas", "Athelas")
                .addOption("seravek", "Seravek（无衬线）")
                .setValue(this.plugin.settings.focusModeFontFamily)
                .onChange(async (value) => {
                    this.plugin.settings.focusModeFontFamily = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.updateFocusModeSettings({ fontFamily: value as FocusFontFamily });
                }));

        new Setting(containerEl)
            .setName("聚焦字号")
            .setDesc("聚焦段落的字体大小（像素）")
            .addSlider(slider => slider
                .setLimits(14, 24, 1)
                .setValue(this.plugin.settings.focusModeFontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.focusModeFontSize = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.updateFocusModeSettings({ fontSize: value });
                }));

        new Setting(containerEl)
            .setName("聚焦行高")
            .setDesc("聚焦段落的行高（1.5 = 紧凑，2.4 = 宽松）")
            .addSlider(slider => slider
                .setLimits(1.5, 2.4, 0.1)
                .setValue(this.plugin.settings.focusModeLineHeight)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.focusModeLineHeight = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.updateFocusModeSettings({ lineHeight: value });
                }));
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat(settings): add focus mode configuration panel with auto-enable option"
```

---

## Task 9: 手动测试

**Step 1: 启动开发环境**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run dev`

**Step 2: 在 Obsidian 中测试**

1. 重新加载 Obsidian 插件（Cmd+R）
2. 打开设置 → DeepPDF → 阅读聚焦模式
3. 启用"自动启用聚焦模式"
4. 打开一个 DeepReader 章节文件（如 `DeepReader/书名/01-章节.md`）
5. 验证：
   - 聚焦模式自动启用
   - 视口内的段落高亮显示，使用 Apple Books 风格字体
   - 视口外的段落淡化
   - 滚动时聚焦效果随视口移动
6. 按 `f` 键测试快捷键切换
7. 点击顶栏聚焦按钮测试切换
8. 测试设置面板各项配置：
   - 自动启用开关
   - 淡化程度
   - 字体选择
   - 字号调整
   - 行高调整

**Step 3: 记录测试结果**

如发现问题，创建对应的修复任务。

---

## 完成确认

完成所有任务后，运行完整构建和测试：

```bash
cd /Users/lizhao/workspace/DeepReader/frontend && npm run build && npm run test:run
```

Expected: 所有构建和测试通过
