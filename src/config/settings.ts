/**
 * DeepReader 插件设置类型定义
 */

import type { ProviderType } from './providers';

export interface EmbeddingSettings {
    provider: "openai" | "ollama" | "lmstudio" | "local";
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    dimensions?: number;
}

export interface RerankerSettings {
    enabled: boolean;
    provider?: "lmstudio" | "ollama" | "openai";
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    weight?: number;  // 0.0-1.0, default 0.7
}

export interface DeepPDFSettings {
    // API Server 设置
    apiPort: number;
    maxResults: number;

    // AI 服务商配置
    llmProvider: ProviderType;

    // Fast 模型配置（用于快速认知状态）
    fastModelEnabled: boolean;
    fastModelProvider: ProviderType;
    fastModelName: string;
    fastModelApiUrl: string;

    // 各服务商 API Key（独立字段）
    deepseekApiKey: string;
    openaiApiKey: string;
    kimiApiKey: string;
    zhipuApiKey: string;
    customApiKey: string;

    // 模型和 Base URL
    llmModel: string;
    apiUrl: string;

    // Embedding 模型配置（用于 Page Index 向量化）
    embedding: EmbeddingSettings;
    
    // Reranker 配置（用于搜索结果重排序）
    reranker?: RerankerSettings;

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
    readingModeStyle: 'paginated' | 'scrolling';

    // Langfuse 追踪配置
    langfusePublicKey: string;
    langfuseSecretKey: string;
    langfuseBaseUrl: string;
    langfuseEnabled: boolean;

    // UI 状态
    lastSettingsTab: string;

    // LangGraph 引擎设置
    enableHumanReview: boolean;

    // LangSmith 追踪配置（LangGraph 引擎专用）
    langsmithApiKey: string;
    langsmithProject: string;
    langsmithEnabled: boolean;
}

export const DEFAULT_SETTINGS: DeepPDFSettings = {
    // API Server 设置
    apiPort: 6088,
    maxResults: 5,

    // AI 服务商配置
    llmProvider: "deepseek",

    // Fast 模型配置
    fastModelEnabled: false,
    fastModelProvider: "deepseek",
    fastModelName: "",
    fastModelApiUrl: "",

    // 各服务商 API Key
    deepseekApiKey: "",
    openaiApiKey: "",
    kimiApiKey: "",
    zhipuApiKey: "",
    customApiKey: "",

    // 模型和 Base URL
    llmModel: "deepseek-chat",
    apiUrl: "",

    // Embedding 模型配置（默认使用 OpenAI text-embedding-3-small）
    embedding: {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
    },

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
    readingModeStyle: 'paginated' as const,

    // Langfuse 追踪配置
    langfusePublicKey: "",
    langfuseSecretKey: "",
    langfuseBaseUrl: "http://localhost:3000",
    langfuseEnabled: false,

    // UI 状态
    lastSettingsTab: "llm",

    // LangGraph 引擎设置
    enableHumanReview: false,

    // LangSmith 追踪配置
    langsmithApiKey: "",
    langsmithProject: "DeepReader",
    langsmithEnabled: false,
};
