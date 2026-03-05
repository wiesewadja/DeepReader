/**
 * DeepPDF 索引管理模态框 - 集成新组件
 * 使用 Obsidian API 获取 PDF 文件
 * 使用任务队列管理器跟踪索引进度
 */

import { App, Modal, Notice } from "obsidian";
import { DeepPDFClient, IndexPDFResult, DeleteIndexResult, ListIndexesResult, IndexListItem, IndexPDFRequest } from "../api/http-client.js";
import { PDFFileSelectorModal, DocumentFileInfo } from "../ui/pdf-file-selector.js";
// import { TaskQueueManager, createIndexTask } from "../components/task-queue-manager.js";
import { IndexStatusBadge, formatIndexTime } from "../components/index-status-badge.js";
import { debug, error as logError } from "../utils/logger.js";

// ==================== SVG 图标系统 ====================
const Icons = {
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    filePlus: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
    refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    database: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s 9-1.34 9-3V5"/></svg>`,
    layers: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
};

// ==================== 索引管理模态框 ====================
export class IndexManagerModal extends Modal {
    private apiClient: DeepPDFClient;
    private onIndexCreated?: () => void;
    // private taskQueue: TaskQueueManager;
    private refreshBtn: HTMLButtonElement | null = null;
    private indexStatusCache: Map<string, string> = new Map(); // 缓存索引状态
    private llmSettings: any; // LLM 配置

    constructor(app: App, apiClient: DeepPDFClient, llmSettings: any, onIndexCreated?: () => void) {
        super(app);
        this.apiClient = apiClient;
        this.llmSettings = llmSettings;
        this.onIndexCreated = onIndexCreated;

        // 创建任务队列容器
        // const taskContainer = document.createElement("div");
        // taskContainer.addClass("deeppdf-task-queue-container");
        // this.containerEl.appendChild(taskContainer);

        // this.taskQueue = new TaskQueueManager(apiClient, taskContainer, {
        //     maxConcurrent: 3,
        //     pollInterval: 2000,
        //     autoRemoveCompleted: true,
        //     autoRemoveDelay: 3000
        // });
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("deeppdf-modal");

        // 创建头部
        this.createHeader(contentEl);

        // 创建任务队列容器（放在索引列表上方）
        // const taskQueueSection = contentEl.createDiv({ cls: "deeppdf-task-queue-section" });
        // taskQueueSection.innerHTML = '<h3 class="deeppdf-section-title">任务进度</h3>';
        // const taskQueueContainer = taskQueueSection.createDiv({ cls: "deeppdf-task-queue-container" });
        // this.taskQueue = new TaskQueueManager(this.apiClient, taskQueueContainer, {
        //     maxConcurrent: 3,
        //     pollInterval: 2000,
        //     autoRemoveCompleted: true,
        //     autoRemoveDelay: 5000
        // });

        // 创建操作按钮区域
        this.createActionButtons(contentEl);

        // 创建索引列表容器
        contentEl.createDiv({ cls: "index-list" });

        // 加载索引列表
        await this.loadIndexes();

        // 启动状态轮询
        this.startStatusPolling();
    }

