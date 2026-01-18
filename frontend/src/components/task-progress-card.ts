/**
 * DeepPDF - 任务进度卡片组件
 * 用于显示上传、索引等长时间运行任务的进度
 */

// ==================== 任务类型定义 ====================
export type TaskType = 'upload' | 'index' | 'query';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface TaskState {
    id: string;
    type: TaskType;
    status: TaskStatus;
    title: string;
    message: string;
    progress: number; // 0-100
    currentStep?: string;
    totalSteps?: number;
    completedSteps?: number;
    startTime: number;
    endTime?: number;
    error?: string;
    result?: any;
}

// ==================== SVG 图标 ====================
const Icons = {
    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    index: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    alert: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    xCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

// ==================== 任务进度卡片类 ====================
export class TaskProgressCard {
    private task: TaskState;
    private container: HTMLElement;
    private onCancel?: (taskId: string) => void;
    private onRetry?: (taskId: string) => void;
    private updateTimer?: number;

    constructor(
        task: TaskState,
        container: HTMLElement,
        options?: {
            onCancel?: (taskId: string) => void;
            onRetry?: (taskId: string) => void;
        }
    ) {
        this.task = task;
        this.container = container;
        this.onCancel = options?.onCancel;
        this.onRetry = options?.onRetry;
    }

    render(): HTMLElement {
        const card = document.createElement("div");
        card.addClass("deeppdf-task-card");
        card.setAttribute("data-task-id", this.task.id);
        card.setAttribute("data-task-status", this.task.status);

        // 根据状态设置样式
        this.updateCardClass(card);

        // 卡片头部
        const header = this.createHeader();
        card.appendChild(header);

        // 进度条
        if (this.task.status === 'processing' || this.task.status === 'pending') {
            const progressBar = this.createProgressBar();
            card.appendChild(progressBar);
        }

        // 详细信息
        const details = this.createDetails();
        card.appendChild(details);

        // 错误信息（如果有）
        if (this.task.error && this.task.status === 'failed') {
            const errorSection = this.createErrorSection();
            card.appendChild(errorSection);
        }

        // 操作按钮
        const actions = this.createActions();
        if (actions) {
            card.appendChild(actions);
        }

        // 更新时间显示
        this.startTimeUpdates(card);

        return card;
    }

    update(newTask: Partial<TaskState>): void {
        this.task = { ...this.task, ...newTask };

        // 查找现有卡片并更新
        const existingCard = this.container.querySelector(`[data-task-id="${this.task.id}"]`) as HTMLElement;
        if (existingCard) {
            const newCard = this.render();
            existingCard.replaceWith(newCard);
        }
    }

    private updateCardClass(card: HTMLElement): void {
        card.className = "deeppdf-task-card";

        switch (this.task.status) {
            case 'processing':
                card.addClass("deeppdf-task-processing");
                break;
            case 'completed':
                card.addClass("deeppdf-task-completed");
                break;
            case 'failed':
                card.addClass("deeppdf-task-failed");
                break;
            case 'cancelled':
                card.addClass("deeppdf-task-cancelled");
                break;
        }
    }

    private createHeader(): HTMLElement {
        const header = document.createElement("div");
        header.addClass("deeppdf-task-header");

        // 图标
        const icon = header.createDiv({ cls: "deeppdf-task-icon" });
        icon.innerHTML = this.getTaskIcon();

        // 标题和信息
        const info = header.createDiv({ cls: "deeppdf-task-info" });

        const title = info.createDiv({ cls: "deeppdf-task-title" });
        title.textContent = this.task.title;

        const statusBadge = info.createDiv({ cls: "deeppdf-task-status-badge" });
        statusBadge.addClass("deeppdf-status-" + this.task.status);
        statusBadge.textContent = this.getStatusText();

        // 时间
        const time = header.createDiv({ cls: "deeppdf-task-time" });
        time.innerHTML = Icons.clock + " " + this.getElapsedTime();

        return header;
    }

    private createProgressBar(): HTMLElement {
        const progressContainer = document.createElement("div");
        progressContainer.addClass("deeppdf-task-progress");

        const progressBar = document.createElement("div");
        progressBar.addClass("deeppdf-progress-bar");
        progressBar.style.width = this.task.progress + "%";

        // 添加动画效果
        if (this.task.status === 'processing') {
            progressBar.addClass("deeppdf-progress-animated");
        }

        const progressText = document.createElement("div");
        progressText.addClass("deeppdf-progress-text");
        progressText.textContent = this.task.progress + "%";

        progressContainer.appendChild(progressBar);
        progressContainer.appendChild(progressText);

        return progressContainer;
    }

    private createDetails(): HTMLElement {
        const details = document.createElement("div");
        details.addClass("deeppdf-task-details");

        // 当前步骤
        if (this.task.currentStep) {
            const step = details.createDiv({ cls: "deeppdf-task-step" });

            const stepIcon = step.createSpan({ cls: "deeppdf-step-icon" });
            stepIcon.innerHTML = Icons.file;

            const stepText = step.createSpan({ cls: "deeppdf-step-text" });
            stepText.textContent = this.task.currentStep;

            // 步骤进度
            if (this.task.totalSteps && this.task.completedSteps !== undefined) {
                const stepProgress = step.createSpan({ cls: "deeppdf-step-progress" });
                stepProgress.textContent = "(" + this.task.completedSteps + "/" + this.task.totalSteps + ")";
            }
        }

        // 消息
        if (this.task.message) {
            const message = details.createDiv({ cls: "deeppdf-task-message" });
            message.textContent = this.task.message;
        }

        return details;
    }

    private createErrorSection(): HTMLElement {
        const errorSection = document.createElement("div");
        errorSection.addClass("deeppdf-task-error");

        const errorIcon = errorSection.createSpan({ cls: "deeppdf-error-icon" });
        errorIcon.innerHTML = Icons.alert;

        const errorMessage = errorSection.createSpan({ cls: "deeppdf-error-message" });
        errorMessage.textContent = this.task.error || "未知错误";

        return errorSection;
    }

    private createActions(): HTMLElement | null {
        const actions = document.createElement("div");
        actions.addClass("deeppdf-task-actions");

        if (this.task.status === 'processing' || this.task.status === 'pending') {
            // 取消按钮
            const cancelBtn = actions.createEl("button", {
                cls: "deeppdf-btn deeppdf-btn-ghost deeppdf-btn-sm"
            });
            cancelBtn.innerHTML = Icons.xCircle + " 取消";
            cancelBtn.addEventListener("click", () => {
                if (this.onCancel) {
                    this.onCancel(this.task.id);
                }
            });
        } else if (this.task.status === 'failed') {
            // 重试按钮
            const retryBtn = actions.createEl("button", {
                cls: "deeppdf-btn deeppdf-btn-secondary deeppdf-btn-sm"
            });
            retryBtn.innerHTML = Icons.spinner + " 重试";
            retryBtn.addEventListener("click", () => {
                if (this.onRetry) {
                    this.onRetry(this.task.id);
                }
            });
        } else if (this.task.status === 'completed') {
            // 完成时间
            if (this.task.endTime) {
                const duration = actions.createSpan({ cls: "deeppdf-task-duration" });
                const elapsed = this.task.endTime - this.task.startTime;
                duration.textContent = "耗时 " + this.formatDuration(elapsed);
            }
        }

        if (actions.children.length === 0) {
            return null;
        }

        return actions;
    }

    private getTaskIcon(): string {
        switch (this.task.type) {
            case 'upload':
                return Icons.upload;
            case 'index':
                return Icons.index;
            case 'query':
                return Icons.search;
            default:
                return Icons.file;
        }
    }

    private getStatusText(): string {
        switch (this.task.status) {
            case 'pending':
                return "等待中";
            case 'processing':
                return "处理中";
            case 'completed':
                return "已完成";
            case 'failed':
                return "失败";
            case 'cancelled':
                return "已取消";
            default:
                return "";
        }
    }

    private getElapsedTime(): string {
        const now = Date.now();
        const elapsed = now - this.task.startTime;
        return this.formatDuration(elapsed);
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return hours + "小时" + (minutes % 60) + "分钟";
        } else if (minutes > 0) {
            return minutes + "分钟" + (seconds % 60) + "秒";
        } else {
            return seconds + "秒";
        }
    }

    private startTimeUpdates(card: HTMLElement): void {
        // 清除之前的定时器
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        // 如果任务正在处理中，每秒更新时间
        if (this.task.status === 'processing' || this.task.status === 'pending') {
            this.updateTimer = window.setInterval(() => {
                const timeEl = card.querySelector(".deeppdf-task-time");
                if (timeEl) {
                    timeEl.innerHTML = Icons.clock + " " + this.getElapsedTime();
                }
            }, 1000);
        }
    }

    destroy(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
    }
}

// ==================== 工厂函数 ====================
export function createTaskCard(
    task: TaskState,
    container: HTMLElement,
    options?: {
        onCancel?: (taskId: string) => void;
        onRetry?: (taskId: string) => void;
    }
): TaskProgressCard {
    const card = new TaskProgressCard(task, container, options);
    const element = card.render();
    container.appendChild(element);
    return card;
}
