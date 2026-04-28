/**
 * Socratic Filter prompts — split S2 analysis into facts+question (hide conclusion)
 */

export const SOCRATIC_SPLIT_PROMPT = `你是一个阅读分析拆分器。将下面的阅读分析拆分为两部分。

规则：
1. "facts"：提取所有具体的证据、引用、数据点（保留原始 wiki 链接 [[...]]）
2. "question"：基于这些证据，提出一个推理问题，让读者自己得出结论
3. "conclusion"：原作者的核心结论和推理过程（暂时隐藏）
4. question 必须锚定在具体证据上，不能泛泛而谈
5. 不要在 facts 中泄露结论

只输出 JSON，不要 markdown 围栏，不要解释。格式: { "facts": "...", "question": "...", "conclusion": "..." }`;
