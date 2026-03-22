# 多模型支持实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepReader Agent 认知状态机添加多模型支持，允许 Router/Inspectional 使用 fast 模型，Analytical/Formatter 使用 main 模型。

**Architecture:** 新增 `LLMClientManager` 类管理多个 LLM 客户端实例，`SharedContext` 持有 manager 引用，`runStateLoop` 根据状态声明的 `model` 类型动态选择客户端。设置页面新增可选的 fast 模型配置区域。

**Tech Stack:** TypeScript, Obsidian Plugin API, LLM API (OpenAI-compatible)

**Spec:** `docs/superpowers/specs/2026-03-22-multi-model-support-design.md`

---

## Task 1: 扩展设置类型定义

**Files:**
- Modify: `frontend/src/config/settings.ts`

**Step 1: 添加 Fast 模型配置字段**

在 `DeepPDFSettings` 接口中添加新字段：

```typescript
export interface DeepPDFSettings {
    // ... 现有字段保持不变 ...

    // 新增：Fast 模型配置
    fastModelEnabled: boolean;       // 是否启用独立 fast 模型
    fastModelProvider: ProviderType; // fast 模型服务商
    fastModelName: string;           // fast 模型名称
}
```

**Step 2: 更新默认值**

在 `DEFAULT_SETTINGS` 中添加：

```typescript
export const DEFAULT_SETTINGS: DeepPDFSettings = {
    // ... 现有默认值 ...

    // Fast 模型配置
    fastModelEnabled: false,
    fastModelProvider: 'deepseek',
    fastModelName: '',
};
```

**Step 3: 导入 ProviderType**

确保文件顶部导入 `ProviderType`：

```typescript
import type { ProviderType } from './providers';
```

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功，无类型错误

**Step 5: Commit**

```bash
git add frontend/src/config/settings.ts
git commit -m "feat(settings): add fast model configuration fields

- Add fastModelEnabled, fastModelProvider, fastModelName fields
- Default fastModelEnabled to false for backward compatibility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 新增 LLMClientManager 类

**Files:**
- Modify: `frontend/src/agent/llm-client.ts`

**Step 1: 定义 ModelConfig 接口**

在 `LLMClientOptions` 接口后添加：

```typescript
export interface ModelConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string;
}
```

**Step 2: 实现 LLMClientManager 类**

在文件末尾 `LLMClient` 类之后添加：

```typescript
/**
 * LLMClientManager - 管理多个 LLM 客户端实例
 *
 * 用于支持不同认知状态使用不同的模型：
 * - main: 用于 Analytical + Formatter（深度分析）
 * - fast: 用于 Router + Inspectional（快速分类）
 */
export class LLMClientManager {
  private mainClient: LLMClient;
  private fastClient: LLMClient | null = null;

  constructor(mainConfig: ModelConfig, fastConfig?: ModelConfig) {
    this.mainClient = new LLMClient(mainConfig);
    if (fastConfig) {
      this.fastClient = new LLMClient(fastConfig);
    }
  }

  /**
   * 根据模型类型获取对应的客户端
   * 如果 fast 客户端未配置，回退到 main 客户端
   */
  getClient(modelType: 'fast' | 'main'): LLMClient {
    if (modelType === 'fast' && this.fastClient) {
      return this.fastClient;
    }
    return this.mainClient;
  }

  /**
   * 获取主客户端（用于向后兼容）
   */
  getMainClient(): LLMClient {
    return this.mainClient;
  }

  /**
   * 检查是否配置了独立的 fast 客户端
   */
  hasFastClient(): boolean {
    return this.fastClient !== null;
  }
}
```

**Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add frontend/src/agent/llm-client.ts
git commit -m "feat(llm-client): add LLMClientManager for multi-model support

- Add ModelConfig interface
- Add LLMClientManager class with main/fast client management
- Support fallback to main when fast not configured

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 更新 SharedContext 类型

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/types.ts`

**Step 1: 导入 LLMClientManager**

修改文件顶部的导入：

```typescript
import type { LLMClient } from '../llm-client';
import type { LLMClientManager } from '../llm-client';  // 新增
```

**Step 2: 更新 SharedContext 接口**

