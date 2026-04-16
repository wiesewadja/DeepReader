import { ChatOpenAI } from "@langchain/openai";

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatModels {
  main: ChatOpenAI;
  fast: ChatOpenAI;
}

/**
 * 创建 main/fast 双模型实例。
 * 替换现有 LLMClientManager，保留相同的双模型架构。
 *
 * - main: S2 Analytical + S4 Formatter（较强模型）
 * - fast: S0 Router + S1 Inspectional（快速/廉价模型）
 *
 * ChatOpenAI 兼容所有 OpenAI API 格式的 provider（DeepSeek、Kimi、Moonshot），
 * 通过 configuration.baseURL 切换。
 */
export function createChatModels(main: ModelConfig, fast?: ModelConfig): ChatModels {
  const mainModel = new ChatOpenAI({
    apiKey: main.apiKey || undefined,
    configuration: main.baseUrl ? { baseURL: main.baseUrl } : undefined,
    model: main.model || 'deepseek-chat',
    streaming: true,
    temperature: 0.3,
  });

  const fastModel = fast
    ? new ChatOpenAI({
        apiKey: fast.apiKey || undefined,
        configuration: fast.baseUrl ? { baseURL: fast.baseUrl } : undefined,
        model: fast.model || 'deepseek-chat',
        streaming: true,
        temperature: 0.1,
      })
    : mainModel;

  return { main: mainModel, fast: fastModel };
}
