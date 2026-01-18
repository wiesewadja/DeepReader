/**
 * DeepPDF 侧边栏视图
 * 现代化设计 - SVG 图标、卡片布局、平滑动画
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { IndexManagerModal } from "../ui/index-manager-modal.js";
import { DeepPDFClient, QueryPDFResult, ListIndexesResult } from "../api/http-client.js";
import { Drawer } from "../components/drawer/drawer.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

// ==================== SVG 图标系统 ====================
const Icons = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    database: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s 9-1.34 9-3V5"/></svg>`,
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
};

export class SidebarView extends ItemView {
    private submitHandler: () => void;
    private keyPressHandler: (e: KeyboardEvent) => void;
    private apiClient: DeepPDFClient | null;
    private indexSelectHandler: () => void;
    private indexSelect: HTMLSelectElement | null = null;
    private statusEl: HTMLElement | null = null;
    private drawer: Drawer | null = null;

    constructor(leaf: WorkspaceLeaf, apiClient: DeepPDFClient | null) {
        super(leaf);
        this.apiClient = apiClient;
        this.submitHandler = () => {};
        this.keyPressHandler = () => {};
        this.indexSelectHandler = () => {};
    }

    getViewType() {
        return SIDEBAR_VIEW_TYPE;
    }

    getDisplayText() {
        return "DeepPDF";
    }

    getIcon() {
        return Icons.database;
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("deeppdf-container");

        // 创建头部
        this.createHeader(container);

        // 创建查询区域
        this.createQuerySection(container);

        // 创建结果区域
        this.createResultsSection(container);

        // 加载索引列表
        await this.loadIndexes();

        // 更新服务器状态
        this.updateStatus();
    }

    private createHeader(container: HTMLElement) {
        const header = container.createEl("header", { cls: "deeppdf-header" });

        // 左侧：Logo 和标题
        const headerLeft = header.createDiv({ cls: "deeppdf-header-left" }) as HTMLElement;

        const logo = headerLeft.createDiv({ cls: "deeppdf-logo" }) as HTMLElement;
        logo.innerHTML = Icons.database;

        headerLeft.createEl("h2", { text: "DeepPDF" });

        // 右侧：状态和操作
        const headerRight = header.createDiv({ cls: "deeppdf-header-right" }) as HTMLElement;

        // 服务器状态指示器
        this.statusEl = headerRight.createDiv({ cls: "deeppdf-status deeppdf-status-loading" });
        this.statusEl.innerHTML = `<span></span> 检查中...`;

        // 管理索引按钮
        const manageBtn = headerRight.createEl("button", {
            cls: "deeppdf-btn deeppdf-manage-btn"
        });
        manageBtn.innerHTML = `${Icons.settings} 管理索引`;
        manageBtn.addEventListener("click", () => {
            this.openIndexDrawer();
        });

        // 创建抽屉面板
        this.drawer = new Drawer({
            position: "right",
            width: "400px",
            overlay: true
        });
        this.containerEl.appendChild(this.drawer.render());
    }

    private createQuerySection(container: HTMLElement) {
        const querySection = container.createDiv({ cls: "deeppdf-query-section" });

        // 索引选择器
        const indexSelectRow = querySection.createDiv({ cls: "deeppdf-index-select-row" });
        indexSelectRow.createEl("label", {
            text: "选择索引:",
            cls: "deeppdf-index-label"
        });

        this.indexSelect = indexSelectRow.createEl("select", {
            cls: "deeppdf-index-select"
        }) as HTMLSelectElement;
        this.indexSelect.add(new Option("加载中...", ""));

        // 查询输入框
        const input = querySection.createEl("input", {
            type: "text",
            cls: "deeppdf-query-input",
            placeholder: "输入问题开始查询..."
        });

        // 提交按钮
        const submitBtn = querySection.createEl("button", {
            cls: "deeppdf-btn deeppdf-submit-btn"
        });
        submitBtn.innerHTML = `${Icons.search} 提问`;

        // 保存事件监听器引用
        this.submitHandler = () => this.handleSubmit(input.value, this.indexSelect?.value || "");
        this.keyPressHandler = (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                this.handleSubmit(input.value, this.indexSelect?.value || "");
            }
        };
        this.indexSelectHandler = () => {
            console.log(`[DeepPDF] 选中的索引: ${this.indexSelect?.value}`);
        };

        // 添加事件监听
        submitBtn.addEventListener("click", this.submitHandler);
        input.addEventListener("keypress", this.keyPressHandler);
        this.indexSelect?.addEventListener("change", this.indexSelectHandler);
    }

    private createResultsSection(container: HTMLElement) {
        const resultsSection = container.createDiv({ cls: "deeppdf-results-section" });

        const emptyState = resultsSection.createDiv({ cls: "deeppdf-empty-state" });
        emptyState.innerHTML = `
            <div style="color: var(--deeppdf-text-muted); opacity: 0.5;">
                ${Icons.search}
            </div>
            <div class="deeppdf-empty-text">输入问题开始查询</div>
            <div class="deeppdf-empty-hint">选择索引后输入问题即可搜索</div>
        `;
    }

    async updateStatus(): Promise<void> {
        if (!this.statusEl) return;

        this.statusEl.className = "deeppdf-status deeppdf-status-loading";
        this.statusEl.innerHTML = `<span></span> 检查中...`;

        if (!this.apiClient) {
            this.statusEl.className = "deeppdf-status deeppdf-status-warning";
            this.statusEl.innerHTML = `<span></span> 未连接`;
            return;
        }

        try {
            const isHealthy = await this.apiClient.healthCheck();
            if (isHealthy) {
                this.statusEl.className = "deeppdf-status deeppdf-status-ok";
                this.statusEl.innerHTML = `<span></span> 已连接`;
            } else {
                this.statusEl.className = "deeppdf-status deeppdf-status-warning";
                this.statusEl.innerHTML = `<span></span> 未连接`;
            }
        } catch (error) {
            this.statusEl.className = "deeppdf-status deeppdf-status-error";
            this.statusEl.innerHTML = `<span></span> 连接失败`;
        }
    }

    openIndexManager() {
        if (!this.apiClient) {
            this.showError("API 客户端未连接");
            return;
        }
        new IndexManagerModal(this.app, this.apiClient, () => this.refreshIndexes()).open();
    }

    private openIndexDrawer() {
        if (!this.drawer) return;

        // 设置抽屉内容
        const drawerContent = this.createIndexManagerContent();
        this.drawer.setContent(drawerContent);
        this.drawer.open();
    }

    private createIndexManagerContent(): HTMLElement {
        const container = document.createElement("div");
        container.addClass("deeppdf-index-manager");

        // 头部
        const header = container.createEl("header");
        header.innerHTML = `
            <div class="deeppdf-drawer-header">
                <h2>索引管理</h2>
                <button class="deeppdf-drawer-close" aria-label="关闭">✕</button>
            </div>
        `;

        // 关闭按钮事件
        const closeBtn = header.querySelector(".deeppdf-drawer-close");
        closeBtn?.addEventListener("click", () => {
            this.drawer?.close();
        });

        // 操作按钮区
        const actions = container.createEl("div", { cls: "deeppdf-drawer-actions" });
        actions.innerHTML = `
            <button class="deeppdf-btn deeppdf-btn-primary">+ 新建索引</button>
            <button class="deeppdf-btn deeppdf-btn-secondary">刷新</button>
        `;

        // 索引列表容器
        const listContainer = container.createEl("div", { cls: "deeppdf-index-list" });
        listContainer.innerHTML = "<p>加载中...</p>";

        // 加载索引列表
        this.loadIndexesIntoDrawer(listContainer);

        return container;
    }

    private async loadIndexesIntoDrawer(container: HTMLElement) {
        if (!this.apiClient) {
            container.innerHTML = "<p>未连接到服务器</p>";
            return;
        }

        try {
            const result = await this.apiClient.listIndexes();
            container.empty();

            if (!result.indexes || result.indexes.length === 0) {
                container.innerHTML = "<p>暂无索引</p>";
                return;
            }

            result.indexes.forEach((index: any) => {
                const card = container.createEl("div", { cls: "deeppdf-index-card" });
                card.innerHTML = `
                    <div class="deeppdf-index-card-info">
                        <span class="deeppdf-index-card-name"> ${index.pdf_name}</span>
                        <span class="deeppdf-index-card-meta">${index.node_count} 节点</span>
                    </div>
                    <button class="deeppdf-btn deeppdf-btn-sm deeppdf-btn-danger">删除</button>
                `;
            });
        } catch (error) {
            container.innerHTML = `<p>加载失败: ${error}</p>`;
        }
    }

    async refreshIndexes(): Promise<void> {
        if (this.indexSelect) {
            await this.loadIndexes();
        }
    }

    async handleSubmit(query: string, selectedIndexId: string) {
        if (!query.trim()) {
            return;
        }

        if (!this.apiClient) {
            this.showError("API 客户端未连接");
            return;
        }

        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        if (!resultsSection) return;

        // 显示加载状态
        resultsSection.innerHTML = `
            <div class="deeppdf-loading">
                <div class="deeppdf-spinner"></div>
                <span>搜索中...</span>
            </div>
        `;

        try {
            // 检查是否选择了索引
            if (!selectedIndexId) {
                resultsSection.innerHTML = `
                    <div class="deeppdf-error">
                        <span>${Icons.warning}</span>
                        <span>请先选择一个索引。如果没有可用索引，请使用"管理索引"创建 PDF 索引。</span>
                    </div>
                `;
                return;
            }

            const result = await this.apiClient.queryPDF(query, selectedIndexId);
            this.displayQueryResult(result, query, resultsSection);
        } catch (error) {
            resultsSection.innerHTML = `
                <div class="deeppdf-error">
                    <span>${Icons.x}</span>
                    <span>查询失败: ${error}</span>
                </div>
            `;
        }
    }

    private async loadIndexes(): Promise<void> {
        if (!this.indexSelect) return;

        if (!this.apiClient) {
            this.indexSelect.innerHTML = '<option value="">未连接</option>';
            return;
        }

        try {
            const result: ListIndexesResult = await this.apiClient.listIndexes();
            this.indexSelect.innerHTML = '';

            if (!result || !Array.isArray(result.indexes) || result.indexes.length === 0) {
                this.indexSelect.add(new Option("暂无索引", ""));
                return;
            }

            result.indexes.forEach((index: any) => {
                const option = new Option(
                    `${index.pdf_name} (${index.node_count} 节点)`,
                    index.id
                );
                this.indexSelect?.add(option);
            });

            console.log(`[DeepPDF] 已加载 ${result.indexes.length} 个索引`);
        } catch (error) {
            console.error('[DeepPDF] 加载索引列表失败:', error);
            this.indexSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    private displayQueryResult(result: QueryPDFResult, query: string, resultsSection: Element): void {
        if (!result || result.status !== "success") {
            resultsSection.innerHTML = `
                <div class="deeppdf-error">
                    <span>${Icons.x}</span>
                    <span>查询失败: 未知错误</span>
                </div>
            `;
            return;
        }

        let resultsHtml = `
            <div class="deeppdf-query-summary">
                <strong>查询:</strong> ${this.escapeHtml(query)}
            </div>
        `;

        if (result.results && Array.isArray(result.results) && result.results.length > 0) {
            resultsHtml += `<div class="deeppdf-results-list">`;
            result.results.forEach((item: any, index: number) => {
                const pageNumber = item.metadata?.page || item.metadata?.start_index;
                const section = item.metadata?.section || "未知";

                resultsHtml += `
                    <div class="deeppdf-result-item" data-index="${index}">
                        <div class="deeppdf-result-header">
                            <span class="deeppdf-result-number">${Icons.file} 结果 ${index + 1}</span>
                            <button class="deeppdf-copy-btn" title="复制内容">
                                ${Icons.copy}
                            </button>
                        </div>
                        <p class="deeppdf-result-text">${this.escapeHtml(item.text || "无内容")}</p>
                        <div class="deeppdf-result-meta">
                            <span class="deeppdf-meta-label">章节:</span>
                            <span>${this.escapeHtml(section)}</span>
                            <span class="deeppdf-meta-separator">•</span>
                            <span class="deeppdf-meta-label">页码:</span>
                            <span>${pageNumber || "未知"}</span>
                        </div>
                    </div>
                `;
            });
            resultsHtml += `</div>`;

            resultsSection.innerHTML = resultsHtml;

            // 添加复制按钮事件
            resultsSection.querySelectorAll(".deeppdf-copy-btn").forEach((btn) => {
                btn.addEventListener("click", (e) => {
                    const card = (e.currentTarget as HTMLElement).closest(".deeppdf-result-item");
                    const text = card?.querySelector(".deeppdf-result-text")?.textContent || "";
                    this.copyToClipboard(text);
                });
            });
        } else {
            resultsSection.innerHTML = resultsHtml + `
                <div class="deeppdf-empty-state">
                    <div style="color: var(--deeppdf-text-muted); opacity: 0.5;">
                        ${Icons.file}
                    </div>
                    <div class="deeppdf-empty-text">未找到相关结果</div>
                    <div class="deeppdf-empty-hint">尝试使用不同的关键词重新搜索</div>
                </div>
            `;
        }
    }

    private copyToClipboard(text: string): void {
        navigator.clipboard.writeText(text).then(() => {
            new Notice("已复制到剪贴板");
        }).catch(() => {
            new Notice("复制失败");
        });
    }

    private showError(message: string) {
        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        if (resultsSection) {
            resultsSection.innerHTML = `
                <div class="deeppdf-error">
                    <span>${Icons.x}</span>
                    <span>${this.escapeHtml(message)}</span>
                </div>
            `;
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    async onClose() {
        // 清理事件监听器
        const submitBtn = this.containerEl.querySelector(".deeppdf-submit-btn");
        const input = this.containerEl.querySelector(".deeppdf-query-input");
        const indexSelect = this.containerEl.querySelector(".deeppdf-index-select");

        if (submitBtn) {
            submitBtn.removeEventListener("click", this.submitHandler);
        }
        if (input) {
            input.removeEventListener("keypress", this.keyPressHandler);
        }
        if (indexSelect) {
            indexSelect.removeEventListener("change", this.indexSelectHandler);
        }

        // 清理抽屉
        if (this.drawer) {
            this.drawer.close();
            const drawerEl = this.drawer.getElement();
            if (drawerEl) {
                drawerEl.remove();
            }
            this.drawer = null;
        }
    }
}