将 `llmClient` 字段改为 `llmClientManager`：

```typescript
export interface SharedContext {
  // ... 其他字段保持不变 ...

  // ===== Engine Dependencies =====
  /** LLM client manager for multi-model support */
  llmClientManager?: LLMClientManager;
  /** @deprecated Use llmClientManager instead */
  llmClient?: LLMClient;  // 保留向后兼容
  /** Tool registry for tool execution */
  toolRegistry?: ToolRegistry;
  /** Tool context for tool execution */
  toolContext?: ToolContext;

  // ... 其他字段保持不变 ...
}
```

**Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 可能有类型错误（其他文件仍使用 llmClient），这是预期的

**Step 4: Commit**

```bash
git add frontend/src/agent/cognitive-engine/types.ts
git commit -m "feat(cognitive-engine): add llmClientManager to SharedContext

- Add LLMClientManager import
- Add llmClientManager field (llmClient deprecated)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 更新 runStateLoop 函数

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/states/run-state-loop.ts`

**Step 1: 导入 LLMClientManager**

```typescript
import { LLMClient } from '../../llm-client';
import { LLMClientManager } from '../../llm-client';  // 新增
```

**Step 2: 修改函数签名**

将 `llmClient: LLMClient` 改为 `llmClientManager: LLMClientManager`：

```typescript
export async function runStateLoop(
  llmClientManager: LLMClientManager,  // 修改这里
  toolRegistry: ToolRegistry,
  toolContext: ToolContext,
  options: StateLoopOptions,
  callbacks: StateLoopCallbacks = {}
): Promise<StateLoopResult> {
```

**Step 3: 在函数开头获取正确的客户端**

在 `const logger = getDebugLogger();` 之后添加：

```typescript
  // 根据模型类型选择客户端
  const llmClient = llmClientManager.getClient(model);
```

**Step 4: 后续代码保持不变**

后续使用 `llmClient` 的代码无需修改，因为变量名相同。

**Step 5: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 可能有类型错误（调用方仍传递 llmClient）

**Step 6: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/run-state-loop.ts
git commit -m "refactor(run-state-loop): use LLMClientManager instead of LLMClient

- Accept LLMClientManager parameter
- Select client based on model type (fast/main)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: 更新各状态文件

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/states/router.ts`
- Modify: `frontend/src/agent/cognitive-engine/states/inspectional.ts`
- Modify: `frontend/src/agent/cognitive-engine/states/analytical.ts`
- Modify: `frontend/src/agent/cognitive-engine/states/formatter.ts`

**Step 1: 更新 router.ts**

修改 `execute` 方法中的 `runStateLoop` 调用：

```typescript
// 检查引擎依赖是否可用
if (!ctx.llmClientManager || !ctx.toolRegistry || !ctx.toolContext) {
  // 回退逻辑...
}

// 使用 LLMClientManager
const response = await runStateLoop(
  ctx.llmClientManager,  // 修改这里
  ctx.toolRegistry,
  ctx.toolContext,
  // ... 其他参数不变
);
```

**Step 2: 更新 inspectional.ts**

同样的修改：

```typescript
if (!ctx.llmClientManager || !ctx.toolRegistry || !ctx.toolContext) {
  // ...
}

const response = await runStateLoop(
  ctx.llmClientManager,  // 修改
  // ...
);
```

**Step 3: 更新 analytical.ts**

同样的修改。

**Step 4: 更新 formatter.ts**

同样的修改。

**Step 5: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 6: Commit**

```bash
git add frontend/src/agent/cognitive-engine/states/router.ts \
        frontend/src/agent/cognitive-engine/states/inspectional.ts \
        frontend/src/agent/cognitive-engine/states/analytical.ts \
        frontend/src/agent/cognitive-engine/states/formatter.ts
git commit -m "refactor(states): use llmClientManager in all state classes

- Router, Inspectional, Analytical, Formatter now use LLMClientManager

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: 更新 SharedContext 实现

**Files:**
- Modify: `frontend/src/agent/cognitive-engine/context.ts`

**Step 1: 导入 LLMClientManager**

```typescript
import type { LLMClientManager } from '../llm-client';
```

**Step 2: 更新 createSharedContext 参数类型**

