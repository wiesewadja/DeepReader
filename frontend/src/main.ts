import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf, Notice } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import { DeepPDFClient } from "./api/http-client.js";

interface DeepPDFSettings {
    apiPort: number;
    maxResults: number;
    deepseekApiKey: string;
    openaiApiKey: string;
    llmProvider: string;
    llmModel: string;
    apiUrl: string;
    maxPagesPerNode: number;
    maxTokensPerNode: number;
    ifAddNodeSummary: boolean;
}

const DEFAULT_SETTINGS: DeepPDFSettings = {
    apiPort: 6088,
    maxResults: 5,
    deepseekApiKey: "",
    openaiApiKey: "",
    llmProvider: "deepseek",
    llmModel: "deepseek-chat",
    apiUrl: "",
    maxPagesPerNode: 10,
    maxTokensPerNode: 20000,
    ifAddNodeSummary: true
};

export default class DeepPDFPlugin extends Plugin {
    settings: DeepPDFSettings;
    apiClient: DeepPDFClient | null = null;

    async onload() {
        console.log('[DeepPDF] Loading plugin');

        await this.loadSettings();

        // 初始化 HTTP 客户端（连接到本地 localhost）
        this.apiClient = new DeepPDFClient(this.settings.apiPort);

        // 检查服务器连接状态
        const isHealthy = await this.apiClient.healthCheck();
        if (!isHealthy) {
            console.log('[DeepPDF] Server not running at localhost:' + this.settings.apiPort);
            new Notice(`DeepPDF: 无法连接到服务器 localhost:${this.settings.apiPort}，请确保后端已启动`);
        } else {
            console.log('[DeepPDF] Server connected successfully');
        }

        // 注册侧边栏视图
        this.registerView(
            SIDEBAR_VIEW_TYPE,
            (leaf) => new SidebarView(leaf, this.apiClient)
        );

        // 添加设置面板
        this.addSettingTab(new DeepPDFSettingTab(this.app, this));

        // 添加 Ribbon 图标
        this.addRibbonIcon("book", "DeepPDF", () => {
            this.activateView();
        });

        // 添加命令
        this.addCommand({
            id: "open-deeppdf-sidebar",
            name: "Open DeepPDF sidebar",
            callback: () => this.activateView()
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onunload() {
        // 插件卸载时不需要停止服务器（服务器由用户独立管理）
    }

    activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;

        const leaves = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) return;
            leaf.setViewState({
                type: SIDEBAR_VIEW_TYPE,
                active: true
            });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }
}

class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;

    constructor(app: App, plugin: DeepPDFPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'API Server 设置' });

        new Setting(containerEl)
            .setName("API Port")
            .setDesc("FastAPI 服务器端口（默认 localhost:6088）")
            .addText(text => text
                .setPlaceholder("6088")
                .setValue(String(this.plugin.settings.apiPort))
                .onChange(async (value) => {
                    this.plugin.settings.apiPort = parseInt(value) || 6088;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
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

        containerEl.createEl('h2', { text: 'LLM API 设置' });

        new Setting(containerEl)
            .setName("LLM Provider")
            .setDesc("Select LLM provider for PDF indexing")
            .addDropdown(dropdown => dropdown
                .addOption("deepseek", "DeepSeek")
                .addOption("openai", "OpenAI")
                .addOption("google", "Google")
                .addOption("custom", "Custom")
                .setValue(this.plugin.settings.llmProvider)
                .onChange(async (value) => {
                    this.plugin.settings.llmProvider = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("LLM Model")
            .setDesc("Model name to use (e.g., deepseek-chat, gpt-4)")
            .addText(text => text
                .setPlaceholder("deepseek-chat")
                .setValue(this.plugin.settings.llmModel)
                .onChange(async (value) => {
                    this.plugin.settings.llmModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("DeepSeek API Key")
            .setDesc("DeepSeek API key for LLM indexing")
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.deepseekApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.deepseekApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .then(setting => {
                const inputEl = setting.controlEl.querySelector('input');
                if (inputEl) inputEl.type = 'password';
            });

        new Setting(containerEl)
            .setName("OpenAI API Key")
            .setDesc("OpenAI API key (for OpenAI provider)")
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .then(setting => {
                const inputEl = setting.controlEl.querySelector('input');
                if (inputEl) inputEl.type = 'password';
            });

        new Setting(containerEl)
            .setName("API Base URL")
            .setDesc("Custom API endpoint (optional, for custom provider)")
            .addText(text => text
                .setPlaceholder("https://api.example.com/v1")
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'PDF 索引设置' });

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        new Setting(containerEl)
            .setName("Add Node Summary")
            .setDesc("Use LLM to generate section summaries")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ifAddNodeSummary)
                .onChange(async (value) => {
                    this.plugin.settings.ifAddNodeSummary = value;
                    await this.plugin.saveSettings();
                }));
    }
}
