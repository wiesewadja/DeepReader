/**
 * 确认弹窗组件
 */

import { type App, Modal, Setting } from "obsidian";

export interface ConfirmModalCheckbox {
    label: string;
    checked?: boolean;  // 默认是否选中
    description?: string;  // 复选框下方的描述文字
}

export interface ConfirmModalOptions {
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
    checkbox?: ConfirmModalCheckbox;  // 可选的复选框配置
    onCancel?: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: (checkboxChecked?: boolean) => void | Promise<void>;
    private options: ConfirmModalOptions;
    private checkboxValue: boolean = false;

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: (checkboxChecked?: boolean) => void | Promise<void>,
        options: ConfirmModalOptions = {}
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.options = options;

        // 初始化复选框默认值
        if (options.checkbox) {
            this.checkboxValue = options.checkbox.checked ?? false;
        }
    }

    onOpen() {
        const { contentEl } = this;
        const { confirmLabel = "Confirm", cancelLabel = "Cancel", checkbox, onCancel } = this.options;

        // 标题
        contentEl.createEl("h2", { text: this.title });

        // 消息（支持换行）
        const messageEl = contentEl.createEl("p");
        messageEl.style.whiteSpace = "pre-wrap";
        messageEl.textContent = this.message;

        // 复选框（如果配置了）
        if (checkbox) {
            const checkboxContainer = contentEl.createDiv({ cls: "deeppdf-confirm-checkbox-container" });
            checkboxContainer.style.marginTop = "12px";
            checkboxContainer.style.marginBottom = "16px";
            checkboxContainer.style.padding = "8px 12px";
            checkboxContainer.style.backgroundColor = "var(--background-secondary)";
            checkboxContainer.style.borderRadius = "6px";

            const labelEl = checkboxContainer.createEl("label", { cls: "deeppdf-confirm-checkbox-label" });
            labelEl.style.display = "flex";
            labelEl.style.alignItems = "flex-start";
            labelEl.style.gap = "8px";
            labelEl.style.cursor = "pointer";

            const checkboxInput = labelEl.createEl("input", { attr: { type: "checkbox" } });
            checkboxInput.checked = this.checkboxValue;
            checkboxInput.style.marginTop = "3px";
            checkboxInput.addEventListener("change", () => {
                this.checkboxValue = checkboxInput.checked;
            });

            const textContainer = labelEl.createDiv();
            textContainer.createEl("span", { text: checkbox.label });

            if (checkbox.description) {
                const descEl = textContainer.createEl("div", { text: checkbox.description });
                descEl.style.fontSize = "12px";
                descEl.style.color = "var(--text-muted)";
                descEl.style.marginTop = "2px";
            }

            // 点击整个标签区域也能切换复选框
            labelEl.addEventListener("click", (e) => {
                if (e.target !== checkboxInput) {
                    checkboxInput.checked = !checkboxInput.checked;
                    this.checkboxValue = checkboxInput.checked;
                }
            });
        }

        // 按钮区域
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(cancelLabel)
                    .onClick(async () => {
                        try {
                            if (onCancel) await onCancel();
                        } finally {
                            this.close();
                        }
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText(confirmLabel)
                    .setCta()
                    .onClick(async () => {
                        // 如果有复选框，传递复选框状态
                        if (checkbox) {
                            await this.onConfirm(this.checkboxValue);
                        } else {
                            await this.onConfirm();
                        }
                        this.close();
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
