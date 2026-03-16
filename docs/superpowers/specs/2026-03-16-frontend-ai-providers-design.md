# 前端 AI 服务商配置设计

## 概述

在 DeepReader 前端配置中增加 Kimi、智谱、自定义等 AI 服务商选项，改造现有的 "LLM API 设置" 为统一的前端 Agent 配置。

## 需求

- **范围**：只修改前端 Agent 配置，不影响后端 PDF 索引设置
- **配置模式**：预设服务商（DeepSeek、Kimi、智谱、OpenAI）+ 自定义选项
- **API Key 存储**：每个服务商独立字段
- **界面位置**：改造现有的 "LLM API 设置" 区域
- **模型配置**：所有服务商的模型名称都可以手动修改

## 数据结构

### Settings 新增字段

```typescript
interface DeepPDFSettings {
  // ... 现有字段 ...

  // Agent 服务商配置
  llmProvider: 'deepseek' | 'kimi' | 'zhipu' | 'openai' | 'custom';

  // 各服务商 API Key（独立字段）
  deepseekApiKey: string;  // 已有
  openaiApiKey: string;    // 已有
  kimiApiKey: string;      // 新增
  zhipuApiKey: string;     // 新增
  customApiKey: string;    // 新增

  // 模型和 Base URL
  llmModel: string;        // 已有，所有服务商通用，可手动修改
  apiUrl: string;          // 已有，仅自定义时生效
}
```

### 默认值

```typescript
const DEFAULT_SETTINGS: DeepPDFSettings = {
  // ... 现有默认值 ...
  llmProvider: "deepseek",
  llmModel: "deepseek-chat",
  deepseekApiKey: "",
  openaiApiKey: "",
  kimiApiKey: "",
  zhipuApiKey: "",
  customApiKey: "",
  apiUrl: "",
};
```

## 预设服务商配置

| 服务商 | Provider 值 | Base URL（预设） | 默认模型 | API Key 字段 |
|--------|-------------|------------------|----------|--------------|
| DeepSeek | `deepseek` | `https://api.deepseek.com` | `deepseek-chat` | `deepseekApiKey` |
| Kimi | `kimi` | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | `kimiApiKey` |
| 智谱 | `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | `zhipuApiKey` |
| OpenAI | `openai` | `https://api.openai.com/v1` | `gpt-4o` | `openaiApiKey` |
| 自定义 | `custom` | 用户输入（`apiUrl`） | 用户输入 | `customApiKey` |

## 设置界面

改造现有的 "LLM API 设置" 区域：

```
┌─────────────────────────────────────────┐
│ LLM API 设置                             │
├─────────────────────────────────────────┤
│ AI 服务商: [DeepSeek ▼]                 │
│                                         │
│ 模型名称: [deepseek-chat____________]   │
│                                         │
│ DeepSeek API Key: [••••••••]            │
│                                         │
│ Kimi API Key: [••••••••]                │
│                                         │
│ 智谱 API Key: [••••••••]                │
│                                         │
│ OpenAI API Key: [••••••••]              │
│                                         │
│ 自定义 API Key: [••••••••]              │
│                                         │
│ API Base URL: [https://...]             │
│ (仅选择"自定义"时生效)                   │
└─────────────────────────────────────────┘
```

### 交互逻辑

1. **切换服务商**：自动填充该服务商的默认模型到 `llmModel` 输入框
2. **模型名称**：用户可以随时手动修改
3. **Base URL**：仅在选择"自定义"时生效，其他服务商使用预设值
4. **API Key**：显示所有服务商的 Key 输入框，方便用户配置

## 代码修改

### 文件：`frontend/src/main.ts`

#### 1. 新增 Settings 字段和默认值

在 `DeepPDFSettings` 接口和 `DEFAULT_SETTINGS` 中添加新字段。

#### 2. 重构 LLM API 设置界面

修改 `DeepPDFSettingTab.display()` 方法：

- 更新 Provider 下拉框选项
- 添加 Kimi、智谱、自定义的 API Key 输入框
- 切换 Provider 时自动更新默认模型
- Base URL 输入框添加说明（仅自定义生效）

#### 3. 修改 getFrontendAgent() 方法

根据 `llmProvider` 读取对应的配置：

```typescript
async getFrontendAgent(): Promise<FrontendAgent> {
  const providerConfig = this.getProviderConfig();

  this.frontendAgent = new FrontendAgent({
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model: this.settings.llmModel || providerConfig.defaultModel,
    skillsDir: this.skillsDir,
    app: this.app,
  });
  // ...
}

private getProviderConfig() {
  const configs = {
    deepseek: {
      apiKey: this.settings.deepseekApiKey,
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat',
    },
    kimi: {
      apiKey: this.settings.kimiApiKey,
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'moonshot-v1-8k',
    },
    zhipu: {
      apiKey: this.settings.zhipuApiKey,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4-flash',
    },
    openai: {
      apiKey: this.settings.openaiApiKey,
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
    },
    custom: {
      apiKey: this.settings.customApiKey,
      baseUrl: this.settings.apiUrl,
      defaultModel: '',
    },
  };

  return configs[this.settings.llmProvider] || configs.deepseek;
}
```

## 兼容性

- 保持现有 `llmProvider` 值（`deepseek`、`openai`、`google`、`custom`）的兼容
- `google` 选项可映射到自定义或移除（根据实际情况）
- 现有用户的 `deepseekApiKey` 和 `openaiApiKey` 不受影响

## 测试要点

1. 切换服务商时，模型名称自动更新为默认值
2. 手动修改模型名称后保存正确
3. 各服务商 API Key 独立存储和读取
4. 自定义服务商正确使用用户输入的 Base URL
5. 升级后现有配置不丢失
