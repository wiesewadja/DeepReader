/**
 * 确认弹窗组件
 *
 * 可访问性 (WCAG 4.1.2 / 4.1.3):
 *  - modalEl 挂 role=dialog + aria-modal=true
 *  - aria-labelledby 指向标题 id
 *  - aria-describedby 指向消息 id
 *  - 异步 onConfirm 期间 confirm 按钮设 aria-busy=true 防止重复点击
 *  - onConfirm 抛错时恢复按钮可用状态，modal 不关闭（允许重试）
 */

import { type App, Modal, Setting } from "obsidian";
import { serviceLog } from "../utils/logger.js";

export interface ConfirmModalCheckbox {
	label: string;
	checked?: boolean; // 默认是否选中
	description?: string; // 复选框下方的描述文字
}

export interface ConfirmModalOptions {
	confirmLabel?: string;
	cancelLabel?: string;
	isDestructive?: boolean;
	checkbox?: ConfirmModalCheckbox; // 可选的复选框配置
	onCancel?: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
	private title: string;
	private message: string;
	private onConfirm: (checkboxChecked?: boolean) => void | Promise<void>;
	private options: ConfirmModalOptions;
	private checkboxValue: boolean = false;
	/** 防止重复点击：true 表示 onConfirm 正在进行中 */
	private isConfirming: boolean = false;
	/** aria-labelledby / aria-describedby 使用的 id 集中点 */
	private static readonly TITLE_ID = "deeppdf-confirm-title";
	private static readonly MESSAGE_ID = "deeppdf-confirm-message";
	/** 加载中状态的按钮文案 */
	private static readonly LOADING_LABEL = "处理中...";

	constructor(
		app: App,
		title: string,
		message: string,
		onConfirm: (checkboxChecked?: boolean) => void | Promise<void>,
		options: ConfirmModalOptions = {},
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
		const { contentEl, modalEl } = this;
		const {
			confirmLabel = "Confirm",
			cancelLabel = "Cancel",
			checkbox,
			onCancel,
		} = this.options;

		// 标题
		const titleEl = contentEl.createEl("h2", {
			text: this.title,
			attr: { id: ConfirmModal.TITLE_ID },
		});

		// 消息（支持换行）
		const messageEl = contentEl.createEl("p", {
			attr: { id: ConfirmModal.MESSAGE_ID },
		});
		messageEl.style.whiteSpace = "pre-wrap";
		messageEl.textContent = this.message;

		// 屏幕阅读器可访问性：dialog 语义 + 关联标题/消息
		modalEl.setAttribute("role", "dialog");
		modalEl.setAttribute("aria-modal", "true");
		modalEl.setAttribute("aria-labelledby", ConfirmModal.TITLE_ID);
		modalEl.setAttribute("aria-describedby", ConfirmModal.MESSAGE_ID);

		// 复选框（如果配置了）
		if (checkbox) {
			const checkboxContainer = contentEl.createDiv({
				cls: "deeppdf-confirm-checkbox-container",
			});
			checkboxContainer.style.marginTop = "12px";
			checkboxContainer.style.marginBottom = "16px";
			checkboxContainer.style.padding = "8px 12px";
			checkboxContainer.style.backgroundColor = "var(--background-secondary)";
			checkboxContainer.style.borderRadius = "6px";

			const labelEl = checkboxContainer.createEl("label", {
				cls: "deeppdf-confirm-checkbox-label",
			});
			labelEl.style.display = "flex";
			labelEl.style.alignItems = "flex-start";
			labelEl.style.gap = "8px";
			labelEl.style.cursor = "pointer";

			const checkboxInput = labelEl.createEl("input", {
				attr: { type: "checkbox" },
			});
			checkboxInput.checked = this.checkboxValue;
			checkboxInput.style.marginTop = "3px";
			checkboxInput.addEventListener("change", () => {
				this.checkboxValue = checkboxInput.checked;
			});

			const textContainer = labelEl.createDiv();
			textContainer.createEl("span", { text: checkbox.label });

			if (checkbox.description) {
				const descEl = textContainer.createEl("div", {
					text: checkbox.description,
				});
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
		const defaultConfirmLabel = confirmLabel; // 闭包捕获，避免恢复时丢失原始文案
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(cancelLabel).onClick(async () => {
					try {
						if (onCancel) await onCancel();
					} finally {
						this.close();
					}
				}),
			)
			.addButton((btn) => {
				const confirmBtn = btn.setButtonText(defaultConfirmLabel).setCta();

				confirmBtn.onClick(async () => {
					// 防止异步 onConfirm 期间被重复点击
					if (this.isConfirming) {
						return;
					}
					this.isConfirming = true;
					confirmBtn.setDisabled(true);
					confirmBtn.setButtonText(ConfirmModal.LOADING_LABEL);
					confirmBtn.buttonEl.setAttribute("aria-busy", "true");

					try {
						if (checkbox) {
							await this.onConfirm(this.checkboxValue);
						} else {
							await this.onConfirm();
						}
						this.close();
					} catch (err) {
						// 错误恢复：让用户可重试，modal 保持打开
						serviceLog("[DeepPDF] ConfirmModal onConfirm error:", err);
						this.isConfirming = false;
						confirmBtn.setDisabled(false);
						confirmBtn.setButtonText(defaultConfirmLabel);
						confirmBtn.buttonEl.removeAttribute("aria-busy");
					}
				});

				return confirmBtn;
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
