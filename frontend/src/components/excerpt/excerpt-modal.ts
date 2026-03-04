/**
 * DeepPDF 摘录模态框组件
 * 用于预览和编辑和保存 AI 回复的摘录
 */

import { App, Modal, Notice } from 'obsidian';
import { ExcerptService } from '../../services/excerpt-service';
import type { ExcerptContent, ExcerptMetadata, ExcerptOptions } from '../../types/excerpt';

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
  private includeBacklinkToggle: HTMLInputElement | null = null;

  // 服务
  private excerptService: ExcerptService;

  constructor(options: ExcerptModalOptions) {
    super(options.app);
    this.content = options.content;
    this.metadata = options.metadata;
    this.onSave = options.onSave;
    this.excerptService = new ExcerptService(this.app);
  }

  onOpen() {
    const { contentEl } = this;

    // 设置模态框标题
    this.titleEl.setText('保存摘录');

    // 创建内容区域
    this.renderContent(contentEl);
  }

  /**
   * 渲染模态框内容
   */
  private renderContent(container: HTMLElement): void {
    // 鸢出说明
    container.createEl('p', {
      cls: 'deeppdf-excerpt-modal-desc',
      text: '将 AI 回复保存为摘录笔记'
    });

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
    const previewSection = container.createEl('div', {
      cls: 'deeppdf-excerpt-preview-section'
    });

    previewSection.createEl('h3', {
      cls: 'deeppdf-excerpt-preview-title',
      text: '预览'
    });

    const previewContent = previewSection.createEl('div', {
      cls: 'deeppdf-excerpt-preview-content'
    });

    // 显示引用内容
    const quoteEl = previewContent.createEl('blockquote', {
      cls: 'deeppdf-excerpt-quote'
    });
    quoteEl.textContent = this.content.text;

    // 显示元数据
    const metaEl = previewContent.createEl('div', {
      cls: 'deeppdf-excerpt-meta'
    });

    metaEl.createEl('span', {
      cls: 'deeppdf-excerpt-source',
      text: `来源: ${this.metadata.sourcePdf}`
    });

    if (this.metadata.page) {
      metaEl.createEl('span', {
        cls: 'deeppdf-excerpt-page',
        text: ` · 第 ${this.metadata.page} 页`
      });
    }
  }

  /**
   * 渲染表单区域
   */
  private renderForm(container: HTMLElement): void {
    const formSection = container.createEl('div', {
      cls: 'deeppdf-excerpt-form-section'
    });

    // 笔记输入
    const noteGroup = formSection.createEl('div', {
      cls: 'deeppdf-excerpt-form-group'
    });

    noteGroup.createEl('label', {
      cls: 'deeppdf-excerpt-form-label',
      text: '我的笔记'
    });

    this.noteInput = noteGroup.createEl('textarea', {
      cls: 'deeppdf-excerpt-note-input',
      attr: {
        placeholder: '添加你的想法...',
        rows: '3'
      }
    });

    // 保存路径
    const pathGroup = formSection.createEl('div', {
      cls: 'deeppdf-excerpt-form-group'
    });

    pathGroup.createEl('label', {
      cls: 'deeppdf-excerpt-form-label',
      text: '保存位置'
    });

    this.pathInput = pathGroup.createEl('input', {
      cls: 'deeppdf-excerpt-path-input',
      attr: {
        type: 'text',
        placeholder: 'Excerpts/DeepPDF.md',
        value: 'Excerpts/DeepPDF.md'
      }
    });

    // 浏览按钮
    const browseBtn = pathGroup.createEl('button', {
      cls: 'deeppdf-excerpt-browse-btn',
      text: '浏览...'
    });
    browseBtn.addEventListener('click', () => this.browseFile());

    // 选项
    const optionsGroup = formSection.createEl('div', {
      cls: 'deeppdf-excerpt-form-group'
    });

    this.includeBacklinkToggle = optionsGroup.createEl('input', {
      cls: 'deeppdf-excerpt-toggle',
      attr: {
        type: 'checkbox',
        id: 'include-backlink'
      }
    });
    (this.includeBacklinkToggle as HTMLInputElement).checked = true;

    const toggleLabel = optionsGroup.createEl('label', {
      cls: 'deeppdf-excerpt-toggle-label',
      attr: {
        for: 'include-backlink'
      }
    });
    toggleLabel.textContent = '包含双向链接（可跳转回原对话）';
  }

  /**
   * 渲染按钮区域
   */
  private renderButtons(container: HTMLElement): void {
    const buttonSection = container.createEl('div', {
      cls: 'deeppdf-excerpt-button-section'
    });

    // 取消按钮
    const cancelBtn = buttonSection.createEl('button', {
      cls: 'deeppdf-excerpt-cancel-btn',
      text: '取消'
    });
    cancelBtn.addEventListener('click', () => this.close());

    // 保存按钮
    const saveBtn = buttonSection.createEl('button', {
      cls: 'deeppdf-excerpt-save-btn',
      text: '保存摘录'
    });
    saveBtn.addEventListener('click', () => this.handleSave());
  }

  /**
   * 浏览文件
   */
  private async browseFile(): Promise<void> {
    // 简化：让用户输入路径
    // 完整实现可以使用 Obsidian 的 FileSuggest
    new Notice('请直接输入文件路径，或使用默认路径');
  }

  /**
   * 处理保存
   */
  private async handleSave(): Promise<void> {
    const note = this.noteInput?.value || '';
    const targetPath = this.pathInput?.value || 'Excerpts/DeepPDF.md';
    const includeBacklink = (this.includeBacklinkToggle as HTMLInputElement)?.checked ?? true;

    const options: ExcerptOptions = {
      note,
      targetPath,
      includeBacklink
    };

    const savedPath = await this.excerptService.saveExcerpt(
      this.content,
      this.metadata,
      options
    );

    if (savedPath) {
      this.onSave?.(savedPath);
      super.close();
    }
  }
}
