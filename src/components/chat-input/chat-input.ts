/**
 * DeepPDF 聊天输入组件
 * 实现多行文本输入框，支持 Enter 发送、Shift+Enter 换行
 * Gemini 风格：文本框在上方，底部工具栏（右侧发送按钮）
 * 注：模式切换已移至设置中的高级选项，默认使用自动路由
 *
 * 支持引用功能：选中文本后添加引用卡片，发送时引用作为上下文
 * Skills 自动路由：后端根据查询关键词自动匹配 Skill，无需手动选择
 */

import { type App, type TFile } from 'obsidian';
import type { QuoteMetadata } from '../../types/quote.js';
import { Icons } from '../../utils/icons.js';
import { FileSuggest } from '../file-suggest/file-suggest.js';

export type { QuoteMetadata } from '../../types/quote.js';

/**
 * 引用数据结构（存储在 quotes 数组中）
 */
export interface QuoteItem {
	/** 唯一标识 */
	id: string;
	/** 引用文本内容 */
	text: string;
	/** 来源文件名（可选） */
	source?: string;
	/** 来源文件路径 */
	sourcePath?: string;
	/** block_id（如 ^ch1-p3） */
	blockId?: string;
	/** 章节 node_id */
	nodeId?: string;
	/** 所属标题 */
	heading?: string;
	/** 完整标题路径 */
	headingPath?: string[];
}

/**
 * 语音输入状态
 */
export type VoiceState = 'idle' | 'recording' | 'recognizing';

/**
 * 聊天输入配置选项
 */
export interface ChatInputOptions {
	/** 发送回调（带引用） */
	onSend: (message: string, quotes: QuoteItem[]) => void;
	/** 键盘事件回调（可选） */
	onKeyDown?: (event: KeyboardEvent) => void;
	/** 初始占位符文本 */
	placeholder?: string;
	/** 初始禁用状态 */
	disabled?: boolean;
	/** 最小行数 */
	minRows?: number;
	/** 最大行数 */
	maxRows?: number;
	/** 最大高度（像素） */
	maxHeight?: number;
	/** 选择文件回调（可选，用于 @ 提及) */
	onSelectFile?: (file: TFile) => void;
	/** App 实例（可选，用于文件搜索) */
	app?: App;
	/** 停止生成回调（可选，AI 回复时点击停止按钮） */
	onStop?: () => void;
	/** 高度变化回调（可选，用于动态调整消息列表间距） */
	onHeightChange?: (height: number) => void;
	/** 加载当前文档回调（可选） */
	onLoadCurrentDoc?: () => void;
	/** 卸载当前文档回调（可选，再次点击时调用） */
	onUnloadCurrentDoc?: () => void;
	/** 引用添加回调（可选，用于在对话界面显示引用卡片） */
	onQuoteAdded?: (quote: QuoteItem) => void;
	/** 引用移除回调（可选） */
	onQuoteRemoved?: (quoteId: string) => void;
	/** 语音输入切换回调（点击麦克风按钮时触发） */
	onVoiceToggle?: () => void;
	/** 是否显示语音按钮（默认 false） */
	showVoiceButton?: boolean;
}

/**
 * @ 提及触发器信息
 */
interface MentionTrigger {
	/** 触发字符 (@ 或 [[) */
	trigger: string;
	/** 搜索查询 */
	query: string;
	/** 触发器开始位置 */
	startPos: number;
}

/**
 * 聊天输入组件
 */
export class ChatInput {
	private el: HTMLElement | null = null;
	private inputContainer: HTMLElement | null = null;
	private textarea: HTMLTextAreaElement | null = null;
	private sendButton: HTMLButtonElement | null = null;
	private loadDocButton: HTMLButtonElement | null = null;
	private voiceButton: HTMLButtonElement | null = null;
	private voiceOverlay: HTMLElement | null = null;
	private options: ChatInputOptions;
	private isStreaming: boolean = false;
	private isDocLoaded: boolean = false;  // 文档是否已加载到上下文
	private voiceState: VoiceState = 'idle';
	private savedPlaceholder = '';

	// 文件建议组件
	private fileSuggest: FileSuggest | null = null;
	private suggestTrigger: MentionTrigger | null = null;

	// 引用卡片相关
	private quotes: QuoteItem[] = [];
	private resizeAnimationFrame: number | null = null;

