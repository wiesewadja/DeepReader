# 前端 AI 服务商配置实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在前端设置中增加 Kimi、智谱、自定义等 AI 服务商配置，改造现有的 LLM API 设置区域，并重构代码组织。

**Architecture:**
1. 将 Settings 类型和默认值抽离到 `config/settings.ts`
2. 将服务商配置抽离到 `config/providers.ts`
3. 将设置界面抽离到 `settings/setting-tab.ts`
4. `main.ts` 保持精简，只保留插件核心逻辑

**Tech Stack:** TypeScript, Obsidian Plugin API

**Spec:** `docs/superpowers/specs/2026-03-16-frontend-ai-providers-design.md`

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/config/settings.ts` | 创建 | Settings 接口和默认值 |
| `frontend/src/config/providers.ts` | 创建 | 服务商配置常量和工具函数 |
| `frontend/src/settings/setting-tab.ts` | 创建 | 设置界面组件 |
| `frontend/src/main.ts` | 修改 | 引用新模块，移除已抽离的代码 |

---

## Chunk 1: 创建 Settings 模块

### Task 1: 创建 config/settings.ts

**Files:**
- Create: `frontend/src/config/settings.ts`

- [ ] **Step 1: 创建 settings.ts 文件**

```typescript
/**
 * DeepReader 插件设置类型定义
 */

export interface DeepPDFSettings {
    // API Server 设置
    apiPort: number;
    maxResults: number;

    // AI 服务商配置
    llmProvider: 'deepseek' | 'kimi' | 'zhipu' | 'openai' | 'custom';

    // 各服务商 API Key（独立字段）
    deepseekApiKey: string;
    openaiApiKey: string;
    kimiApiKey: string;
    zhipuApiKey: string;
    customApiKey: string;

    // 模型和 Base URL
    llmModel: string;
    apiUrl: string;

    // PDF 索引设置
    maxPagesPerNode: number;
    maxTokensPerNode: number;
    ifAddNodeSummary: boolean;

    // 状态存储
    lastSelectedIndexId: string;
    forceMode: string;
    lastCrossBookMode: boolean;
    lastCrossBookSessionId: string;
    chatCache?: Record<string, any>;
    enableDebugLog: boolean;
    lastDeepSearchMode: boolean;

    // 阅读模式设置
    autoEnableReadingMode: boolean;
}

export const DEFAULT_SETTINGS: DeepPDFSettings = {
    // API Server 设置
    apiPort: 6088,
    maxResults: 5,

    // AI 服务商配置
    llmProvider: "deepseek",

    // 各服务商 API Key
    deepseekApiKey: "",
    openaiApiKey: "",
    kimiApiKey: "",
    zhipuApiKey: "",
    customApiKey: "",

    // 模型和 Base URL
    llmModel: "deepseek-chat",
    apiUrl: "",

    // PDF 索引设置
    maxPagesPerNode: 10,
    maxTokensPerNode: 20000,
    ifAddNodeSummary: true,

    // 状态存储
    lastSelectedIndexId: "",
    forceMode: "auto",
    lastCrossBookMode: false,
    lastCrossBookSessionId: "",
    enableDebugLog: false,
    lastDeepSearchMode: false,

    // 阅读模式设置
    autoEnableReadingMode: true,
};
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`

Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add frontend/src/config/settings.ts
git commit -m "feat: create settings module with type definitions"
```

---

## Chunk 2: 创建 Providers 模块

### Task 2: 创建 config/providers.ts

**Files:**
- Create: `frontend/src/config/providers.ts`

- [ ] **Step 1: 创建 providers.ts 文件**

