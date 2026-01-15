import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import { MCPClient } from "./mcp/client.js";

interface DeepPDFSettings {
    mcpServerPath: string;
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
    mcpServerPath: "/Users/lizhao/workspace/DeepPDF/mcp-server",
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
    mcpClient: MCPClient | null = null;

    async onload() {
        await this.loadSettings();

        // 初始化 MCP 客户端
        try {
            this.mcpClient = new MCPClient({
                serverPath: this.settings.mcpServerPath,
                env: {
                    DEEPSEEK_API_KEY: this.settings.deepseekApiKey,
                    OPENAI_API_KEY: this.settings.openaiApiKey,
                    PDF_INDEX_LLM_PROVIDER: this.settings.llmProvider,
                    PDF_INDEX_MODEL: this.settings.llmModel,
                    PDF_INDEX_BASE_URL: this.settings.apiUrl,
                    PDF_INDEX_MAX_PAGES_PER_NODE: String(this.settings.maxPagesPerNode),
                    PDF_INDEX_MAX_TOKENS_PER_NODE: String(this.settings.maxTokensPerNode),
                    PDF_INDEX_IF_ADD_NODE_SUMMARY: this.settings.ifAddNodeSummary ? "yes" : "no"
                }
            });

            // 连接到 MCP 服务器
            await this.mcpClient.connect();

            console.log("[DeepPDF] MCP Client connected successfully");
        } catch (error) {
            console.error("[DeepPDF] Failed to connect MCP Client:", error);
            // 不抛出错误，允许插件在没有 MCP 连接的情况下运行
        }

        // 注册侧边栏视图
        this.registerView(
            SIDEBAR_VIEW_TYPE,
            (leaf) => new SidebarView(leaf, this.mcpClient)
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
        // 断开 MCP 客户端连接
        if (this.mcpClient) {
            this.mcpClient.disconnect();
        }
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

        containerEl.createEl('h2', { text: 'MCP Server 设置' });

        new Setting(containerEl)
            .setName("MCP Server Path")
            .setDesc("Path to the MCP server directory")
            .addText(text => text
                .setPlaceholder("/path/to/mcp-server")
                .setValue(this.plugin.settings.mcpServerPath)
                .onChange(async (value) => {
                    this.plugin.settings.mcpServerPath = value;
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
