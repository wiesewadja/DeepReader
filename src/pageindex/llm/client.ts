/**
 * pageindex-llm: OpenAI-compatible API utilities
 * Supports OpenAI, LM Studio, Ollama, and other compatible endpoints
 *
 * Node.js compatible version - uses native fetch API (no openai SDK dependency)
 */

import { isThinkingModel as sharedIsThinkingModel, getDisableThinkingParams, stripThinkTags as sharedStripThinkTags } from '../../config/thinking-models.js';
import { normalizeBaseUrl } from '../../config/providers.js';
import { safeRequest } from '../../utils/safe-request.js';
import { log as piLog } from '../core/logger';

/** Cross-runtime sleep function */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface ClientConfig {
  apiKey?: string;
  baseUrl?: string; // For LM Studio: http://localhost:1234/v1
}

export interface ChatOptions {
  model: string;
  prompt: string;
  apiKey?: string;
  baseUrl?: string;
  chatHistory?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxRetries?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  finishReason: "finished" | "max_output_reached" | "error";
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Check if the base URL is LM Studio
 */
function isLMStudio(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  return baseUrl.includes("localhost:1234") || baseUrl.includes("127.0.0.1:1234");
}

/**
 * Check if the model is a thinking model (supports reasoning parameter)
 * Delegates to shared utility for consistent detection across all paths.
 */
function isThinkingModel(model: string): boolean {
  return sharedIsThinkingModel(model);
}

/**
 * Call ChatGPT-compatible API with retry logic
 * Works with OpenAI, LM Studio, Ollama, etc.
 */
export async function chatGPT(options: ChatOptions): Promise<string> {
  // Use native LM Studio API only for known thinking models that support reasoning parameter
  // Other models should use the standard OpenAI-compatible endpoint
  if (isLMStudio(options.baseUrl) && isThinkingModel(options.model)) {
    const result = await chatLMStudioNative(options);
    return result.content;
  }
  
  // Use OpenAI-compatible endpoint for all other cases
  const result = await chatGPTWithFinishReason(options);
  return result.content;
}

/**
 * Call ChatGPT-compatible API and return full result including token usage.
 * Use this when callers need inputTokens/outputTokens from the response.
 */
export async function chatGPTWithUsage(options: ChatOptions): Promise<ChatResult> {
  return chatGPTWithFinishReason(options);
}

/**
 * Call ChatGPT-compatible API with retry logic and finish reason
 */
export async function chatGPTWithFinishReason(
  options: ChatOptions
): Promise<ChatResult> {
  const {
    model,
    prompt,
    apiKey,
    baseUrl,
    chatHistory = [],
    temperature = 0,
    maxRetries = 5,
    maxTokens,
  } = options;

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY || process.env.API_KEY || "lm-studio";
  const effectiveBaseUrl = normalizeBaseUrl(baseUrl || process.env.OPENAI_BASE_URL || process.env.API_BASE_URL || "https://api.openai.com/v1");

  const messages: Array<{ role: string; content: string }> = [
    ...chatHistory,
    { role: "user", content: prompt },
  ];

  let lastError: Error | null = null;
  const TIMEOUT_MS = 120_000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const t0 = Date.now();
      if (attempt > 0) {
        piLog(`[chatGPT] Retry ${attempt + 1}/${maxRetries} for model ${model}...`);
      }

      const disableThinking = getDisableThinkingParams(model);

      const response = await Promise.race([
        safeRequest({
          url: `${effectiveBaseUrl}/chat/completions`,
          method: "POST",
          contentType: "application/json",
          headers: { Authorization: `Bearer ${effectiveApiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            ...(disableThinking || {}),
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
        ),
      ]);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      piLog(`[chatGPT] ${model} responded in ${elapsed}s (status ${response.status}, attempt ${attempt + 1})`);

      if (response.status >= 400) {
        piLog(`[chatGPT] API error ${response.status}: ${response.text?.slice(0, 300)}`);
        throw new Error(`API error: ${response.status} - ${response.text}`);
      }

      const data = response.json as {
        choices: Array<{
          message: { content: string };
          finish_reason: string;
        }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const choice = data.choices[0];
      if (!choice) {
        throw new Error("No response from API");
      }

      piLog(`[chatGPT] finish_reason=${choice.finish_reason}, output ${choice.message.content.length} chars`);

      return {
        content: sharedStripThinkTags(choice.message.content),
        finishReason: choice.finish_reason === "stop" ? "finished" :
                      choice.finish_reason === "length" ? "max_output_reached" : "error",
        ...(data.usage ? { usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } } : {}),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      piLog(`[chatGPT] Attempt ${attempt + 1} failed: ${lastError.message}`);

      if (attempt < maxRetries - 1) {
        // 429 限流：指数退避 + 随机抖动，避免所有并发请求同时重试
        const is429 = lastError.message.includes('429');
        const baseBackoff = is429 ? 3000 : 1000;
        const backoff = baseBackoff * Math.pow(2, attempt) + Math.random() * 1000;
        piLog(`[chatGPT] Retrying in ${Math.round(backoff)}ms...`);
        await sleep(backoff);
      }
    }
  }

  piLog(`[chatGPT] All ${maxRetries} retries exhausted for ${model}`);
  throw lastError || new Error("Failed after retries");
}

/**
 * Native LM Studio API call (for thinking models)
 */
async function chatLMStudioNative(options: ChatOptions): Promise<ChatResult> {
  const {
    model,
    prompt,
    apiKey = "lm-studio",
    baseUrl = "http://localhost:1234/v1",
    temperature = 0,
  } = options;

  const response = await safeRequest({
    url: `${baseUrl}/chat/completions`,
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      // Disable reasoning for better performance in non-thinking scenarios
      reasoning_effort: "none",
    }),
  });

  if (response.status >= 400) {
    throw new Error(`LM Studio API error: ${response.status} - ${response.text}`);
  }

  const data = response.json as {
    choices: Array<{
      message: { content: string };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  if (!choice) {
    throw new Error("No response from LM Studio API");
  }

  return {
    content: choice.message.content,
    finishReason: choice.finish_reason === "stop" ? "finished" : "error",
    ...(data.usage ? { usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } } : {}),
  };
}