	// 事件处理器引用（用于清理）
	private inputHandler: (() => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private clickHandler: (() => void) | null = null;
	private pasteHandler: (() => void) | null = null;
	private loadDocClickHandler: (() => void) | null = null;
	private containerClickHandler: ((event: MouseEvent) => void) | null = null;
	private voiceClickHandler: (() => void) | null = null;

	constructor(options: ChatInputOptions) {
		this.options = {
			placeholder: '输入消息...',
			disabled: false,
			minRows: 1,
			maxRows: 5,
			maxHeight: 150,
			...options
		};
		this.savedPlaceholder = this.options.placeholder || '';
		this.el = this.render();

		// 初始化文件建议组件
		if (this.options.app) {
			this.fileSuggest = new FileSuggest({
				app: this.options.app,
				onSelect: (file) => this.insertMention(file)
			});
		}
	}

	/**
	 * 设置流式输出状态
	 * @param streaming 是否正在流式输出
	 */
	setStreaming(streaming: boolean): void {
		this.isStreaming = streaming;
		if (!this.el || !this.sendButton) return;

		if (streaming) {
			this.el.addClass('deeppdf-chat-input-streaming');
			// 更新发送按钮为停止按钮
			this.sendButton.innerHTML = Icons.stop || '⏹';
			this.sendButton.setAttribute('aria-label', '停止生成');
			this.sendButton.disabled = false;
		} else {
			this.el.removeClass('deeppdf-chat-input-streaming');
			// 恢复发送按钮
			this.sendButton.innerHTML = Icons.send;
			this.sendButton.setAttribute('aria-label', '发送消息');
			this.updateSendButtonState();
		}

		// 通知高度变化
		this.notifyHeightChange();
	}

	/**
	 * 设置语音输入状态
	 */
	setVoiceState(state: VoiceState): void {
		this.voiceState = state;
		if (!this.voiceButton || !this.textarea) return;

		this.voiceButton.classList.remove('recording', 'recognizing');
		this.removeVoiceOverlay();

		if (state === 'recording') {
			this.voiceButton.classList.add('recording');
			this.textarea.disabled = true;
			this.textarea.value = '';
			this.textarea.setAttribute('placeholder', '');
			this.inputContainer?.addClass('deeppdf-voice-active');
			this.showVoiceOverlay('正在聆听...', true);
		} else if (state === 'recognizing') {
			this.voiceButton.classList.add('recognizing');
			this.textarea.disabled = true;
			this.textarea.value = '';
			this.textarea.setAttribute('placeholder', '');
			this.inputContainer?.addClass('deeppdf-voice-active');
			this.showVoiceOverlay('正在识别...', false);
		} else {
			this.textarea.disabled = this.options.disabled || false;
			this.textarea.setAttribute('placeholder', this.savedPlaceholder);
			this.inputContainer?.removeClass('deeppdf-voice-active');
		}

		this.notifyHeightChange();
	}

	private showVoiceOverlay(label: string, showWave: boolean): void {
		const inputArea = this.textarea?.parentElement;
		if (!inputArea) return;

		inputArea.style.position = 'relative';

		this.voiceOverlay = inputArea.createDiv({ cls: 'deeppdf-voice-overlay' });

		if (showWave) {
			const wave = this.voiceOverlay.createSpan({ cls: 'deeppdf-voice-wave' });
			for (let i = 0; i < 5; i++) {
				wave.createSpan();
			}
		}

		this.voiceOverlay.createSpan({
			cls: 'deeppdf-voice-label',
			text: label,
		});
	}

	private removeVoiceOverlay(): void {
		if (this.voiceOverlay) {
			this.voiceOverlay.remove();
			this.voiceOverlay = null;
		}
	}

	/**
	 * 追加语音识别文字（流式）
	 */
	appendVoiceText(text: string): void {
		if (!this.textarea) return;
		// 首次写入时移除 overlay，恢复 textarea 可见
		if (this.voiceOverlay) {
			this.removeVoiceOverlay();
			this.inputContainer?.removeClass('deeppdf-voice-active');
			this.textarea.style.color = '';
			this.textarea.style.caretColor = '';
		}
		this.textarea.value += text;
		this.autoResize();
		this.updateSendButtonState();
	}

	/**
	 * 完成语音识别，启用编辑
	 */
	completeVoiceInput(): void {
		this.setVoiceState('idle');
		this.textarea?.focus();
	}

	/**
	 * 获取当前输入框高度
	 */
	getHeight(): number {
		return this.inputContainer?.offsetHeight || 0;
	}

	/**
	 * 通知高度变化
	 */
	private notifyHeightChange(): void {
		if (this.options.onHeightChange) {
			const height = this.getHeight();
			this.options.onHeightChange(height);
		}
	}

	/**
	 * 渲染聊天输入组件
	 */
	private render(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-chat-input');

		// 整体容器 (deeppdf-chat-input-container)
		this.inputContainer = container.createEl('div', {
			cls: 'deeppdf-chat-input-container'
		});
		const inputContainer = this.inputContainer;

		// 1. 输入区域
		const inputArea = inputContainer.createEl('div', {
			cls: 'deeppdf-input-area'
		});

		this.textarea = inputArea.createEl('textarea', {
			cls: 'deeppdf-chat-input-textarea'
		});
		this.textarea.placeholder = this.options.placeholder || '';
		this.textarea.rows = this.options.minRows || 1;
		this.textarea.disabled = this.options.disabled || false;
		this.textarea.setAttribute('aria-label', '');
		this.textarea.setAttribute('aria-multiline', 'true');
		this.textarea.style.minHeight = 'auto';

		// 2. 底部工具栏
		const toolbar = inputContainer.createEl('div', {
			cls: 'deeppdf-input-toolbar'
		});

		// 左侧工具
		const leftToolbar = toolbar.createEl('div', {
			cls: 'deeppdf-toolbar-left'
		});

		// 麦克风按钮（最左位）
		if (this.options.showVoiceButton && this.options.onVoiceToggle) {
			this.voiceButton = leftToolbar.createEl('button', {
				cls: 'deeppdf-voice-btn'
			});
			this.voiceButton.innerHTML = Icons.mic;
			this.voiceButton.setAttribute('aria-label', '语音输入');
			this.voiceButton.type = 'button';
		}

		// 加载当前文档按钮
		if (this.options.onLoadCurrentDoc) {
			this.loadDocButton = leftToolbar.createEl('button', {
				cls: 'deeppdf-load-doc-btn'
			});
			this.loadDocButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
			this.loadDocButton.setAttribute('aria-label', '加载当前文档到上下文');
			this.loadDocButton.type = 'button';
		}

		// 右侧工具 (发送按钮)
		const rightToolbar = toolbar.createEl('div', {
			cls: 'deeppdf-toolbar-right'
		});

		// 发送按钮
		this.sendButton = rightToolbar.createEl('button', {
			cls: 'deeppdf-chat-input-send-btn'
		});
		this.sendButton.innerHTML = Icons.send;
		this.sendButton.disabled = true;
		this.sendButton.setAttribute('aria-label', '发送消息');
		this.sendButton.type = 'button';

		// 在创建所有元素后添加事件监听器
		this.attachEventListeners();

		// 初始更新发送按钮状态
		this.updateSendButtonState();

		return container;
	}

	/**
	 * 附加事件监听器
	 */
	private attachEventListeners(): void {
		if (!this.textarea) return;

		// 输入事件：调整高度、更新按钮状态和检测 @ 提及
		this.inputHandler = () => {
			this.autoResize();
			this.updateSendButtonState();
			this.checkMentionTrigger();
		};
		this.textarea.addEventListener('input', this.inputHandler);

		// 键盘事件：处理 Enter、Shift+Enter 和文件建议导航
		this.keydownHandler = (event: KeyboardEvent) => {
			// 优先处理文件建议的键盘导航
			if (this.fileSuggest?.handleKeydown(event)) {
				return;
			}
			this.handleKeyDown(event);
		};
		this.textarea.addEventListener('keydown', this.keydownHandler);

		// 点击发送按钮
		if (this.sendButton) {
			this.clickHandler = () => {
				// 如果正在流式输出，点击停止
				if (this.isStreaming) {
					this.options.onStop?.();
				} else {
					this.handleSend();
				}
			};
			this.sendButton.addEventListener('click', this.clickHandler);
		}

		// 点击加载文档按钮
		if (this.loadDocButton && this.options.onLoadCurrentDoc) {
			this.loadDocClickHandler = () => {
				if (this.isDocLoaded) {
					// 已加载，点击卸载
					this.options.onUnloadCurrentDoc?.();
				} else {
					// 未加载，点击加载
					this.options.onLoadCurrentDoc?.();
				}
				// 点击后自动聚焦到输入框
				this.focus();
			};
			this.loadDocButton.addEventListener('click', this.loadDocClickHandler);
		}

		// 点击麦克风按钮
		if (this.voiceButton && this.options.onVoiceToggle) {
			this.voiceClickHandler = () => {
				this.options.onVoiceToggle!();
			};
			this.voiceButton.addEventListener('click', this.voiceClickHandler);
		}

		// 粘贴事件：移除多余的格式
		this.pasteHandler = () => {
			// 延迟处理以确保粘贴内容已插入
			setTimeout(() => {
				this.autoResize();
				this.updateSendButtonState();
			}, 0);
		};
		this.textarea.addEventListener('paste', this.pasteHandler);

		// 点击容器时聚焦 textarea（折叠状态下也能点击）
		this.containerClickHandler = (event: MouseEvent) => {
			// 如果正在流式输出，不处理
			if (this.isStreaming) return;

			// 如果点击的是按钮，不处理（让按钮自己处理）
			const target = event.target as HTMLElement;
			if (target.closest('button')) return;

			// 聚焦 textarea
			this.textarea?.focus();
		};
		this.inputContainer?.addEventListener('click', this.containerClickHandler);

		// 聚焦/失焦时通知高度变化（用于动态调整消息列表间距）
		this.textarea.addEventListener('focus', () => {
			// 延迟通知，等待 CSS 过渡完成
			setTimeout(() => this.notifyHeightChange(), 300);
		});
		this.textarea.addEventListener('blur', () => {
			// 延迟通知，等待 CSS 过渡完成
			setTimeout(() => this.notifyHeightChange(), 300);
		});

		// 点击其他地方时隐藏文件建议
		document.addEventListener('click', this.handleDocumentClick);
	}

	/**
	 * 处理文档点击事件（隐藏文件建议）
	 */
	private handleDocumentClick = (event: MouseEvent): void => {
		if (this.fileSuggest?.isVisible()) {
			const target = event.target as HTMLElement;
			if (!target.closest('.deeppdf-file-suggest') && !target.closest('.deeppdf-chat-input-textarea')) {
				this.fileSuggest.hide();
				this.suggestTrigger = null;
			}
		}
	};

	/**
	 * 处理键盘事件
	 */
	private handleKeyDown(event: KeyboardEvent): void {
		// 触发自定义键盘事件回调
		this.options.onKeyDown?.(event);

		// Enter 发送（如果没有按 Shift）
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			this.handleSend();
		}
	}

