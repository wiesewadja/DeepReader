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
- 块引用格式：[[书名/文件名#^block_id|语义别名]]
  - 语义别名应为该段话对应的核心概念词或具体论点词（2-6 字），切记不可直接照搬章节名称或文件名：
    - 正例：在面临[[思维简史/02-记忆#^p12|工作记忆瓶颈]]时，笔记是重要的外部辅助。
    - 反例：在面临记忆瓶颈时，笔记是重要的外部辅助。[[思维简史/02-记忆#^p12|第二章 记忆结构]]（照搬章节名，且链接孤立在句尾）
- 链接必须自然嵌入句内作为主语/宾语/定语来替代关键词，禁止链接孤立跟在句尾或单独放在括号内。
- 引用覆盖率：必须最大化利用提供给你的 block_id，回答的每个主要分析段落都应当包含至少一个 wiki 链接。
- 真实性要求：文件名与 block_id 必须严格源自上方检索结果或候选篮中标注的值，绝对禁止凭空捏造。`,
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

