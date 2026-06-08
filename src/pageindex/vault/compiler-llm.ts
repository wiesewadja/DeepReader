import { chatGPT } from "../llm/client";
import { buildConceptExtractionPrompt, buildDeepAnalysisPrompt } from "./compiler-prompts";
import type { ConceptExtraction, DeepAnalysis } from "./compiler-types";

/** 解析 LLM 返回的概念提取 JSON */
export function parseConceptExtractionResponse(response: string): { results: ConceptExtraction[] } {
  // 提取 JSON（可能在 ```json ... ``` 包裹中）
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ||
    response.match(/(\{[\s\S]*\})/);

  if (!jsonMatch) {
    throw new Error("Failed to parse LLM response as JSON");
  }

  const parsed = JSON.parse(jsonMatch[1]);
  if (!parsed.results || !Array.isArray(parsed.results)) {
    throw new Error("LLM response missing 'results' array");
  }

  return parsed as { results: ConceptExtraction[] };
}

/** 合并语义相近的标签（冷启动去重用） */
export function mergeTags(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    if (seen.has(tag)) continue;
    // 跳过已被更长标签包含的短标签（如"认知"被"认知科学"包含）
    const isSubsumed = tags.some(
      (other) => other !== tag && other.includes(tag) && other.length > tag.length
    );
    if (isSubsumed) continue;

    result.push(tag);
    seen.add(tag);
  }

  return result;
}

/** Phase 1: 批量概念提取 */
export async function extractConcepts(
  notes: Array<{ file: string; summary: string }>,
  existingTopics: string[],
  existingTags: string[],
  options: { model: string; apiKey?: string; baseUrl?: string }
): Promise<ConceptExtraction[]> {
  const prompt = buildConceptExtractionPrompt(notes, existingTopics, existingTags);

  const response = await chatGPT({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    prompt,
    temperature: 0,
  });

  const parsed = parseConceptExtractionResponse(response);
  return parsed.results;
}

/** Phase 2: 单篇深度分析 */
export async function analyzeNoteDeep(
  filePath: string,
  noteContent: string,
  relatedContext: string,
  options: { model: string; apiKey?: string; baseUrl?: string }
): Promise<DeepAnalysis> {
  const prompt = buildDeepAnalysisPrompt(filePath, noteContent, relatedContext);

  const response = await chatGPT({
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    prompt,
    temperature: 0,
  });

  // 提取 JSON
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ||
    response.match(/(\{[\s\S]*\})/);

  if (!jsonMatch) {
    throw new Error(`Failed to parse deep analysis response for ${filePath}`);
  }

  return JSON.parse(jsonMatch[1]) as DeepAnalysis;
}