```typescript
/**
 * AI 服务商配置
 * 定义各服务商的 Base URL、默认模型和 API Key 字段映射
 */

import type { DeepPDFSettings } from './settings';

export type ProviderType = 'deepseek' | 'kimi' | 'zhipu' | 'openai' | 'custom';

export interface ProviderConfig {
    baseUrl: string;
    defaultModel: string;
    apiKeyField: keyof DeepPDFSettings;
}

/**
 * 各服务商的预设配置
 */
export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
    deepseek: {
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        apiKeyField: 'deepseekApiKey',
    },
    kimi: {
        baseUrl: 'https://api.moonshot.cn/v1',
        defaultModel: 'moonshot-v1-8k',
        apiKeyField: 'kimiApiKey',
    },
    zhipu: {
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4-flash',
        apiKeyField: 'zhipuApiKey',
    },
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        apiKeyField: 'openaiApiKey',
    },
    custom: {
        baseUrl: '', // 使用用户输入的 apiUrl
        defaultModel: '',
        apiKeyField: 'customApiKey',
    },
};

/**
 * 获取服务商的默认模型
 */
export function getProviderDefaultModel(provider: ProviderType): string {
    return PROVIDER_CONFIGS[provider]?.defaultModel || 'deepseek-chat';
}

/**
 * 获取当前服务商的完整配置
 */
export function getProviderConfig(
    settings: Pick<DeepPDFSettings, 'llmProvider' | 'apiUrl'>
): { apiKey: string; baseUrl: string; defaultModel: string; apiKeyField: keyof DeepPDFSettings } {
    let provider = settings.llmProvider as ProviderType;

    // 向后兼容：将旧的 google 映射到 custom
    if (provider === 'google' as unknown as ProviderType) {
        provider = 'custom';
    }

    const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.deepseek;

    return {
        apiKey: '', // 实际的 apiKey 由调用方从 settings 中读取
        baseUrl: provider === 'custom' ? settings.apiUrl : config.baseUrl,
        defaultModel: config.defaultModel,
        apiKeyField: config.apiKeyField,
    };
}

/**
 * 服务商显示名称映射
 */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
    deepseek: 'DeepSeek',
    kimi: 'Kimi (Moonshot)',
    zhipu: '智谱 (GLM)',
    openai: 'OpenAI',
    custom: '自定义',
};
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`

Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add frontend/src/config/providers.ts
git commit -m "feat: create providers module with AI service configs"
```

---

## Chunk 3: 创建 SettingTab 模块

### Task 3: 创建 settings/setting-tab.ts

**Files:**
- Create: `frontend/src/settings/setting-tab.ts`

- [ ] **Step 1: 创建 setting-tab.ts 文件**

从 main.ts 中提取设置界面代码，并使用新的模块：

```typescript
/**
 * DeepReader 插件设置界面
 */

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DeepPDFPlugin from '../main';
import type { ProviderType } from '../config/providers';
import { PROVIDER_LABELS, getProviderDefaultModel } from '../config/providers';

