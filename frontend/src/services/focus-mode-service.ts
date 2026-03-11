/**
 * 聚焦模式服务（简化版）
 * 使用纯 CSS :hover 实现聚焦效果，无需 IntersectionObserver
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
    unfocusedLevel: 0.25,
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

        // 注入动态样式（字体配置）
        this.injectStyles();
        this.applyFontStyles();

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
     * 应用字体样式（动态配置）
     */
    private applyFontStyles(): void {
        if (!this.styleElement) return;

        const fontFamily = FONT_FAMILIES[this.settings.fontFamily];
        this.styleElement.textContent = `
            body.deeppdf-reading-mode.deeppdf-focus-mode {
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
     * 刷新（当内容变化时调用）- 简化版无需操作
     */
    refresh(): void {
        // 使用 CSS :hover 实现，无需刷新
        serviceLog('[FocusMode] Refresh (no-op for CSS-based implementation)');
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
