import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { IndexManagerModal } from "../ui/index-manager-modal.js";
import { DeepPDFClient, QueryPDFResult, ListIndexesResult } from "../api/http-client.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    private submitHandler: () => void;
    private keyPressHandler: (e: KeyboardEvent) => void;
    private apiClient: DeepPDFClient | null;
    private indexSelectHandler: () => void;

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

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("deeppdf-container");

        // 头部
        const header = container.createEl("header", { cls: "deeppdf-header" });
        header.createEl("h2", { text: "DeepPDF" });

        // 服务器状态指示器
        const statusEl = header.createEl("div", { cls: "deeppdf-status" });
        this.updateStatus(statusEl);

        // 管理索引按钮
        const manageBtn = header.createEl("button", {
            cls: "deeppdf-manage-btn",
            text: "管理索引"
        });
        manageBtn.addEventListener("click", () => {
            this.openIndexManager();
        });

        // 查询输入区域
        const querySection = container.createEl("div", { cls: "deeppdf-query-section" });

        // 索引选择器
        const indexSelectRow = querySection.createDiv({ cls: "deeppdf-index-select-row" });
        indexSelectRow.createEl("label", {
            text: "选择索引:",
            cls: "deeppdf-index-label"
        });

        const indexSelect = indexSelectRow.createEl("select", {
            cls: "deeppdf-index-select"
        }) as HTMLSelectElement;
        indexSelect.add(new Option("加载中...", ""));

        const input = querySection.createEl("input", {
            type: "text",
            cls: "deeppdf-query-input",
            placeholder: "输入问题..."
        });

        const submitBtn = querySection.createEl("button", {
            cls: "deeppdf-submit-btn",
            text: "提问"
        });

        // 结果区域
        const resultsSection = container.createEl("div", { cls: "deeppdf-results-section" });
        resultsSection.createEl("p", {
            text: "输入问题开始查询",
            cls: "deeppdf-placeholder"
        });

        // 保存事件监听器引用以便清理
        this.submitHandler = () => this.handleSubmit(input.value, indexSelect.value);
        this.keyPressHandler = (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                this.handleSubmit(input.value, indexSelect.value);
            }
        };
        this.indexSelectHandler = () => {
            // 索引选择变化时的处理（可选）
            console.log(`[DeepPDF] 选中的索引: ${indexSelect.value}`);
        };

        // 添加事件监听
        submitBtn.addEventListener("click", this.submitHandler);
        input.addEventListener("keypress", this.keyPressHandler);
        indexSelect.addEventListener("change", this.indexSelectHandler);

        // 加载索引列表
        await this.loadIndexes(indexSelect);
    }

    async updateStatus(statusEl: HTMLElement): Promise<void> {
        statusEl.empty();
        if (!this.apiClient) {
            statusEl.createEl("span", {
                text: "⚠️ API 客户端未连接",
                cls: "deeppdf-status-warning"
            });
        } else {
            const isHealthy = await this.apiClient.healthCheck();
            if (isHealthy) {
                statusEl.createEl("span", {
                    text: "✅ API 服务器已连接",
                    cls: "deeppdf-status-ok"
                });
            } else {
                statusEl.createEl("span", {
                    text: "⚠️ API 服务器未连接",
                    cls: "deeppdf-status-warning"
                });
            }
        }
    }

    openIndexManager() {
        if (!this.apiClient) {
            this.showError("API 客户端未连接");
            return;
        }
        new IndexManagerModal(this.app, this.apiClient).open();
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

        resultsSection.innerHTML = "<p>查询中...</p>";

        try {
            // 检查是否选择了索引
            if (!selectedIndexId) {
                resultsSection.innerHTML = `
                    <div class="deeppdf-result">
                        <h3>查询结果</h3>
                        <p class="deeppdf-notice">
                            ⚠️ 请先选择一个索引。<br>
                            如果没有可用索引，请使用"管理索引"创建 PDF 索引。
                        </p>
                    </div>
                `;
                return;
            }

            // 使用选中的索引进行查询
            const result = await this.apiClient.queryPDF(query, selectedIndexId);

            this.displayQueryResult(result, query, resultsSection);
        } catch (error) {
            resultsSection.innerHTML = `<p class="deeppdf-error">查询失败: ${error}</p>`;
        }
    }

    /**
     * 加载索引列表到选择器
     */
    private async loadIndexes(indexSelect: HTMLSelectElement): Promise<void> {
        if (!this.apiClient) {
            indexSelect.innerHTML = '<option value="">未连接</option>';
            return;
        }

        try {
            const result: ListIndexesResult = await this.apiClient.listIndexes();

            // 清空现有选项
            indexSelect.innerHTML = '';

            if (!result || !Array.isArray(result.indexes) || result.indexes.length === 0) {
                indexSelect.add(new Option("暂无索引", ""));
                return;
            }

            // 添加索引选项
            result.indexes.forEach((index: any) => {
                const option = new Option(
                    `${index.pdf_name} (${index.node_count} 节点)`,
                    index.id
                );
                indexSelect.add(option);
            });

            console.log(`[DeepPDF] 已加载 ${result.indexes.length} 个索引`);
        } catch (error) {
            console.error('[DeepPDF] 加载索引列表失败:', error);
            indexSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    private displayQueryResult(result: QueryPDFResult, query: string, resultsSection: Element): void {
        if (!result || result.status !== "success") {
            resultsSection.innerHTML = `
                <div class="deeppdf-result">
                    <h3>查询结果</h3>
                    <p class="deeppdf-error">查询失败: ${"未知错误"}</p>
                </div>
            `;
            return;
        }

        let resultsHtml = `
            <div class="deeppdf-result">
                <h3>查询结果</h3>
                <p><strong>问题:</strong> ${query}</p>
        `;

        if (result.results && Array.isArray(result.results) && result.results.length > 0) {
            resultsHtml += `<div class="deeppdf-results-list">`;
            result.results.forEach((item: any, index: number) => {
                const pageNumber = item.metadata?.page || item.metadata?.start_index;

                resultsHtml += `
                    <div class="deeppdf-result-item">
                        <h4>结果 ${index + 1}</h4>
                        <p class="deeppdf-result-text">${item.text || "无内容"}</p>
                        <div class="deeppdf-result-meta">
                            <span class="deeppdf-meta-label">章节:</span>
                            <span>${item.metadata?.section || "未知"}</span>
                            <span class="deeppdf-meta-separator">•</span>
                            <span class="deeppdf-meta-label">页码:</span>
                            <span>${pageNumber || "未知"}</span>
                        </div>
                    </div>
                `;
            });
            resultsHtml += `</div>`;
        } else {
            resultsHtml += `<p class="deeppdf-notice">未找到相关结果</p>`;
        }

        resultsHtml += `</div>`;
        resultsSection.innerHTML = resultsHtml;
    }

    private showError(message: string) {
        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        if (resultsSection) {
            resultsSection.innerHTML = `<p class="deeppdf-error">${message}</p>`;
        }
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
    }
}
