/**
 * Voice Pipeline — TTS 语音生成
 *
 * 从格式化输出生成语音：先摘要，再按句分段合成，合并为完整音频。
 * 支持流式回调（边生成边返回音频块）。
 */

import { agentLog as log } from '../../utils/logger.js';

export interface VoiceConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  provider?: string;
}

export interface VoicePipelineOptions {
  userQuestion?: string;
  bookTitle?: string;
  memoryContext?: string;
  abortSignal?: AbortSignal;
}

export async function generateVoice(
  formattedOutput: string,
  ttsConfig: VoiceConfig,
  llmConfig: VoiceConfig,
  options: VoicePipelineOptions,
  onChunk?: (audioChunk: ArrayBuffer) => void,
): Promise<ArrayBuffer | null> {
  const signal = options.abortSignal;
  if (signal?.aborted) return null;

  const { TTSSummarizer } = await import('../../services/tts/tts-summarizer.js');
  const { TTSClient } = await import('../../services/tts/tts-client.js');
  const { MiniMaxTTSClient } = await import('../../services/tts/minimax-tts-client.js');
  const { getDefaultVoiceProfile } = await import('../../services/tts/voice-profile.js');
  const { TTSService } = await import('../../services/tts/tts-service.js');

  const summarizer = new TTSSummarizer({
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model || 'deepseek-chat',
  });

  const client = ttsConfig.provider === 'minimax'
    ? new MiniMaxTTSClient({
        apiKey: ttsConfig.apiKey,
        baseUrl: ttsConfig.baseUrl,
        model: ttsConfig.model,
      })
    : new TTSClient({
        apiKey: ttsConfig.apiKey,
        baseUrl: ttsConfig.baseUrl,
        model: ttsConfig.model,
      });

  // 先对整个内容进行摘要
  const summary = await summarizer.summarize(formattedOutput, options.userQuestion, {
    bookTitle: options.bookTitle,
    memoryContent: options.memoryContext,
  });

  if (!summary.trim() || signal?.aborted) return null;

  const sentences = splitSentences(summary);

  if (sentences.length === 0) return null;

  // 顺序生成所有句子的音频（保持顺序）
  const audioChunks: ArrayBuffer[] = [];
  for (const sentence of sentences) {
    if (signal?.aborted) break;
    try {
      const audioBuffer = await client.synthesize(sentence, {
        voiceProfile: { voice: getDefaultVoiceProfile(ttsConfig.provider).voice },
      });
      audioChunks.push(audioBuffer);
      // 流式回调：每生成一个句子就返回音频块
      if (onChunk) {
        onChunk(audioBuffer);
      }
    } catch (err) {
      log('[VoicePipeline] sentence synthesis failed:', err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err));
    }
  }

  if (signal?.aborted || audioChunks.length === 0) return null;

  // 合并所有音频片段
  return TTSService.mergeAudioChunks(audioChunks);
}

export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const idx = remaining.search(/[。！？!?]/);
    if (idx === -1) break;
    const sentence = remaining.slice(0, idx + 1).trim();
    if (sentence) sentences.push(sentence);
    remaining = remaining.slice(idx + 1);
  }
  const tail = remaining.trim();
  if (tail) sentences.push(tail);
  return sentences;
}
