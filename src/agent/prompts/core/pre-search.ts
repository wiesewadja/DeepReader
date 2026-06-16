// src/agent/prompts/core/pre-search.ts

import type { PromptModule } from '../types.js';

export const preSearchPrompt: PromptModule = {
  id: 'pre-search.s2-pre',
  version: '1.0.0',
  name: 'S2-Pre 预检索早停',
  description: '早停路径直接出答案的 prompt',
  metadata: {
    node: 'analytical-pre-search',
    category: 'core',
    tokenEstimate: 500,
    tags: ['pre-search', 'early-stop'],
  },
  locales: {
    zh: {
      systemPrompt: `基于以下检索结果回答用户问题。你必须从检索结果中引用原文，并使用 wiki 链接标注来源。即使信息不完整，也要基于已有内容给出尽可能充分的回答。

输出格式要求：
- 引用来源用 [[书名/file_name#^block_id|短别名]] 格式，别名 2-6 字核心词
- file_name 和 block_id 必须来自上方检索结果中标注的值，禁止编造
- 链接必须嵌入句子内部替代关键词，不要孤立在句尾
- 必须在回答中包含至少一个 wiki 链接`,
    },
    en: {
      systemPrompt: `Answer the user's question based on the following search results. You must quote the original text from search results and use wiki links to mark sources. Even if information is incomplete, give the most comprehensive answer possible based on available content.

Output format requirements:
- Use [[book/file_name#^block_id|short alias]] format for citations, alias 2-6 chars
- file_name and block_id must come from the search results above, do not fabricate
- Links must be embedded inline to replace keywords, never place孤立 in sentence endings
- Must include at least one wiki link in your answer`,
    },
  },
};

