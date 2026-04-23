/**
 * DeepReader 插件设置界面
 */

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DeepPDFPlugin from '../main';
import type { ProviderType } from '../config/providers';
import { PROVIDER_LABELS, PROVIDER_CONFIGS, getAvailableProvidersForRole, getProviderName, getProviderBaseUrl } from '../config/providers';
import type { RoleType } from '../config/ai-roles';
import { ROLE_CAPABILITY } from '../config/ai-roles';

/** Proposition feature toggle: disabled due to high token cost. Re-enable after optimization. */
const PROPOSITION_ENABLED = false;

import { setLogEnabled, serviceLog } from '../utils/logger';

type SettingsTabId = 'llm' | 'index' | 'profile' | 'advanced' | 'reading';

interface SettingsTab {
    id: SettingsTabId;
    name: string;
    icon: string;
}

export class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;
    private currentTab: SettingsTabId = 'llm';
    private contentContainer: HTMLElement | null = null;
    private expandedSections: Set<string> = new Set();

    // Tab 定义
    private tabs: SettingsTab[] = [
        { id: 'llm', name: 'AI 服务', icon: '🤖' },
        { id: 'index', name: '服务配置', icon: '📚' },
        { id: 'profile', name: '用户画像', icon: '👤' },
        { id: 'advanced', name: '高级', icon: '⚙️' },
        { id: 'reading', name: '阅读模式', icon: '📖' },
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

            // 图标
            navItem.createSpan({ cls: 'deeppdf-settings-nav-icon', text: tab.icon });

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
     * AI 服务设置 — 仅配置服务商账号（API Key）
     */
    private renderLLMSettings(container: HTMLElement): void {
        container.createEl('h3', { text: 'AI 服务' });
        container.createEl('p', {
            text: '配置各服务商的 API Key。填写 Key 后，在「服务配置」Tab 中为各用途分配服务商和模型。',
            cls: 'setting-item-description'
        });

        this.renderProviderAccounts(container);
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
     * 区域二：用途角色分配
     */
    private renderRoleAssignments(container: HTMLElement): void {
        const roles = this.plugin.settings.roles;
        if (!roles) return;

        // 必填角色
        const requiredRoles: { role: RoleType; label: string; desc: string }[] = [
            { role: 'chat', label: '主对话', desc: '用于主要对话和分析' },
            { role: 'router', label: '路由', desc: '用于查询路由和快速检索' },
            { role: 'pageindex', label: '页面索引', desc: '用于书籍索引时的 LLM 调用' },
        ];

        // 可选角色（proposition 暂时隐藏，后续优化 token 用量后恢复）
        const optionalRoles: { role: RoleType; label: string; desc: string }[] = [
            ...(PROPOSITION_ENABLED ? [{ role: 'proposition' as RoleType, label: '原子事实', desc: '提取原子事实卡片（禁用则不提取）' }] : []),
            { role: 'embedding', label: '向量化', desc: '用于语义搜索的向量嵌入（禁用则降级 BM25）' },
            { role: 'reranker', label: '重排序', desc: '对搜索结果进行精细重排（禁用则不重排）' },
        ];

        // 必填角色区域
        for (const { role, label, desc } of requiredRoles) {
            this.renderRoleRow(container, role, label, desc, false);
        }

        container.createEl('hr', { cls: 'deeppdf-settings-divider' });

        // 可选角色区域
        for (const { role, label, desc } of optionalRoles) {
            this.renderRoleRow(container, role, label, desc, true);
        }
    }

    /**
     * 渲染单个角色行
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
                row.createEl('p', {
                    text: `启用后将为此角色分配服务商和模型。`,
                    cls: 'setting-item-description'
                });
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

        const modelSetting = new Setting(row)
            .setName("模型")
            .addText(text => text
                .setPlaceholder(defaultModel || 'model-name')
                .setValue(roleConfig?.model || '')
                .onChange(async (value) => {
                    (settings.roles as unknown as Record<string, unknown>)[role] = {
                        ...(settings.roles as unknown as Record<string, unknown>)[role] as object,
                        model: value,
                    };
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                }));

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
     * PDF 索引设置
     */
    private renderPdfIndexSettings(container: HTMLElement): void {
        container.createEl('h3', { text: 'PDF 索引设置' });

        // PDF 解析参数
        container.createEl('h4', { text: '解析参数' });

        new Setting(container)
            .setName("Max Results")
            .setDesc("Maximum number of results to return")
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxResults)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxResults = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("Max Pages Per Node")
            .setDesc("Maximum pages per section node")
            .addSlider(slider => slider
                .setLimits(1, 50, 1)
                .setValue(this.plugin.settings.maxPagesPerNode)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxPagesPerNode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("Max Tokens Per Node")
            .setDesc("Maximum tokens per section node")
            .addSlider(slider => slider
                .setLimits(1000, 50000, 1000)
                .setValue(this.plugin.settings.maxTokensPerNode)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxTokensPerNode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("Add Node Summary")
            .setDesc("Use LLM to generate section summaries")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ifAddNodeSummary)
                .onChange(async (value) => {
                    this.plugin.settings.ifAddNodeSummary = value;
                    await this.plugin.saveSettings();
                }));
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

        // ═══ 角色分配 ═══
        this.renderRoleAssignments(container);

        // 分隔线
        container.createEl('hr', { cls: 'deeppdf-settings-divider' });

        // ═══ 参数调优（可折叠区块）═══
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
    private renderProfileSettings(container: HTMLElement): void {
        container.createEl('h3', { text: '用户画像设置' });
        container.createEl('p', {
            text: '指定包含你日记、随笔、感悟的目录，奚童会从中了解你，提供更贴心的阅读陪伴。',
            cls: 'setting-item-description',
        });

        new Setting(container)
            .setName('笔记目录')
            .setDesc('存放日记、随笔、感悟的 Obsidian 文件夹路径（相对于 Vault 根目录）')
            .addText(text => text
                .setPlaceholder('例如：Journals/随手记')
                .setValue(this.plugin.settings.journalDir)
                .onChange(async (value) => {
                    const oldDir = this.plugin.settings.journalDir;
                    this.plugin.settings.journalDir = value;
                    await this.plugin.saveSettings();

                    if (oldDir && oldDir !== value) {
                        const builder = (this.plugin as any).profileBuilder;
                        if (builder) await builder.deleteProfile();
                        new Notice('笔记目录已变更，请重新构建画像');
                    }
                    (this.plugin as any).profileBuilder = value
                        ? new (require('../services/profile-builder').ProfileBuilder)(this.app, this.plugin.settings)
                        : undefined;
                }));

        const statusEl = container.createDiv({ cls: 'deeppdf-profile-status' });
        this.refreshProfileStatus(statusEl);

        new Setting(container)
            .setName('构建用户画像')
            .setDesc('扫描指定目录中的笔记，生成你的专属画像')
            .addButton(btn => btn
                .setButtonText('构建画像')
                .setCta()
                .onClick(async () => {
                    await this.handleBuildProfile(btn, statusEl, false);
                }));

        new Setting(container)
            .setName('重建画像')
            .setDesc('忽略已有数据，完全重新构建')
            .addButton(btn => btn
                .setButtonText('重建')
                .onClick(async () => {
                    await this.handleBuildProfile(btn, statusEl, true);
                }));

        new Setting(container)
            .setName('删除画像')
            .setDesc('删除已生成的画像和索引数据')
            .addButton(btn => btn
                .setButtonText('删除')
                .setWarning()
                .onClick(async () => {
                    const builder = (this.plugin as any).profileBuilder;
                    if (builder) {
                        await builder.deleteProfile();
                        new Notice('画像已删除');
                        this.refreshProfileStatus(statusEl);
                    }
                }));
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

    private async handleBuildProfile(
        btn: any,
        statusEl: HTMLElement,
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
        try {
            await builder.build(
                (progress: any) => {
                    statusEl.empty();
                    statusEl.createSpan({ text: progress.message });
                },
                force,
            );
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                new Notice(`构建失败：${e.message}`);
            }
        }
        btn.setButtonText(force ? '重建' : '构建画像');
        this.refreshProfileStatus(statusEl);
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

        container.createEl('p', {
            text: '提示：关闭后，打开章节文件将使用普通编辑模式，启用后则进入沉浸式阅读模式。',
            cls: 'setting-item-description'
        });
    }

}
