/**
 * DeepPDF - PDF 文件选择器
 * 使用 Obsidian API 获取 vault 中的 PDF 文件
 * 支持从系统上传文件
 */

import { join } from "path";
import { type App, Modal, FuzzySuggestModal, type TFile, Notice } from "obsidian";
import { getVaultPath } from "../utils/mobile-fs.js";

// ==================== 文档类型 ====================
export type DocumentType = "pdf" | "epub";

// ==================== SVG 图标 ====================
const Icons = {
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    filePdf: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><text x="7" y="17" font-size="8" fill="currentColor" stroke="none">PDF</text></svg>`,
    fileEpub: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><text x="6" y="17" font-size="6" fill="currentColor" stroke="none">EPUB</text></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    empty: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`
};

// ==================== 文档文件信息 ====================
export interface DocumentFileInfo {
    file: TFile;
    name: string;
    path: string;
    size: number;
    sizeFormatted: string;
    folder: string;
    docType: DocumentType;
}

// 保持向后兼容的类型别名
export interface PDFFileInfo extends Omit<DocumentFileInfo, 'docType'> {
    docType: 'pdf';
}

// ==================== 系统上传文件信息 ====================
export interface SystemFileInfo {
    file: File;
    name: string;
    size: number;
    sizeFormatted: string;
    docType: DocumentType;
}

// ==================== 选择结果类型 ====================
export type FileSelectResult = DocumentFileInfo | SystemFileInfo;

// ==================== 判断是否为系统上传文件 ====================
export function isSystemFileInfo(info: FileSelectResult): info is SystemFileInfo {
    return 'file' in info && info.file instanceof File;
}

// ==================== 文档文件选择器模态框 ====================
export class PDFFileSelectorModal extends Modal {
    private onSelect: (fileInfo: FileSelectResult) => void;
    private documentFiles: DocumentFileInfo[] = [];
    private filteredFiles: DocumentFileInfo[] = [];
    private searchInput: HTMLInputElement | null = null;
    private fileListEl: HTMLElement | null = null;
    private fileCountEl: HTMLElement | null = null;
    private uploadInput: HTMLInputElement | null = null;

    constructor(app: App, onSelect: (fileInfo: FileSelectResult) => void) {
        super(app);
        this.onSelect = onSelect;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("deeppdf-modal", "pdf-file-selector");

        // 创建头部
        this.createHeader(contentEl);

        // 创建搜索框和上传按钮
        this.createSearchBox(contentEl);

        // 加载文档文件（PDF 和 EPUB）
        await this.loadDocumentFiles();

        // 更新文件计数（在加载完成后）
        if (this.fileCountEl) {
            this.updateFileCount(this.fileCountEl);
        }

        // 创建文件列表
        this.createFileList(contentEl);
    }

