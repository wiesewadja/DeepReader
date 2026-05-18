/**
 * Callout 解析器 — 从 Markdown 文本中提取用户标注内容
 *
 * 统一处理 DeepReader 原生标注（[!warning]+ 等）和微信读书标注（[!quote]+ / [!note]+），
 * 跳过元数据行（来源链接、页码、分隔线），返回可搜索的纯文本数组。
 */

const CALLOUT_HEADER_RE = /^> \[!([a-z]+)\]/;
const META_LINE_RE = /^(?:---|📍 来源:|📄 页码:)/;

export function parseCallouts(markdown: string): string[] {
	const results: string[] = [];
	const lines = markdown.split('\n');

	let inCallout = false;
	let calloutLines: string[] = [];

	for (const line of lines) {
		if (CALLOUT_HEADER_RE.test(line)) {
			// 新 callout 开始 → 保存前一个
			if (calloutLines.length > 0) {
				results.push(calloutLines.join(' '));
			}
			inCallout = true;
			calloutLines = [];
			continue;
		}

		if (inCallout) {
			if (line.startsWith('>')) {
				// 去掉 `> ` 或 `>` 前缀
				const content = (line.startsWith('> ') ? line.slice(2) : line.slice(1)).trim();
				if (!content || META_LINE_RE.test(content)) continue;
				calloutLines.push(content);
			} else {
				// callout 结束
				if (calloutLines.length > 0) {
					results.push(calloutLines.join(' '));
				}
				inCallout = false;
				calloutLines = [];
			}
		}
	}

	// 文件末尾的 callout
	if (calloutLines.length > 0) {
		results.push(calloutLines.join(' '));
	}

	return results;
}
