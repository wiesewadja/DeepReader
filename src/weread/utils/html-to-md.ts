/**
 * HTML → Markdown 转换封装
 */

import { NodeHtmlMarkdown } from 'node-html-markdown';

const converter = new NodeHtmlMarkdown();

/**
 * 将 HTML 内容转换为 Markdown
 */
export function htmlToMarkdown(html: string): string {
	if (!html) return '';
	return converter.translate(html).trim();
}
