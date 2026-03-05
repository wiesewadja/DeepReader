import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf, Notice } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import { DeepPDFClient } from "./api/http-client.js";
import { setLogEnabled, log, warn, error } from "./utils/logger.js";

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
    lastSelectedIndexId: string;
    forceMode: string;  // 强制路由模式：auto(默认) | fast | section | slow
    // 跨书籍模式状态
    lastCrossBookMode: boolean;  // 上次是否处于跨书籍模式
    lastCrossBookSessionId: string;  // 跨书籍模式的会话ID
    chatCache?: Record<string, any>;  // 对话缓存
    enableDebugLog: boolean;  // 是否启用调试日志
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
    ifAddNodeSummary: true,
    lastSelectedIndexId: "",
    forceMode: "auto",  // 默认使用自动路由
    lastCrossBookMode: false,  // 默认不启用跨书籍模式
    lastCrossBookSessionId: "",  // 跨书籍会话ID
    enableDebugLog: false  // 默认关闭调试日志
};

export default class DeepPDFPlugin extends Plugin {
    settings: DeepPDFSettings;
    apiClient: DeepPDFClient | null = null;

    async onload() {
        await this.loadSettings();

        // 设置日志开关
        setLogEnabled(this.settings.enableDebugLog);

        log('Loading plugin');

        // 初始化 HTTP 客户端（连接到本地 localhost）
        this.apiClient = new DeepPDFClient(this.settings.apiPort);

        // 检查服务器连接状态
        try {
            const isHealthy = await this.apiClient.healthCheck();
            if (!isHealthy) {
                log('Server not running or unhealthy at localhost:' + this.settings.apiPort);
                new Notice(`DeepPDF: 无法连接到服务器 (localhost:${this.settings.apiPort})。请启动后端服务。`);
            } else {
                log('Server connected successfully');
            }
        } catch (err) {
            warn('Failed to connect to server:', err);
            new Notice(`DeepPDF: 连接失败 (localhost:${this.settings.apiPort})。请检查后端是否运行。`);
        }

        // 注册侧边栏视图
        this.registerView(
            SIDEBAR_VIEW_TYPE,
            (leaf) => new SidebarView(leaf, this.apiClient, this)
        );

        // 添加设置面板
        this.addSettingTab(new DeepPDFSettingTab(this.app, this));

        // 添加 Ribbon 图标 - 使用读书郎图标
        this.addRibbonIcon("lucide-book-open", "DeepPDF", () => {
            this.activateView();
        });

        // 添加命令
        this.addCommand({
            id: "open-deepreader-sidebar",
            name: "Open DeepReader sidebar",
            callback: () => this.activateView()
        });

        // 注册 URI 协议处理器 - 单书籍对话
        this.registerObsidianProtocolHandler("deepreader-chat", async (params) => {
            log("[DeepReader] URI handler called with params:", params);

            const indexId = params.index_id;
            if (!indexId) {
                new Notice("DeepReader: 缺少 index_id 参数");
                return;
            }

            // 先重置跨书籍模式状态，确保打开侧边栏时不会恢复跨书籍模式
            this.settings.lastCrossBookMode = false;
            this.settings.lastCrossBookSessionId = "";
            await this.saveSettings();

            // 打开侧边栏
            this.activateView();

            // 等待视图加载（增加延迟确保 renderMainUI 完成）
            setTimeout(() => {
                // 通过事件通知侧边栏切换到指定索引
                this.app.workspace.trigger("deeppdf:select-index", indexId);
            }, 300);
        });

        // 注册 URI 协议处理器 - 跨书籍搜索（支持书单/标签过滤）
        this.registerObsidianProtocolHandler("deepreader-search", async (params) => {
            log("[DeepReader] deepreader-search URI handler called with params:", params);

            // 解析书单和标签参数（逗号分隔）
            const booklists = params.booklists ? params.booklists.split(",").map(s => decodeURIComponent(s.trim())) : [];
            const tags = params.tags ? params.tags.split(",").map(s => decodeURIComponent(s.trim())) : [];

            // 打开侧边栏
            this.activateView();

            // 等待视图加载
            setTimeout(() => {
                // 通过事件通知侧边栏启动跨书籍搜索
                this.app.workspace.trigger("deeppdf:cross-book-search", { booklists, tags });
            }, 100);
        });

        // 注册 URI 协议处理器 - 主题报告
        this.registerObsidianProtocolHandler("deepreader-theme-report", async (params) => {
            log("[DeepReader] deepreader-theme-report URI handler called");

            // 打开侧边栏
            this.activateView();

            // 等待视图加载
            setTimeout(() => {
                // 通过事件通知侧边栏打开主题报告
                this.app.workspace.trigger("deeppdf:theme-report");
            }, 100);
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // 更新日志开关状态
        setLogEnabled(this.settings.enableDebugLog);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // 更新日志开关状态
        setLogEnabled(this.settings.enableDebugLog);
    }

    async onunload() {
        // 卸载时手动清理视图，虽然 Obsidian 会自动处理，但显式清理更安全
        this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);
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

        containerEl.createEl('h2', { text: '高级选项' });

        new Setting(containerEl)
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

        new Setting(containerEl)
            .setName("启用调试日志")
            .setDesc("开启后会在控制台输出详细运行日志，用于问题排查。默认关闭以减少日志噪音。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugLog)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugLog = value;
                    await this.plugin.saveSettings();
                }));

        // 添加说明文字
        containerEl.createEl('p', {
            text: '提示：大多数情况下使用"自动路由"即可获得最佳体验。强制模式仅用于特定场景的调试或控制。',
            cls: 'setting-item-description'
        });
    }
}
