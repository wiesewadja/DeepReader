/**
 * DeepReader 插件设置界面
 */

import { App, Notice, PluginSettingTab, Setting, TFolder, FuzzySuggestModal } from 'obsidian';
import type DeepPDFPlugin from '../main';
import type { ProviderType } from '../config/providers';
import { PROVIDER_LABELS, PROVIDER_CONFIGS, getAvailableProvidersForRole, getProviderName, getProviderBaseUrl, applyPreset } from '../config/providers';
import type { RoleType } from '../config/ai-roles';
import { ROLE_CAPABILITY } from '../config/ai-roles';
import { PRESETS, getPresetById } from '../config/presets';
import type { ProviderPreset } from '../config/presets';


/** Proposition feature toggle: disabled due to high token cost. Re-enable after optimization. */
const PROPOSITION_ENABLED = false;

import { setLogEnabled, serviceLog } from '../utils/logger';

type SettingsTabId = 'llm' | 'index' | 'profile' | 'advanced' | 'reading';

interface SettingsTab {
    id: SettingsTabId;
    name: string;
}

export class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;
    private currentTab: SettingsTabId = 'llm';
    private contentContainer: HTMLElement | null = null;
    private expandedSections: Set<string> = new Set();
    private selectedPresetId: string | null = null;
    private testStatus: { success: boolean; message: string } | null = null;
    private forceShowQuickSetup: boolean = false;

    // Tab 定义
    private tabs: SettingsTab[] = [
        { id: 'llm', name: 'AI 服务' },
        { id: 'index', name: '服务配置' },
        { id: 'profile', name: '用户画像' },
        { id: 'advanced', name: '高级' },
        { id: 'reading', name: '阅读模式' },
    ];

    constructor(app: App, plugin: DeepPDFPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('deeppdf-settings');

        // 创建 Tab 布局容器
        const tabContainer = containerEl.createDiv({ cls: 'deeppdf-settings-tabs' });

        // 左侧 Tab 导航
        const navContainer = tabContainer.createDiv({ cls: 'deeppdf-settings-nav' });
        this.createTabNav(navContainer);

        // 右侧内容区
        this.contentContainer = tabContainer.createDiv({ cls: 'deeppdf-settings-content' });

        // 渲染当前选中的 Tab
        this.renderTabContent(this.currentTab);
    }

    /**
     * 创建左侧 Tab 导航
     */
    private createTabNav(container: HTMLElement): void {
        this.tabs.forEach(tab => {
            const navItem = container.createDiv({
                cls: `deeppdf-settings-nav-item ${this.currentTab === tab.id ? 'is-active' : ''}`
            });

            // 名称
            navItem.createSpan({ cls: 'deeppdf-settings-nav-name', text: tab.name });

            // 点击事件
            navItem.addEventListener('click', () => {
                this.switchTab(tab.id);
            });
        });
    }

    /**
     * 切换 Tab
     */
    private switchTab(tabId: SettingsTabId): void {
        this.currentTab = tabId;
        this.display();
    }

    /** 切换折叠区块并刷新指定 Tab */
    private toggleSection(sectionId: string, tabId: SettingsTabId): void {
        if (this.expandedSections.has(sectionId)) {
            this.expandedSections.delete(sectionId);
        } else {
            this.expandedSections.add(sectionId);
        }
        this.renderTabContent(tabId);
    }

    /**
     * 渲染 Tab 内容
     */
    private renderTabContent(tabId: SettingsTabId): void {
        if (!this.contentContainer) return;

        const container = this.contentContainer;
        container.empty();

        switch (tabId) {
            case 'llm':
                this.renderLLMSettings(container);
                break;
            case 'index':
                this.renderIndexServicesSettings(container);
                break;
            case 'profile':
                this.renderProfileSettings(container);
                break;
            case 'advanced':
                this.renderAdvancedSettings(container);
                break;
            case 'reading':
                this.renderReadingModeSettings(container);
                break;
        }
    }

    /**
     * AI 服务设置 — 快速配置 / 摘要 / 高级模式
     */
    private renderLLMSettings(container: HTMLElement): void {
        if (!this.plugin.settings.setupComplete || this.forceShowQuickSetup) {
            this.renderQuickSetup(container);
        } else {
            this.renderConfigSummary(container);
        }

        // 高级模式切换
        const advancedKey = 'advanced-llm';
        const isAdvanced = this.expandedSections.has(advancedKey);

        const toggleAdvanced = container.createDiv({ cls: 'deeppdf-toggle-advanced' });
        toggleAdvanced.setText(isAdvanced ? '收起高级设置 ▲' : '展开高级设置 ▼');
        toggleAdvanced.addEventListener('click', () => this.toggleSection(advancedKey, 'llm'));

        if (isAdvanced) {
            container.createEl('h3', { text: '服务商账号' });
            container.createEl('p', {
                text: '配置各服务商的 API Key。填写 Key 后，在「服务配置」Tab 中为各用途分配服务商和模型。',
                cls: 'setting-item-description'
            });
            this.renderProviderAccounts(container);
        }
    }

    /**
     * 快速配置界面 — 预设卡片 + Key 输入
     */
    private renderQuickSetup(container: HTMLElement): void {
        const card = container.createDiv({ cls: 'deeppdf-settings-card deeppdf-quick-setup' });
        card.createEl('div', { text: '开始使用 DeepReader', cls: 'deeppdf-quick-setup-title' });
        card.createEl('div', {
            text: '选择一个 AI 服务方案，填入 API Key 即可开始',
            cls: 'deeppdf-quick-setup-desc',
        });

        // 预设卡片网格
        const grid = card.createDiv({ cls: 'deeppdf-preset-grid' });
        for (const preset of PRESETS) {
            const presetCard = grid.createDiv({ cls: 'deeppdf-preset-card' });
            if (this.selectedPresetId === preset.id) {
                presetCard.addClass('is-selected');
            }

            presetCard.createEl('div', { text: preset.label, cls: 'deeppdf-preset-card-name' });
            presetCard.createEl('div', { text: preset.description, cls: 'deeppdf-preset-card-desc' });

            // 标签
            if (preset.recommended || preset.free) {
                const badgeRow = presetCard.createDiv();
                if (preset.recommended) {
                    badgeRow.createEl('span', { text: '推荐', cls: 'deeppdf-preset-card-badge is-recommended' });
                }
                if (preset.free) {
                    badgeRow.createEl('span', { text: '免费额度', cls: 'deeppdf-preset-card-badge is-free' });
                }
            }

            presetCard.addEventListener('click', () => {
                this.selectedPresetId = preset.id;
                this.testStatus = null;
                this.renderTabContent('llm');
            });
        }

        // 默认选中推荐
        if (!this.selectedPresetId) {
            this.selectedPresetId = PRESETS.find(p => p.recommended)?.id || PRESETS[0]?.id || null;
        }

        // API Key 输入
        const selectedPreset = this.selectedPresetId ? getPresetById(this.selectedPresetId) : null;
        const providerId = selectedPreset?.provider || 'siliconflow';
        const currentKey = this.plugin.settings.providers[providerId]?.apiKey || '';

        const keyRow = card.createDiv({ cls: 'deeppdf-key-row' });
        const keyInput = keyRow.createEl('input', {
            cls: 'deeppdf-key-input',
            attr: {
                type: 'password',
                placeholder: `输入 ${PROVIDER_LABELS[providerId as ProviderType] || providerId} API Key`,
                value: currentKey,
            },
        });

        // 显示/隐藏
        const eyeBtn = keyRow.createEl('button', { text: '👁', cls: 'deeppdf-btn-eye' });
        let keyVisible = false;
        eyeBtn.addEventListener('click', () => {
            keyVisible = !keyVisible;
            keyInput.type = keyVisible ? 'text' : 'password';
        });

        // 测试状态
        if (this.testStatus) {
            keyRow.createEl('span', {
                text: this.testStatus.message,
                cls: `deeppdf-key-status ${this.testStatus.success ? 'is-success' : 'is-error'}`,
            });
        }

        // 操作按钮
        const actionsRow = card.createDiv({ cls: 'deeppdf-actions-row' });

        const testBtn = actionsRow.createEl('button', { text: '测试连接', cls: 'deeppdf-btn-secondary' });

        const confirmBtn = actionsRow.createEl('button', { text: '确认配置 →', cls: 'deeppdf-btn-primary' });

        // 注册链接
        if (selectedPreset?.website) {
            const hint = card.createEl('div', { cls: 'setting-item-description deeppdf-hint-register' });
            hint.createSpan({ text: '还没有 Key？' });
            hint.createEl('a', {
                text: `前往注册${selectedPreset.free ? '（免费）' : ''}`,
                attr: { href: selectedPreset.website, target: '_blank' },
            });
        }

        // 事件处理
        testBtn.addEventListener('click', async () => {
            const apiKey = keyInput.value.trim();
            if (!apiKey || !selectedPreset) return;

            testBtn.textContent = '测试中...';
            testBtn.setAttribute('disabled', 'true');

            try {
                const { testConnection } = await import('../config/model-fetcher');
                const config = PROVIDER_CONFIGS[providerId as ProviderType];
                const result = await testConnection(
                    config?.baseUrl || '',
                    apiKey,
                    selectedPreset.roleAssignments.chat || config?.defaultModel || '',
                    'chat',
                );
                this.testStatus = result.success
                    ? { success: true, message: `✓ ${result.latencyMs}ms` }
                    : { success: false, message: `✗ ${result.error}` };
            } catch (e: any) {
                this.testStatus = { success: false, message: `✗ ${e.message}` };
            }

            testBtn.textContent = '测试连接';
            testBtn.removeAttribute('disabled');
            this.renderTabContent('llm');
        });

        confirmBtn.addEventListener('click', async () => {
            const apiKey = keyInput.value.trim();
            if (!apiKey || !this.selectedPresetId) {
                new Notice('请输入 API Key');
                return;
            }

            applyPreset(this.selectedPresetId, apiKey, this.plugin.settings);
            this.plugin.settings.setupComplete = true;
            this.plugin.resetFrontendAgent();
            await this.plugin.saveSettings();
            this.testStatus = null;
            new Notice('配置完成！可以开始使用了');
            this.forceShowQuickSetup = false;
            this.renderTabContent('llm');
        });
    }

    /**
     * 配置摘要 — 已配置时显示
     */
    private renderConfigSummary(container: HTMLElement): void {
        const card = container.createDiv({ cls: 'deeppdf-settings-card' });
        const summary = card.createDiv({ cls: 'deeppdf-config-summary' });

        // 推断当前使用的预设
        const currentPreset = this.detectCurrentPreset();
        const titleText = currentPreset
            ? `当前方案：${currentPreset.label}`
            : '当前配置';
        summary.createEl('div', { text: titleText, cls: 'deeppdf-config-summary-title' });

        // 显示角色摘要
        const roles = this.plugin.settings.roles;
        const parts: string[] = [];
        if (roles.chat) parts.push(`对话: ${roles.chat.model}`);
        if (roles.embedding) parts.push(`语义搜索: ${roles.embedding.model}`);
        if (roles.reranker) parts.push(`排序: ${roles.reranker.model}`);
        if (parts.length === 0) parts.push('仅基础对话');
        summary.createEl('div', { text: parts.join(' · '), cls: 'deeppdf-config-summary-details' });

        // 操作按钮
        const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
        const switchBtn = actions.createEl('button', { text: '切换方案', cls: 'deeppdf-btn-secondary' });

        switchBtn.addEventListener('click', () => {
            this.forceShowQuickSetup = true;
            this.testStatus = null;
            this.renderTabContent('llm');
        });
    }

    /**
     * 检测当前配置匹配哪个预设
     */
    private detectCurrentPreset(): ProviderPreset | null {
        const { roles } = this.plugin.settings;
        return PRESETS.find(p =>
            Object.entries(p.roleAssignments).every(([role, model]) => {
                const r = (roles as unknown as Record<string, { provider: string; model: string } | null>)[role];
                return r?.provider === p.provider && r?.model === model;
            })
        ) ?? null;
    }

    /**
     * 区域一：服务商账号管理（固定 + 自定义）
     */
    private renderProviderAccounts(container: HTMLElement): void {
        const providers = this.plugin.settings.providers;
        if (!providers) return;

        // 渲染所有服务商（固定 + 自定义）
        for (const providerId of Object.keys(providers)) {
            const account = providers[providerId];
            if (!account) continue;

            const isBuiltIn = !!PROVIDER_CONFIGS[providerId as ProviderType];
            const displayName = isBuiltIn
                ? PROVIDER_LABELS[providerId as ProviderType]
                : (account as { name?: string }).name || providerId;

            const sectionId = `provider-${providerId}`;
            const isCollapsed = !this.expandedSections.has(sectionId);
            const card = container.createDiv({ cls: 'deeppdf-settings-collapsible-section' });
            const header = card.createDiv({ cls: 'deeppdf-settings-collapsible-header' });

            const titleRow = header.createDiv({ cls: 'deeppdf-settings-provider-title' });
            titleRow.createEl('h5', { text: displayName });

            if (isBuiltIn) {
                const caps = PROVIDER_CONFIGS[providerId as ProviderType].capabilities;
                const capTags: string[] = [];
                if (caps.chat) capTags.push('对话');
                if (caps.embedding) capTags.push('向量化');
                if (caps.reranker) capTags.push('重排序');
                titleRow.createSpan({ text: capTags.join(' · '), cls: 'deeppdf-settings-capability-tags' });
            } else {
                titleRow.createSpan({ text: '自定义', cls: 'deeppdf-settings-capability-tags' });
            }

            const hasKey = !!(account as { apiKey?: string }).apiKey;
            titleRow.createSpan({
                text: hasKey ? '✓ 已配置' : '未配置',
                cls: `deeppdf-settings-status ${hasKey ? 'is-configured' : 'is-not-configured'}`
            });

            const indicator = header.createSpan({ cls: 'deeppdf-settings-collapsible-indicator' });
            indicator.setText(isCollapsed ? '▶' : '▼');

            header.addEventListener('click', () => {
                if (this.expandedSections.has(sectionId)) {
                    this.expandedSections.delete(sectionId);
                } else {
                    this.expandedSections.add(sectionId);
                }
                this.renderTabContent('llm');
            });

            if (!isCollapsed) {
                const content = card.createDiv({ cls: 'deeppdf-settings-collapsible-content' });
                this.renderProviderDetail(content, providerId, account, isBuiltIn, displayName);
            }
        }

        // "添加自定义服务商" 按钮
        container.createDiv({ cls: 'deeppdf-settings-add-provider' }, (wrapper) => {
            new Setting(wrapper)
                .setName("添加自定义服务商")
                .setDesc("支持 OpenAI 兼容 API 的第三方服务商（如 OpenRouter、Together AI、中转站等）")
                .addButton(btn => btn
                    .setButtonText("+ 添加")
                    .setCta()
                    .onClick(() => {
                        const id = `custom-${Date.now()}`;
                        (this.plugin.settings.providers as Record<string, unknown>)[id] = {
                            apiKey: '',
                            baseUrl: '',
                            name: '',
                        };
                        this.renderTabContent('llm');
                    }));
        });
    }

    /**
     * 渲染单个服务商的详细配置
     */
    private renderProviderDetail(
        container: HTMLElement,
        providerId: string,
        account: { apiKey?: string; baseUrl?: string; name?: string },
        isBuiltIn: boolean,
        displayName: string,
    ): void {
        // 自定义服务商：显示名称输入和删除按钮
        if (!isBuiltIn) {
            new Setting(container)
                .setName("服务商名称")
                .setDesc("自定义显示名称")
                .addText(text => text
                    .setPlaceholder("我的 API 服务")
                    .setValue(account.name || '')
                    .onChange(async (value) => {
                        (this.plugin.settings.providers as Record<string, unknown>)[providerId] = {
                            ...account,
                            name: value,
                        };
                        await this.plugin.saveSettings();
                    }));

            new Setting(container)
                .setName("Base URL")
                .setDesc("服务商的 API 地址（必填）")
                .addText(text => text
                    .setPlaceholder("https://api.example.com/v1")
                    .setValue(account.baseUrl || '')
                    .onChange(async (value) => {
                        (this.plugin.settings.providers as Record<string, unknown>)[providerId] = {
                            ...account,
                            baseUrl: value,
                        };
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                    }));

            new Setting(container)
                .setName("删除此服务商")
                .setDesc("删除后，使用该服务商的角色将失效")
                .addButton(btn => btn
                    .setButtonText("删除")
                    .setWarning()
                    .onClick(async () => {
                        delete (this.plugin.settings.providers as Record<string, unknown>)[providerId];
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                        this.renderTabContent('llm');
                    }));
        }

        // API Key（所有服务商都有）
        const keySetting = new Setting(container)
            .setName("API Key")
            .setDesc(`用于访问 ${displayName} 服务的密钥`)
            .addText(text => {
                text.setPlaceholder("sk-...")
                    .setValue(account.apiKey || '')
                    .inputEl.type = 'password';
                text.onChange(async (value) => {
                    (this.plugin.settings.providers as Record<string, unknown>)[providerId] = {
                        ...(this.plugin.settings.providers as Record<string, unknown>)[providerId] as object,
                        apiKey: value,
                    };
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                    this.renderTabContent('llm');
                });
            });

        const inputEl = keySetting.controlEl.querySelector('input');
        keySetting.addExtraButton(btn => {
            let visible = false;
            btn.setIcon('eye')
                .setTooltip('显示 API Key')
                .onClick(() => {
                    visible = !visible;
                    if (inputEl) inputEl.type = visible ? 'text' : 'password';
                    btn.setIcon(visible ? 'eye-off' : 'eye');
                    btn.setTooltip(visible ? '隐藏 API Key' : '显示 API Key');
                });
        });

    }

    /**
     * 渲染单个角色行（可折叠）
     */
    private renderRoleRow(
        container: HTMLElement,
        role: RoleType,
        label: string,
        desc: string,
        optional: boolean
    ): void {
        const settings = this.plugin.settings;
        const roleConfig = (settings.roles as unknown as Record<string, unknown>)?.[role] as {
            provider: ProviderType;
            model: string;
            baseUrlOverride?: string;
        } | null;

        const sectionId = `role-${role}`;
        const isCollapsed = !this.expandedSections.has(sectionId);

        // 创建可折叠区块容器
        const sectionWrapper = container.createDiv({ cls: 'deeppdf-settings-collapsible-section' });

        // 创建 header（点击可折叠）
        const header = sectionWrapper.createDiv({ cls: 'deeppdf-settings-collapsible-header' });

        // 标题区域
        const titleRow = header.createDiv({ cls: 'deeppdf-settings-provider-title' });
        titleRow.createEl('h5', { text: label });

        // 描述
        header.createEl('span', {
            text: desc,
            cls: 'deeppdf-settings-collapsible-desc'
        });

        // 折叠指示器
        const indicator = header.createSpan({ cls: 'deeppdf-settings-collapsible-indicator' });
        indicator.setText(isCollapsed ? '▶' : '▼');

        // 点击事件
        header.addEventListener('click', () => {
            if (this.expandedSections.has(sectionId)) {
                this.expandedSections.delete(sectionId);
            } else {
                this.expandedSections.add(sectionId);
            }
            this.renderTabContent('index');
        });

        // 如果未折叠，渲染内容
        if (!isCollapsed) {
            const content = sectionWrapper.createDiv({ cls: 'deeppdf-settings-collapsible-content' });
            this.renderRoleContent(content, role, label, desc, optional, roleConfig, settings);
        }
    }

    /**
     * 渲染角色内容
     */
    private renderRoleContent(
        container: HTMLElement,
        role: RoleType,
        label: string,
        desc: string,
        optional: boolean,
        roleConfig: { provider: ProviderType; model: string; baseUrlOverride?: string } | null,
        settings: any
    ): void {
        const row = container.createDiv({ cls: 'deeppdf-settings-role-row' });

        // 可选角色有启用/禁用开关
        if (optional) {
            const isEnabled = roleConfig !== null;
            const toggleSetting = new Setting(row)
                .setName(label)
                .setDesc(desc)
                .addToggle(toggle => toggle
                    .setValue(isEnabled)
                    .onChange(async (value) => {
                        if (value) {
                            // 启用：默认分配第一个可用服务商
                            const available = getAvailableProvidersForRole(role, settings);
                            const defaultProvider = available[0] || 'deepseek';
                            (settings.roles as unknown as Record<string, unknown>)[role] = {
                                provider: defaultProvider,
                                model: PROVIDER_CONFIGS[defaultProvider as ProviderType]?.defaultModel || '',
                            };
                        } else {
                            (settings.roles as unknown as Record<string, unknown>)[role] = null;
                        }
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                        this.renderTabContent('index');
                    }));

            if (!isEnabled) {
                if (role === 'embedding') {
                    row.createEl('p', {
                        text: '语义搜索让 AI 不仅匹配关键词，还能理解含义。开启后首次索引稍慢，但搜索质量显著提升。',
                        cls: 'setting-item-description'
                    });
                } else {
                    row.createEl('p', {
                        text: `启用后将为此角色分配服务商和模型。`,
                        cls: 'setting-item-description'
                    });
                }
                return;
            }
        } else {
            row.createEl('h5', { text: label });
            row.createEl('span', { text: desc, cls: 'setting-item-description' });
        }

        // 服务商下拉
        const availableProviders = getAvailableProvidersForRole(role, settings);
        const currentProvider = roleConfig?.provider || 'deepseek';

        new Setting(row)
            .setName("服务商")
            .setDesc(availableProviders.length === 0 ? '没有已配置的服务商，请先在上方填写 API Key' : '')
            .addDropdown(dropdown => {
                const allProviders = new Set<string>([...availableProviders, currentProvider]);
                for (const p of allProviders) {
                    const hasKey = !!(settings.providers as Record<string, unknown>)[p] &&
                        !!((settings.providers as Record<string, unknown>)[p] as { apiKey?: string })?.apiKey;
                    const label = getProviderName(p, settings);
                    dropdown.addOption(p, `${label}${hasKey ? '' : ' (未配置)'}`);
                }
                dropdown.setValue(currentProvider);
                dropdown.onChange(async (value) => {
                    const defaultModel = PROVIDER_CONFIGS[value as ProviderType]?.defaultModel || '';
                    (settings.roles as unknown as Record<string, unknown>)[role] = {
                        ...(settings.roles as unknown as Record<string, unknown>)[role] as object,
                        provider: value,
                        model: defaultModel,
                    };
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                    this.renderTabContent('index');
                });
            });

        // 模型输入
        const providerConfig = PROVIDER_CONFIGS[currentProvider as ProviderType];
        const isBuiltIn = !!providerConfig;
        const supportsModelList = isBuiltIn ? providerConfig.supportsModelList : true;
        const defaultModel = isBuiltIn ? providerConfig.defaultModel : '';

        const oldModel = roleConfig?.model || '';
        const modelSetting = new Setting(row)
            .setName("模型")
            .addText(text => text
                .setPlaceholder(defaultModel || 'model-name')
                .setValue(oldModel)
                .onChange(async (value) => {
                    (settings.roles as unknown as Record<string, unknown>)[role] = {
                        ...(settings.roles as unknown as Record<string, unknown>)[role] as object,
                        model: value,
                    };
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();

                    // Embedding 模型变更警告
                    if (role === 'embedding' && oldModel && value && oldModel !== value) {
                        new Notice('已切换向量化模型，已有索引可能需要重建以保持搜索一致性');
                    }
                }));

        // 测试连接按钮：验证 API Key + Base URL + 模型名是否可用
        const currentAccount = (settings.providers as Record<string, unknown>)[currentProvider] as { apiKey?: string; baseUrl?: string } | undefined;
        if (currentAccount?.apiKey) {
            modelSetting.addExtraButton(btn => btn
                .setIcon('plug')
                .setTooltip('测试连接')
                .onClick(async () => {
                    // 从 plugin.settings 读取最新值，避免闭包捕获旧数据
                    const freshSettings = this.plugin.settings;
                    const freshAccount = (freshSettings.providers as Record<string, unknown>)[currentProvider] as { apiKey?: string; baseUrl?: string } | undefined;
                    const freshRole = (freshSettings.roles as unknown as Record<string, unknown>)[role] as any;
                    const currentModel = freshRole?.model;
                    if (!currentModel) {
                        new Notice('请先填写模型名称');
                        return;
                    }
                    btn.setDisabled(true);
                    btn.setIcon('loader');
                    const { testConnection } = await import('../config/model-fetcher');
                    const builtInConfig = PROVIDER_CONFIGS[currentProvider as ProviderType];
                    const effectiveBaseUrl = freshAccount?.baseUrl || builtInConfig?.baseUrl || '';
                    const result = await testConnection(
                        effectiveBaseUrl,
                        freshAccount?.apiKey || '',
                        currentModel,
                        role === 'embedding' ? 'embedding' : 'chat',
                    );
                    btn.setDisabled(false);
                    btn.setIcon('plug');
                    if (result.success) {
                        new Notice(`✓ 连接成功 (${result.latencyMs}ms) — ${result.model || currentModel}`);
                    } else {
                        new Notice(`✗ 连接失败: ${result.error}`);
                    }
                }));
        }

        // 支持模型列表的服务商：按需获取下拉选择
        if (supportsModelList) {
            const account = (settings.providers as Record<string, unknown>)[currentProvider] as { apiKey?: string; baseUrl?: string } | undefined;
            if (account?.apiKey) {
                modelSetting.addExtraButton(btn => btn
                    .setIcon('refresh-cw')
                    .setTooltip('获取模型列表')
                    .onClick(async () => {
                        btn.setDisabled(true);
                        const { fetchModels } = await import('../config/model-fetcher');
                        const result = await fetchModels(currentProvider, account as any);
                        btn.setDisabled(false);
                        if (result.success && result.models.length > 0) {
                            // 替换文本输入为下拉选择
                            const controlEl = modelSetting.controlEl;
                            controlEl.empty();
                            const select = controlEl.createEl('select', { cls: 'dropdown' });
                            for (const m of result.models) {
                                const opt = select.createEl('option', { text: m });
                                opt.value = m;
                            }
                            const currentModel = roleConfig?.model || '';
                            if (currentModel && !result.models.includes(currentModel)) {
                                const opt = select.createEl('option', { text: `${currentModel} (自定义)` });
                                opt.value = currentModel;
                            }
                            select.value = currentModel || defaultModel || result.models[0];
                            select.addEventListener('change', async () => {
                                (settings.roles as unknown as Record<string, unknown>)[role] = {
                                    ...(settings.roles as unknown as Record<string, unknown>)[role] as object,
                                    model: select.value,
                                };
                                this.plugin.resetFrontendAgent();
                                await this.plugin.saveSettings();
                            });
                            new Notice(`获取到 ${result.models.length} 个模型`);
                        } else {
                            new Notice(`获取失败: ${result.error || '无可用模型'}`);
                        }
                    }));
            }
        }

        // 思考模型控制（chat 能力角色）
        if (ROLE_CAPABILITY[role] === 'chat') {
            const currentDisableThinking = (roleConfig as any)?.disableThinking;
            new Setting(row)
                .setName("禁用深度思考")
                .setDesc("禁用模型的思考过程，减少首次响应延迟和 Token 消耗。默认自动检测。")
                .addDropdown(dropdown => dropdown
                    .addOption('', '自动检测')
                    .addOption('true', '强制禁用')
                    .addOption('false', '不禁用')
                    .setValue(currentDisableThinking === true ? 'true' : currentDisableThinking === false ? 'false' : '')
                    .onChange(async (value) => {
                        const disableThinking = value === 'true' ? true : value === 'false' ? false : undefined;
                        (settings.roles as unknown as Record<string, unknown>)[role] = {
                            ...(settings.roles as unknown as Record<string, unknown>)[role] as object,
                            disableThinking,
                        };
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                    }));
        }

        // embedding 角色专用：batch size 配置
        if (role === 'embedding') {
            const currentBatchSize = (roleConfig as any)?.embeddingBatchSize;
            new Setting(row)
                .setName("Batch Size")
                .setDesc("每次 API 请求最多发送的文本数（默认 32，GLM/部分服务商限制为 32）")
                .addText(text => text
                    .setPlaceholder('32')
                    .setValue(currentBatchSize != null ? String(currentBatchSize) : '')
                    .onChange(async (value) => {
                        const parsed = parseInt(value, 10);
                        (settings.roles as unknown as Record<string, unknown>)[role] = {
                            ...(settings.roles as unknown as Record<string, unknown>)[role] as object,
                            embeddingBatchSize: (!value || isNaN(parsed)) ? undefined : Math.max(1, Math.min(parsed, 2048)),
                        };
                        await this.plugin.saveSettings();
                    }));
        }
    }


    /**
     * 服务配置 — 角色分配（选模型）+ 参数调优
     */
    private renderIndexServicesSettings(container: HTMLElement): void {
        container.createEl('h3', { text: '服务配置' });
        container.createEl('p', {
            text: '为每种用途选择服务商和模型。需要先在「AI 服务」Tab 中配置好 API Key。',
            cls: 'setting-item-description'
        });

        // ═══ 核心服务卡片 ═══
        const coreCard = container.createDiv({ cls: 'deeppdf-settings-card' });
        coreCard.createEl('h4', { text: '核心服务' });
        const requiredRoles: { role: RoleType; label: string; desc: string }[] = [
            { role: 'chat', label: '主对话', desc: '用于主要对话和分析' },
            { role: 'router', label: '路由', desc: '用于查询路由和快速检索' },
            { role: 'pageindex', label: '页面索引', desc: '用于书籍索引时的 LLM 调用' },
        ];
        for (const { role, label, desc } of requiredRoles) {
            this.renderRoleRow(coreCard, role, label, desc, false);
        }

        // ═══ 增强服务卡片 ═══
        const enhanceCard = container.createDiv({ cls: 'deeppdf-settings-card' });
        enhanceCard.createEl('h4', { text: '增强服务（可选）' });
        const optionalRoles: { role: RoleType; label: string; desc: string }[] = [
            ...(PROPOSITION_ENABLED ? [{ role: 'proposition' as RoleType, label: '原子事实', desc: '提取原子事实卡片（禁用则不提取）' }] : []),
            { role: 'embedding', label: '向量化', desc: '用于语义搜索的向量嵌入（禁用则降级 BM25）' },
            { role: 'reranker', label: '重排序', desc: '对搜索结果进行精细重排（禁用则不重排）' },
            { role: 'tts', label: '语音播报', desc: 'AI 语音合成播报（禁用则无语音功能）' },
        ];
        for (const { role, label, desc } of optionalRoles) {
            this.renderRoleRow(enhanceCard, role, label, desc, true);
        }

        // 信息图 Key（独立卡片）
        const infoCard = container.createDiv({ cls: 'deeppdf-settings-card' });
        infoCard.createEl('h4', { text: '信息图生成' });
        infoCard.createEl('div', {
            text: '填写 SenseNova API Key 后，AI 可在适当时生成专业信息图。',
            cls: 'setting-item-description'
        });
        new Setting(infoCard)
            .addText(text => {
                text.setPlaceholder("sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
                    .setValue(this.plugin.settings.sensenovaApiKey)
                    .inputEl.type = 'password';
                text.onChange(async (value) => {
                    this.plugin.settings.sensenovaApiKey = value.trim();
                    await this.plugin.saveSettings();
                });
            });

        // ═══ 参数调优 ═══
        container.createEl('hr', { cls: 'deeppdf-settings-divider' });

        if (PROPOSITION_ENABLED) {
            this.renderCollapsibleSection(container, 'proposition-params', '📝 原子事实参数', '卡片密度等参数',
                (section) => this.renderPropositionParams(section));
        }

        this.renderCollapsibleSection(container, 'reranker-params', '🔄 重排序参数', '重排序权重等参数',
            (section) => this.renderRerankerParams(section));

        this.renderCollapsibleSection(container, 'pdf-params', '📄 索引参数', 'PDF 解析和索引参数',
            (section) => this.renderPdfSettings(section));
    }

    /**
     * 渲染可折叠的服务区块
     */
    private renderCollapsibleSection(
        container: HTMLElement,
        sectionId: string,
        title: string,
        description: string,
        renderContent: (section: HTMLElement) => void
    ): void {
        const isCollapsed = !this.expandedSections.has(sectionId);

        // 创建区块容器
        const sectionWrapper = container.createDiv({ cls: 'deeppdf-settings-collapsible-section' });

        // 创建 header（点击可折叠）
        const header = sectionWrapper.createDiv({ cls: 'deeppdf-settings-collapsible-header' });
        header.createEl('h4', { text: title });
        header.createEl('span', {
            text: description,
            cls: 'deeppdf-settings-collapsible-desc'
        });

        // 折叠指示器
        const indicator = header.createSpan({ cls: 'deeppdf-settings-collapsible-indicator' });
        indicator.setText(isCollapsed ? '▶' : '▼');

        // 点击事件
        header.addEventListener('click', () => {
            if (this.expandedSections.has(sectionId)) {
                this.expandedSections.delete(sectionId);
            } else {
                this.expandedSections.add(sectionId);
            }
            this.renderTabContent('index');
        });

        // 如果未折叠，渲染内容
        if (!isCollapsed) {
            const content = sectionWrapper.createDiv({ cls: 'deeppdf-settings-collapsible-content' });
            renderContent(content);
        }
    }

    /**
     * 渲染 Reranker 设置
     */
    /**
     * 重排序参数（权重）
     */
    private renderRerankerParams(container: HTMLElement): void {
        const roles = this.plugin.settings.roles;
        const isEnabled = roles?.reranker !== null;

        if (!isEnabled) {
            container.createEl('p', {
                text: '重排序已禁用。在上方启用重排序角色后可调整参数。',
                cls: 'setting-item-description'
            });
            return;
        }

        new Setting(container)
            .setName("重排序权重")
            .setDesc("Reranker 分数在最终得分中的权重 (0.0-1.0)")
            .addSlider(slider => slider
                .setLimits(0, 100, 5)
                .setValue((this.plugin.settings.rerankerWeight ?? 0.7) * 100)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.rerankerWeight = value / 100;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * 原子事实参数（卡片密度）
     */
    private renderPropositionParams(container: HTMLElement): void {
        const roles = this.plugin.settings.roles;
        const isEnabled = roles?.proposition !== null;

        if (!isEnabled) {
            container.createEl('p', {
                text: '原子事实卡片已禁用。在上方启用该角色后可调整参数。',
                cls: 'setting-item-description'
            });
            return;
        }

        new Setting(container)
            .setName("卡片密度")
            .setDesc("每 500 字提取的卡片数量")
            .addSlider(slider => slider
                .setLimits(1, 3, 1)
                .setValue(this.plugin.settings.propositionCardsPer500Words || 1)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.propositionCardsPer500Words = value;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * 渲染 PDF 索引设置
     */
    private renderPdfSettings(container: HTMLElement): void {
        new Setting(container)
            .setName("每节点最大页数")
            .setDesc("PDF 解析时每个章节的最大页数")
            .addSlider(slider => slider
                .setLimits(1, 50, 1)
                .setValue(this.plugin.settings.maxPagesPerNode)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxPagesPerNode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("每节点最大 Token")
            .setDesc("每个章节的最大 Token 数")
            .addSlider(slider => slider
                .setLimits(1000, 50000, 1000)
                .setValue(this.plugin.settings.maxTokensPerNode)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxTokensPerNode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("生成章节摘要")
            .setDesc("使用 LLM 为每个章节生成摘要")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ifAddNodeSummary)
                .onChange(async (value) => {
                    this.plugin.settings.ifAddNodeSummary = value;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * 高级设置
     */
    private renderAdvancedSettings(container: HTMLElement): void {
        container.createEl('h3', { text: '高级设置' });

        new Setting(container)
            .setName("启用调试日志")
            .setDesc("开启后会在控制台输出详细运行日志，用于问题排查。默认关闭以减少日志噪音。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugLog)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugLog = value;
                    setLogEnabled(value);
                    await this.plugin.saveSettings();
                }));

        // 语音书信回复
        new Setting(container)
            .setName("语音书信回复")
            .setDesc("AI 回复变为语音对话气泡+书信模式。语音从分析结果并行生成，文字以信封形式呈现。需要配置 TTS 角色。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableVoiceReply)
                .onChange(async (value) => {
                    this.plugin.settings.enableVoiceReply = value;
                    await this.plugin.saveSettings();
                }));

        // 分隔线
        container.createEl('hr', { cls: 'deeppdf-settings-divider' });

        // Skills 管理
        container.createEl('h4', { text: 'Skills 管理' });

        new Setting(container)
            .setName("重载 Skills")
            .setDesc("重新加载所有 Skills（包括内置和用户自定义）。当你添加了新的 Skill 文件后，点击此按钮使其生效。")
            .addButton(button => button
                .setButtonText("重载 Skills")
                .setCta()
                .onClick(async () => {
                    try {
                        button.setDisabled(true);
                        button.setButtonText("重载中...");
                        const result = await this.plugin.reloadSkills();
                        button.setDisabled(false);
                        button.setButtonText("重载 Skills");
                        if (result.success) {
                            new Notice(`Skills 重载成功！共加载 ${result.skills.length} 个技能`);
                        } else {
                            new Notice(`Skills 重载失败: ${result.message}`);
                        }
                    } catch (err) {
                        button.setDisabled(false);
                        button.setButtonText("重载 Skills");
                        const errMsg = err instanceof Error ? err.message : String(err);
                        new Notice(`Skills 重载失败: ${errMsg}`);
                    }
                }));

        container.createEl('p', {
            text: '提示：你也可以通过命令面板（Cmd/Ctrl+P）搜索"Reload DeepReader Skills"来重载。',
            cls: 'setting-item-description'
        });
    }

    /**
     * 用户画像设置
     */
    private async renderProfileSettings(container: HTMLElement): Promise<void> {
        container.createEl('h3', { text: '用户画像设置' });
        container.createEl('p', {
            text: '指定包含你日记、随笔、感悟的目录，奚童会从中了解你，提供更贴心的阅读陪伴。',
            cls: 'setting-item-description',
        });

        new Setting(container)
            .setName('笔记目录')
            .setDesc('存放日记、随笔、感悟的 Obsidian 文件夹路径（相对于 Vault 根目录）')
            .addText(text => {
                text
                    .setPlaceholder('点击下方按钮选择目录')
                    .setValue(this.plugin.settings.journalDir || '')
                    .inputEl.readOnly = true;
            })
            .addButton(btn => btn
                .setButtonText('选择目录')
                .setCta()
                .onClick(() => {
                    new FolderSuggestModal(this.app, async (path) => {
                        if (path === this.plugin.settings.journalDir) return;
                        this.plugin.settings.journalDir = path;
                        await this.plugin.saveSettings();
                        (this.plugin as any).profileBuilder = path
                            ? new (await import('../services/profile-builder')).ProfileBuilder(this.app, this.plugin.settings)
                            : undefined;
                        new Notice('笔记目录已保存');
                        this.renderTabContent('profile');
                    }).open();
                }));

        const builder = (this.plugin as any).profileBuilder;
        const hasProfile = !!(await builder?.readMeta?.());

        new Setting(container)
            .setName(hasProfile ? '重建画像' : '构建画像')
            .setDesc(hasProfile ? '忽略已有数据，完全重新构建画像' : '扫描指定目录中的笔记，生成你的专属画像')
            .addButton(btn => {
                btn
                    .setButtonText(builder?.getIsBuilding() ? '取消构建' : (hasProfile ? '重建' : '构建画像'))
                    .setCta()
                    .onClick(async () => {
                        await this.handleBuildProfile(btn, statusEl, progressEl, hasProfile);
                    });
            })
            .addButton(btn => {
                btn
                    .setButtonText('删除')
                    .setWarning()
                    .setDisabled(!hasProfile);
                if (hasProfile) {
                    btn.onClick(async () => {
                        if (builder) {
                            await builder.deleteProfile();
                            new Notice('画像已删除');
                            this.renderTabContent('profile');
                        }
                    });
                }
            });

        // 状态 + 进度放在按钮下方，空间充裕
        const statusEl = container.createDiv({ cls: 'deeppdf-profile-status' });
        const progressEl = container.createDiv({ cls: 'deeppdf-profile-progress' });

        if (builder?.getIsBuilding()) {
            this.pollBuildProgress(null, statusEl, progressEl, hasProfile);
        } else {
            this.refreshProfileStatus(statusEl);
        }
    }

    private async refreshProfileStatus(el: HTMLElement): Promise<void> {
        el.empty();
        const builder = (this.plugin as any).profileBuilder;
        if (!builder) {
            el.createSpan({ text: '未配置笔记目录', cls: 'setting-item-description' });
            return;
        }

        const meta = await builder.readMeta();
        if (meta) {
            const date = new Date(meta.lastBuildTime).toLocaleDateString('zh-CN');
            el.createSpan({ text: `上次构建：${date} · 涵盖 ${meta.fileCount} 篇笔记` });
        } else {
            el.createSpan({ text: '尚未构建画像', cls: 'setting-item-description' });
        }
    }

    private showBuildProgress(el: HTMLElement): void {
        const builder = (this.plugin as any).profileBuilder;
        if (!builder) return;
        const p = builder.latestProgress;
        if (!p) return;

        el.empty();

        const stageLabels: Record<string, string> = {
            scanning: '扫描笔记文件',
            indexing: '建立索引',
            generating: '生成画像摘要',
            done: '构建完成',
        };

        const stageLabel = stageLabels[p.stage] || p.stage;
        const bar = el.createDiv({ cls: 'deeppdf-profile-progress-bar' });
        const label = el.createDiv({ cls: 'deeppdf-profile-progress-label' });

        if (p.total > 0) {
            const pct = Math.round((p.current / p.total) * 100);
            const fill = bar.createDiv({ cls: 'deeppdf-profile-progress-fill' });
            fill.style.width = `${pct}%`;
            label.setText(`${stageLabel}：${p.current} / ${p.total}（${pct}%）`);
        } else {
            label.setText(stageLabel);
        }
    }

    private pollBuildProgress(
        btn: any | null,
        statusEl: HTMLElement,
        progressEl: HTMLElement,
        force: boolean,
    ): void {
        const builder = (this.plugin as any).profileBuilder;
        if (!builder) return;

        this.showBuildProgress(progressEl);

        if (builder.getIsBuilding()) {
            setTimeout(() => this.pollBuildProgress(btn, statusEl, progressEl, force), 500);
        } else {
            if (btn) btn.setButtonText(force ? '重建' : '构建画像');
            progressEl.empty();
            this.refreshProfileStatus(statusEl);
            (this.plugin as any).frontendAgent?.invalidateProfileCache?.();
            this.renderTabContent('profile');
        }
    }

    private async handleBuildProfile(
        btn: any,
        statusEl: HTMLElement,
        progressEl: HTMLElement,
        force: boolean,
    ): Promise<void> {
        const builder = (this.plugin as any).profileBuilder;
        if (!builder) {
            new Notice('请先配置笔记目录');
            return;
        }

        if (builder.getIsBuilding()) {
            builder.cancel();
            btn.setButtonText(force ? '重建' : '构建画像');
            return;
        }

        btn.setButtonText('取消构建');

        builder.build(undefined, force).catch((e: any) => {
            if (e.name !== 'AbortError') {
                new Notice(`构建失败：${e.message}`);
            }
        });

        this.pollBuildProgress(btn, statusEl, progressEl, force);
    }

    /**
     * 阅读模式设置
     */
    private renderReadingModeSettings(container: HTMLElement): void {
        container.createEl('h3', { text: '阅读模式设置' });

        new Setting(container)
            .setName("自动进入阅读模式")
            .setDesc("打开 DeepReader 章节文件时自动进入沉浸式阅读模式")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoEnableReadingMode)
                .onChange(async (value) => {
                    this.plugin.settings.autoEnableReadingMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.setAutoEnable(value);
                }));

        new Setting(container)
            .setName("阅读模式样式")
            .setDesc("分页模式：横向翻页阅读（不支持 blockId 跳转）；滚动模式：纵向滚动阅读（支持跳转到引用段落）")
            .addDropdown(dropdown => dropdown
                .addOption('paginated', '分页模式')
                .addOption('scrolling', '滚动模式')
                .setValue(this.plugin.settings.readingModeStyle)
                .onChange(async (value: string) => {
                    this.plugin.settings.readingModeStyle = value as 'paginated' | 'scrolling';
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.setStyle(value as 'paginated' | 'scrolling');
                }));

        new Setting(container)
            .setName("消息气泡主题")
            .setDesc("选择 AI 回复消息的视觉风格")
            .addDropdown(dropdown => dropdown
                .addOption('notebook', '笔记本')
                .addOption('parchment', '羊皮纸')
                .addOption('clean', '纯净白纸')
                .addOption('chat', '聊天卡片')
                .addOption('kami', '和紙')
                .setValue(this.plugin.settings.messageBubbleTheme || 'notebook')
                .onChange(async (value: string) => {
                    this.plugin.settings.messageBubbleTheme = value as 'notebook' | 'parchment' | 'clean' | 'chat' | 'kami';
                    await this.plugin.saveSettings();
                    document.querySelectorAll('[class*="deeppdf-pattern-"]').forEach(el => {
                        const cls = Array.from(el.classList).find((c: string) => c.startsWith('deeppdf-pattern-'));
                        if (cls) el.classList.replace(cls, `deeppdf-pattern-${value}`);
                    });
                }));

        new Setting(container)
            .setName("墨迹效果")
            .setDesc("开启后，鼠标在阅读模式下移动时会留下渐隐的墨迹轨迹")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableInkLayer)
                .onChange(async (value) => {
                    this.plugin.settings.enableInkLayer = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.setEnableInkLayer(value);
                }));

        container.createEl('p', {
            text: '提示：关闭后，打开章节文件将使用普通编辑模式，启用后则进入沉浸式阅读模式。',
            cls: 'setting-item-description'
        });

        // === 主动阅读引导 ===
        container.createEl('h3', { text: '主动阅读引导' });

        new Setting(container)
            .setName("启用主动引导")
            .setDesc("打开新书时，奚童会主动提出结构化问题，帮助你快速建立对书籍的整体理解")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.proactiveGuidanceEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.proactiveGuidanceEnabled = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("引导冷却时间")
            .setDesc("两次主动引导之间的最小间隔（分钟）")
            .addSlider(slider => slider
                .setLimits(1, 30, 1)
                .setValue(this.plugin.settings.proactiveCooldownMinutes)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.proactiveCooldownMinutes = value;
                    await this.plugin.saveSettings();
                }));
    }

}

/**
 * 文件夹选择弹窗 — 基于 FuzzySuggestModal
 */
class FolderSuggestModal extends FuzzySuggestModal<string> {
    private onSelect: (path: string) => void;

    constructor(app: App, onSelect: (path: string) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder('输入关键词筛选文件夹…');
        this.setInstructions([{ command: '↑↓', purpose: '导航' }, { command: '↵', purpose: '选择' }, { command: 'esc', purpose: '取消' }]);
    }

    getItems(): string[] {
        const folders: string[] = [];
        const recurse = (folder: TFolder) => {
            folders.push(folder.path);
            for (const child of folder.children) {
                if (child instanceof TFolder) recurse(child);
            }
        };
        recurse(this.app.vault.getRoot());
        folders.sort((a, b) => a.localeCompare(b));
        return folders;
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string): void {
        this.onSelect(item);
    }
}
