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
 * 获取当前服务商的配置信息
 */
export function getProviderConfig(
    settings: Pick<DeepPDFSettings, 'llmProvider' | 'apiUrl'>
): ProviderConfig & { provider: ProviderType } {
    let provider = settings.llmProvider as ProviderType;

    // 向后兼容：将旧的 google 映射到 custom
    if ((provider as string) === 'google') {
        provider = 'custom';
    }

    const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.deepseek;

    return {
        ...config,
        provider,
        baseUrl: provider === 'custom' ? settings.apiUrl : config.baseUrl,
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
