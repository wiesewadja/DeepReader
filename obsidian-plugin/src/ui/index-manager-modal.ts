import { App, Modal, Notice, SuggestModal } from "obsidian";
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

        // 操作按钮区域
        const buttonContainer = contentEl.createDiv({ cls: "index-button-container" });

        // 导入 PDF 按钮
        const importBtn = buttonContainer.createEl("button", {
            text: "+ 导入 PDF",
            cls: "mod-cta"
        });
        importBtn.addEventListener("click", () => this.importPDF());

        // 刷新按钮
        const refreshBtn = buttonContainer.createEl("button", {
            text: "刷新索引列表"
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
                    text: "提示：点击上方\"导入 PDF\"按钮开始创建索引",
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

    /**
     * 导入 PDF 并创建索引
     */
    private async importPDF() {
        // 创建一个简单的模态框来输入文件路径
        new ImportPDFModal(this.app, this.mcpClient).open();
    }
}

/**
 * PDF 导入模态框
 */
class ImportPDFModal extends Modal {
    private mcpClient: MCPClient;
    private inputEl: HTMLInputElement | null = null;
    private submitBtn: HTMLButtonElement | null = null;

    constructor(app: App, mcpClient: MCPClient) {
        super(app);
        this.mcpClient = mcpClient;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "导入 PDF 索引" });

        // 文件路径输入
        const inputContainer = contentEl.createDiv({ cls: "import-input-container" });
        inputContainer.createEl("label", { text: "PDF 文件路径:" });

        this.inputEl = inputContainer.createEl("input", {
            type: "text",
            placeholder: "/path/to/your/file.pdf",
            cls: "import-file-input"
        });

        // 提示信息
        const hintEl = contentEl.createEl("p", {
            text: "💡 提示：输入 PDF 文件的完整路径，例如 /Users/xxx/Documents/paper.pdf",
            cls: "deemphasized"
        });

        // 按钮容器
        const buttonContainer = contentEl.createDiv({ cls: "import-button-container" });

        // 取消按钮
        const cancelBtn = buttonContainer.createEl("button", {
            text: "取消"
        });
        cancelBtn.addEventListener("click", () => this.close());

        // 导入按钮
        this.submitBtn = buttonContainer.createEl("button", {
            text: "开始索引",
            cls: "mod-cta"
        });
        this.submitBtn.addEventListener("click", () => this.handleImport());

        // 支持回车提交
        this.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
            if (e.key === "Enter" && this.submitBtn) {
                this.handleImport();
            }
        });

        // 自动聚焦到输入框
        setTimeout(() => this.inputEl?.focus(), 100);
    }

    private async handleImport() {
        const pdfPath = this.inputEl?.value?.trim();

        if (!pdfPath) {
            new Notice("请输入 PDF 文件路径");
            return;
        }

        // 禁用按钮防止重复提交
        if (this.submitBtn) {
            this.submitBtn.disabled = true;
            this.submitBtn.textContent = "索引中...";
        }

        // 显示进度提示
        const progressNotice = new Notice(`📄 正在索引: ${pdfPath}`, 0);

        try {
            // 调用 MCP 客户端创建索引
            const result = await this.mcpClient.indexPDF(pdfPath);

            progressNotice.hide();

            if (result && result.status === "success") {
                new Notice(
                    `✅ 索引创建成功！\n` +
                    `PDF: ${result.pdf_name}\n` +
                    `节点数: ${result.node_count}\n` +
                    `索引 ID: ${result.index_id}`
                );
                this.close(); // 关闭模态框
            } else if (result && result.status === "error") {
                new Notice(`❌ 索引失败: ${result.error || "未知错误"}`);
                if (this.submitBtn) {
                    this.submitBtn.disabled = false;
                    this.submitBtn.textContent = "开始索引";
                }
            } else {
                new Notice(`❌ 索引失败: 未知错误`);
                if (this.submitBtn) {
                    this.submitBtn.disabled = false;
                    this.submitBtn.textContent = "开始索引";
                }
            }
        } catch (indexError) {
            progressNotice.hide();
            new Notice(`❌ 索引失败: ${indexError}`);
            if (this.submitBtn) {
                this.submitBtn.disabled = false;
                this.submitBtn.textContent = "开始索引";
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
