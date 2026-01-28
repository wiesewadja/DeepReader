/**
 * DeepPDF 聊天历史模态框
 * 显示历史会话列表，支持切换会话
 */

import { App, Modal, Notice } from 'obsidian';
import { Component } from '../component.js';

/**
 * 会话信息接口
 */
export interface ChatSession {
	sessionId: string;
	indexId: string;
	pdfName: string;
	messageCount: number;
	lastMessageTime: string;
	createdTime: string;
}

/**
 * 历史模态框配置
 */
export interface ChatHistoryModalOptions {
	onSessionSelect?: (sessionId: string, indexId: string) => void;
	onSessionDelete?: (sessionId: string, indexId: string) => void;
}

/**
 * 聊天历史模态框组件
 */
export class ChatHistoryModal extends Component {
	private modal: Modal | null = null;
	private options: ChatHistoryModalOptions;
	private sessions: ChatSession[] = [];
	private app: App;

	constructor(app: App, options: ChatHistoryModalOptions = {}) {
		super();
		this.app = app;
		this.options = options;
	}

	/**
	 * 设置会话列表
	 */
	setSessions(sessions: ChatSession[]): void {
		this.sessions = sessions;
		this.render();
	}

	/**
	 * 打开模态框
	 */
	open(): void {
		if (this.modal) {
			this.modal.open();
			return;
		}

		// 创建 Obsidian 模态框
		this.modal = new Modal(this.app);

		// 渲染内容到模态框
		const contentEl = this.render();
		this.modal.contentEl.empty();
		this.modal.contentEl.appendChild(contentEl);

		this.modal.open();
	}

	/**
	 * 关闭模态框
	 */
	close(): void {
		if (this.modal) {
			this.modal.close();
			this.modal = null;
		}
	}

	/**
	 * 渲染模态框内容
	 */
	render(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'deeppdf-history-modal';

		// 标题
		const header = container.createEl('div', { cls: 'deeppdf-modal-header' });
		header.innerHTML = `
			<h2>聊天历史</h2>
			<p>选择一个历史会话继续对话，或删除不需要的会话</p>
		`;

		// 会话列表
		const sessionsList = container.createEl('div', { cls: 'deeppdf-sessions-list' });

		if (this.sessions.length === 0) {
			sessionsList.innerHTML = `
				<div class="deeppdf-empty-sessions">
					<div class="deeppdf-empty-icon">💬</div>
					<p>暂无历史会话</p>
				</div>
			`;
		} else {
			this.sessions.forEach(session => {
				const sessionItem = this.createSessionItem(session);
				sessionsList.appendChild(sessionItem);
			});
		}

		// 关闭按钮
		const footer = container.createEl('div', { cls: 'deeppdf-modal-footer' });
		const closeButton = footer.createEl('button', {
			cls: 'mod-cta',
			text: '关闭'
		});
		closeButton.addEventListener('click', () => this.close());
		footer.appendChild(closeButton);

		container.appendChild(sessionsList);
		container.appendChild(footer);

		return container;
	}

	/**
	 * 创建会话项
	 */
	private createSessionItem(session: ChatSession): HTMLElement {
		const item = document.createElement('div');
		item.className = 'deeppdf-session-item';

		// 会话信息
		const info = item.createEl('div', { cls: 'deeppdf-session-info' });

		const title = info.createEl('div', { cls: 'deeppdf-session-title' });
		title.textContent = session.pdfName;

		const meta = info.createEl('div', { cls: 'deeppdf-session-meta' });
		meta.innerHTML = `
			<span class="deeppdf-session-count">${session.messageCount} 条消息</span>
			<span class="deeppdf-session-time">${this.formatTime(session.lastMessageTime)}</span>
		`;

		info.appendChild(title);
		info.appendChild(meta);

		// 操作按钮
		const actions = item.createEl('div', { cls: 'deeppdf-session-actions' });

		// 切换按钮
		const switchButton = actions.createEl('button', {
			cls: 'deeppdf-session-switch',
			text: '切换'
		});
		switchButton.addEventListener('click', () => {
			this.options.onSessionSelect?.(session.sessionId, session.indexId);
			this.close();
		});

		// 删除按钮
		const deleteButton = actions.createEl('button', {
			cls: 'deeppdf-session-delete',
			text: '删除'
		});
		deleteButton.addEventListener('click', () => {
			this.handleDeleteSession(session);
		});

		actions.appendChild(switchButton);
		actions.appendChild(deleteButton);

		item.appendChild(info);
		item.appendChild(actions);

		return item;
	}

	/**
	 * 处理删除会话
	 */
	private async handleDeleteSession(session: ChatSession): Promise<void> {
		const confirm = window.confirm(`确定要删除 "${session.pdfName}" 的会话记录吗？此操作不可撤销。`);
		if (!confirm) return;

		try {
			await this.options.onSessionDelete?.(session.sessionId, session.indexId);
			new Notice('会话已删除');

			// 从列表中移除
			this.sessions = this.sessions.filter(s => s.sessionId !== session.sessionId);

			// 重新渲染
			if (this.el) {
				const list = this.el.querySelector('.deeppdf-sessions-list');
				if (list) {
					const item = list.querySelectorAll('.deeppdf-session-item');
					item.forEach(el => el.remove());

					if (this.sessions.length === 0) {
						list.innerHTML = `
							<div class="deeppdf-empty-sessions">
								<div class="deeppdf-empty-icon">💬</div>
								<p>暂无历史会话</p>
							</div>
						`;
					} else {
						this.sessions.forEach(s => {
							const sessionItem = this.createSessionItem(s);
							list.appendChild(sessionItem);
						});
					}
				}
			}
		} catch (error) {
			new Notice('删除失败：' + error);
		}
	}

	/**
	 * 格式化时间
	 */
	private formatTime(timeStr: string): string {
		const date = new Date(timeStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) {
			return '刚刚';
		} else if (diffMins < 60) {
			return `${diffMins} 分钟前`;
		} else if (diffHours < 24) {
			return `${diffHours} 小时前`;
		} else if (diffDays < 7) {
			return `${diffDays} 天前`;
		} else {
			return date.toLocaleDateString('zh-CN');
		}
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		this.close();
		super.destroy();
	}
}
