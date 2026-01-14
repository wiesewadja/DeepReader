import { App, Modal, Notice } from "obsidian";
import { requestUrl } from "obsidian";

interface IndexInfo {
    id: string;
    pdf_name: string;
    created_at: string;
    node_count: number;
}

export class IndexManagerModal extends Modal {
    private serverPath: string;

    constructor(app: App, serverPath: string) {
        super(app);
        this.serverPath = serverPath;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "PDF 索引管理" });

        // 说明信息
        contentEl.createEl("p", {
            text: `MCP 服务器路径: ${this.serverPath}`,
            cls: "deemphasized"
        });

        // 刷新按钮
        const refreshBtn = contentEl.createEl("button", {
            text: "刷新",
            cls: "mod-cta"
        });
        refreshBtn.addEventListener("click", () => this.loadIndexes());

        // 索引列表容器
        contentEl.createDiv({ cls: "index-list" });

        await this.loadIndexes();
    }

    private async loadIndexes() {
        const listContainer = this.contentEl.querySelector(".index-list") as HTMLElement;
        if (!listContainer) return;

        listContainer.empty();

        try {
            // 直接读取索引目录中的 JSON 文件
            const indexesDir = `${this.serverPath}/data/indexes`;
            const result = await requestUrl({
                url: `file://${indexesDir}`,
                method: "GET"
            });

            // 由于跨域限制，直接使用文件系统 API 不可行
            // 显示提示信息
            listContainer.createEl("div", { cls: "deeppdf-notice" });
            listContainer.createEl("p", {
                text: "📂 索引管理功能说明",
                cls: "deeppdf-notice-title"
            });

            const noticeEl = listContainer.createEl("div", { cls: "deeppdf-notice-content" });
            noticeEl.createEl("p", {
                text: "索引数据存储在以下目录："
            });
            noticeEl.createEl("code", {
                text: `${this.serverPath}/data/indexes/`
            });
            noticeEl.createEl("p", {
                text: "每个索引对应一个 JSON 文件，包含索引元数据。"
            });
            noticeEl.createEl("p", {
                text: "要管理索引，您可以："
            });
            noticeEl.createEl("ul").createEl("li", {
                text: "直接删除对应的 JSON 文件"
            });
            noticeEl.createEl("ul").createEl("li", {
                text: "或使用 MCP 服务器的命令行工具"
            });

            // 显示示例命令
            const cmdEl = listContainer.createEl("div", { cls: "deeppdf-command-example" });
            cmdEl.createEl("p", {
                text: "示例命令：",
                cls: "deeppdf-notice-title"
            });
            cmdEl.createEl("pre", {
                text: `cd ${this.serverPath}\nuv run python -c "from deeppdf.tools.index_manager import list_indexes; import json; print(json.dumps(list_indexes('${this.serverPath}/data')))"`
            });

        } catch (error) {
            listContainer.createEl("p", {
                text: `加载索引时出错: ${error}`,
                cls: "deemphasized"
            });
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
