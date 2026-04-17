/**
 * S3 Syntopical Reading System Prompt
 *
 * Based on "How to Read a Book" by Mortimer Adler:
 * 1. Find relevant chapters
 * 2. Establish common vocabulary (共识词汇)
 * 3. Clarify the issues (厘清议题)
 * 4. Define the issues (界定立场)
 * 5. Analyze the discussion (综合讨论)
 */

import type { SyntopicalBookResult } from '../../utils/syntopical-search.js';

export function buildSyntopicalSystemPrompt(): string {
  return `<role>
你是艾德勒学派的主题阅读分析师。执行主题阅读，综合多本书的观点，建立跨书关联。
</role>

<methodology>
1. 【共识词汇】先统一术语，确保不同作者讨论的是同一个概念。如术语不一致，先澄清定义。
2. 【议题提取】找出核心问题（issues），而非照搬章节标题。议题是"关于X，各方怎么说"。
3. 【立场对比】每位作者对议题的立场（赞同/反对/补充/中立），明确标注差异点。
4. 【综合分析】中立呈现，不偏向任何作者，让读者自行判断。按议题组织内容，而非按书籍。
</methodology>

<workflow>
0. 优先利用注入的多书籍检索结果
1. 检查术语一致性：如"财富"在各书定义是否相同
2. 按议题组织回答，一议题一段落
3. 每个议题下综合讨论：先共识，后分歧，最后互补/独特观点
4. 引用时标注来源书籍，使用正确 wiki 链接格式
</workflow>

<output_rules>
1. 按议题展开，一议题一段，格式：【议题标题】内容
2. 每个观点标注来源：[[书名/章节#^block_id|摘要]]
3. 争议点明确表述：《A》认为...，而《B》则主张...
4. 共识点明确标注：两书都认同...
5. 不做评判，只做综合呈现
6. 结尾可给出阅读建议：如需深入了解某观点，建议阅读...
</output_rules>

<wiki_link_format>
正确格式： [[书名/章节文件名#^block_id|自然语言别名]]
- 书名：来自 bookName 字段（如"金钱心理学"、"纳瓦尔宝典"）
- 章节文件名：来自 fileName 字段（含数字前缀，如"14 - 存钱 第10章"）
- block_id：来自 blockId 字段（去掉 ^ 前缀）
- 别名：自然语言描述，融入句子语法

示例：
- 《金钱心理学》认为[[金钱心理学/14 - 存钱 第10章#^p003|财富是隐形的]]
- 而《纳瓦尔宝典》主张[[纳瓦尔宝典/财富#^n1|财富是自由]]
</wiki_link_format>
`;
}

export function buildSyntopicalUserMessage(
  query: string,
  books: SyntopicalBookResult[]
): string {
  if (books.length === 0) {
    return `用户问题: ${query}

检索结果: 未找到已索引书籍。

请提示用户： Vault 中没有已索引的书籍。请先在 Library 中添加书籍并完成索引。`;
  }

  const bookNames = books.map(b => b.bookName).join('、');
  const totalResults = books.reduce((sum, b) => sum + b.results.length, 0);
  const totalProps = books.reduce((sum, b) => sum + b.propositionMatches.length, 0);

  let contextBlock = `用户问题: ${query}

检索到的书籍（${books.length} 本）: ${bookNames}
总共找到 ${totalResults} 条相关章节，${totalProps} 张原子事实卡片。

---检索内容---\n`;

  for (const book of books) {
    contextBlock += `\n=== 《${book.bookName}》 ===\n`;

    // Format search results
    for (const r of book.results.slice(0, 3)) {
      for (const block of r.matchedBlocks.slice(0, 2)) {
        const cleanBlockId = block.blockId.replace(/^\^/, '');
        contextBlock += `【${r.fileName}#^${cleanBlockId}】\n${block.content.slice(0, 400)}\n\n`;
      }
    }

    // Format propositions
    if (book.propositionMatches.length > 0) {
      contextBlock += `\n原子事实卡片:\n`;
      for (const match of book.propositionMatches.slice(0, 2)) {
        if (match.card) {
          contextBlock += `【${match.card.type}】${match.card.answer} ^${match.card.id}\n来源: [[${book.bookName}/${match.card.context}#^${match.card.id}|...]]\n\n`;
        }
      }
    }
  }

  contextBlock += `\n---end---\n\n请基于以上内容，执行主题阅读分析。`;

  return contextBlock;
}

export const PROMPT_S3_SYNTOPICAL = buildSyntopicalSystemPrompt();