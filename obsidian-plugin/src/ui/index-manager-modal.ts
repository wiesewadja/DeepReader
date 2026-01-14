import { App, Modal } from "obsidian";
import { MCPClient } from "../mcp/client.js";
import { IndexInfo } from "../mcp/types.js";

export class IndexManagerModal extends Modal {
    private client: MCPClient;

    constructor(app: App, client: MCPClient) {
        super(app);
        this.client = client;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "PDF 索引管理" });

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
            const result = await this.client.listIndexes();

            if (result.status === "success" && result.indexes) {
                if (result.indexes.length === 0) {
                    listContainer.createEl("p", {
                        text: "暂无索引",
                        cls: "deemphasized"
                    });
                    return;
                }

                for (const index of result.indexes) {
                    this.createIndexItem(listContainer, index);
                }
            } else {
                listContainer.createEl("p", {
                    text: `加载失败: ${result.error}`,
                    cls: "deemphasized"
                });
            }
        } catch (error) {
            listContainer.createEl("p", {
                text: `加载索引时出错: ${error}`,
                cls: "deemphasized"
            });
        }
    }

    private createIndexItem(container: HTMLElement, index: IndexInfo) {
        const itemEl = container.createDiv({ cls: "index-item" });

        const infoEl = itemEl.createDiv({ cls: "index-info" });
        infoEl.createEl("h3", { text: index.pdf_name });
        infoEl.createEl("p", {
            text: `节点数: ${index.node_count} | 创建时间: ${index.created_at}`
        });

        const deleteBtn = itemEl.createEl("button", {
            text: "删除",
            cls: "mod-warning"
        });

        deleteBtn.addEventListener("click", async () => {
            if (confirm(`确定要删除索引 "${index.pdf_name}" 吗？`)) {
                await this.deleteIndex(index.id, itemEl);
            }
        });
    }

    private async deleteIndex(indexId: string, itemEl: HTMLElement) {
        try {
            const result = await this.client.deleteIndex(indexId);

            if (result.status === "success") {
                itemEl.remove();
            } else {
                alert(`删除失败: ${result.error}`);
            }
        } catch (error) {
            alert(`删除索引时出错: ${error}`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
