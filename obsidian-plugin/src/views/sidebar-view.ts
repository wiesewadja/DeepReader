import { ItemView, WorkspaceLeaf } from "obsidian";
import { IndexManagerModal } from "../ui/index-manager-modal.js";
import { MCPClient } from "../mcp/client.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    private submitHandler: () => void;
    private keyPressHandler: (e: KeyboardEvent) => void;
    private mcpClient: MCPClient | null;

    constructor(leaf: WorkspaceLeaf, mcpClient: MCPClient | null) {
        super(leaf);
        this.mcpClient = mcpClient;
        this.submitHandler = () => {};
        this.keyPressHandler = () => {};
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
        if (!this.mcpClient) {
            statusEl.createEl("span", {
                text: "⚠️ MCP 客户端未连接",
                cls: "deeppdf-status-warning"
            });
        } else if (this.mcpClient.checkConnection()) {
            statusEl.createEl("span", {
                text: "✅ MCP 服务器已连接",
                cls: "deeppdf-status-ok"
            });
        } else {
            statusEl.createEl("span", {
                text: "⚠️ MCP 服务器未连接",
                cls: "deeppdf-status-warning"
            });
        }

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
        this.submitHandler = () => this.handleSubmit(input.value);
        this.keyPressHandler = (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                this.handleSubmit(input.value);
            }
        };

        // 添加事件监听
        submitBtn.addEventListener("click", this.submitHandler);
        input.addEventListener("keypress", this.keyPressHandler);
    }

    openIndexManager() {
        if (!this.mcpClient) {
            this.showError("MCP 客户端未连接");
            return;
        }
        new IndexManagerModal(this.app, this.mcpClient).open();
    }

    async handleSubmit(query: string) {
        if (!query.trim()) {
            return;
        }

        if (!this.mcpClient) {
            this.showError("MCP 客户端未连接");
            return;
        }

        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        if (!resultsSection) return;

        resultsSection.innerHTML = "<p>查询中...</p>";

        try {
            // 使用 MCP 客户端调用查询功能
            const indexes = await this.mcpClient.listIndexes();

            if (!indexes || !Array.isArray(indexes.indexes) || indexes.indexes.length === 0) {
                resultsSection.innerHTML = `
                    <div class="deeppdf-result">
                        <h3>查询结果</h3>
                        <p class="deeppdf-notice">
                            ⚠️ 没有可用的索引。<br>
                            请先使用"管理索引"创建 PDF 索引。
                        </p>
                    </div>
                `;
                return;
            }

            // 使用第一个索引进行查询
            const firstIndex = indexes.indexes[0];
            const result = await this.mcpClient.queryPDF(query, firstIndex.id);

            this.displayQueryResult(result, query, resultsSection);
        } catch (error) {
            resultsSection.innerHTML = `<p class="deeppdf-error">查询失败: ${error}</p>`;
        }
    }

    private displayQueryResult(result: any, query: string, resultsSection: Element): void {
        if (!result || result.status !== "success") {
            resultsSection.innerHTML = `
                <div class="deeppdf-result">
                    <h3>查询结果</h3>
                    <p class="deeppdf-error">查询失败: ${result?.message || "未知错误"}</p>
                </div>
            `;
            return;
        }

        let resultsHtml = `
            <div class="deeppdf-result">
                <h3>查询结果</h3>
                <p><strong>问题:</strong> ${query}</p>
                <p><strong>索引:</strong> ${result.index_info?.pdf_name || "未知"}</p>
        `;

        if (result.results && Array.isArray(result.results) && result.results.length > 0) {
            resultsHtml += `<div class="deeppdf-results-list">`;
            result.results.forEach((item: any, index: number) => {
                resultsHtml += `
                    <div class="deeppdf-result-item">
                        <h4>结果 ${index + 1}</h4>
                        <p class="deeppdf-result-text">${item.text || "无内容"}</p>
                        <div class="deeppdf-result-meta">
                            <span>📄 ${item.metadata?.section || "未知章节"}</span>
                            <span>📄 页码: ${item.metadata?.page || "未知"}</span>
                            <span>🎯 相似度: ${(item.metadata?.distance || 0).toFixed(3)}</span>
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

        if (submitBtn) {
            submitBtn.removeEventListener("click", this.submitHandler);
        }
        if (input) {
            input.removeEventListener("keypress", this.keyPressHandler);
        }
    }
}
