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
    chatCache?: Record<string, unknown>;
    enableDebugLog: boolean;
    lastDeepSearchMode: boolean;

    // 阅读模式设置
    autoEnableReadingMode: boolean;

    // UI 状态
    lastSettingsTab: string;
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

    // UI 状态
    lastSettingsTab: "llm",
};