export class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;

    constructor(app: App, plugin: DeepPDFPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.renderApiServerSettings(containerEl);
        this.renderLLMSettings(containerEl);
        this.renderPdfIndexSettings(containerEl);
        this.renderAdvancedSettings(containerEl);
        this.renderReadingModeSettings(containerEl);
        this.renderSkillsSettings(containerEl);
    }

    /**
     * API Server 设置
     */
    private renderApiServerSettings(containerEl: HTMLElement): void {
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
    }

    /**
     * LLM API 设置
     */
    private renderLLMSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'LLM API 设置' });

        // AI 服务商选择
        new Setting(containerEl)
            .setName("AI 服务商")
            .setDesc("选择前端 Agent 使用的 AI 服务商")
            .addDropdown(dropdown => {
                // 添加所有服务商选项
                (Object.keys(PROVIDER_LABELS) as ProviderType[]).forEach(key => {
                    dropdown.addOption(key, PROVIDER_LABELS[key]);
                });
                dropdown
                    .setValue(this.plugin.settings.llmProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.llmProvider = value as ProviderType;
                        // 自动填充默认模型
                        const defaultModel = getProviderDefaultModel(value as ProviderType);
                        if (defaultModel && !this.plugin.settings.llmModel) {
                            this.plugin.settings.llmModel = defaultModel;
                        }
                        // 重置 FrontendAgent 以使用新配置
                        this.plugin.resetFrontendAgent();
                        await this.plugin.saveSettings();
                        // 刷新界面以显示更新的模型名称
                        this.display();
                    });
            });

        // 模型名称
        new Setting(containerEl)
            .setName("模型名称")
            .setDesc("当前服务商使用的模型，可手动修改")
            .addText(text => text
                .setPlaceholder("deepseek-chat")
                .setValue(this.plugin.settings.llmModel)
                .onChange(async (value) => {
                    this.plugin.settings.llmModel = value;
                    await this.plugin.saveSettings();
                }));

        // DeepSeek API Key
        this.createApiKeySetting(containerEl, "DeepSeek API Key", "DeepSeek API key", 'deepseekApiKey');

        // Kimi API Key
        this.createApiKeySetting(containerEl, "Kimi API Key", "Moonshot API key", 'kimiApiKey');

        // 智谱 API Key
        this.createApiKeySetting(containerEl, "智谱 API Key", "智谱 GLM API key", 'zhipuApiKey');

        // OpenAI API Key
        this.createApiKeySetting(containerEl, "OpenAI API Key", "OpenAI API key", 'openaiApiKey');

        // 自定义 API Key
        this.createApiKeySetting(containerEl, "自定义 API Key", "自定义服务商的 API key", 'customApiKey');

        // API Base URL
        new Setting(containerEl)
            .setName("API Base URL")
            .setDesc("自定义服务商的 API 地址（仅选择「自定义」时生效）")
            .addText(text => text
                .setPlaceholder("https://api.example.com/v1")
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * 创建 API Key 设置项（带密码隐藏）
     */
    private createApiKeySetting(
        containerEl: HTMLElement,
        name: string,
        desc: string,
        field: 'deepseekApiKey' | 'kimiApiKey' | 'zhipuApiKey' | 'openaiApiKey' | 'customApiKey'
    ): void {
        new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings[field])
                .onChange(async (value) => {
                    (this.plugin.settings as any)[field] = value;
                    await this.plugin.saveSettings();
                }))
            .then(setting => {
                const inputEl = setting.controlEl.querySelector('input');
                if (inputEl) inputEl.type = 'password';
            });
    }

    /**
     * PDF 索引设置
     */
    private renderPdfIndexSettings(containerEl: HTMLElement): void {
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

    /**
     * 高级设置
     */
    private renderAdvancedSettings(containerEl: HTMLElement): void {
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
    }

    /**
     * 阅读模式设置
     */
    private renderReadingModeSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: '阅读模式' });

        new Setting(containerEl)
            .setName("自动进入阅读模式")
            .setDesc("打开 DeepReader 章节文件时自动进入沉浸式阅读模式")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoEnableReadingMode)
                .onChange(async (value) => {
                    this.plugin.settings.autoEnableReadingMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.setAutoEnable(value);
                }));

        containerEl.createEl('p', {
            text: '提示：关闭后，打开章节文件将使用普通编辑模式，启用后则进入沉浸式阅读模式。',
            cls: 'setting-item-description'
        });
    }

    /**
     * Skills 管理设置
     */
    private renderSkillsSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'Skills 管理' });

        new Setting(containerEl)
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

        containerEl.createEl('p', {
            text: '提示：你也可以通过命令面板（Cmd/Ctrl+P）搜索"Reload DeepReader Skills"来重载。',
            cls: 'setting-item-description'
        });
    }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`

Expected: 编译成功（可能有 main.ts 的导入错误，下一步修复）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/settings/setting-tab.ts
git commit -m "feat: create setting-tab module with UI components"
```

---

## Chunk 4: 重构 main.ts

### Task 4: 更新 main.ts 使用新模块

**Files:**
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: 更新导入语句**

在文件顶部添加新模块的导入，并移除旧的类型定义：

