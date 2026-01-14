import { ItemView, WorkspaceLeaf } from "obsidian";
import { IndexManagerModal } from "../ui/index-manager-modal.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    private submitHandler: () => void;
    private keyPressHandler: (e: KeyboardEvent) => void;
    private mcpServerPath: string;

    constructor(leaf: WorkspaceLeaf, mcpServerPath: string = "") {
        super(leaf);
        this.mcpServerPath = mcpServerPath;
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
        if (!this.mcpServerPath) {
            statusEl.createEl("span", {
                text: "⚠️ 未配置 MCP 服务器路径",
                cls: "deeppdf-status-warning"
            });
        } else {
            statusEl.createEl("span", {
                text: `✅ MCP 服务器: ${this.mcpServerPath}`,
                cls: "deeppdf-status-ok"
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
        if (!this.mcpServerPath) {
            this.showError("请先在设置中配置 MCP 服务器路径");
            return;
        }
        new IndexManagerModal(this.app, this.mcpServerPath).open();
    }

    async handleSubmit(query: string) {
        if (!query.trim()) {
            return;
        }

        if (!this.mcpServerPath) {
            this.showError("请先在设置中配置 MCP 服务器路径");
            return;
        }

        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        if (!resultsSection) return;

        resultsSection.innerHTML = "<p>查询中...</p>";

        try {
            // TODO: 实现实际的查询逻辑
            // 当前版本使用模拟数据
            await this.simulateQuery(query, resultsSection);
        } catch (error) {
            resultsSection.innerHTML = `<p class="deeppdf-error">查询失败: ${error}</p>`;
        }
    }

    private async simulateQuery(query: string, resultsSection: Element) {
        // 模拟查询延迟
        await new Promise(resolve => setTimeout(resolve, 500));

        resultsSection.innerHTML = `
            <div class="deeppdf-result">
                <h3>查询结果</h3>
                <p><strong>问题:</strong> ${query}</p>
                <p class="deeppdf-notice">
                    📝 注意：当前版本使用模拟数据。<br>
                    实际查询功能需要 MCP 服务器支持。
                </p>
                <div class="deeppdf-meta-info">
                    <p><strong>MCP 服务器路径:</strong> ${this.mcpServerPath}</p>
                    <p><strong>索引状态:</strong> 请使用"管理索引"查看</p>
                </div>
            </div>
        `;
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
