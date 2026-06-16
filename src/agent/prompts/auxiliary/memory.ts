// src/agent/prompts/auxiliary/memory.ts

import type { PromptModule } from '../types.js';

/** 对话整合提示词 */
export const consolidationPrompt: PromptModule = {
  id: 'memory.consolidation',
  version: '1.0.0',
  name: '对话整合',
  description: '分析对话并提取核心信息',
  metadata: {
    category: 'auxiliary',
    tokenEstimate: 500,
    tags: ['memory', 'consolidation', 'dialogue'],
  },
  locales: {
    zh: {
      systemPrompt: `分析这段对话，提取核心信息并调用 save_memory 工具。

## 分析要点
1. **讨论主题**：这段对话讨论了什么？（简短概括）
2. **关键结论**：得出的结论或给出的建议是什么？
3. **引用链接**：返回了哪些 [[书名#^blockId]] 链接？（最多保留3个重要引用）
4. **用户画像推理**（重点关注，按以下维度观察）：
   - **提问倾向**：用户喜欢深入追问细节？还是概览总结？
   - **阅读偏好**：用户关注哪些主题/领域？
   - **交互风格**：用户是简洁型（短问题）还是详细型（长段描述）？
   - **认知水平**：从提问深度推断用户的专业程度

## 输出要求
- history_entry 格式：💬 关于《书名》讨论了主题，得出结论Y。引用：[[书名#^blockId]]
- 每轮对话生成一条摘要（精简，<100字）
- **跳过规则**：如果对话无实质内容（条目长度<20字符），history_entry 返回空字符串
- 必须调用 save_memory 工具`,
    },
    en: {
      systemPrompt: `Analyze this conversation, extract core information, and call the save_memory tool.

## Analysis Points
1. **Discussion Topic**: What was discussed? (brief summary)
2. **Key Conclusions**: What conclusions were reached or advice given?
3. **Citation Links**: Which [[book#^blockId]] links were returned? (keep max 3 important citations)
4. **User Profile Inference** (focus area, observe by dimension):
   - **Questioning Style**: Does the user prefer deep dives or overviews?
   - **Reading Preferences**: What topics/fields does the user focus on?
   - **Interaction Style**: Concise (short questions) or detailed (long descriptions)?
   - **Cognitive Level**: Infer expertise from question depth

## Output Requirements
- history_entry format: 💬 Discussed [topic] about《Book Title》, concluded Y. Citation: [[book#^blockId]]
- Generate one summary per conversation round (concise, <100 chars)
- **Skip Rule**: If conversation has no substance (entry length <20 chars), return empty string
- Must call save_memory tool`,
    },
  },
};

/** 记忆压缩提示词 */
export const compressionPrompt: PromptModule = {
  id: 'memory.compression',
  version: '1.0.0',
  name: '记忆压缩',
  description: '激进压缩长期记忆',
  metadata: {
    category: 'auxiliary',
    tokenEstimate: 300,
    tags: ['memory', 'compression', 'long-term'],
  },
  locales: {
    zh: {
      systemPrompt: `激进压缩以下长期记忆，目标：100 行以内，8000 字符以内。

## 压缩规则（必须严格执行）
1. **激进合并**：相同概念只保留一次，用逗号连接多个值
2. **删除冗余**：
   - 删除"正在阅读"、"当前关注"等临时状态（这些会过时）
   - 删除重复出现的概念
   - 删除过于详细的描述
3. **极简表达**：
   - 用关键词替代完整句子
   - 用"-"列表替代段落
4. **保持结构**：用户画像/阅读偏好/兴趣主题/阅读习惯

## 输出格式
保持 Markdown 格式，但极度精简。

调用 compress_memory 工具返回压缩后的记忆。`,
    },
    en: {
      systemPrompt: `Aggressively compress the following long-term memory. Target: under 100 lines, under 8000 characters.

## Compression Rules (strictly follow)
1. **Aggressive Merge**: Keep each concept only once, connect multiple values with commas
2. **Delete Redundancy**:
   - Delete temporary states like "currently reading", "current focus" (these become outdated)
   - Delete repeated concepts
   - Delete overly detailed descriptions
3. **Minimal Expression**:
   - Use keywords instead of complete sentences
   - Use "-" lists instead of paragraphs
4. **Preserve Structure**: User profile / reading preferences / interest topics / reading habits

## Output Format
Keep Markdown format, but extremely concise.

Call compress_memory tool to return compressed memory.`,
    },
  },
};

/** 导出所有 Memory 提示词 */
export const memoryPrompts = {
  consolidation: consolidationPrompt,
  compression: compressionPrompt,
};

// 注册
import { promptRegistry } from '../registry.js';
promptRegistry.register(consolidationPrompt);
promptRegistry.register(compressionPrompt);