```typescript
export interface CreateSharedContextOptions {
  indexId: string;
  pdfName: string;
  rawUserQuery: string;
  chatHistory?: ChatMessage[];
  markdownFiles?: Record<string, string>;
  abortSignal?: AbortSignal;
  llmClientManager?: LLMClientManager;  // 新增
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
}
```

**Step 3: 更新 SharedContextImpl 类**

添加 `llmClientManager` 属性：

```typescript
class SharedContextImpl implements SharedContext {
  // ... 现有属性 ...

  llmClientManager?: LLMClientManager;

  constructor(options: CreateSharedContextOptions) {
    // ... 现有赋值 ...
    this.llmClientManager = options.llmClientManager;
  }
}
```

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 5: Commit**

```bash
git add frontend/src/agent/cognitive-engine/context.ts
git commit -m "refactor(context): add llmClientManager to SharedContextImpl

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: 更新 FrontendAgent

**Files:**
- Modify: `frontend/src/agent/index.ts`

**Step 1: 导入 LLMClientManager**

```typescript
import { LLMClient, LLMClientManager, type ModelConfig } from './llm-client.js';
```

**Step 2: 扩展 FrontendAgentOptions**

```typescript
export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string;
  skillsDir: string;
  app: any;

  // 新增：Fast 模型配置（可选）
  fastModelEnabled?: boolean;
  fastApiKey?: string;
  fastBaseUrl?: string;
  fastModel?: string;
  fastProviderName?: string;
}
```

**Step 3: 修改 FrontendAgent 类**

```typescript
export class FrontendAgent {
  private llmClientManager: LLMClientManager;  // 替换 llmClient
  // ... 其他属性保持不变 ...

  constructor(private options: FrontendAgentOptions) {
    // 构建 main 配置
    const mainConfig: ModelConfig = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      providerName: options.providerName,
    };

    // 构建 fast 配置（如果启用）
    let fastConfig: ModelConfig | undefined;
    if (options.fastModelEnabled && options.fastApiKey) {
      fastConfig = {
        apiKey: options.fastApiKey,
        baseUrl: options.fastBaseUrl,
        model: options.fastModel,
        providerName: options.fastProviderName,
      };
    }

    this.llmClientManager = new LLMClientManager(mainConfig, fastConfig);

    // ... 其他初始化代码保持不变 ...
  }
```

**Step 4: 更新 getLLMClient 方法**

```typescript
/**
 * 获取 LLM 客户端（用于记忆整合等内部功能）
 * 返回主客户端以保持向后兼容
 */
getLLMClient(): LLMClient {
  return this.llmClientManager.getMainClient();
}
```

**Step 5: 更新 chat 和 continueChat 方法**

修改 `createSharedContext` 调用：

```typescript
const ctx = createSharedContext({
  indexId: context.indexId || '',
  pdfName: context.pdfName || '',
  rawUserQuery: userMessage,
  chatHistory: [],  // 或 cleanHistory
  markdownFiles: context.markdownFiles,
  abortSignal: callbacks.abortSignal,
  // 使用 llmClientManager
  llmClientManager: this.llmClientManager,
  toolRegistry: toolRegistry,
  toolContext: context,
});
```

**Step 6: 更新 SubagentManager 初始化**

```typescript
setupSubagentManager(context: ToolContext): void {
  const toolRegistry = createToolRegistry(this.skillLoader, context);
  const manager = new SubagentManager(
    this.llmClientManager.getMainClient(),  // 使用 getMainClient()
    toolRegistry,
    context
  );
  setSubagentManager(manager);
  log('[FrontendAgent] SubagentManager 已初始化');
}
```

**Step 7: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 8: Commit**

```bash
git add frontend/src/agent/index.ts
git commit -m "refactor(FrontendAgent): use LLMClientManager for multi-model support

- Add fast model options to FrontendAgentOptions
- Replace llmClient with llmClientManager
- Update chat/continueChat to pass llmClientManager

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: 更新 main.ts 传递配置

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 定位 FrontendAgent 创建位置**

找到创建 `FrontendAgent` 的代码（通常在 `resetFrontendAgent` 或类似方法中）。

**Step 2: 传递 fast 模型配置**

