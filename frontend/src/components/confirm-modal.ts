
import { App, Modal, Setting } from 'obsidian';

export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: () => void;
    private confirmLabel: string;
    private cancelLabel: string;
    private isDestructive: boolean;

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: () => void,
        options: {
            confirmLabel?: string;
            cancelLabel?: string;
            isDestructive?: boolean;
        } = {}
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmLabel = options.confirmLabel || 'Confirm';
        this.cancelLabel = options.cancelLabel || 'Cancel';
        this.isDestructive = options.isDestructive || false;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.title });

        // 支持多行消息
        const lines = this.message.split('\\n');
        lines.forEach(line => {
            contentEl.createEl('p', { text: line });
        });

        const buttonContainer = contentEl.createDiv('modal-button-container');

        // Cancel Button
        const cancelBtn = buttonContainer.createEl('button', { text: this.cancelLabel });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        // Confirm Button
        const confirmBtn = buttonContainer.createEl('button', {
            text: this.confirmLabel,
            cls: this.isDestructive ? 'mod-warning' : 'mod-cta'
        });

        // 聚焦主按钮
        setTimeout(() => confirmBtn.focus(), 50);

        confirmBtn.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
