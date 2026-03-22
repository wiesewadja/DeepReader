# 多模型支持设计文档

## 概述

为 DeepReader Agent 的认知状态机添加多模型支持，允许不同阶段使用不同的 LLM 模型，以优化成本和性能。

## 背景

当前架构中，所有认知状态（Router、Inspectional、Analytical、Formatter）共用同一个 LLMClient 实例。虽然每个状态已声明了 `model: 'fast' | 'main'` 类型，但该类型仅用于日志记录，实际调用时仍使用同一模型。

### 认知状态与模型类型映射

| 状态 | ModelType | 职责 |
|------|-----------|------|
| S0 Router | `fast` | 意图分类、查询重写 |
| S1 Inspectional | `fast` | TOC 获取、范围锁定 |
| S2 Analytical | `main` | 深度分析、内容提取 |
| S4 Formatter | `main` | 格式化输出 |

## 设计决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 模型粒度 | 两级模型 (`fast` / `main`) | 最大化 LLM 缓存命中率，同类任务共享模型 |
| 服务商 | 支持不同服务商 | 灵活配置，如 `fast` 用 OpenAI，`main` 用 DeepSeek |
| 配置来源 | 混合模式 | 插件设置优先，支持默认值 |
| 默认策略 | 智能默认 | `main` 使用现有配置，`fast` 默认等同于 `main`（向后兼容）|

## 架构设计

### 1. 设置结构扩展

```typescript
// config/settings.ts
export interface DeepPDFSettings {
    // ... 现有字段保持不变（作为 main 模型配置）...

    // 新增：Fast 模型配置
    fastModelEnabled: boolean;       // 是否启用独立 fast 模型，默认 false
    fastModelProvider: ProviderType; // fast 模型服务商
    fastModelName: string;           // fast 模型名称
    // API Key 复用现有字段结构（deepseekApiKey 等）
}
```

### 2. LLMClientManager

新增客户端管理器，负责创建和缓存多个 LLMClient 实例：

```typescript
// llm-client.ts
export interface ModelConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string;
}

export class LLMClientManager {
  private mainClient: LLMClient;
  private fastClient: LLMClient | null = null;
  private fastConfig: ModelConfig | null = null;

  constructor(mainConfig: ModelConfig, fastConfig?: ModelConfig) {
    this.mainClient = new LLMClient(mainConfig);
    if (fastConfig) {
      this.fastClient = new LLMClient(fastConfig);
      this.fastConfig = fastConfig;
    }
  }

  getClient(modelType: 'fast' | 'main'): LLMClient {
    if (modelType === 'fast' && this.fastClient) {
      return this.fastClient;
    }
    return this.mainClient;
  }

  getMainClient(): LLMClient {
    return this.mainClient;
  }
}
```

### 3. SharedContext 变更

```typescript
// cognitive-engine/types.ts
export interface SharedContext {
  // ... 其他字段保持不变 ...

  // 新增：LLMClientManager
  llmClientManager?: LLMClientManager;

  // 保留但标记 deprecated（向后兼容）
  /** @deprecated Use llmClientManager instead */
  llmClient?: LLMClient;
}
```

### 4. runStateLoop 变更

```typescript
// cognitive-engine/states/run-state-loop.ts
export async function runStateLoop(
  llmClientManager: LLMClientManager,  // 变更：接收 Manager
  toolRegistry: ToolRegistry,
  toolContext: ToolContext,
  options: StateLoopOptions,
  callbacks: StateLoopCallbacks = {}
): Promise<StateLoopResult> {
  const { model, ... } = options;

  // 根据 model 类型选择客户端
  const llmClient = llmClientManager.getClient(model);

  // 后续逻辑不变...
}
```

### 5. FrontendAgent 变更

```typescript
// index.ts
export class FrontendAgent {
  private llmClientManager: LLMClientManager;  // 变更

  constructor(options: FrontendAgentOptions) {
    // 创建 main 客户端配置
    const mainConfig: ModelConfig = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      providerName: options.providerName,
    };

    // 创建 fast 客户端配置（如果有）
    const fastConfig = options.fastModelEnabled ? {
      apiKey: options.fastApiKey!,
      baseUrl: options.fastBaseUrl,
      model: options.fastModel,
      providerName: options.fastProviderName,
    } : undefined;

    this.llmClientManager = new LLMClientManager(mainConfig, fastConfig);
  }
}
```

### 6. 数据流

