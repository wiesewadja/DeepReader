import { ChatOpenAI } from "@langchain/openai";
import { getDisableThinkingParams } from "../../config/thinking-models.js";
import { createCorsSafeFetch } from "../../utils/safe-request.js";

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  disableThinking?: boolean;
  requestTimeout?: number; // 请求超时（毫秒）
}

export interface ChatModels {
  main: ChatOpenAI;
  fast: ChatOpenAI;
}

/**
 * 混合 token 估算：CJK 字符 ~1 token，其他 ~4 字符/token。
 * 避免 ChatOpenAI.getNumTokens() 远程加载 tiktoken BPE 词表（会被墙）。
 */
async function estimateTokens(content: string | Array<{ type: string; text?: string }>): Promise<number> {
  const text = typeof content === 'string'
    ? content
    : content.map(c => (c.type === 'text' && c.text) || '').join('');
  if (!text) return 0;
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
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
    maxTokens: 8192,
    modelKwargs: mainKwargs,
    timeout: main.requestTimeout || 60000, // 默认 60 秒超时（@langchain/openai 字段名为 timeout）
  });
  // 覆盖 getNumTokens，跳过远程 tiktoken 加载（避免 gfw 导致的 ERR_CONNECTION_CLOSED）
  mainModel.getNumTokens = estimateTokens;

  let fastModel = mainModel;
  if (fast) {
    const fastKwargs = fast.disableThinking !== false
      ? (getDisableThinkingParams(fast.model) ?? {})
      : {};

    fastModel = new ChatOpenAI({
      apiKey: fast.apiKey || undefined,
      configuration: fast.baseUrl ? { baseURL: fast.baseUrl, fetch: corsSafeFetch } : { fetch: corsSafeFetch },
      model: fast.model || 'deepseek-chat',
      streaming: false,
      temperature: 0.1,
      modelKwargs: fastKwargs,
      timeout: fast.requestTimeout || 30000, // 默认 30 秒超时
    });
    fastModel.getNumTokens = estimateTokens;
  }

  return { main: mainModel, fast: fastModel };
}
