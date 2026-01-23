/**
 * DeepPDF 聊天输入组件
 * 实现多行文本输入框，支持 Enter 发送、Shift+Enter 换行
 * Gemini 风格：文本框在上方，底部工具栏（左侧模式切换，右侧发送按钮）
 */

import { Icons } from '../../utils/icons.js';
import { ChatMode } from '../agent-mode-toggle/agent-mode-toggle.js';

/**
 * 聊天模式配置
 */
interface ChatModeConfig {
	id: ChatMode;
	name: string;
	shortName: string;
	icon: string;
}

const CHAT_MODES: Record<ChatMode, ChatModeConfig> = {
	fast: {
		id: 'fast',
		name: '快速检索',
		shortName: '快速',
		icon: '⚡'  // Unicode 闪电符号
	},
	agent: {
		id: 'agent',
		name: 'Agent 问答',
		shortName: 'Agent',
		icon: '🤖'  // Unicode 机器人符号
	}
};

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
	/** 初始聊天模式 */
	initialMode?: ChatMode;
	/** 模式变化回调 */
	onModeChange?: (mode: ChatMode) => void;
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
	private currentMode: ChatMode;

	// 事件处理器引用（用于清理）
	private inputHandler: (() => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private clickHandler: (() => void) | null = null;
	private modeClickHandler: (() => void) | null = null;
	private pasteHandler: (() => void) | null = null;
	private resizeAnimationFrame: number | null = null;

	constructor(options: ChatInputOptions) {
		this.options = {
			placeholder: '输入消息...',
			disabled: false,
			minRows: 1,
			maxRows: 5,
			maxHeight: 150,
			initialMode: 'fast',
			...options
		};
		this.currentMode = this.options.initialMode || 'fast';
		this.el = this.render();
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

		// 左侧工具 (模式切换)
		const leftToolbar = toolbar.createEl('div', {
			cls: 'deeppdf-toolbar-left'
		});

		this.modeButton = leftToolbar.createEl('button', {
			cls: 'deeppdf-mode-switch-btn'
		});
		this.updateModeButton();

		// 右侧工具 (发送按钮)
		const rightToolbar = toolbar.createEl('div', {
			cls: 'deeppdf-toolbar-right'
		});

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
	 * 更新模式按钮显示
	 */
	private updateModeButton(): void {
		if (!this.modeButton) return;

		const modeConfig = CHAT_MODES[this.currentMode];
		// 极简风格：只显示图标，或者图标+简短名称
		// 用户要求极简化，左下角。可以使用一个小图标，hover 时显示名称
		this.modeButton.innerHTML = `<span class="mode-icon">${modeConfig.icon}</span><span class="mode-name">${modeConfig.shortName}</span>`;
		this.modeButton.setAttribute('aria-label', `当前模式：${modeConfig.name}，点击切换`);
		this.modeButton.setAttribute('title', `点击切换到${this.currentMode === 'fast' ? 'Agent' : '快速'}模式`);
		this.modeButton.setAttribute('data-mode', this.currentMode);
	}

	/**
	 * 附加事件监听器
	 */
	private attachEventListeners(): void {
		if (!this.textarea) return;

		// 输入事件：调整高度和更新按钮状态
		this.inputHandler = () => {
			this.autoResize();
			this.updateSendButtonState();
		};
		this.textarea.addEventListener('input', this.inputHandler);

		// 键盘事件：处理 Enter 和 Shift+Enter
		this.keydownHandler = (event: KeyboardEvent) => {
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
		if (this.modeButton) {
			this.modeClickHandler = () => {
				this.toggleMode();
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
	}

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
	 * 切换聊天模式
	 */
	private toggleMode(): void {
		// 在两种模式之间切换
		this.currentMode = this.currentMode === 'fast' ? 'agent' : 'fast';
		this.updateModeButton();

		// 触发模式变化回调
		this.options.onModeChange?.(this.currentMode);
	}

	/**
	 * 获取当前聊天模式
	 */
	getMode(): ChatMode {
		return this.currentMode;
	}

	/**
	 * 设置聊天模式
	 */
	setMode(mode: ChatMode): void {
		if (this.currentMode === mode) return;

		this.currentMode = mode;
		this.updateModeButton();
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