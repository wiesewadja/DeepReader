import { ChatOpenAI } from "@langchain/openai";
import { getDisableThinkingParams } from "../../config/thinking-models.js";
import { createCorsSafeFetch } from "../../utils/safe-request.js";

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  disableThinking?: boolean;
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
  // 计算禁用思考参数：undefined=自动检测, true=强制禁用, false=不禁用
  const mainKwargs = main.disableThinking !== false
    ? (getDisableThinkingParams(main.model) ?? {})
    : {};

  const corsSafeFetch = createCorsSafeFetch();

  const mainModel = new ChatOpenAI({
    apiKey: main.apiKey || undefined,
    configuration: main.baseUrl ? { baseURL: main.baseUrl, fetch: corsSafeFetch } : { fetch: corsSafeFetch },
    model: main.model || 'deepseek-chat',
    streaming: true,
    temperature: 0.3,
    modelKwargs: mainKwargs,
  });

  let fastModel = mainModel;
  if (fast) {
    const fastKwargs = fast.disableThinking !== false
      ? (getDisableThinkingParams(fast.model) ?? {})
      : {};

    fastModel = new ChatOpenAI({
      apiKey: fast.apiKey || undefined,
      configuration: fast.baseUrl ? { baseURL: fast.baseUrl, fetch: corsSafeFetch } : { fetch: corsSafeFetch },
      model: fast.model || 'deepseek-chat',
      streaming: true,
      temperature: 0.1,
      modelKwargs: fastKwargs,
    });
  }

  return { main: mainModel, fast: fastModel };
}
