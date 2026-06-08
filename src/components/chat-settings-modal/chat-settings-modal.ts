/**
 * DeepPDF 聊天设置模态框
 * 提供聊天模式切换等隐藏设置选项
 */

import { type App, Modal } from 'obsidian';
import { AgentModeToggle, type ChatMode } from '../agent-mode-toggle/agent-mode-toggle';

export interface ChatSettingsOptions {
    initialMode: ChatMode;
    onModeChange: (mode: ChatMode) => void;
}

export class ChatSettingsModal extends Modal {
    private options: ChatSettingsOptions;
    private agentModeToggle: AgentModeToggle | null = null;

    constructor(app: App, options: ChatSettingsOptions) {
        super(app);
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('deeppdf-chat-settings-modal');

        // 标题
        const header = contentEl.createEl('h2', {
            text: '聊天设置',
            cls: 'deeppdf-settings-title'
        });

        // 描述
        const description = contentEl.createEl('p', {
            text: '配置聊天模式和回答偏好',
            cls: 'deeppdf-settings-description'
        });

        // 创建设置项容器
        const settingsContainer = contentEl.createDiv({
            cls: 'deeppdf-settings-container'
        });

        // ========== 模式切换设置 ==========
        this.createModeSetting(settingsContainer);

        // ========== 模式说明 ==========
        this.createModeDescription(settingsContainer);

        // 关闭按钮
        const buttonContainer = contentEl.createDiv({
            cls: 'modal-button-container'
        });

        const closeBtn = buttonContainer.createEl('button', {
            text: '关闭',
            cls: 'mod-cta'
        });

        closeBtn.addEventListener('click', () => {
            this.close();
        });

        // 聚焦关闭按钮
        setTimeout(() => closeBtn.focus(), 50);
    }

    /**
     * 创建模式切换设置项
     */
    private createModeSetting(container: HTMLElement) {
        const settingItem = container.createDiv({
            cls: 'deeppdf-setting-item'
        });

        const label = settingItem.createDiv({
            cls: 'deeppdf-setting-label'
        });
        label.createEl('h3', { text: '聊天模式' });
        label.createEl('p', {
            text: '选择 AI 回答的方式',
            cls: 'deeppdf-setting-hint'
        });

        const control = settingItem.createDiv({
            cls: 'deeppdf-setting-control'
        });

        // 使用现有的 AgentModeToggle 组件
        this.agentModeToggle = new AgentModeToggle({
            initialMode: this.options.initialMode,
            onModeChange: (mode: ChatMode) => {
                this.options.onModeChange(mode);
            }
        });

        const toggleEl = this.agentModeToggle.getElement();
        if (toggleEl) {
            control.appendChild(toggleEl);
        }
    }

    /**
     * 创建模式说明
     */
    private createModeDescription(container: HTMLElement) {
        const descriptionSection = container.createDiv({
            cls: 'deeppdf-mode-description'
        });

        // 快速检索模式说明
        const fastDesc = descriptionSection.createDiv({
            cls: 'deeppdf-mode-desc-item deeppdf-mode-desc-fast'
        });
        fastDesc.innerHTML = `
            <div class="deeppdf-mode-desc-icon">⚡</div>
            <div class="deeppdf-mode-desc-content">
                <div class="deeppdf-mode-desc-title">快速检索</div>
                <div class="deeppdf-mode-desc-text">直接从文档索引中检索相关内容并返回，速度快，适合快速查找信息</div>
            </div>
        `;

        // Agent 问答模式说明
        const agentDesc = descriptionSection.createDiv({
            cls: 'deeppdf-mode-desc-item deeppdf-mode-desc-agent'
        });
        agentDesc.innerHTML = `
            <div class="deeppdf-mode-desc-icon">🤖</div>
            <div class="deeppdf-mode-desc-content">
                <div class="deeppdf-mode-desc-title">Agent 问答</div>
                <div class="deeppdf-mode-desc-text">使用 Agent 思考并调用工具，综合多个来源回答复杂问题，适合深度分析</div>
            </div>
        `;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.removeClass('deeppdf-chat-settings-modal');
        this.agentModeToggle = null;
    }
}