    private createHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: "deeppdf-modal-header" });

        const headerLeft = header.createDiv({ cls: "deeppdf-modal-header-left" });
        const logo = headerLeft.createDiv({ cls: "deeppdf-logo" });
        logo.innerHTML = Icons.filePdf;

        headerLeft.createEl("h2", {
            text: "选择 PDF 或 EPUB 文件",
            cls: "deeppdf-modal-title"
        });

        const description = container.createEl("p", {
            text: "从 Vault 中选择文件，或从系统上传新文件",
            cls: "deeppdf-modal-description"
        });
    }

    private createSearchBox(container: HTMLElement) {
        const searchContainer = container.createDiv({ cls: "deeppdf-search-container" });

        const searchWrapper = searchContainer.createDiv({ cls: "deeppdf-search-wrapper" });

        this.searchInput = searchWrapper.createEl("input", {
            cls: "deeppdf-search-input",
            attr: { type: "text", placeholder: "搜索 Vault 中的文档..." }
        });

        this.searchInput.addEventListener("input", () => {
            this.filterFiles(this.searchInput?.value || "");
        });

        // 上传按钮
        const uploadBtn = searchWrapper.createEl("button", {
            cls: "deeppdf-upload-btn",
            attr: { type: "button", title: "从系统上传文件" }
        });
        uploadBtn.innerHTML = Icons.upload;

        // 隐藏的文件输入
        this.uploadInput = searchWrapper.createEl("input", {
            cls: "deeppdf-hidden-input",
            attr: {
                type: "file",
                accept: ".pdf,.epub",
                multiple: "false"
            }
        }) as HTMLInputElement;

        uploadBtn.addEventListener("click", () => {
            this.uploadInput?.click();
        });

        this.uploadInput.addEventListener("change", () => {
            this.handleSystemFileSelect();
        });

        // 显示文件数量（稍后更新）
        this.fileCountEl = searchContainer.createDiv({ cls: "deeppdf-file-count" });
    }

    /**
     * 处理系统文件选择
     */
    private handleSystemFileSelect() {
        if (!this.uploadInput || !this.uploadInput.files || this.uploadInput.files.length === 0) {
            return;
        }

        const file = this.uploadInput.files[0];
        const extension = file.name.split('.').pop()?.toLowerCase() as DocumentType;

        if (!['pdf', 'epub'].includes(extension)) {
            new Notice('仅支持 PDF 和 EPUB 文件');
            return;
        }

        const systemFileInfo: SystemFileInfo = {
            file,
            name: file.name.replace(/\.(pdf|epub)$/i, ''),
            size: file.size,
            sizeFormatted: this.formatFileSize(file.size),
            docType: extension
        };

        this.onSelect(systemFileInfo);
        this.close();
    }

    private async loadDocumentFiles() {
        // 使用 Obsidian API 获取所有 PDF 和 EPUB 文件
        const allFiles = this.app.vault.getFiles();
        const supportedExtensions = ["pdf", "epub"];
        const documentFiles = allFiles.filter(f =>
            supportedExtensions.includes(f.extension)
        );

        // 获取 vault 的基础路径
        const basePath = getVaultPath(this.app);

        this.documentFiles = documentFiles.map(file => {
            // 拼接绝对路径
            const absolutePath = basePath ? join(basePath, file.path) : file.path;

            return {
                file,
                name: file.basename,
                path: absolutePath, // 使用绝对路径
                size: file.stat.size,
                sizeFormatted: this.formatFileSize(file.stat.size),
                folder: file.parent?.path || "/",
                docType: file.extension as DocumentType
            };
        });

        this.filteredFiles = [...this.documentFiles];
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

    private createFileItem(fileInfo: DocumentFileInfo, index: number): HTMLElement {
        const item = document.createElement("div");
        item.addClass("deeppdf-file-item", "deeppdf-animate-fade-in");
        item.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

        // 图标和文件名
        const info = item.createDiv({ cls: "deeppdf-file-item-info" });

        const icon = info.createDiv({ cls: "deeppdf-file-icon" });
        // 根据文档类型选择图标
        icon.innerHTML = fileInfo.docType === "epub" ? Icons.fileEpub : Icons.filePdf;

        const details = info.createDiv({ cls: "deeppdf-file-details" });

        const name = details.createDiv({ cls: "deeppdf-file-name" });
        name.textContent = fileInfo.name;

        const meta = details.createDiv({ cls: "deeppdf-file-meta" });

        // 文档类型徽章
        const typeBadge = meta.createSpan({ cls: "deeppdf-type-badge" });
        typeBadge.textContent = fileInfo.docType.toUpperCase();
        typeBadge.setAttribute("data-doc-type", fileInfo.docType);

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
                <div class="deeppdf-empty-text">未找到文档</div>
                <div class="deeppdf-empty-hint">
                    ${this.searchInput && this.searchInput.value
                ? "尝试使用其他关键词搜索"
                : "当前 vault 中没有 PDF 或 EPUB 文件"}
                </div>
            </div>
        `;
    }

    private filterFiles(query: string) {
        const searchTerm = query.toLowerCase().trim();

        if (!searchTerm) {
            this.filteredFiles = [...this.documentFiles];
        } else {
            this.filteredFiles = this.documentFiles.filter(f =>
                f.name.toLowerCase().includes(searchTerm) ||
                f.path.toLowerCase().includes(searchTerm) ||
                f.folder.toLowerCase().includes(searchTerm) ||
                f.docType.toLowerCase().includes(searchTerm)
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
        const total = this.documentFiles.length;
        const filtered = this.filteredFiles.length;

        if (total === 0) {
            container.textContent = "当前 vault 中没有文档";
        } else if (filtered === total) {
            container.textContent = `共 ${total} 个文档`;
        } else {
            container.textContent = `找到 ${filtered} / ${total} 个文档`;
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
export class PDFQuickSelector extends FuzzySuggestModal<DocumentFileInfo> {
    private documentFiles: DocumentFileInfo[] = [];
    private onSelect: (fileInfo: DocumentFileInfo) => void;

    constructor(app: App, onSelect: (fileInfo: DocumentFileInfo) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder("输入文件名搜索...");
    }

    async onOpen() {
        // 加载文档文件（PDF 和 EPUB）
        const allFiles = this.app.vault.getFiles();
        const supportedExtensions = ["pdf", "epub"];
        const documentFiles = allFiles.filter(f =>
            supportedExtensions.includes(f.extension)
        );

        // 获取 vault 的基础路径
        const basePath = getVaultPath(this.app);

        this.documentFiles = documentFiles.map(file => {
            // 拼接绝对路径
            const absolutePath = basePath ? join(basePath, file.path) : file.path;

            return {
                file,
                name: file.basename,
                path: absolutePath, // 使用绝对路径
                size: file.stat.size,
                sizeFormatted: this.formatFileSize(file.stat.size),
                folder: file.parent?.path || "/",
                docType: file.extension as DocumentType
            };
        });

        super.onOpen();
    }

    getItems(): DocumentFileInfo[] {
        return this.documentFiles;
    }

    getItemText(item: DocumentFileInfo): string {
        return `${item.name} (${item.folder}) [${item.docType.toUpperCase()}]`;
    }

    onChooseItem(item: DocumentFileInfo, evt: MouseEvent | KeyboardEvent) {
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
