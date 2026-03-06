/**
 * 确认弹窗组件
 */

import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalOptions {
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
}

export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: () => void | Promise<void>;
    private options: ConfirmModalOptions;

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: () => void | Promise<void>,
        options: ConfirmModalOptions = {}
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;
        const { confirmLabel = "Confirm", cancelLabel = "Cancel" } = this.options;

        // 标题
        contentEl.createEl("h2", { text: this.title });

        // 消息（支持换行）
        const messageEl = contentEl.createEl("p");
        messageEl.style.whiteSpace = "pre-wrap";
        messageEl.textContent = this.message;

        // 按钮区域
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(cancelLabel)
                    .onClick(() => {
                        this.close();
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText(confirmLabel)
                    .setCta()
                    .onClick(async () => {
                        await this.onConfirm();
                        this.close();
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
