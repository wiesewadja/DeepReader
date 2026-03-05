/**
 * DeepPDF 顶部导航组件
 * 极简风格：Logo + 状态点 + 设置按钮
 */

import { Component } from '../component.js';
import { Icons } from '../../utils/icons.js';

/**
 * 连接状态类型
 */
export type ConnectionStatus = 'loading' | 'connected' | 'disconnected' | 'error';

/**
 * TopNav 配置选项
 */
export interface TopNavOptions {
	/** 点击设置回调 */
	onSettings?: () => void;
	/** 点击标题回调（可选，可用于打开关于页等） */
	onTitleClick?: () => void;
	/** 新建会话回调 */
	onNewChat?: () => void;
}

/**
 * TopNav 顶部导航组件
 */
export class TopNav extends Component {
	private options: TopNavOptions;
	private statusDot: HTMLElement | null = null;
	private statusText: HTMLElement | null = null;
	private settingsButtonHandler: (() => void) | null = null;
	private newChatButtonHandler: (() => void) | null = null;

	constructor(options: TopNavOptions = {}) {
		super();
		this.options = options;
		this.el = this.render();
	}

	/**
	 * 渲染顶部导航组件
	 */
	render(): HTMLElement {
		const container = document.createElement('header');
		container.className = 'deeppdf-header-minimal';

		// 左侧：Logo + 标题 + 状态点
		const leftSection = document.createElement('div');
		leftSection.className = 'deeppdf-header-left';

		// Logo
		const logo = document.createElement('div');
		logo.className = 'deeppdf-logo-icon';
		logo.innerHTML = Icons.bookworm;
		leftSection.appendChild(logo);

		// 标题
		const title = document.createElement('h1');
		title.className = 'deeppdf-header-title';
		title.textContent = 'DeepReader';
		if (this.options.onTitleClick) {
			title.style.cursor = 'pointer';
			title.addEventListener('click', this.options.onTitleClick);
		}
		leftSection.appendChild(title);

		// 状态点 (直接跟在标题后面)
		const statusWrapper = document.createElement('div');
		statusWrapper.className = 'deeppdf-status-indicator';

		this.statusDot = document.createElement('span');
		this.statusDot.className = 'deeppdf-status-dot';
		statusWrapper.appendChild(this.statusDot);

		this.statusText = document.createElement('span');
		this.statusText.className = 'deeppdf-status-text';
		this.statusText.textContent = 'Connecting...';
		statusWrapper.appendChild(this.statusText);

		leftSection.appendChild(statusWrapper);
		container.appendChild(leftSection);

		// 右侧：工具按钮组
		const rightSection = document.createElement('div');
		rightSection.className = 'deeppdf-header-right';

		// 新建会话按钮
		const newChatButton = document.createElement('button');
		newChatButton.className = 'deeppdf-icon-button';
		newChatButton.innerHTML = Icons.plus;
		newChatButton.setAttribute('aria-label', '新建对话');
		newChatButton.setAttribute('title', '新建对话');

		this.newChatButtonHandler = () => {
			this.options.onNewChat?.();
		};
		newChatButton.addEventListener('click', this.newChatButtonHandler);

		// 设置按钮
		const settingsButton = document.createElement('button');
		settingsButton.className = 'deeppdf-icon-button';
		settingsButton.innerHTML = Icons.settings;
		settingsButton.setAttribute('aria-label', '设置');
		settingsButton.setAttribute('title', '设置');

		this.settingsButtonHandler = () => {
			this.options.onSettings?.();
		};
		settingsButton.addEventListener('click', this.settingsButtonHandler);

		// 添加按钮到右侧区域
		rightSection.appendChild(newChatButton);
		rightSection.appendChild(settingsButton);
		container.appendChild(rightSection);

		return container;
	}

	/**
	 * 设置连接状态
	 */
	setStatus(status: ConnectionStatus): void {
		if (!this.statusDot || !this.statusText) return;

		// 重置类名
		this.statusDot.className = 'deeppdf-status-dot';

		switch (status) {
			case 'loading':
				this.statusDot.classList.add('status-loading');
				this.statusText.textContent = 'Checking...';
				break;
			case 'connected':
				this.statusDot.classList.add('status-ok');
				this.statusText.textContent = 'Connected';
				break;
			case 'disconnected':
				this.statusDot.classList.add('status-warning');
				this.statusText.textContent = 'Offline';
				break;
			case 'error':
				this.statusDot.classList.add('status-error');
				this.statusText.textContent = 'Error';
				break;
		}
	}

	/**
	 * 销毁组件
	 */
	destroy(): void {
		if (this.settingsButtonHandler) {
			const settingsButton = this.el?.querySelector('button[aria-label="设置"]');
			if (settingsButton) {
				settingsButton.removeEventListener('click', this.settingsButtonHandler);
			}
			this.settingsButtonHandler = null;
		}
		if (this.newChatButtonHandler) {
			const newChatButton = this.el?.querySelector('button[aria-label="新建对话"]');
			if (newChatButton) {
				newChatButton.removeEventListener('click', this.newChatButtonHandler);
			}
			this.newChatButtonHandler = null;
		}

		this.statusDot = null;
		this.statusText = null;

		super.destroy();
	}
}