```typescript
resetFrontendAgent(): void {
  const providerConfig = getProviderConfig(this.settings);

  // 获取 fast 模型配置
  const fastModelEnabled = this.settings.fastModelEnabled;
  const fastProviderConfig = fastModelEnabled
    ? getProviderConfig({
        llmProvider: this.settings.fastModelProvider,
        apiUrl: this.settings.apiUrl,  // custom 时使用
      })
    : null;

  this.frontendAgent = new FrontendAgent({
    apiKey: this.getApiKeyForProvider(this.settings.llmProvider),
    baseUrl: providerConfig.baseUrl,
    model: this.settings.llmModel,
    providerName: PROVIDER_LABELS[this.settings.llmProvider],
    skillsDir: this.getSkillsDir(),
    app: this.app,

    // Fast 模型配置
    fastModelEnabled: fastModelEnabled,
    fastApiKey: fastModelEnabled
      ? this.getApiKeyForProvider(this.settings.fastModelProvider)
      : undefined,
    fastBaseUrl: fastProviderConfig?.baseUrl,
    fastModel: this.settings.fastModelName || undefined,
    fastProviderName: fastModelEnabled
      ? PROVIDER_LABELS[this.settings.fastModelProvider]
      : undefined,
  });
}
```

**Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add frontend/src/main.ts
git commit -m "feat(main): pass fast model config to FrontendAgent

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: 添加设置 UI - Fast 模型配置

**Files:**
- Modify: `frontend/src/settings/setting-tab.ts`

**Step 1: 添加折叠区域 HTML 结构**

在 `renderLLMSettings` 方法末尾，自定义 Base URL 之后添加：

```typescript
// 分隔线
container.createEl('hr', { cls: 'deeppdf-settings-divider' });

// 快速模型设置（折叠区域）
const fastModelSection = container.createDiv({ cls: 'deeppdf-settings-section' });
this.renderFastModelSettings(fastModelSection);
```

**Step 2: 实现 renderFastModelSettings 方法**

```typescript
/**
 * 渲染快速模型设置区域
 */
private renderFastModelSettings(container: HTMLElement): void {
    // 标题（可折叠）
    const header = container.createDiv({ cls: 'deeppdf-settings-section-header' });
    header.createEl('h4', { text: '快速模型设置（可选）' });
    header.createEl('span', {
        text: '用于路由和检视阶段，可选择更便宜/更快的模型以节省成本',
        cls: 'setting-item-description'
    });

    // 启用开关
    let fastModelConfigEl: HTMLElement | null = null;

    new Setting(container)
        .setName("启用独立的快速模型")
        .setDesc("开启后，路由和检视阶段将使用此模型，分析与格式化仍使用主模型")
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.fastModelEnabled)
            .onChange(async (value) => {
                this.plugin.settings.fastModelEnabled = value;
                await this.plugin.saveSettings();
                this.plugin.resetFrontendAgent();
                // 重新渲染此区域
                this.renderTabContent('llm');
            }));

    // 如果未启用，不显示详细配置
    if (!this.plugin.settings.fastModelEnabled) {
        return;
    }

    // 快速模型配置区域
    fastModelConfigEl = container.createDiv({ cls: 'deeppdf-settings-fast-model-config' });

    // 服务商选择
    const fastProvider = this.plugin.settings.fastModelProvider as ProviderType;
    new Setting(fastModelConfigEl)
        .setName("快速模型服务商")
        .setDesc("选择快速模型的服务商")
        .addDropdown(dropdown => {
            (Object.keys(PROVIDER_LABELS) as ProviderType[]).forEach(key => {
                dropdown.addOption(key, PROVIDER_LABELS[key]);
            });
            dropdown
                .setValue(fastProvider)
                .onChange(async (value) => {
                    this.plugin.settings.fastModelProvider = value as ProviderType;
                    // 自动填充默认模型
                    const defaultModel = getProviderDefaultModel(value as ProviderType);
                    if (defaultModel) {
                        this.plugin.settings.fastModelName = defaultModel;
                    }
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                    this.renderTabContent('llm');
                });
        });

    // 模型名称
    new Setting(fastModelConfigEl)
        .setName("快速模型名称")
        .setDesc("快速模型的具体名称")
        .addText(text => text
            .setPlaceholder("gpt-4o-mini")
            .setValue(this.plugin.settings.fastModelName)
            .onChange(async (value) => {
                this.plugin.settings.fastModelName = value;
                this.plugin.resetFrontendAgent();
                await this.plugin.saveSettings();
            }));

    // API Key（根据服务商显示对应的输入框）
    const fastProviderLabel = PROVIDER_LABELS[fastProvider];
    const fastApiKeyField = this.getApiKeyField(fastProvider);
    this.createApiKeySetting(
        fastModelConfigEl,
        `${fastProviderLabel} API Key (快速模型)`,
        `用于访问 ${fastProviderLabel} 快速模型的 API 密钥`,
        fastApiKeyField
    );

    // 自定义 Base URL（仅 custom 服务商）
    if (fastProvider === 'custom') {
        new Setting(fastModelConfigEl)
            .setName("快速模型 API Base URL")
            .setDesc("自定义快速模型的 API 地址")
            .addText(text => text
                .setPlaceholder("https://api.example.com/v1")
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    this.plugin.resetFrontendAgent();
                    await this.plugin.saveSettings();
                }));
    }
}
```

