/**
 * DeepPDF 摘录模态框组件
 * 用于预览和编辑和保存 AI 回复的摘录
 *
 * 可访问性 (WCAG 4.1.2 / 4.1.3):
 *  - modalEl 挂 role=dialog + aria-modal=true
 *  - aria-labelledby 指向 modal 标题
 *  - 表单 label 元素设 for 属性指向对应 input/textarea id
 *  - 异步保存期间 save 按钮设 aria-busy=true / disabled 防止重复点击
 *  - 保存拋错时恢复按钮可用状态，modal 不关闭（允许重试）
 */

import { type App, Modal, Notice } from "obsidian";
import { ExcerptService } from "../../services/excerpt-service";
import { serviceLog } from "../../utils/logger.js";
import type {
	ExcerptContent,
	ExcerptMetadata,
	ExcerptOptions,
} from "../../types/excerpt";

/**
 * 摘录模态框配置
 */
export interface ExcerptModalOptions {
	/** 摘录内容 */
	content: ExcerptContent;
	/** 摘录元数据 */
	metadata: ExcerptMetadata;
	/** 应用实例 */
	app: App;
	/** 保存成功回调 */
	onSave?: (path: string) => void;
}

/**
 * 摘录模态框
 */
export class ExcerptModal extends Modal {
	private content: ExcerptContent;
	private metadata: ExcerptMetadata;
	private onSave?: (path: string) => void;

	// 表单元素
	private noteInput: HTMLTextAreaElement | null = null;
	private pathInput: HTMLInputElement | null = null;

	// 服务
	private excerptService: ExcerptService;

	/** 防止重复点击：true 表示保存正在进行中 */
	private isSaving: boolean = false;
	/** aria 关联 id 集中点（label.for 指向对应 input.id） */
	private static readonly NOTE_INPUT_ID = "deeppdf-excerpt-note-input";
	private static readonly PATH_INPUT_ID = "deeppdf-excerpt-path-input";
	/** 加载中按钮文案 */
	private static readonly SAVING_LABEL = "保存中...";

	constructor(options: ExcerptModalOptions) {
		super(options.app);
		this.content = options.content;
		this.metadata = options.metadata;
		this.onSave = options.onSave;
		this.excerptService = new ExcerptService(this.app);
	}

	onOpen() {
		const { contentEl, modalEl, titleEl } = this;

		// 设置模态框标题 + 给 title 元素一个稳定 id 以供 aria-labelledby 引用
		titleEl.setText("保存摘录");
		if (!titleEl.id) {
			titleEl.id = "deeppdf-excerpt-modal-title";
		}

		// 屏幕阅读器可访问性：dialog 语义 + 关联标题
		modalEl.setAttribute("role", "dialog");
		modalEl.setAttribute("aria-modal", "true");
		modalEl.setAttribute("aria-labelledby", titleEl.id);

		// 创建内容区域
		this.renderContent(contentEl);
	}

	/**
	 * 渲染模态框内容
	 */
	private renderContent(container: HTMLElement): void {
		// 预览区域
		this.renderPreview(container);

		// 表单区域
		this.renderForm(container);

		// 按钮区域
		this.renderButtons(container);
	}

	/**
	 * 渲染预览区域
	 */
	private renderPreview(container: HTMLElement): void {
		const previewSection = container.createEl("div", {
			cls: "deeppdf-excerpt-preview-section",
		});

		// 预览内容卡片
		const previewCard = previewSection.createEl("div", {
			cls: "deeppdf-excerpt-preview-card",
		});

		// 显示原始内容
		const contentEl = previewCard.createEl("div", {
			cls: "deeppdf-excerpt-content-preview",
		});
		contentEl.textContent = this.content.text;

		// 元数据标签
		const metaEl = previewCard.createEl("div", {
			cls: "deeppdf-excerpt-meta-tags",
		});

		// 来源类型标签
		const typeTag = metaEl.createEl("span", {
			cls: "deeppdf-excerpt-tag deeppdf-excerpt-tag-type",
		});
		if (this.metadata.sourceType === "reading") {
			typeTag.createEl("span", { cls: "deeppdf-excerpt-tag-icon", text: "📖" });
			typeTag.createEl("span", { text: "章节摘录" });
		} else if (this.metadata.sourceType === "chat") {
			typeTag.createEl("span", { cls: "deeppdf-excerpt-tag-icon", text: "💬" });
			typeTag.createEl("span", { text: "对话摘录" });
		} else {
			typeTag.createEl("span", { cls: "deeppdf-excerpt-tag-icon", text: "📝" });
			typeTag.createEl("span", { text: "摘录" });
		}

		// 书籍标签
		const sourceTag = metaEl.createEl("span", {
			cls: "deeppdf-excerpt-tag deeppdf-excerpt-tag-source",
		});
		sourceTag.createEl("span", { cls: "deeppdf-excerpt-tag-icon", text: "📚" });
		sourceTag.createEl("span", { text: this.metadata.sourcePdf });

		// 章节标签（如果是阅读摘录）
		if (this.metadata.sourceType === "reading" && this.metadata.chapterName) {
			const chapterTag = metaEl.createEl("span", {
				cls: "deeppdf-excerpt-tag deeppdf-excerpt-tag-chapter",
			});
			chapterTag.createEl("span", {
				cls: "deeppdf-excerpt-tag-icon",
				text: "📑",
			});
			chapterTag.createEl("span", { text: this.metadata.chapterName });
		}

		// 页码标签（如果有）
		if (this.metadata.page) {
			const pageTag = metaEl.createEl("span", {
				cls: "deeppdf-excerpt-tag deeppdf-excerpt-tag-page",
			});
			pageTag.createEl("span", { cls: "deeppdf-excerpt-tag-icon", text: "📄" });
			pageTag.createEl("span", { text: `第 ${this.metadata.page} 页` });
		}
	}

