import { ItemView, WorkspaceLeaf } from "obsidian";
import { MCPClient } from "../mcp/client.js";
import { IndexManagerModal } from "../ui/index-manager-modal.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    private client: MCPClient | null;
    private submitHandler: () => void;
    private keyPressHandler: (e: KeyboardEvent) => void;

    constructor(leaf: WorkspaceLeaf, client: MCPClient | null = null) {
        super(leaf);
        this.client = client;
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
        if (!this.client) {
            alert("MCP 客户端未连接。请先在设置中配置 MCP 服务器路径。");
            return;
        }
        new IndexManagerModal(this.app, this.client).open();
    }

    async handleSubmit(query: string) {
        if (!query.trim()) {
            return;
        }

        const resultsSection = this.containerEl.querySelector(".deeppdf-results-section");
        if (!resultsSection) return;

        resultsSection.innerHTML = "<p>查询中...</p>";

        // TODO: 集成 MCP 查询功能，替换下面的模拟实现
        setTimeout(() => {
            resultsSection.innerHTML = `
                <div class="deeppdf-result">
                    <p>查询功能尚未完全实现</p>
                    <p><strong>问题:</strong> ${query}</p>
                </div>
            `;
        }, 500);
    }

    async onClose() {
        // 清理事件监听器，防止内存泄漏
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