**Step 3: 添加 CSS 样式（可选）**

在 `frontend/src/settings/settings.css` 中添加：

```css
/* 快速模型设置区域 */
.deeppdf-settings-divider {
    border: none;
    border-top: 1px solid var(--background-modifier-border);
    margin: 1.5em 0;
}

.deeppdf-settings-section-header {
    margin-bottom: 1em;
}

.deeppdf-settings-section-header h4 {
    margin: 0 0 0.25em 0;
    font-size: 1em;
}

.deeppdf-settings-fast-model-config {
    padding-left: 1em;
    border-left: 2px solid var(--background-modifier-border);
    margin-top: 1em;
}
```

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

**Step 5: Commit**

```bash
git add frontend/src/settings/setting-tab.ts frontend/src/settings/settings.css
git commit -m "feat(settings): add fast model configuration UI

- Add collapsible fast model settings section
- Provider/model/api key inputs for fast model
- Auto-fill default model on provider change

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: 集成测试

**Step 1: 构建前端**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功，无错误

**Step 2: 在 Obsidian 中测试**

1. 部署插件：`npm run deploy && obsidian plugin:reload id=deepreader`
2. 打开设置页面，查看 AI 服务 Tab
3. 验证"快速模型设置"区域显示正常
4. 启用快速模型，配置 OpenAI 服务商和 API Key
5. 开始一个对话，验证功能正常

**Step 3: 测试场景**

| 场景 | 预期行为 |
|------|----------|
| fastModelEnabled=false | 所有状态使用 main 模型 |
| fastModelEnabled=true | Router/Inspectional 用 fast，Analytical/Formatter 用 main |
| 切换服务商 | 默认模型名称自动填充 |

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete multi-model support implementation

- Two-level model granularity (fast/main)
- Support different providers per model type
- Optional fast model configuration in settings
- Backward compatible with existing configuration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 文件修改总结

| 文件 | 修改类型 |
|------|----------|
| `frontend/src/config/settings.ts` | 扩展字段 |
| `frontend/src/agent/llm-client.ts` | 新增 LLMClientManager |
| `frontend/src/agent/cognitive-engine/types.ts` | 更新 SharedContext |
| `frontend/src/agent/cognitive-engine/context.ts` | 更新实现 |
| `frontend/src/agent/cognitive-engine/states/run-state-loop.ts` | 参数变更 |
| `frontend/src/agent/cognitive-engine/states/router.ts` | 调用更新 |
| `frontend/src/agent/cognitive-engine/states/inspectional.ts` | 调用更新 |
| `frontend/src/agent/cognitive-engine/states/analytical.ts` | 调用更新 |
| `frontend/src/agent/cognitive-engine/states/formatter.ts` | 调用更新 |
| `frontend/src/agent/index.ts` | 使用 LLMClientManager |
| `frontend/src/main.ts` | 传递配置 |
| `frontend/src/settings/setting-tab.ts` | 新增 UI |
| `frontend/src/settings/settings.css` | 新增样式 |
