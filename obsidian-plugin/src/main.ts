import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf } from "obsidian";
import { MCPClient } from "./mcp/client.js";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";

interface DeepPDFSettings {
    mcpServerPath: string;
    maxResults: number;
}

const DEFAULT_SETTINGS: DeepPDFSettings = {
    mcpServerPath: "/Users/lizhao/workspace/DeepPDF/mcp-server",
    maxResults: 5
};

export default class DeepPDFPlugin extends Plugin {
    settings: DeepPDFSettings;
    mcpClient: MCPClient | null = null;

    async onload() {
        await this.loadSettings();

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
    }
}
