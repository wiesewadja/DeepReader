/**
 * DeepPDF 聊天输入组件
 * 实现多行文本输入框，支持 Enter 发送、Shift+Enter 换行
 * Gemini 风格：文本框在上方，底部工具栏（右侧发送按钮）
 * 注：模式切换已移至设置中的高级选项，默认使用自动路由
 */

import { App, TFile } from 'obsidian';
import { Icons } from '../../utils/icons.js';
import { FileSuggest } from '../file-suggest/file-suggest.js';

/**
 * 搜索模式
 */
export type SearchMode = 'single' | 'cross';

/**
 * 聊天输入配置选项
 */
export interface ChatInputOptions {
	/** 发送回调 */
	onSend: (message: string) => void;
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
	/** 模式切换回调（可选） */
	onModeToggle?: () => void;
	/** 当前搜索模式（可选） */
	searchMode?: SearchMode;
	/** 选择文件回调（可选，用于 @ 提及) */
	onSelectFile?: (file: TFile) => void;
	/** App 实例（可选，用于文件搜索) */
	app?: App;
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
	private textarea: HTMLTextAreaElement | null = null;
	private sendButton: HTMLButtonElement | null = null;
	private modeButton: HTMLButtonElement | null = null;
	private options: ChatInputOptions;

	// 文件建议组件
	private fileSuggest: FileSuggest | null = null;
	private suggestTrigger: MentionTrigger | null = null;

	// 事件处理器引用（用于清理）
	private inputHandler: (() => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private clickHandler: (() => void) | null = null;
	private pasteHandler: (() => void) | null = null;
	private modeClickHandler: (() => void) | null = null;
	private resizeAnimationFrame: number | null = null;

	constructor(options: ChatInputOptions) {
		this.options = {
			placeholder: '输入消息...',
			disabled: false,
			minRows: 1,
			maxRows: 5,
			maxHeight: 150,
			...options
		};
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
	 * 渲染聊天输入组件
	 */
	private render(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-chat-input');

		// 整体容器 (deeppdf-chat-input-container)
		const inputContainer = container.createEl('div', {
			cls: 'deeppdf-chat-input-container'
		});

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
		this.textarea.setAttribute('aria-label', '聊天输入框');
		this.textarea.setAttribute('aria-multiline', 'true');
		this.textarea.style.minHeight = 'auto';

		// 2. 底部工具栏
		const toolbar = inputContainer.createEl('div', {
			cls: 'deeppdf-input-toolbar'
		});

		// 右侧工具 (模式切换按钮 + 发送按钮)
		const rightToolbar = toolbar.createEl('div', {
			cls: 'deeppdf-toolbar-right'
		});

		// 模式切换按钮
		this.modeButton = rightToolbar.createEl('button', {
			cls: 'deeppdf-mode-toggle-btn'
		});
		this.updateModeButtonDisplay();
		this.modeButton.type = 'button';

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
				this.handleSend();
			};
			this.sendButton.addEventListener('click', this.clickHandler);
		}

		// 点击模式切换按钮
		if (this.modeButton && this.options.onModeToggle) {
			this.modeClickHandler = () => {
				this.options.onModeToggle?.();
			};
			this.modeButton.addEventListener('click', this.modeClickHandler);
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
		let x = rect.left;
		let y = rect.bottom + 4;

		// 如果有触发器，尝试定位到触发器位置
		if (this.suggestTrigger) {
			// 简化处理：保持在文本框下方
			// 精确定位需要更复杂的文本测量
		}

		this.fileSuggest.setPosition(x, y);
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

		if (trimmedValue.length === 0) {
			return;
		}

		// 触发发送回调
		this.options.onSend(trimmedValue);

		// 清空输入框
		this.clear();

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
		const isDisabled = value.length === 0 || this.textarea.disabled;

		this.sendButton.disabled = isDisabled;
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
	 * 设置搜索模式
	 */
	setSearchMode(mode: SearchMode): void {
		this.options.searchMode = mode;
		this.updateModeButtonDisplay();
	}

	/**
	 * 更新模式按钮显示
	 */
	private updateModeButtonDisplay(): void {
		if (!this.modeButton) return;

		const mode = this.options.searchMode || 'single';
		const isCrossMode = mode === 'cross';

		// 使用小圆按钮样式
		// 跨书籍模式开启时显示高亮实心圆，关闭时显示空心圆
		this.modeButton.innerHTML = ''; // 清空内容，使用 CSS 绘制圆形

		if (isCrossMode) {
			this.modeButton.addClass('active');
		} else {
			this.modeButton.removeClass('active');
		}

		this.modeButton.setAttribute('aria-label', isCrossMode ? '跨书籍模式已开启（点击关闭）' : '跨书籍模式已关闭（点击开启）');
		this.modeButton.setAttribute('data-mode', mode);
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

		if (this.modeButton && this.modeClickHandler) {
			this.modeButton.removeEventListener('click', this.modeClickHandler);
			this.modeClickHandler = null;
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
		this.modeButton = null;
	}
}