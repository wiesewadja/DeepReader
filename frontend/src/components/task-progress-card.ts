import { STEP_CONFIG, TaskProgress } from "../types/index.js";

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
        const stepConfig = STEP_CONFIG[step] || STEP_CONFIG["start"];

        const nameEl = card.createEl("div", { cls: "deeppdf-task-name" });
        nameEl.innerHTML = `📄 ${this.escapeHtml(pdfName)}`;

        const progressBar = card.createEl("div", { cls: "deeppdf-task-progress-bar" });
        const progressFill = progressBar.createEl("div", { cls: "deeppdf-task-progress-fill" });
        progressFill.style.width = `${percent}%`;

        const progressText = card.createEl("div", { cls: "deeppdf-task-progress-text" });
        progressText.innerHTML = `
            <span>${stepConfig.icon} ${stepConfig.label}</span>
            <span>${percent}%</span>
        `;

        const cancelBtn = card.createEl("button", {
            cls: "deeppdf-btn deeppdf-btn-sm deeppdf-btn-text"
        });
        cancelBtn.textContent = "✕ 取消";
        cancelBtn.addEventListener("click", () => {
            if (this.onCancel) this.onCancel();
        });
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
