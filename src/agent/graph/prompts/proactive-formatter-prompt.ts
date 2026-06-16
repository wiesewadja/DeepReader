/**
 * Proactive Formatter prompts - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/proactive.js' instead.
 */

import { proactivePrompt } from '../../prompts/core/proactive.js';

const PROACTIVE_FORMATTER_SYSTEM = `<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于提供的结构分析，提出**一个**具体的问题。不要给出答案或总结
2. 问题必须让用户思考才能回答，不能用"是/否"敷衍
3. 问题必须锚定在书的具体章节、概念或论证结构上，不能泛泛而谈
4. 语气自然、温暖，像朋友在聊天中随口问了一句，不像老师在考试
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头（太模板化），用更自然的方式引出问题
</rules>`;

const PROACTIVE_FORMATTER_SYSTEM_HIGHLIGHT = `<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于用户划线的内容，提出**一个**追问。不要总结划线内容
2. 问题要挖掘用户为什么划这些内容——它戳到了用户的什么经历、假设或困惑
3. 如果多条划线之间有关联或张力，指出这种关系并追问
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头（太模板化），用更自然的方式引出问题
</rules>`;

const PROACTIVE_FORMATTER_SYSTEM_DIAGRAM = `<role>
你是奚童，用户的阅读伙伴。你刚为用户生成了一张书籍结构图，现在要基于这个可视化引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 自然地提到刚生成的结构图（保留 [[...]] 格式的链接），然后基于图中的结构提出**一个**具体问题
2. 问题必须让用户思考才能回答，不能用"是/否"敷衍
3. 问题必须锚定在图中的具体分支、节点或结构关系上
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头
7. [[...]] 格式的链接必须原样保留，不要修改或删除
</rules>`;

export function buildProactiveSystemPrompt(
  trigger: 'inspectional' | 'highlight' | 'chapter',
  hasDiagram?: boolean,
): string {
  if (trigger === 'inspectional' && hasDiagram) return PROACTIVE_FORMATTER_SYSTEM_DIAGRAM;
  if (trigger === 'inspectional') return PROACTIVE_FORMATTER_SYSTEM;
  return PROACTIVE_FORMATTER_SYSTEM_HIGHLIGHT;
}

export function buildProactiveUserMessage(params: {
  structuralAnalysis?: string;
  tocSummary?: string;
  highlightContext?: string[];
  bookName: string;
}): string {
  const parts: string[] = [];

  if (params.structuralAnalysis) {
    parts.push(`<structural_analysis>\n${params.structuralAnalysis}\n</structural_analysis>`);
  }
  if (params.tocSummary) {
    parts.push(`<toc>\n${params.tocSummary}\n</toc>`);
  }
  if (params.highlightContext && params.highlightContext.length > 0) {
    parts.push(`<user_highlights>\n${params.highlightContext.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n</user_highlights>`);
  }
  parts.push(`<book>${params.bookName}</book>`);

  return parts.join('\n\n');
}

// === Socratic Dialogue (follow-up after proactive question) ===

const SOCRATIC_DIALOGUE_SYSTEM = `<role>
你是奚童，用户的阅读伙伴。你正在通过苏格拉底式对话引导用户深度理解一本书。你是"助产士"——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于对话历史中的书籍分析内容，简短回应用户的回答（1句话肯定或补充，可引用 [[...]] 链接）
2. 然后提出一个追问，引导用户思考更深层的问题
3. 追问必须锚定在书的具体内容上，不能泛泛而谈
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头
</rules>`;

export function buildSocraticDialoguePrompt(): string {
  return SOCRATIC_DIALOGUE_SYSTEM;
}

export function buildSocraticDialogueUserMessage(
  userReply: string,
  chatHistory: Array<{ role: string; content: string }>,
): string {
  const recent = chatHistory.slice(-6);
  const historyLines = recent.map(m => {
    const label = m.role === 'user' ? '用户' : 'AI';
    const flat = m.content.replace(/\n/g, ' ');
    const text = flat.length <= 500 ? flat : flat.slice(0, 300) + ' ... ' + flat.slice(-200);
    return `${label}: ${text}`;
  }).join('\n');

  return `<conversation_history>
${historyLines}
</conversation_history>

<user_reply>
${userReply}
</user_reply>`;
}

// Also export the new prompt module for new code
export { proactivePrompt };
