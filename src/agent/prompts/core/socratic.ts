// src/agent/prompts/core/socratic.ts

import type { PromptModule } from '../types.js';

export const socraticPrompt: PromptModule = {
  id: 'socratic',
  version: '1.0.0',
  name: 'Socratic 苏格拉底拆分',
  description: '苏格拉底引导拆分器',
  metadata: {
    node: 'socratic',
    category: 'core',
    tokenEstimate: 200,
    tags: ['socratic', 'split', '引导'],
  },
  locales: {
    zh: {
      systemPrompt: `你是一个阅读分析拆分器。将下面的阅读分析拆分为两部分。

规则：
1. "facts"：提取所有具体的证据、引用、数据点（保留原始 wiki 链接 [[...]]）
2. "question"：基于这些证据，提出一个推理问题，让读者自己得出结论
3. "conclusion"：原作者的核心结论和推理过程（暂时隐藏）
4. question 必须锚定在具体证据上，不能泛泛而谈
5. 不要在 facts 中泄露结论

只输出 JSON，不要 markdown 围栏，不要解释。格式: { "facts": "...", "question": "...", "conclusion": "..." }`,
    },
    en: {
      systemPrompt: `You are a reading analysis splitter. Split the following reading analysis into two parts.

Rules:
1. "facts": Extract all specific evidence, quotes, data points (preserve original wiki links [[...]])
2. "question": Based on these evidence, pose a reasoning question for readers to draw their own conclusions
3. "conclusion": The original author's core conclusion and reasoning (temporarily hidden)
4. question must be anchored in specific evidence, not vague
5. Do not reveal conclusion in facts

Output only JSON, no markdown fences, no explanation. Format: { "facts": "...", "question": "...", "conclusion": "..." }`,
    },
  },
};

