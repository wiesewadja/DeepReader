/**
 * DeepPDF - PDF 文件选择器
 * 使用 Obsidian API 获取 vault 中的 PDF 文件
 */

import { App, Modal, FuzzySuggestModal, TFile } from "obsidian";

// ==================== SVG 图标 ====================
const Icons = {
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    filePdf: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="17" font-size="8" fill="currentColor" stroke="none">PDF</text></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

// ==================== PDF 文件信息 ====================
export interface PDFFileInfo {
    file: TFile;
    name: string;
    path: string;
    size: number;
    sizeFormatted: string;
    folder: string;
}

// ==================== PDF 文件选择器模态框 ====================
export class PDFFileSelectorModal extends Modal {
    private onSelect: (fileInfo: PDFFileInfo) => void;
    private pdfFiles: PDFFileInfo[] = [];
    private filteredFiles: PDFFileInfo[] = [];
    private searchInput: HTMLInputElement | null = null;
    private fileListEl: HTMLElement | null = null;

    constructor(app: App, onSelect: (fileInfo: PDFFileInfo) => void) {
        super(app);
        this.onSelect = onSelect;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("deeppdf-modal", "pdf-file-selector");

        // 创建头部
        this.createHeader(contentEl);

        // 创建搜索框
        this.createSearchBox(contentEl);

        // 加载 PDF 文件
        await this.loadPDFFiles();

        // 创建文件列表
        this.createFileList(contentEl);
    }

    private createHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: "deeppdf-modal-header" });

        const headerLeft = header.createDiv({ cls: "deeppdf-modal-header-left" });
        const logo = headerLeft.createDiv({ cls: "deeppdf-logo" });
        logo.innerHTML = Icons.filePdf;

        headerLeft.createEl("h2", {
            text: "选择 PDF 文件",
            cls: "deeppdf-modal-title"
        });

        const description = container.createEl("p", {
            text: "从当前 vault 中选择要创建索引的 PDF 文件",
            cls: "deeppdf-modal-description"
        });
    }

    private createSearchBox(container: HTMLElement) {
        const searchContainer = container.createDiv({ cls: "deeppdf-search-container" });

        const searchWrapper = searchContainer.createDiv({ cls: "deeppdf-search-wrapper" });

        const searchIcon = searchWrapper.createDiv({ cls: "deeppdf-search-icon" });
        searchIcon.innerHTML = Icons.search;

        this.searchInput = searchWrapper.createEl("input", {
            cls: "deeppdf-search-input",
            attr: { type: "text", placeholder: "搜索 PDF 文件..." }
        });

        this.searchInput.addEventListener("input", () => {
            this.filterFiles(this.searchInput?.value || "");
        });

        // 显示文件数量
        const countEl = searchContainer.createDiv({ cls: "deeppdf-file-count" });
        this.updateFileCount(countEl);
    }

    private async loadPDFFiles() {
        // 使用 Obsidian API 获取所有 PDF 文件
        const allFiles = this.app.vault.getFiles();
        const pdfFiles = allFiles.filter(f => f.extension === "pdf");

        this.pdfFiles = pdfFiles.map(file => ({
            file,
            name: file.basename,
            path: file.path,
            size: file.stat.size,
            sizeFormatted: this.formatFileSize(file.stat.size),
            folder: file.parent?.path || "/"
        }));

        this.filteredFiles = [...this.pdfFiles];
    }

    private createFileList(container: HTMLElement) {
        this.fileListEl = container.createDiv({ cls: "deeppdf-file-list" });

        if (this.filteredFiles.length === 0) {
            this.showEmptyState(this.fileListEl);
        } else {
            this.renderFileList(this.fileListEl);
        }
    }

    private renderFileList(container: HTMLElement) {
        container.empty();

        this.filteredFiles.forEach((fileInfo, index) => {
            const fileItem = this.createFileItem(fileInfo, index);
            container.appendChild(fileItem);
        });
    }

    private createFileItem(fileInfo: PDFFileInfo, index: number): HTMLElement {
        const item = document.createElement("div");
        item.addClass("deeppdf-file-item", "deeppdf-animate-fade-in");
        item.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

        // 图标和文件名
        const info = item.createDiv({ cls: "deeppdf-file-item-info" });

        const icon = info.createDiv({ cls: "deeppdf-file-icon" });
        icon.innerHTML = Icons.filePdf;

        const details = info.createDiv({ cls: "deeppdf-file-details" });

        const name = details.createDiv({ cls: "deeppdf-file-name" });
        name.textContent = fileInfo.name;

        const meta = details.createDiv({ cls: "deeppdf-file-meta" });

        const folderBadge = meta.createSpan({ cls: "deeppdf-folder-badge" });
        folderBadge.innerHTML = `${Icons.folder} ${fileInfo.folder}`;

        const sizeBadge = meta.createSpan({ cls: "deeppdf-size-badge" });
        sizeBadge.textContent = fileInfo.sizeFormatted;

        // 选择按钮
        const selectBtn = item.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-primary deeppdf-btn-sm"
        });
        selectBtn.textContent = "选择";
        selectBtn.addEventListener("click", () => {
            this.onSelect(fileInfo);
            this.close();
        });

        // 整个卡片可点击
        item.addEventListener("click", (e) => {
            if (e.target !== selectBtn) {
                this.onSelect(fileInfo);
                this.close();
            }
        });

        return item;
    }

    private showEmptyState(container: HTMLElement) {
        container.innerHTML = `
            <div class="deeppdf-empty-state">
                <div class="deeppdf-empty-icon">${Icons.empty}</div>
                <div class="deeppdf-empty-text">未找到 PDF 文件</div>
                <div class="deeppdf-empty-hint">
                    ${this.searchInput && this.searchInput.value
                        ? "尝试使用其他关键词搜索"
                        : "当前 vault 中没有 PDF 文件"}
                </div>
            </div>
        `;
    }

    private filterFiles(query: string) {
        const searchTerm = query.toLowerCase().trim();

        if (!searchTerm) {
            this.filteredFiles = [...this.pdfFiles];
        } else {
            this.filteredFiles = this.pdfFiles.filter(f =>
                f.name.toLowerCase().includes(searchTerm) ||
                f.path.toLowerCase().includes(searchTerm) ||
                f.folder.toLowerCase().includes(searchTerm)
            );
        }

        if (this.fileListEl) {
            if (this.filteredFiles.length === 0) {
                this.showEmptyState(this.fileListEl);
            } else {
                this.renderFileList(this.fileListEl);
            }
        }

        // 更新计数
        const countEl = this.contentEl.querySelector(".deeppdf-file-count");
        if (countEl) {
            this.updateFileCount(countEl as HTMLElement);
        }
    }

    private updateFileCount(container: HTMLElement) {
        const total = this.pdfFiles.length;
        const filtered = this.filteredFiles.length;

        if (total === 0) {
            container.textContent = "当前 vault 中没有 PDF 文件";
        } else if (filtered === total) {
            container.textContent = `共 ${total} 个 PDF 文件`;
        } else {
            container.textContent = `找到 ${filtered} / ${total} 个 PDF 文件`;
        }
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.removeClass("deeppdf-modal", "pdf-file-selector");
    }
}

// ==================== 快速选择器（FuzzySuggestModal）====================
export class PDFQuickSelector extends FuzzySuggestModal<PDFFileInfo> {
    private pdfFiles: PDFFileInfo[] = [];
    private onSelect: (fileInfo: PDFFileInfo) => void;

    constructor(app: App, onSelect: (fileInfo: PDFFileInfo) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder("输入文件名搜索...");
    }

    async onOpen() {
        // 加载 PDF 文件
        const allFiles = this.app.vault.getFiles();
        const pdfFiles = allFiles.filter(f => f.extension === "pdf");

        this.pdfFiles = pdfFiles.map(file => ({
            file,
            name: file.basename,
            path: file.path,
            size: file.stat.size,
            sizeFormatted: this.formatFileSize(file.stat.size),
            folder: file.parent?.path || "/"
        }));

        super.onOpen();
    }

    getItems(): PDFFileInfo[] {
        return this.pdfFiles;
    }

    getItemText(item: PDFFileInfo): string {
        return `${item.name} (${item.folder})`;
    }

    onChooseItem(item: PDFFileInfo, evt: MouseEvent | KeyboardEvent) {
        this.onSelect(item);
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }
}