```
用户配置（设置页面）
       │
       ▼
  DeepPDFPlugin
   (main.ts)
       │
       ├── mainConfig: { apiKey, baseUrl, model }
       └── fastConfig?: { fastApiKey, fastBaseUrl, fastModel }
       │
       ▼
  FrontendAgent
       │
       └── llmClientManager: LLMClientManager
              ├── mainClient: LLMClient
              └── fastClient?: LLMClient
       │
       ▼
  SharedContext.llmClientManager
       │
       ▼
  runStateLoop(llmClientManager.getClient(state.model), ...)
       │
       ├── state.model === 'fast' → fastClient || mainClient
       └── state.model === 'main' → mainClient
```

## UI 设计

### 位置

AI 服务设置 Tab，主模型配置下方

### 布局

```
┌─────────────────────────────────────────────────────────────────┐
│  AI 服务设置                                                      │
├─────────────────────────────────────────────────────────────────┤
│  [现有配置：服务商、模型名称、API Key]                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  ▼ 快速模型设置（可选）                                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 用于路由和检视阶段，可选择更便宜/更快的模型以节省成本              │ │
│  │                                                             │ │
│  │ [✓] 启用独立的快速模型                                        │ │
│  │                                                             │ │
│  │ 快速模型服务商          [OpenAI ▼]                           │ │
│  │ 快速模型名称            [gpt-4o-mini     ]                   │ │
│  │ OpenAI API Key         [•••••••••••••••  ] 👁                │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 交互逻辑

1. **默认状态**：折叠显示 "▶ 快速模型设置（可选）"
2. **展开后**：显示说明文字和启用复选框
3. **勾选启用**：显示服务商选择、模型名称、API Key 输入
4. **切换服务商**：自动填充默认模型名称
5. **取消勾选**：隐藏配置项，fast 模型回退到 main 配置

### 样式

复用现有设置样式，折叠区域使用 `.setting-item-collapsible` 类。

## 文件修改清单

| 文件 | 修改类型 | 修改内容 |
|------|----------|----------|
| `config/settings.ts` | 扩展 | 新增 `fastModelEnabled`, `fastModelProvider`, `fastModelName` 字段及默认值 |
| `config/providers.ts` | 扩展 | 新增 `getFastProviderConfig()` 辅助函数 |
| `llm-client.ts` | 新增 | 新增 `LLMClientManager` 类和 `ModelConfig` 类型 |
| `cognitive-engine/types.ts` | 修改 | `SharedContext.llmClient` → `llmClientManager` |
| `cognitive-engine/context.ts` | 修改 | 更新 `createSharedContext` 参数 |
| `cognitive-engine/states/run-state-loop.ts` | 修改 | 接收 `LLMClientManager`，内部选择客户端 |
| `cognitive-engine/states/router.ts` | 修改 | 传递 `llmClientManager` |
| `cognitive-engine/states/inspectional.ts` | 修改 | 传递 `llmClientManager` |
| `cognitive-engine/states/analytical.ts` | 修改 | 传递 `llmClientManager` |
| `cognitive-engine/states/formatter.ts` | 修改 | 传递 `llmClientManager` |
| `cognitive-engine/engine.ts` | 修改 | 传递 `llmClientManager` 到各状态 |
| `index.ts` (FrontendAgent) | 重构 | 使用 `LLMClientManager`，扩展 `FrontendAgentOptions` |
| `main.ts` | 修改 | 传递双模型配置给 `FrontendAgent` |
| `settings/setting-tab.ts` | 扩展 | 新增折叠式 Fast 模型配置 UI |

## 向后兼容性

1. **现有配置**：`FrontendAgentOptions` 保持原有字段，作为 main 配置
2. **默认行为**：`fastModelEnabled = false` 时，fast 和 main 使用同一客户端
3. **API 兼容**：`FrontendAgent.getLLMClient()` 返回 main 客户端（保持现有行为）

## 测试计划

1. **单元测试**：`LLMClientManager.getClient()` 选择逻辑
2. **集成测试**：
   - 仅配置 main 模型时，所有状态使用 main
   - 配置 fast + main 时，Router/Inspectional 使用 fast，Analytical/Formatter 使用 main
3. **UI 测试**：
   - 折叠/展开交互
   - 启用/禁用切换
   - 服务商切换时模型名称自动填充

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 配置复杂度增加 | 默认禁用 fast 模型，用户无需关心 |
| 多客户端内存占用 | 客户端实例轻量，按需创建 |
| 服务商 API 格式差异 | 复用现有 `ProviderConfig` 机制 |
