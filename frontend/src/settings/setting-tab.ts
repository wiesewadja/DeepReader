/**
 * DeepReader 插件设置界面
 */

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DeepPDFPlugin from '../main';
import type { ProviderType } from '../config/providers';
import { PROVIDER_LABELS, getProviderDefaultModel } from '../config/providers';

type SettingsTabId = 'llm' | 'pdf' | 'advanced' | 'reading' | 'skills';

interface SettingsTab {
    id: SettingsTabId;
    name: string;
    icon: string;
}

export class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;
    private currentTab: SettingsTabId = 'llm';
    private contentContainer: HTMLElement | null = null;

    // Tab 定义
    private tabs: SettingsTab[] = [
        { id: 'llm', name: 'AI 服务', icon: '🤖' },
        { id: 'pdf', name: 'PDF 索引', icon: '📄' },
        { id: 'advanced', name: '高级', icon: '⚙️' },
        { id: 'reading', name: '阅读模式', icon: '📖' },
        { id: 'skills', name: 'Skills', icon: '🧩' },
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
            case 'pdf':
                this.renderPdfIndexSettings(container);
                break;
            case 'advanced':
                this.renderAdvancedSettings(container);
                break;
            case 'reading':
                this.renderReadingModeSettings(container);
                break;
            case 'skills':
                this.renderSkillsSettings(container);
                break;
        }
    }

    /**
     * AI 服务设置
     */
    private renderLLMSettings(container: HTMLElement): void {
        container.createEl('h3', { text: 'AI 服务设置' });

        const currentProvider = this.plugin.settings.llmProvider as ProviderType;

        // 服务商选择
        new Setting(container)
            .setName("AI 服务商")
            .setDesc("选择与您对话的 AI 服务商")
            .addDropdown(dropdown => {
                // 添加所有服务商选项
                (Object.keys(PROVIDER_LABELS) as ProviderType[]).forEach(key => {
                    dropdown.addOption(key, PROVIDER_LABELS[key]);
                });
                dropdown
                    .setValue(currentProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.llmProvider = value as ProviderType;
                        // 自动填充默认模型
                        const defaultModel = getProviderDefaultModel(value as ProviderType);
                        if (defaultModel) {
                            this.plugin.settings.llmModel = defaultModel;
                        }
                        // 重置 FrontendAgent 以使用新配置
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                        // 刷新界面以显示对应的 API Key 输入框
                        this.renderTabContent('llm');
                    });
            });

        // 模型名称
        new Setting(container)
            .setName("模型名称")
            .setDesc("当前服务商使用的模型，可手动修改")
            .addText(text => text
                .setPlaceholder("deepseek-chat")
                .setValue(this.plugin.settings.llmModel)
                .onChange(async (value) => {
                    this.plugin.settings.llmModel = value;
                    // 重置 FrontendAgent 以使用新模型
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                    console.log('[DeepPDF] 模型名称已更新为:', value);
                }));

        // 只显示当前服务商的 API Key 输入框
        const providerLabel = PROVIDER_LABELS[currentProvider];
        const apiKeyField = this.getApiKeyField(currentProvider);
        this.createApiKeySetting(
            container,
            `${providerLabel} API Key`,
            `用于访问 ${providerLabel} 服务的 API 密钥`,
            apiKeyField
        );

        // 仅自定义服务商显示 Base URL
        if (currentProvider === 'custom') {
            new Setting(container)
                .setName("API Base URL")
                .setDesc("自定义服务商的 API 地址")
                .addText(text => text
                    .setPlaceholder("https://api.example.com/v1")
                    .setValue(this.plugin.settings.apiUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.apiUrl = value;
                        // 重置 FrontendAgent 以使用新的 Base URL
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                    }));
        }
    }

    /**
     * 获取服务商对应的 API Key 字段名
     */
    private getApiKeyField(provider: ProviderType): 'deepseekApiKey' | 'kimiApiKey' | 'zhipuApiKey' | 'openaiApiKey' | 'customApiKey' {
        const fieldMap: Record<ProviderType, 'deepseekApiKey' | 'kimiApiKey' | 'zhipuApiKey' | 'openaiApiKey' | 'customApiKey'> = {
            deepseek: 'deepseekApiKey',
            kimi: 'kimiApiKey',
            zhipu: 'zhipuApiKey',
            openai: 'openaiApiKey',
            custom: 'customApiKey',
        };
        return fieldMap[provider];
    }

    /**
     * 创建 API Key 设置项（带密码隐藏和显示/隐藏切换）
     */
    private createApiKeySetting(
        container: HTMLElement,
        name: string,
        desc: string,
        field: 'deepseekApiKey' | 'kimiApiKey' | 'zhipuApiKey' | 'openaiApiKey' | 'customApiKey'
    ): void {
        const setting = new Setting(container)
            .setName(name)
            .setDesc(desc)
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings[field] as string)
                .onChange(async (value) => {
                    (this.plugin.settings as unknown as Record<string, string>)[field] = value;
                    // 重置 FrontendAgent 以使用新的 API Key
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                }));

        // 获取输入框元素
        const inputEl = setting.controlEl.querySelector('input');
        if (inputEl) {
            inputEl.type = 'password';
            inputEl.style.paddingRight = '30px';
        }

        // 添加眼睛图标按钮
        setting.addExtraButton(btn => {
            let isVisible = false;
            btn
                .setIcon('eye')
                .setTooltip('显示 API Key')
                .onClick(() => {
                    isVisible = !isVisible;
                    if (inputEl) {
                        inputEl.type = isVisible ? 'text' : 'password';
                    }
                    btn.setIcon(isVisible ? 'eye-off' : 'eye');
                    btn.setTooltip(isVisible ? '隐藏 API Key' : '显示 API Key');
                });
        });
    }

    /**
     * PDF 索引设置
     */
    private renderPdfIndexSettings(container: HTMLElement): void {
        container.createEl('h3', { text: 'PDF 索引设置' });

        new Setting(container)
            .setName("API Port")
            .setDesc("FastAPI 服务器端口（默认 localhost:6088）")
            .addText(text => text
                .setPlaceholder("6088")
                .setValue(String(this.plugin.settings.apiPort))
                .onChange(async (value) => {
                    this.plugin.settings.apiPort = parseInt(value) || 6088;
                    await this.plugin.saveSettings();
                }));

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
     * 高级设置
     */
    private renderAdvancedSettings(container: HTMLElement): void {
        container.createEl('h3', { text: '高级设置' });

        new Setting(container)
            .setName("强制路由模式")
            .setDesc("强制指定 Agent 路由模式。auto=根据查询自动选择，fast=仅快速检索，section=优先页面读取，slow=完全分析")
            .addDropdown(dropdown => dropdown
                .addOption("auto", "自动路由（推荐）")
                .addOption("fast", "快速检索（仅搜索）")
                .addOption("section", "章节优先（搜索+页面读取）")
                .addOption("slow", "完全分析（所有工具）")
                .setValue(this.plugin.settings.forceMode)
                .onChange(async (value) => {
                    this.plugin.settings.forceMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(container)
            .setName("启用调试日志")
            .setDesc("开启后会在控制台输出详细运行日志，用于问题排查。默认关闭以减少日志噪音。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugLog)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugLog = value;
                    await this.plugin.saveSettings();
                }));
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

        container.createEl('p', {
            text: '提示：关闭后，打开章节文件将使用普通编辑模式，启用后则进入沉浸式阅读模式。',
            cls: 'setting-item-description'
        });
    }

    /**
     * Skills 设置
     */
    private renderSkillsSettings(container: HTMLElement): void {
        container.createEl('h3', { text: 'Skills 管理' });

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
}