    private createHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: "deeppdf-modal-header" });

        const headerLeft = header.createDiv({ cls: "deeppdf-modal-header-left" });
        const logo = headerLeft.createDiv({ cls: "deeppdf-logo" });
        logo.innerHTML = Icons.database;

        const title = headerLeft.createEl("h2", {
            text: "PDF 索引管理",
            cls: "deeppdf-modal-title"
        });

        const description = container.createEl("p", {
            text: "从当前 vault 中选择 PDF 文件并创建索引",
            cls: "deeppdf-modal-description"
        });
    }

    private createActionButtons(container: HTMLElement) {
        const buttonContainer = container.createDiv({ cls: "deeppdf-button-group" });

        // 选择 PDF 并创建索引按钮
        const importBtn = buttonContainer.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-primary"
        });
        importBtn.innerHTML = `${Icons.filePlus} 选择 PDF 创建索引`;
        importBtn.addEventListener("click", () => this.selectPDFAndCreateIndex());

        // 刷新按钮
        this.refreshBtn = buttonContainer.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-secondary"
        });
        this.refreshBtn.innerHTML = `${Icons.refresh} 刷新`;
        this.refreshBtn.addEventListener("click", () => this.loadIndexes());
    }

    private pendingPDFs: DocumentFileInfo[] = []; // 待索引的 PDF 列表

    private selectPDFAndCreateIndex() {
        new PDFFileSelectorModal(this.app, async (fileInfo: DocumentFileInfo) => {
            // 添加到待索引列表
            this.pendingPDFs.push(fileInfo);
            new Notice(`已选择 "${fileInfo.name}"，请点击"开始索引"按钮`);
            // 刷新显示
            await this.loadIndexes();
        }).open();
    }

    private async createIndexFromFile(fileInfo: DocumentFileInfo, startBtn?: HTMLButtonElement) {
        try {
            // 显示创建中提示
            new Notice(`正在为 "${fileInfo.name}" 创建索引...`);

            // 调用 API 创建索引，传递 LLM 配置
            const result: IndexPDFResult = await this.apiClient.indexPDF(fileInfo.path, {
                llmProvider: this.llmSettings.llmProvider,
                llmModel: this.llmSettings.llmModel,
                deepseekApiKey: this.llmSettings.deepseekApiKey,
                openaiApiKey: this.llmSettings.openaiApiKey,
                apiUrl: this.llmSettings.apiUrl,
                maxPagesPerNode: this.llmSettings.maxPagesPerNode,
                maxTokensPerNode: this.llmSettings.maxTokensPerNode,
                ifAddNodeSummary: this.llmSettings.ifAddNodeSummary
            });

            if (result && result.status === 'success') {
                // 成功创建（同步完成）
                new Notice(`索引创建成功！节点数: ${result.node_count}`);

                // 从待索引列表中移除
                this.pendingPDFs = this.pendingPDFs.filter(p => p.path !== fileInfo.path);

                // 刷新索引列表
                await this.loadIndexes();

                if (this.onIndexCreated) {
                    this.onIndexCreated();
                }
            } else if (result && result.status === 'pending') {
                // 异步处理中
                new Notice(`索引任务已创建，ID: ${result.index_id}。请稍后在索引列表中查看进度。`);

                // 从待索引列表中移除
                this.pendingPDFs = this.pendingPDFs.filter(p => p.path !== fileInfo.path);

                // 关闭模态框，让用户回到主界面查看索引状态
                this.close();

                if (this.onIndexCreated) {
                    this.onIndexCreated();
                }
            } else {
                // 失败
                new Notice(`索引创建失败: ${result?.error || '未知错误'}`, 5000);

                // 恢复按钮状态
                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.innerHTML = `${Icons.filePlus} 开始索引`;
                }
            }
        } catch (error: any) {
            // 处理 HTTP 错误和其他异常
            let errorMessage = '索引创建失败';

            if (error.message) {
                if (error.message.includes('Too Many Requests') || error.message.includes('速率限制')) {
                    errorMessage = '创建索引过于频繁，请稍后再试';
                } else if (error.message.includes('API key')) {
                    errorMessage = 'API key 未配置或无效，请在设置中检查';
                } else {
                    errorMessage = `索引创建失败: ${error.message}`;
                }
            }

            new Notice(errorMessage, 5000);
            logError('[DeepPDF] 索引创建错误:', error);

            // 恢复按钮状态
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.innerHTML = `${Icons.filePlus} 开始索引`;
            }
        }
    }

    private async loadIndexes() {
        const listContainer = this.contentEl.querySelector(".index-list") as HTMLElement;
        if (!listContainer) return;

        // 显示加载状态
        listContainer.empty();
        listContainer.innerHTML = `
            <div class="deeppdf-loading">
                <div class="deeppdf-spinner"></div>
                <span>加载索引列表...</span>
            </div>
        `;

        try {
            const result: ListIndexesResult = await this.apiClient.listIndexes();
            listContainer.empty();

            const indexes = (result && Array.isArray(result.indexes)) ? result.indexes : [];

            // 检查是否有待索引的 PDF 或已有索引
            if (this.pendingPDFs.length === 0 && indexes.length === 0) {
                this.showEmptyState(listContainer);
                return;
            }

            // 显示索引卡片列表（包括待索引的 PDF 和已有索引）
            this.showIndexCards(listContainer, indexes);
        } catch (error) {
            this.showErrorState(listContainer, error);
        }
    }

    private showEmptyState(container: HTMLElement) {
        container.innerHTML = `
            <div class="deeppdf-empty-state">
                <div class="deeppdf-empty-icon">${Icons.folder}</div>
                <div class="deeppdf-empty-text">暂无索引</div>
                <div class="deeppdf-empty-hint">点击上方 "选择 PDF 创建索引" 按钮开始</div>
            </div>
        `;
    }

    private showErrorState(container: HTMLElement, error: unknown) {
        container.innerHTML = `
            <div class="deeppdf-error">
                <span>${Icons.x}</span>
                <span>加载索引失败: ${error}</span>
            </div>
        `;
    }

    private showIndexCards(container: HTMLElement, indexes: IndexListItem[]) {
        const cardsContainer = container.createDiv({ cls: "index-cards-container" });

        // 1. 显示待索引的 PDF（如果有）
        if (this.pendingPDFs.length > 0) {
            const pendingSection = cardsContainer.createDiv({ cls: "pending-pdfs-section" });
            const pendingTitle = pendingSection.createEl("h3", {
                text: "待索引 PDF",
                cls: "deeppdf-section-title"
            });

            this.pendingPDFs.forEach((pdfInfo, index) => {
                const pendingCard = this.createPendingPDFCard(pdfInfo);
                pendingCard.addClass("deeppdf-animate-fade-in");
                pendingCard.style.animationDelay = `${index * 50}ms`;
                pendingSection.appendChild(pendingCard);
            });
        }

        // 2. 显示已有索引
        if (indexes.length > 0) {
            indexes.forEach((index: IndexListItem, indexNum: number) => {
                const card = this.createIndexCard(index);
                card.addClass("deeppdf-animate-fade-in");
                card.style.animationDelay = `${Math.min((indexNum + this.pendingPDFs.length) * 50, 200)}ms`;
                cardsContainer.appendChild(card);
            });
        }
    }

    private createPendingPDFCard(pdfInfo: DocumentFileInfo): HTMLElement {
        const card = document.createElement("div");
        card.addClass("index-card", "pending-card");

        // 左侧信息区域
        const info = card.createDiv({ cls: "index-card-info" });

        const name = info.createDiv({ cls: "index-card-name" });
        name.innerHTML = `${Icons.file} ${this.escapeHtml(pdfInfo.name)}`;

        const meta = info.createDiv({ cls: "index-card-meta" });
        meta.innerHTML = `${pdfInfo.sizeFormatted} • 待索引`;

        // 右侧操作区域
        const actions = card.createDiv({ cls: "index-card-actions" });

        // 开始索引按钮
        const startBtn = actions.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-primary"
        });
        startBtn.innerHTML = `${Icons.filePlus} 开始索引`;
        startBtn.addEventListener("click", async () => {
            startBtn.disabled = true;
            startBtn.innerHTML = `<span class="deeppdf-spinner" style="width:14px;height:14px;border-width:1px;"></span> 索引中...`;
            await this.createIndexFromFile(pdfInfo, startBtn);
        });

        // 移除按钮
        const removeBtn = actions.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-ghost"
        });
        removeBtn.innerHTML = `${Icons.x} 移除`;
        removeBtn.addEventListener("click", () => {
            this.pendingPDFs = this.pendingPDFs.filter(p => p.path !== pdfInfo.path);
            this.loadIndexes();
        });

        return card;
    }

    private createIndexCard(index: IndexListItem): HTMLElement {
        const card = document.createElement("div");
        card.addClass("index-card");
        card.setAttribute("data-index-id", index.id);

        // 左侧信息区域
        const info = card.createDiv({ cls: "index-card-info" });

        const name = info.createDiv({ cls: "index-card-name" });
        name.innerHTML = `${Icons.file} ${this.escapeHtml(index.pdf_name)}`;

        const meta = info.createDiv({ cls: "index-card-meta" });

        // 节点数
        const nodesItem = meta.createDiv({ cls: "index-card-meta-item" });
        nodesItem.innerHTML = `${Icons.layers} ${index.node_count} 节点`;

        // 创建时间
        const dateItem = meta.createDiv({ cls: "index-card-meta-item" });
        dateItem.innerHTML = `${Icons.calendar} ${formatIndexTime(index.created_at)}`;

        // 状态徽章
        const status = IndexStatusBadge.fromAPIStatus(index.status || 'unknown');
        const badgeContainer = info.createDiv({ cls: "index-card-status" });
        const badge = new IndexStatusBadge(badgeContainer, status);
        badgeContainer.appendChild(badge.render());

        // 右侧操作区域
        const actions = card.createDiv({ cls: "index-card-actions" });

        const deleteBtn = actions.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-ghost"
        });
        deleteBtn.innerHTML = `${Icons.trash} 删除`;
        deleteBtn.addEventListener("click", async () => {
            if (confirm(`确定要删除索引 "${index.pdf_name}" 吗？`)) {
                await this.deleteIndex(index.id, card);
            }
        });

        return card;
    }

    private async deleteIndex(indexId: string, cardEl: HTMLElement) {
        // 显示删除中状态
        const deleteBtn = cardEl.querySelector(".deeppdf-btn") as HTMLButtonElement;
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `<span class="deeppdf-spinner" style="width:14px;height:14px;border-width:1px;"></span> 删除中...`;
        }

        try {
            const result: DeleteIndexResult = await this.apiClient.deleteIndex(indexId);

            if (result && result.status === "success") {
                new Notice("索引删除成功");
                // 动画移除卡片
                cardEl.style.opacity = "0";
                cardEl.style.transform = "translateX(20px)";
                setTimeout(() => {
                    cardEl.remove();
                    // 检查是否为空
                    const remainingCards = this.contentEl.querySelectorAll(".index-card");
                    if (remainingCards.length === 0) {
                        const listContainer = this.contentEl.querySelector(".index-list") as HTMLElement;
                        if (listContainer) {
                            this.showEmptyState(listContainer);
                        }
                    }
                }, 200);
            } else {
                new Notice(`删除失败: ${result?.message || "未知错误"}`);
                if (deleteBtn) {
                    deleteBtn.disabled = false;
                    deleteBtn.innerHTML = `${Icons.trash} 删除`;
                }
            }
        } catch (error) {
            new Notice(`删除失败: ${error}`);
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = `${Icons.trash} 删除`;
            }
        }
    }

    /**
     * 启动状态轮询 - 更新索引卡片上的状态徽章
     */
    private startStatusPolling(): void {
        // 每 5 秒更新一次索引状态
        const pollInterval = window.setInterval(async () => {
            await this.updateIndexStatuses();
        }, 5000);

        // 在模态框关闭时清除定时器
        this.onClose = () => {
            clearInterval(pollInterval);
            // this.taskQueue.destroy();
            const { contentEl } = this;
            contentEl.empty();
            contentEl.removeClass("deeppdf-modal");
        };
    }

    private async updateIndexStatuses(): Promise<void> {
        const indexCards = Array.from(this.contentEl.querySelectorAll(".index-card"));

        for (const card of indexCards) {
            const indexId = card.getAttribute("data-index-id");
            if (!indexId) continue;

            try {
                const progress = await this.apiClient.getTaskProgress(indexId);

                // 更新状态徽章
                const badgeContainer = card.querySelector(".index-card-status");
                if (badgeContainer) {
                    const status = IndexStatusBadge.fromAPIStatus(progress.status);
                    const badge = new IndexStatusBadge(badgeContainer as HTMLElement, status, progress.progress_percent);
                    badgeContainer.innerHTML = '';
                    badgeContainer.appendChild(badge.render());
                }
            } catch (error) {
                // 忽略错误，可能是索引已被删除
                debug(`[DeepPDF] 获取索引 ${indexId} 状态失败:`, error);
            }
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
