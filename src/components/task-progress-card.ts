import { STEP_CONFIG, TaskProgress } from "../types/index.js";

/**
 * 任务进度卡片组件
 *
 * 显示索引进度的详细信息，包括：
 * - 文件名
 * - 当前步骤图标和标签
 * - 进度百分比和进度条
 * - 后端返回的详细消息
 * - 取消按钮
 */
export class TaskProgressCard {
    private el: HTMLElement;
    private progress: TaskProgress;
    private onCancel?: () => void;

    constructor(progress: TaskProgress, onCancel?: () => void) {
        this.progress = progress;
        this.onCancel = onCancel;
        this.el = this.render();
    }

    private render(): HTMLElement {
        const card = document.createElement("div");
        card.addClass("deeppdf-task-card");

        if (this.progress.status === "failed") {
            card.addClass("deeppdf-task-card-failed");
            this.renderFailedState(card);
        } else if (this.progress.status === "completed") {
            card.addClass("deeppdf-task-card-completed");
            this.renderCompletedState(card);
        } else {
            this.renderProcessingState(card);
        }

        return card;
    }

    private renderProcessingState(card: HTMLElement): void {
        const pdfName = this.progress.pdf_name || "未知文件";
        const percent = this.progress.progress_percent || 0;
        const step = this.progress.current_step || "start";
        const message = this.progress.message || "";
        const stepConfig = STEP_CONFIG[step] || STEP_CONFIG["start"];

        // 文件名行
        const nameEl = card.createEl("div", { cls: "deeppdf-task-name" });
        nameEl.innerHTML = `📄 ${this.escapeHtml(pdfName)}`;

        // 进度条
        const progressBar = card.createEl("div", { cls: "deeppdf-task-progress-bar" });
        const progressFill = progressBar.createEl("div", { cls: "deeppdf-task-progress-fill" });
        progressFill.style.width = `${percent}%`;

        // 进度状态行（步骤 + 百分比）
        const progressText = card.createEl("div", { cls: "deeppdf-task-progress-text" });
        progressText.innerHTML = `
            <span class="deeppdf-task-step">${stepConfig.icon} ${stepConfig.label}</span>
            <span class="deeppdf-task-percent">${percent}%</span>
        `;

        // 详细消息行（如果有且与步骤标签不同）
        if (message && message !== stepConfig.label) {
            const messageEl = card.createEl("div", { cls: "deeppdf-task-message" });
            messageEl.textContent = message;
        }

        // 阶段指示器
        const phaseEl = card.createEl("div", { cls: "deeppdf-task-phase" });
        const phaseInfo = this.getPhaseInfo(percent);
        phaseEl.innerHTML = `<span class="deeppdf-phase-label">${phaseInfo.label}</span>`;

        // 取消按钮
        const cancelBtn = card.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-sm deeppdf-btn-text deeppdf-task-cancel-btn"
        });
        cancelBtn.textContent = "✕ 取消";
        cancelBtn.addEventListener("click", () => {
            if (this.onCancel) this.onCancel();
        });
    }

    /**
     * 根据进度百分比获取当前阶段信息
     */
    private getPhaseInfo(percent: number): { label: string; color: string } {
        if (percent < 15) {
            return { label: "准备阶段", color: "#94a3b8" };
        } else if (percent < 50) {
            return { label: "初始化", color: "#60a5fa" };
        } else if (percent < 60) {
            return { label: "文档解析", color: "#34d399" };
        } else if (percent < 85) {
            return { label: "生成摘要", color: "#f59e0b" };
        } else if (percent < 95) {
            return { label: "存储数据", color: "#8b5cf6" };
        } else {
            return { label: "即将完成", color: "#10b981" };
        }
    }

    private renderCompletedState(card: HTMLElement): void {
        const pdfName = this.progress.pdf_name || "未知文件";
        card.innerHTML = `
            <div class="deeppdf-task-name">✅ ${this.escapeHtml(pdfName)}</div>
            <div class="deeppdf-task-status">索引创建完成</div>
        `;
    }

    private renderFailedState(card: HTMLElement): void {
        const pdfName = this.progress.pdf_name || "未知文件";
        const error = this.progress.error || "未知错误";
        card.innerHTML = `
            <div class="deeppdf-task-name">❌ ${this.escapeHtml(pdfName)}</div>
            <div class="deeppdf-task-error">错误: ${this.escapeHtml(error)}</div>
            <button class="deeppdf-btn deeppdf-btn-sm">🔄 重试</button>
        `;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    update(progress: TaskProgress): void {
        this.progress = progress;
        // 清空当前元素
        this.el.empty();
        // 清除所有状态类
        this.el.classList.remove('deeppdf-task-card-completed', 'deeppdf-task-card-failed');
        // 重新渲染
        const newRender = this.render();
        // 更新类名
        if (progress.status === 'completed') {
            this.el.addClass('deeppdf-task-card-completed');
        } else if (progress.status === 'failed') {
            this.el.addClass('deeppdf-task-card-failed');
        }
        // 添加新渲染的内容
        Array.from(newRender.childNodes).forEach(node => {
            this.el.appendChild(node);
        });
    }

    getElement(): HTMLElement {
        return this.el;
    }
}