	/**
	 * 渲染表单区域
	 */
	private renderForm(container: HTMLElement): void {
		const formSection = container.createEl("div", {
			cls: "deeppdf-excerpt-form-section",
		});

		// 笔记输入
		const noteGroup = formSection.createEl("div", {
			cls: "deeppdf-excerpt-form-group",
		});

		// 屏幕阅读器可访问性：label for + input id 关联
		noteGroup.createEl("label", {
			cls: "deeppdf-excerpt-form-label",
			text: "添加笔记",
			attr: { for: ExcerptModal.NOTE_INPUT_ID },
		});

		this.noteInput = noteGroup.createEl("textarea", {
			cls: "deeppdf-excerpt-note-input",
			attr: {
				id: ExcerptModal.NOTE_INPUT_ID,
				placeholder: "写下你的想法...",
				rows: "2",
			},
		});

		// 保存路径
		const pathGroup = formSection.createEl("div", {
			cls: "deeppdf-excerpt-form-group",
		});

		pathGroup.createEl("label", {
			cls: "deeppdf-excerpt-form-label",
			text: "保存位置",
			attr: { for: ExcerptModal.PATH_INPUT_ID },
		});

		// 使用 ExcerptService 生成基于书籍名和日期的默认路径
		const defaultPath = this.excerptService.getExcerptPath(
			this.metadata.sourcePdf,
		);

		this.pathInput = pathGroup.createEl("input", {
			cls: "deeppdf-excerpt-path-input",
			attr: {
				id: ExcerptModal.PATH_INPUT_ID,
				type: "text",
				placeholder: defaultPath,
				value: defaultPath,
			},
		});
	}

	/**
	 * 渲染按钮区域
	 */
	private renderButtons(container: HTMLElement): void {
		const buttonSection = container.createEl("div", {
			cls: "deeppdf-excerpt-button-section",
		});

		// 取消按钮
		const cancelBtn = buttonSection.createEl("button", {
			cls: "deeppdf-excerpt-cancel-btn",
			text: "取消",
		});
		cancelBtn.addEventListener("click", () => this.close());

		// 保存按钮
		const defaultSaveLabel = "保存摘录";
		const saveBtn = buttonSection.createEl("button", {
			cls: "deeppdf-excerpt-save-btn",
			text: defaultSaveLabel,
		});
		saveBtn.addEventListener("click", async () => {
			// 防止异步保存期间被重复点击
			if (this.isSaving) {
				return;
			}
			this.isSaving = true;
			saveBtn.disabled = true;
			saveBtn.textContent = ExcerptModal.SAVING_LABEL;
			saveBtn.setAttribute("aria-busy", "true");

			try {
				await this.handleSave();
			} catch (err) {
				// 错误恢复：让用户可重试，modal 保持打开
				serviceLog("[DeepPDF] ExcerptModal save error:", err);
				this.isSaving = false;
				saveBtn.disabled = false;
				saveBtn.textContent = defaultSaveLabel;
				saveBtn.removeAttribute("aria-busy");
			}
		});
	}

	/**
	 * 处理保存
	 */
	private async handleSave(): Promise<void> {
		const note = this.noteInput?.value || "";
		const targetPath =
			this.pathInput?.value ||
			this.excerptService.getExcerptPath(this.metadata.sourcePdf);

		const options: ExcerptOptions = {
			note,
			targetPath,
			includeBacklink: false,
		};

		const savedPath = await this.excerptService.saveExcerpt(
			this.content,
			this.metadata,
			options,
		);

		if (savedPath) {
			this.onSave?.(savedPath);
			this.close();
		}
	}
}
