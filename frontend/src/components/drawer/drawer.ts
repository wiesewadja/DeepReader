/**
 * DeepPDF 抽屉面板组件
 * 支持从左侧或右侧滑入/滑出的动画效果
 */

import { Component } from "../component.js";

export interface DrawerOptions {
    position: "left" | "right";
    width: string;
    overlay: boolean;
}

export class Drawer extends Component {
    private isOpen: boolean = false;
    private overlayEl: HTMLElement | null = null;
    private contentEl: HTMLElement | null = null;

    constructor(private options: DrawerOptions) {
        super();
    }

    render(): HTMLElement {
        // 遮罩层
        this.overlayEl = document.createElement("div");
        this.overlayEl.addClass("deeppdf-drawer-overlay");

        // 点击遮罩层关闭抽屉
        if (this.options.overlay) {
            this.overlayEl.onclick = () => this.close();
        } else {
            this.overlayEl.style.pointerEvents = "none";
        }

        // 抽屉内容
        this.contentEl = document.createElement("div");
        this.contentEl.addClass("deeppdf-drawer");
        this.contentEl.addClass(`deeppdf-drawer-${this.options.position}`);
        this.contentEl.style.width = this.options.width;

        const container = document.createElement("div");
        container.addClass("deeppdf-drawer-container");
        container.appendChild(this.overlayEl);
        container.appendChild(this.contentEl);

        this.el = container;
        return this.el;
    }

    /**
     * 打开抽屉
     */
    open(): void {
        this.isOpen = true;
        this.overlayEl?.addClass("deeppdf-drawer-overlay-open");
        this.contentEl?.addClass("deeppdf-drawer-open");
    }

    /**
     * 关闭抽屉
     */
    close(): void {
        this.isOpen = false;
        this.overlayEl?.removeClass("deeppdf-drawer-overlay-open");
        this.contentEl?.removeClass("deeppdf-drawer-open");
    }

    /**
     * 切换抽屉状态
     */
    toggle(): void {
        this.isOpen ? this.close() : this.open();
    }

    /**
     * 检查抽屉是否打开
     */
    isDrawerOpen(): boolean {
        return this.isOpen;
    }

    /**
     * 设置抽屉内容
     */
    setContent(content: HTMLElement | string): void {
        if (!this.contentEl) return;
        this.contentEl.empty();
        if (typeof content === "string") {
            this.contentEl.innerHTML = content;
        } else {
            this.contentEl.appendChild(content);
        }
    }

    /**
     * 获取内容容器元素
     */
    getContentEl(): HTMLElement | null {
        return this.contentEl;
    }

    /**
     * 获取遮罩层元素
     */
    getOverlayEl(): HTMLElement | null {
        return this.overlayEl;
    }
}
