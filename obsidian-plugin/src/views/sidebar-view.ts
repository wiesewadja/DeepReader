import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { IndexManagerModal } from "../ui/index-manager-modal.js";
import { MCPClient } from "../mcp/client.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
    private submitHandler: () => void;
    private keyPressHandler: (e: KeyboardEvent) => void;
    private mcpClient: MCPClient | null;
    private indexSelectHandler: () => void;

    constructor(leaf: WorkspaceLeaf, mcpClient: MCPClient | null) {
        super(leaf);
        this.mcpClient = mcpClient;
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

    openIndexManager() {
        if (!this.mcpClient) {
            this.showError("MCP 客户端未连接");
            return;
        }
        new IndexManagerModal(this.app, this.mcpClient).open();
    }

    async handleSubmit(query: string, selectedIndexId: string) {
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
            const result = await this.mcpClient.queryPDF(query, selectedIndexId);

            this.displayQueryResult(result, query, resultsSection);
        } catch (error) {
            resultsSection.innerHTML = `<p class="deeppdf-error">查询失败: ${error}</p>`;
        }
    }

    /**
     * 加载索引列表到选择器
     */
    private async loadIndexes(indexSelect: HTMLSelectElement): Promise<void> {
        if (!this.mcpClient) {
            indexSelect.innerHTML = '<option value="">未连接</option>';
            return;
        }

        try {
            const result = await this.mcpClient.listIndexes();

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
                const pageNumber = item.metadata?.page || item.metadata?.start_index;
                const pdfPath = result.index_info?.pdf_path;
                const dataAttrs = pdfPath ? `data-pdf-path="${pdfPath}" data-page="${pageNumber}"` : '';

                resultsHtml += `
                    <div class="deeppdf-result-item">
                        <h4>结果 ${index + 1}</h4>
                        <p class="deeppdf-result-text">${item.text || "无内容"}</p>
                        <div class="deeppdf-result-meta">
                            <span>📄 ${item.metadata?.section || "未知章节"}</span>
                            <span>📄 页码: ${pageNumber || "未知"}</span>
                            <span>🎯 相似度: ${(item.metadata?.distance || 0).toFixed(3)}</span>
                        </div>
                        ${pdfPath && pageNumber ? `
                            <button class="deeppdf-jump-btn" ${dataAttrs} data-result-index="${index}">
                                📖 跳转到 PDF
                            </button>
                        ` : ''}
                    </div>
                `;
            });
            resultsHtml += `</div>`;
        } else {
            resultsHtml += `<p class="deeppdf-notice">未找到相关结果</p>`;
        }

        resultsHtml += `</div>`;
        resultsSection.innerHTML = resultsHtml;

        // 添加跳转按钮事件监听
        this.attachJumpHandlers(resultsSection);
    }

    /**
     * 为跳转按钮添加事件处理器
     */
    private attachJumpHandlers(resultsSection: Element): void {
        const jumpButtons = resultsSection.querySelectorAll('.deeppdf-jump-btn');
        jumpButtons.forEach((button) => {
            button.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const pdfPath = target.getAttribute('data-pdf-path');
                const page = target.getAttribute('data-page');

                if (pdfPath && page) {
                    this.jumpToPDF(pdfPath, parseInt(page));
                }
            });
        });
    }

    /**
     * 跳转到 PDF 指定页码
     *
     * @param pdfPath - PDF 文件路径
     * @param pageNumber - 目标页码（从 1 开始）
     */
    private async jumpToPDF(pdfPath: string, pageNumber: number): Promise<void> {
        try {
            // 尝试在 vault 中查找文件（通过文件名匹配）
            const pdfName = pdfPath.split('/').pop() || pdfPath.split('\\').pop();
            if (!pdfName) {
                new Notice(`❌ 无法解析文件名`);
                return;
            }

            // 搜索 vault 中的 PDF 文件
            const files = this.app.vault.getFiles();
            const pdfFile = files.find(f =>
                f.name === pdfName && f.extension === 'pdf'
            );

            if (pdfFile) {
                // PDF 在 vault 中：使用 Obsidian 的内部链接打开
                // Obsidian 的 PDF 链接格式：file.pdf#page=5
                const linkWithPage = `${pdfFile.path}#page=${pageNumber}`;
                await this.app.workspace.openLinkText(linkWithPage, '', true);
                new Notice(`✅ 已打开 PDF: 第 ${pageNumber} 页`);
            } else {
                // PDF 不在 vault 中：使用系统默认应用打开
                this.openExternalPDF(pdfPath, pageNumber);
            }
        } catch (error) {
            console.error('[DeepPDF] 跳转 PDF 失败:', error);
            new Notice(`❌ 跳转失败: ${error}`);
        }
    }

    /**
     * 使用系统默认应用打开外部 PDF
     *
     * @param pdfPath - PDF 文件路径
     * @param pageNumber - 目标页码（仅用于提示）
     */
    private openExternalPDF(pdfPath: string, pageNumber: number): void {
        const { exec } = require('child_process');

        // 根据 OS 选择打开命令
        let command: string;
        if (process.platform === 'darwin') {
            // macOS: 使用 Preview 打开
            command = `open "${pdfPath}"`;
        } else if (process.platform === 'win32') {
            // Windows
            command = `start "" "${pdfPath}"`;
        } else {
            // Linux
            command = `xdg-open "${pdfPath}"`;
        }

        exec(command, (error: any) => {
            if (error) {
                new Notice(`❌ 打开 PDF 失败: ${error.message}`);
            } else {
                new Notice(`✅ 已打开 PDF（外部文件，请手动跳转到第 ${pageNumber} 页）`);
            }
        });
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
