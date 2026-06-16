/**
 * S3 Syntopical Reading System Prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/utils.js' instead.
 */

export { syntopicalPrompt } from '../../prompts/core/syntopical.js';

import { syntopicalPrompt } from '../../prompts/core/syntopical.js';
import type { SyntopicalBookResult } from '../../utils/syntopical-search.js';

export function buildSyntopicalSystemPrompt(): string {
  return syntopicalPrompt.locales.zh.systemPrompt;
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

    for (const r of book.results.slice(0, 3)) {
      for (const block of r.matchedBlocks.slice(0, 2)) {
        const cleanBlockId = block.blockId.replace(/^\^/, '');
        contextBlock += `【${r.fileName}#^${cleanBlockId}】\n${block.content.slice(0, 400)}\n\n`;
      }
    }

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