```typescript
import { Plugin, WorkspaceLeaf, Notice, MarkdownView, TFile } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import { DeepPDFClient } from "./api/http-client.js";
import { serviceLog, warn, error } from "./utils/logger.js";
import { ReadingModeService, type ReadingModeCallbacks, type HighlightColorId } from './components/reading-mode/index.js';
import { BUILT_IN_SKILLS } from './built-in-skills.js';
import { FrontendAgent } from './agent/index.js';
import { DeepPDFSettings, DEFAULT_SETTINGS } from './config/settings.js';
import { getProviderConfig, getProviderDefaultModel, type ProviderType } from './config/providers.js';
import { DeepPDFSettingTab } from './settings/setting-tab.js';

const log = serviceLog;
```

- [ ] **Step 2: 删除旧的 DeepPDFSettings 接口和 DEFAULT_SETTINGS**

删除 `main.ts` 中原有的 `DeepPDFSettings` 接口（约 12-34 行）和 `DEFAULT_SETTINGS` 常量（约 36-55 行）。

- [ ] **Step 3: 删除旧的 DeepPDFSettingTab 类**

删除 `main.ts` 中原有的 `DeepPDFSettingTab` 类（约 940-1160 行）。

- [ ] **Step 4: 更新 getFrontendAgent 方法**

```typescript
/**
 * 获取或初始化 FrontendAgent
 */
async getFrontendAgent(): Promise<FrontendAgent> {
    if (!this.frontendAgent) {
        const config = getProviderConfig(this.settings);
        const apiKeyField = config.apiKeyField;
        const apiKey = this.settings[apiKeyField] as string || '';

        this.frontendAgent = new FrontendAgent({
            apiKey: apiKey,
            baseUrl: config.baseUrl || undefined,
            model: this.settings.llmModel || config.defaultModel || 'deepseek-chat',
            skillsDir: this.skillsDir,
            app: this.app,
        });
        await this.frontendAgent.initialize();
        log('[DeepPDF] FrontendAgent initialized with provider:', this.settings.llmProvider);
    }
    return this.frontendAgent;
}

/**
 * 重置 FrontendAgent（切换服务商时调用）
 */
resetFrontendAgent(): void {
    this.frontendAgent = null;
    log('[DeepPDF] FrontendAgent reset, will reinitialize with new config');
}
```

- [ ] **Step 5: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`

Expected: 编译成功，无错误

- [ ] **Step 6: Commit**

```bash
git add frontend/src/main.ts
git commit -m "refactor: use new config and settings modules in main.ts"
```

---

## Chunk 5: 最终验证和清理

### Task 5: 验证和测试

- [ ] **Step 1: 完整构建测试**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`

Expected: 编译成功，无警告

- [ ] **Step 2: 类型检查**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 3: 手动功能测试**

1. 在 Obsidian 中重新加载插件（Cmd+R）
2. 打开 DeepReader 设置页面
3. 验证 AI 服务商下拉框显示：DeepSeek、Kimi、智谱、OpenAI、自定义
4. 验证切换服务商时模型名称自动更新
5. 验证各 API Key 输入框正常工作（密码隐藏）
6. 验证 Base URL 说明文字显示正确
7. 发送一条消息测试 Agent 是否正常工作

- [ ] **Step 4: Final Commit**

```bash
git add -A
git commit -m "feat: add multi-provider AI configuration with modular code structure"
```

---

## 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `frontend/src/config/settings.ts` | Settings 类型和默认值 |
| `frontend/src/config/providers.ts` | 服务商配置 |
| `frontend/src/settings/setting-tab.ts` | 设置界面 |

### 修改文件

| 文件 | 修改内容 |
|------|------|
| `frontend/src/main.ts` | 引用新模块，移除已抽离的代码 |

---

## 完成标志

- [ ] 新模块文件创建完成
- [ ] main.ts 重构完成
- [ ] 所有编译通过
- [ ] 设置界面正常显示
- [ ] 各服务商配置正常工作
- [ ] Agent 使用正确的服务商配置
