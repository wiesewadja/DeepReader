/**
 * DeepPDF - 索引状态徽章组件
 * 用于在索引卡片上显示实时状态和详细进度
 */

import { STEP_CONFIG } from "../types/index.js";

export type IndexStatus = 'building' | 'ready' | 'error' | 'unknown';

// ==================== SVG 图标 ====================
const StatusIcons = {
    building: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 0 1 1-6.219-8.56"/></svg>`,
    ready: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    unknown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

// ==================== 状态徽章类 ====================
export class IndexStatusBadge {
    private container: HTMLElement;
    private status: IndexStatus;
    private progress?: number;
    private currentStep?: string;
    private message?: string;
    private badgeEl: HTMLElement | null = null;
    private progressFillEl: HTMLElement | null = null;

    constructor(container: HTMLElement, status: IndexStatus, progress?: number, currentStep?: string, message?: string) {
        this.container = container;
        this.status = status;
        this.progress = progress;
        this.currentStep = currentStep;
        this.message = message;
        // 渲染并追加到容器
        this.badgeEl = this.render();
        this.container.appendChild(this.badgeEl);
    }

    /**
     * 根据后端状态字符串确定状态
     */
    static fromAPIStatus(apiStatus: string): IndexStatus {
        const status = apiStatus.toLowerCase();
        if (status === 'processing' || status === 'pending') {
            return 'building';
        } else if (status === 'completed' || status === 'success') {
            return 'ready';
        } else if (status === 'failed' || status === 'error') {
            return 'error';
        }
        return 'unknown';
    }

    render(): HTMLElement {
        // 创建主容器
        const wrapper = document.createElement("div");
        wrapper.className = "deeppdf-status-wrapper";

        // 状态徽章
        const badge = document.createElement("span");
        badge.className = `deeppdf-status-badge deeppdf-status-${this.status}`;

        // 状态图标
        const icon = document.createElement("span");
        icon.className = "deeppdf-status-icon";
        icon.innerHTML = StatusIcons[this.status] || StatusIcons.unknown;
        badge.appendChild(icon);

        // 状态文本
        const text = document.createElement("span");
        text.className = "deeppdf-status-text";
        text.textContent = this.getStatusText();
        badge.appendChild(text);

        // 进度百分比（仅 building 状态显示）
        if (this.status === 'building' && this.progress !== undefined) {
            const progressEl = document.createElement("span");
            progressEl.className = "deeppdf-status-progress";
            progressEl.textContent = ` ${this.progress}%`;
            badge.appendChild(progressEl);
        }

        wrapper.appendChild(badge);

        // 当前步骤详情（building 状态显示）
        if (this.status === 'building') {
            const stepInfo = document.createElement("div");
            stepInfo.className = "deeppdf-step-info";

            // 步骤标签
            const stepLabel = document.createElement("span");
            stepLabel.className = "deeppdf-step-label";
            const stepConfig = STEP_CONFIG[this.currentStep || 'start'];
            stepLabel.innerHTML = `${stepConfig.icon} ${stepConfig.label}`;
            stepInfo.appendChild(stepLabel);

            // 进度条
            if (this.progress !== undefined) {
                const progressContainer = document.createElement("div");
                progressContainer.className = "deeppdf-progress-bar-container";

                const progressBar = document.createElement("div");
                progressBar.className = "deeppdf-progress-bar";

                this.progressFillEl = document.createElement("div");
                this.progressFillEl.className = "deeppdf-progress-fill";
                this.progressFillEl.style.width = `${this.progress}%`;

                progressBar.appendChild(this.progressFillEl);
                progressContainer.appendChild(progressBar);
                stepInfo.appendChild(progressContainer);
            }

            // 详细消息（如果有且与步骤标签不同）
            if (this.message && this.currentStep) {
                const stepConfig = STEP_CONFIG[this.currentStep];
                if (!stepConfig || this.message !== stepConfig.label) {
                    const messageEl = document.createElement("div");
                    messageEl.className = "deeppdf-step-message";
                    messageEl.textContent = this.message;
                    stepInfo.appendChild(messageEl);
                }
            }

            wrapper.appendChild(stepInfo);
        }

        return wrapper;
    }

    /**
     * 更新进度
     */
    update(progress: number, currentStep?: string, message?: string): void {
        this.progress = progress;
        this.currentStep = currentStep;
        this.message = message;

        // 重新渲染
        const newBadge = this.render();

        // 替换旧元素
        this.container.innerHTML = '';
        this.container.appendChild(newBadge);
    }

    private getStatusText(): string {
        switch (this.status) {
            case 'building':
                return '索引中';
            case 'ready':
                return '就绪';
            case 'error':
                return '错误';
            case 'unknown':
            default:
                return '未知';
        }
    }
}

// ==================== 工厂函数 ====================
export function createIndexStatusBadge(
    container: HTMLElement,
    status: IndexStatus,
    progress?: number,
    currentStep?: string,
    message?: string
): IndexStatusBadge {
    const badge = new IndexStatusBadge(container, status, progress, currentStep, message);
    // render() 已经在构造函数中调用，结果存储在 badgeEl 中
    // 这里直接返回 badge 对象
    return badge;
}

/**
 * 创建带有状态的索引卡片徽章
 */
export function createIndexCardBadge(
    container: HTMLElement,
    status: IndexStatus,
    options?: {
        progress?: number;
        currentStep?: string;
        message?: string;
        lastUpdated?: string;
    }
): HTMLElement {
    const badgeWrapper = container.createDiv({ cls: "deeppdf-index-badges" });

    // 状态徽章
    const statusBadge = badgeWrapper.createSpan({ cls: "deeppdf-badge" });
    statusBadge.addClass(`deeppdf-badge-${status}`);

    const stepConfig = options?.currentStep ? STEP_CONFIG[options.currentStep] : null;
    const statusText = status === 'building' ? '索引中' :
                     status === 'ready' ? '就绪' :
                     status === 'error' ? '错误' : '未知';
    statusBadge.innerHTML = `${StatusIcons[status] || StatusIcons.unknown} ${statusText}`;

    // 进度（如果有）
    if (status === 'building' && options?.progress !== undefined) {
        const progressBadge = badgeWrapper.createSpan({ cls: "deeppdf-badge deeppdf-badge-progress" });
        progressBadge.textContent = `${options.progress}%`;
    }

    // 当前步骤（如果有）
    if (status === 'building' && options?.currentStep && stepConfig) {
        const stepBadge = badgeWrapper.createSpan({ cls: "deeppdf-badge deeppdf-badge-step" });
        stepBadge.innerHTML = `${stepConfig.icon} ${stepConfig.label}`;
    }

    // 最后更新时间（如果有）
    if (options?.lastUpdated) {
        const timeBadge = badgeWrapper.createSpan({ cls: "deeppdf-badge deeppdf-badge-time" });
        timeBadge.textContent = options.lastUpdated;
    }

    return badgeWrapper;
}

/**
 * 格式化索引的相对时间显示
 */
export function formatIndexTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;

    return date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit'
    });
}
