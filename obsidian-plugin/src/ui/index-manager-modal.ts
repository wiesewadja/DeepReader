import { App, Modal, Notice } from "obsidian";
import { MCPClient } from "../mcp/client.js";

interface IndexInfo {
    id: string;
    pdf_name: string;
    created_at: string;
    node_count: number;
}

export class IndexManagerModal extends Modal {
    private mcpClient: MCPClient;

    constructor(app: App, mcpClient: MCPClient) {
        super(app);
        this.mcpClient = mcpClient;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "PDF 索引管理" });

        // 说明信息
        contentEl.createEl("p", {
            text: "管理 PDF 索引，用于深度查询",
            cls: "deemphasized"
        });

        // 刷新按钮
        const refreshBtn = contentEl.createEl("button", {
            text: "刷新索引列表",
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
        listContainer.createEl("p", { text: "加载中..." });

        try {
            // 使用 MCP 客户端获取索引列表
            const result = await this.mcpClient.listIndexes();

            listContainer.empty();

            if (!result || !Array.isArray(result.indexes) || result.indexes.length === 0) {
                listContainer.createEl("p", {
                    text: "📭 暂无索引",
                    cls: "deemphasized"
                });
                listContainer.createEl("p", {
                    text: "提示：使用命令行工具索引 PDF 文件",
                    cls: "deemphasized"
                });
                return;
            }

            // 显示索引列表
            const table = listContainer.createEl("table", {
                cls: "index-table"
            });

            // 表头
            const thead = table.createEl("thead");
            const headerRow = thead.createEl("tr");
            headerRow.createEl("th", { text: "PDF 名称" });
            headerRow.createEl("th", { text: "节点数" });
            headerRow.createEl("th", { text: "创建时间" });
            headerRow.createEl("th", { text: "操作" });

            // 表体
            const tbody = table.createEl("tbody");
            result.indexes.forEach((index: IndexInfo) => {
                const row = tbody.createEl("tr");

                row.createEl("td", {
                    text: index.pdf_name,
                    cls: "index-name"
                });

                row.createEl("td", {
                    text: index.node_count.toString(),
                    cls: "index-count"
                });

                row.createEl("td", {
                    text: new Date(index.created_at).toLocaleString('zh-CN'),
                    cls: "index-date"
                });

                const actionsCell = row.createEl("td", {
                    cls: "index-actions"
                });

                const deleteBtn = actionsCell.createEl("button", {
                    text: "删除",
                    cls: "mod-warning"
                });

                deleteBtn.addEventListener("click", async () => {
                    if (confirm(`确定要删除索引 "${index.pdf_name}" 吗？`)) {
                        await this.deleteIndex(index.id);
                    }
                });
            });

        } catch (error) {
            listContainer.empty();
            listContainer.createEl("p", {
                text: `加载索引失败: ${error}`,
                cls: "deeppdf-error"
            });
        }
    }

    private async deleteIndex(indexId: string) {
        try {
            const result = await this.mcpClient.deleteIndex(indexId);

            if (result && result.status === "success") {
                new Notice("索引删除成功");
                await this.loadIndexes(); // 刷新列表
            } else {
                new Notice(`删除失败: ${result?.message || "未知错误"}`);
            }
        } catch (error) {
            new Notice(`删除失败: ${error}`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
