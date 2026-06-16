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
