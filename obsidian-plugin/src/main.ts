import { Plugin, PluginSettingTab, App, Setting } from "obsidian";

export default class DeepPDFPlugin extends Plugin {
    async onload() {
        console.log("Loading DeepPDF plugin");

        // 添加 Ribbon 图标
        this.addRibbonIcon("book", "DeepPDF", () => {
            console.log("DeepPDF ribbon icon clicked");
        });

        // 添加命令
        this.addCommand({
            id: "open-deeppdf",
            name: "Open DeepPDF",
            callback: () => {
                console.log("Open DeepPDF command");
            }
        });

        // 添加设置面板
        this.addSettingTab(new DeepPDFSettingTab(this.app, this));
    }

    onunload() {
        console.log("Unloading DeepPDF plugin");
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
            .setName("DeepPDF 设置")
            .setDesc("配置 MCP 服务器和索引选项");
    }
}