	/**
	 * 检测 @ 提及触发器
	 */
	private checkMentionTrigger(): void {
		if (!this.textarea || !this.fileSuggest) return;

		const value = this.textarea.value;
		const cursorPos = this.textarea.selectionStart;

		const trigger = this.detectMentionTrigger(value, cursorPos);

		if (trigger) {
			this.suggestTrigger = trigger;
			this.fileSuggest.search(trigger.query);
			this.positionSuggest();
		} else {
			this.fileSuggest.hide();
			this.suggestTrigger = null;
		}
	}

	/**
	 * 检测提及触发器
	 * 支持 @ 和 [[ 两种触发方式
	 */
	private detectMentionTrigger(value: string, cursorPos: number): MentionTrigger | null {
		const beforeCursor = value.substring(0, cursorPos);

		// 匹配 [[xxx 格式（Obsidian 风格链接）
		const wikilinkMatch = beforeCursor.match(/\[\[([^\]\n]*)$/);
		if (wikilinkMatch) {
			const query = wikilinkMatch[1];
			// 如果已经输入了 ]，说明链接已完成，不触发
			if (query.includes(']]')) return null;
			return {
				trigger: '[[',
				query: query,
				startPos: cursorPos - query.length - 2
			};
		}

		// 匹配 @xxx 格式
		const atMatch = beforeCursor.match(/@([^@\n\s]*)$/);
		if (atMatch) {
			const query = atMatch[1];
			return {
				trigger: '@',
				query: query,
				startPos: cursorPos - query.length - 1
			};
		}

		return null;
	}

	/**
	 * 定位文件建议下拉菜单
	 */
	private positionSuggest(): void {
		if (!this.fileSuggest || !this.textarea) return;

		// 获取文本框的位置
		const rect = this.textarea.getBoundingClientRect();

		// 计算光标位置（简化版：放在文本框下方）
		const lineHeight = parseInt(getComputedStyle(this.textarea).lineHeight) || 20;
		const scrollTop = this.textarea.scrollTop;

		// 基本定位：文本框左下角
		const x = rect.left;
		const y = rect.bottom + 4;

		// 如果有触发器，尝试定位到触发器位置
		if (this.suggestTrigger) {
			// 简化处理：保持在文本框下方
			// 精确定位需要更复杂的文本测量
		}

		this.fileSuggest.setPosition(x, y, rect.top);
	}

	/**
	 * 插入选中的文件提及
	 */
	private insertMention(file: TFile): void {
		if (!this.textarea || !this.suggestTrigger) return;

		const value = this.textarea.value;
		const { startPos, trigger } = this.suggestTrigger;
		const cursorPos = this.textarea.selectionStart;

		// 替换触发器和查询文本为 [[文件名]] 格式
		const before = value.substring(0, startPos);
		const after = value.substring(cursorPos);

		// 使用 Obsidian 的 wikilink 格式
		const newText = `${before}[[${file.basename}]]${after}`;
		this.textarea.value = newText;

		// 移动光标到插入内容之后
		const newCursorPos = startPos + file.basename.length + 4; // 4 = [[ ]].length
		this.textarea.setSelectionRange(newCursorPos, newCursorPos);

		// 触发文件选择回调
		this.options.onSelectFile?.(file);

		// 清理状态
		this.suggestTrigger = null;
		this.autoResize();
		this.updateSendButtonState();

		// 重新聚焦文本框
		this.textarea.focus();
	}

	/**
	 * 处理发送消息
	 */
	private handleSend(): void {
		// 检查是否禁用
		if (!this.textarea || this.textarea.disabled) {
			return;
		}

		const value = this.getValue();
		const trimmedValue = value.trim();

		// 允许只有引用没有文本的情况
		if (trimmedValue.length === 0 && this.quotes.length === 0) {
			return;
		}

		// 触发发送回调（带引用）
		this.options.onSend(trimmedValue, [...this.quotes]);

		// 清空输入框和引用
		this.clear();
		this.clearQuotes();

		// 重新聚焦
		this.focus();
	}

	/**
	 * 自动调整文本框高度
	 */
	private autoResize(): void {
		if (!this.textarea) return;

		// 取消之前的动画帧请求，避免重复执行
		if (this.resizeAnimationFrame !== null) {
			cancelAnimationFrame(this.resizeAnimationFrame);
		}

		// 使用 requestAnimationFrame 优化性能
		this.resizeAnimationFrame = requestAnimationFrame(() => {
			this.performResize();
			this.resizeAnimationFrame = null;
		});
	}

	/**
	 * 执行实际的调整高度操作
	 */
	private performResize(): void {
		if (!this.textarea) return;

		const maxHeight = this.options.maxHeight || 150;
		const minRows = this.options.minRows || 1;
		const maxRows = this.options.maxRows || 5;

		// 保存当前滚动位置
		const scrollTop = this.textarea.scrollTop;

		// 重置高度以获取准确的 scrollHeight
		this.textarea.style.height = 'auto';

		// 计算新高度
		const scrollHeight = this.textarea.scrollHeight;
		const lineHeight = parseInt(getComputedStyle(this.textarea).lineHeight) || 20;
		const minHeight = lineHeight * minRows;
		const maxHeightCalculated = lineHeight * maxRows;

		let newHeight = scrollHeight;

		// 限制最小高度
		if (newHeight < minHeight) {
			newHeight = minHeight;
		}

		// 限制最大高度
		if (newHeight > maxHeightCalculated) {
			newHeight = maxHeightCalculated;
		}

		// 限制最大像素高度
		if (newHeight > maxHeight) {
			newHeight = maxHeight;
		}

		this.textarea.style.height = `${newHeight}px`;

		// 恢复滚动位置
		this.textarea.scrollTop = scrollTop;

		// 如果达到最大高度，启用滚动
		if (scrollHeight > maxHeightCalculated || scrollHeight > maxHeight) {
			this.textarea.style.overflowY = 'auto';
		} else {
			this.textarea.style.overflowY = 'hidden';
		}
	}

	/**
	 * 更新发送按钮状态
	 */
	private updateSendButtonState(): void {
		if (!this.sendButton || !this.textarea) return;

		const value = this.getValue().trim();
		// 有引用或有文本时都可以发送
		const isDisabled = (value.length === 0 && this.quotes.length === 0) || this.textarea.disabled;

		this.sendButton.disabled = isDisabled;
	}

	// ==================== 引用相关方法 ====================

	/**
	 * 添加引用
	 * @param text 引用文本
	 * @param source 来源文件名（可选）
	 */
	addQuote(text: string, source?: string): void {
		if (!text.trim()) return;

		const quote: QuoteItem = {
			id: `quote-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			text: text.trim(),
			source
		};

		this.quotes.push(quote);
		this.updateSendButtonState();
		this.notifyHeightChange();

		// 通过回调通知外部渲染引用卡片
		this.options.onQuoteAdded?.(quote);
	}

	/**
	 * 移除引用
	 * @param quoteId 引用 ID
	 */
	removeQuote(quoteId: string): void {
		this.quotes = this.quotes.filter(q => q.id !== quoteId);
		this.updateSendButtonState();
		this.notifyHeightChange();

		// 通过回调通知外部
		this.options.onQuoteRemoved?.(quoteId);
	}

	/**
	 * 清空所有引用
	 */
	clearQuotes(): void {
		this.quotes = [];
		this.updateSendButtonState();
		this.notifyHeightChange();
	}

	/**
	 * 获取所有引用
	 */
	getQuotes(): QuoteItem[] {
		return [...this.quotes];
	}

	/**
	 * 获取输入内容
	 */
	getValue(): string {
		return this.textarea?.value || '';
	}

	/**
	 * 设置输入内容
	 */
	setValue(value: string): void {
		if (!this.textarea) return;

		this.textarea.value = value;
		this.autoResize();
		this.updateSendButtonState();
	}

	/**
	 * 清空输入
	 */
	clear(): void {
		this.setValue('');
	}

	/**
	 * 聚焦输入框
	 */
	focus(): void {
		this.textarea?.focus();
	}

	/**
	 * 设置占位符文本
	 */
	setPlaceholder(text: string): void {
		if (!this.textarea) return;

		this.textarea.placeholder = text;
	}

	/**
	 * 设置禁用状态
	 */
	setDisabled(disabled: boolean): void {
		if (!this.textarea || !this.sendButton) return;

		this.textarea.disabled = disabled;
		this.updateSendButtonState();
	}

	/**
	 * 设置加载按钮的激活状态
	 */
	setLoadBtnActive(active: boolean): void {
		this.isDocLoaded = active;  // 同步更新内部状态
		if (!this.loadDocButton) return;
		if (active) {
			this.loadDocButton.classList.add('active');
			// 有横线的文档图标（表示已加载内容）
			this.loadDocButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>`;
			this.loadDocButton.setAttribute('aria-label', '从上下文移除文档');
		} else {
			this.loadDocButton.classList.remove('active');
			// 空白文档图标
			this.loadDocButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
			this.loadDocButton.setAttribute('aria-label', '加载当前文档到上下文');
		}
	}

	/**
	 * 获取组件元素
	 */
	getElement(): HTMLElement | null {
		return this.el;
	}

	/**
	 * 销毁组件
	 */
	destroy(): void {
		// 取消待处理的动画帧请求
		if (this.resizeAnimationFrame !== null) {
			cancelAnimationFrame(this.resizeAnimationFrame);
			this.resizeAnimationFrame = null;
		}

		// 移除所有事件监听器
		if (this.textarea) {
			if (this.inputHandler) {
				this.textarea.removeEventListener('input', this.inputHandler);
				this.inputHandler = null;
			}
			if (this.keydownHandler) {
				this.textarea.removeEventListener('keydown', this.keydownHandler);
				this.keydownHandler = null;
			}
			if (this.pasteHandler) {
				this.textarea.removeEventListener('paste', this.pasteHandler);
				this.pasteHandler = null;
			}
		}

		if (this.sendButton && this.clickHandler) {
			this.sendButton.removeEventListener('click', this.clickHandler);
			this.clickHandler = null;
		}

		if (this.loadDocButton && this.loadDocClickHandler) {
			this.loadDocButton.removeEventListener('click', this.loadDocClickHandler);
			this.loadDocClickHandler = null;
		}

		if (this.voiceButton && this.voiceClickHandler) {
			this.voiceButton.removeEventListener('click', this.voiceClickHandler);
			this.voiceClickHandler = null;
		}

		if (this.inputContainer && this.containerClickHandler) {
			this.inputContainer.removeEventListener('click', this.containerClickHandler);
			this.containerClickHandler = null;
		}

		// 移除文档点击事件监听器
		document.removeEventListener('click', this.handleDocumentClick);

		// 销毁文件建议组件
		if (this.fileSuggest) {
			this.fileSuggest.destroy();
			this.fileSuggest = null;
		}
		this.suggestTrigger = null;

		// 从 DOM 中移除元素
		if (this.el && this.el.parentNode) {
			this.el.parentNode.removeChild(this.el);
		}

		// 清理引用
		this.el = null;
		this.textarea = null;
		this.sendButton = null;
		this.loadDocButton = null;
		this.voiceButton = null;
	}
}
