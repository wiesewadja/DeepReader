/**
 * DeepPDF Agent 模式切换组件
 * 提供快速检索和 AI 智能体两种模式的切换
 */

/**
 * 聊天模式类型
 */
export type ChatMode = 'fast' | 'agent';

/**
 * Agent 模式切换配置选项
 */
export interface AgentModeToggleOptions {
	/** 初始模式 */
	initialMode?: ChatMode;
	/** 模式变更回调 */
	onModeChange?: (mode: ChatMode) => void;
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * 模式信息
 */
interface ModeInfo {
	id: ChatMode;
	label: string;
	description: string;
	icon: string;
}

const MODES: Record<ChatMode, ModeInfo> = {
	fast: {
		id: 'fast',
		label: '快速检索',
		description: '适合简单问题，快速返回相关内容',
		icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`
	},
	agent: {
		id: 'agent',
		label: 'AI 智能体',
		description: '适合复杂问题，深度分析和多步推理',
		icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><path d="M8.5 8.5A2.5 2.5 0 0 0 8 10c0 1.5 1.5 2.5 3 2.5s3-1 3-2.5a2.5 2.5 0 0 0-.5-1.5"></path><path d="M15 15a5 5 0 0 1-5 5"></path></svg>`
	}
};

/**
 * Agent 模式切换组件
 */
export class AgentModeToggle {
	private el: HTMLElement | null = null;
	private currentMode: ChatMode;
	private options: AgentModeToggleOptions;
	private onModeChange?: (mode: ChatMode) => void;

	// 事件处理器引用
	private clickHandlers: (() => void)[] = [];

	constructor(options: AgentModeToggleOptions = {}) {
		this.options = {
			initialMode: 'fast',
			disabled: false,
			...options
		};
		this.currentMode = this.options.initialMode || 'fast';
		this.onModeChange = options.onModeChange;
		this.el = this.render();
	}

	/**
	 * 渲染组件
	 */
	private render(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-agent-mode-toggle');

		// 标题
		const label = container.createEl('div', {
			cls: 'deeppdf-agent-mode-toggle-label',
			text: '回答模式'
		});

		// 模式选项容器
		const modesContainer = container.createEl('div', {
			cls: 'deeppdf-agent-mode-options'
		});

		// 渲染两种模式
		Object.values(MODES).forEach(mode => {
			const modeOption = modesContainer.createEl('div', {
				cls: 'deeppdf-agent-mode-option'
			});

			// 根据当前模式设置选中状态
			if (mode.id === this.currentMode) {
				modeOption.addClass('deeppdf-agent-mode-option-active');
			}

			// 单选按钮
			const radio = modeOption.createEl('div', {
				cls: 'deeppdf-agent-mode-radio'
			});

			if (mode.id === this.currentMode) {
				radio.addClass('deeppdf-agent-mode-radio-checked');
				radio.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`;
			}

			// 内容容器
			const content = modeOption.createEl('div', {
				cls: 'deeppdf-agent-mode-content'
			});

			// 标签行（图标 + 标签）
			const labelRow = content.createEl('div', {
				cls: 'deeppdf-agent-mode-label-row'
			});

			const iconWrapper = labelRow.createEl('div', {
				cls: 'deeppdf-agent-mode-icon'
			});
			iconWrapper.innerHTML = mode.icon;

			const labelSpan = labelRow.createEl('span', {
				cls: 'deeppdf-agent-mode-name',
				text: mode.label
			});

			// 描述
			const desc = content.createEl('div', {
				cls: 'deeppdf-agent-mode-description',
				text: mode.description
			});

			// 添加点击事件
			const clickHandler = () => {
				if (this.options.disabled) return;
				if (mode.id !== this.currentMode) {
					this.setMode(mode.id);
				}
			};
			modeOption.addEventListener('click', clickHandler);
			this.clickHandlers.push(clickHandler);
		});

		// 如果禁用，添加禁用样式
		if (this.options.disabled) {
			container.addClass('deeppdf-agent-mode-toggle-disabled');
		}

		return container;
	}

	/**
	 * 设置当前模式
	 */
	setMode(mode: ChatMode): void {
		if (this.options.disabled) return;

		this.currentMode = mode;

		// 更新 UI
		this.el?.querySelectorAll('.deeppdf-agent-mode-option').forEach((option, index) => {
			const modeId = Object.values(MODES)[index].id;
			if (modeId === mode) {
				option.addClass('deeppdf-agent-mode-option-active');
				// 更新单选按钮
				const radio = option.querySelector('.deeppdf-agent-mode-radio');
				if (radio) {
					radio.addClass('deeppdf-agent-mode-radio-checked');
					radio.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`;
				}
			} else {
				option.removeClass('deeppdf-agent-mode-option-active');
				// 更新单选按钮
				const radio = option.querySelector('.deeppdf-agent-mode-radio');
				if (radio) {
					radio.removeClass('deeppdf-agent-mode-radio-checked');
					radio.innerHTML = '';
				}
			}
		});

		// 触发回调
		this.onModeChange?.(mode);
	}

	/**
	 * 获取当前模式
	 */
	getMode(): ChatMode {
		return this.currentMode;
	}

	/**
	 * 设置禁用状态
	 */
	setDisabled(disabled: boolean): void {
		this.options.disabled = disabled;

		if (disabled) {
			this.el?.addClass('deeppdf-agent-mode-toggle-disabled');
		} else {
			this.el?.removeClass('deeppdf-agent-mode-toggle-disabled');
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
		// 移除所有事件监听器
		const options = this.el?.querySelectorAll('.deeppdf-agent-mode-option');
		options?.forEach((option, index) => {
			if (this.clickHandlers[index]) {
				option.removeEventListener('click', this.clickHandlers[index]);
			}
		});
		this.clickHandlers = [];

		// 从 DOM 中移除
		if (this.el && this.el.parentNode) {
			this.el.parentNode.removeChild(this.el);
		}

		this.el = null;
	}
}
