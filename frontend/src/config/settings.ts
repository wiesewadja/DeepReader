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

    // Langfuse 可观测性配置
    langfusePublicKey: string;
    langfuseSecretKey: string;
    langfuseBaseUrl: string;
    langfuseEnabled: boolean;

    // UI 状态
    lastSettingsTab: string;
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

    // Langfuse 可观测性
    langfusePublicKey: "",
    langfuseSecretKey: "",
    langfuseBaseUrl: "http://localhost:3000",
    langfuseEnabled: false,

    // UI 状态
    lastSettingsTab: "llm",
};
