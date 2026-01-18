/**
 * DeepPDF - 索引状态徽章组件
 * 用于在索引卡片上显示实时状态
 */

export type IndexStatus = 'building' | 'ready' | 'error' | 'unknown';

// ==================== SVG 图标 ====================
const StatusIcons = {
    building: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    ready: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    unknown: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

// ==================== 状态徽章类 ====================
export class IndexStatusBadge {
    private container: HTMLElement;
    private status: IndexStatus;
    private progress?: number;

    constructor(container: HTMLElement, status: IndexStatus, progress?: number) {
        this.container = container;
        this.status = status;
        this.progress = progress;
    }

    render(): HTMLElement {
        const badge = document.createElement("span");
        badge.addClass("deeppdf-index-status-badge");
        badge.addClass(`deeppdf-status-${this.status}`);

        const icon = badge.createSpan({ cls: "deeppdf-status-icon" });
        icon.innerHTML = StatusIcons[this.status] || StatusIcons.unknown;

        const text = badge.createSpan({ cls: "deeppdf-status-text" });
        text.textContent = this.getStatusText();

        // 进度动画
        if (this.status === 'building' && this.progress !== undefined) {
            badge.createSpan({ cls: "deeppdf-status-progress" }).textContent = ` ${this.progress}%`;
        }

        return badge;
    }

    update(status: IndexStatus, progress?: number): void {
        this.status = status;
        this.progress = progress;

        const existingBadge = this.container.querySelector(".deeppdf-index-status-badge");
        if (existingBadge) {
            const newBadge = this.render();
            existingBadge.replaceWith(newBadge);
        }
    }

    private getStatusText(): string {
        switch (this.status) {
            case 'building':
                return "索引中";
            case 'ready':
                return "就绪";
            case 'error':
                return "错误";
            case 'unknown':
            default:
                return "未知";
        }
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
}

// ==================== 工厂函数 ====================
export function createIndexStatusBadge(
    container: HTMLElement,
    status: IndexStatus,
    progress?: number
): IndexStatusBadge {
    const badge = new IndexStatusBadge(container, status, progress);
    const element = badge.render();
    container.appendChild(element);
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
        lastUpdated?: string;
    }
): HTMLElement {
    const badgeWrapper = container.createDiv({ cls: "deeppdf-index-badges" });

    // 状态徽章
    const statusBadge = badgeWrapper.createSpan({ cls: "deeppdf-badge" });
    statusBadge.addClass(`deeppdf-badge-${status}`);
    statusBadge.innerHTML = `${StatusIcons[status] || StatusIcons.unknown} ${IndexStatusBadge.prototype['getStatusText']?.call({ status }) || ''}`;

    // 进度（如果有）
    if (status === 'building' && options?.progress !== undefined) {
        const progressBadge = badgeWrapper.createSpan({ cls: "deeppdf-badge deeppdf-badge-progress" });
        progressBadge.textContent = `${options.progress}%`;
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
