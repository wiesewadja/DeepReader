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

    // 预览内容卡片
    const previewCard = previewSection.createEl('div', {
      cls: 'deeppdf-excerpt-preview-card'
    });

    // 显示原始内容
    const contentEl = previewCard.createEl('div', {
      cls: 'deeppdf-excerpt-content-preview'
    });
    contentEl.textContent = this.content.text;

    // 元数据标签
    const metaEl = previewCard.createEl('div', {
      cls: 'deeppdf-excerpt-meta-tags'
    });

    // 来源类型标签
    const typeTag = metaEl.createEl('span', {
      cls: 'deeppdf-excerpt-tag deeppdf-excerpt-tag-type'
    });
    if (this.metadata.sourceType === 'reading') {
      typeTag.createEl('span', { cls: 'deeppdf-excerpt-tag-icon', text: '📖' });
      typeTag.createEl('span', { text: '章节摘录' });
    } else if (this.metadata.sourceType === 'chat') {
      typeTag.createEl('span', { cls: 'deeppdf-excerpt-tag-icon', text: '💬' });
      typeTag.createEl('span', { text: '对话摘录' });
    } else {
      typeTag.createEl('span', { cls: 'deeppdf-excerpt-tag-icon', text: '📝' });
      typeTag.createEl('span', { text: '摘录' });
    }

    // 书籍标签
    const sourceTag = metaEl.createEl('span', {
      cls: 'deeppdf-excerpt-tag deeppdf-excerpt-tag-source'
    });
    sourceTag.createEl('span', { cls: 'deeppdf-excerpt-tag-icon', text: '📚' });
    sourceTag.createEl('span', { text: this.metadata.sourcePdf });

    // 章节标签（如果是阅读摘录）
    if (this.metadata.sourceType === 'reading' && this.metadata.chapterName) {
      const chapterTag = metaEl.createEl('span', {
        cls: 'deeppdf-excerpt-tag deeppdf-excerpt-tag-chapter'
      });
      chapterTag.createEl('span', { cls: 'deeppdf-excerpt-tag-icon', text: '📑' });
      chapterTag.createEl('span', { text: this.metadata.chapterName });
    }

    // 页码标签（如果有）
    if (this.metadata.page) {
      const pageTag = metaEl.createEl('span', {
        cls: 'deeppdf-excerpt-tag deeppdf-excerpt-tag-page'
      });
      pageTag.createEl('span', { cls: 'deeppdf-excerpt-tag-icon', text: '📄' });
      pageTag.createEl('span', { text: `第 ${this.metadata.page} 页` });
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
      text: '添加笔记'
    });

    this.noteInput = noteGroup.createEl('textarea', {
      cls: 'deeppdf-excerpt-note-input',
      attr: {
        placeholder: '写下你的想法...',
        rows: '2'
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

    // 使用 ExcerptService 生成基于书籍名和日期的默认路径
    const defaultPath = this.excerptService.getExcerptPath(this.metadata.sourcePdf);

    this.pathInput = pathGroup.createEl('input', {
      cls: 'deeppdf-excerpt-path-input',
      attr: {
        type: 'text',
        placeholder: defaultPath,
        value: defaultPath
      }
    });
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
   * 处理保存
   */
  private async handleSave(): Promise<void> {
    const note = this.noteInput?.value || '';
    const targetPath = this.pathInput?.value || this.excerptService.getExcerptPath(this.metadata.sourcePdf);

    const options: ExcerptOptions = {
      note,
      targetPath,
      includeBacklink: false
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
