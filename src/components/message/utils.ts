/**
 * Message 组件工具函数
 */

import { uiLog as log } from '../../utils/logger.js';

/**
 * Sanitize HTML for safe innerHTML rendering.
 * Strips dangerous tags, event handlers, and script URLs.
 */
export function sanitizeHumanizedHtml(html: string): string {
	let result = html;

	// Remove dangerous tags and their content
	result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
	result = result.replace(/<script\b[^>]*\/?>/gi, '');
	result = result.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
	result = result.replace(/<iframe\b[^>]*\/?>/gi, '');
	result = result.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
	result = result.replace(/<embed\b[^>]*\/?>/gi, '');
	result = result.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '');
	result = result.replace(/<meta\b[^>]*\/?>/gi, '');
	result = result.replace(/<link\b[^>]*\/?>/gi, '');
	result = result.replace(/<base\b[^>]*\/?>/gi, '');

	// Remove event handler attributes (onclick, onerror, onload, etc.)
	result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

	// Remove javascript: and data: URLs in src/href/action
	result = result.replace(/(src|href|action)\s*=\s*["']?\s*(?:javascript|data)\s*:[^"'\s>]*/gi, '$1=""');

	return result;
}

/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
	if (!text) return '';
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(isoString: string): string {
	try {
		const date = new Date(isoString);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	} catch (e) {
		return '';
	}
}

/**
 * 从 Markdown 内容中提取特定块引用的内容
 */
export function extractSectionByBlockRef(content: string, blockRef: string): string {
	const lines = content.split('\n');

	// 查找块引用的位置 ^blockRef
	const blockRefPattern = new RegExp(`^\\^${blockRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
	let blockIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		if (blockRefPattern.test(lines[i])) {
			blockIndex = i;
			break;
		}
	}

	// 如果找到块引用，提取从块引用到下一个标题或块引用之间的内容
	if (blockIndex !== -1) {
		const sectionLines: string[] = [];

		for (let i = blockIndex + 1; i < lines.length; i++) {
			const line = lines[i];
			if (/^#+\s/.test(line) || /^\^\w+/.test(line)) {
				break;
			}
			sectionLines.push(line);
		}

		const result = sectionLines.join('\n').trim();
		log('[extractSectionByBlockRef] Found block ref at index:', blockIndex);
		log('[extractSectionByBlockRef] Extracted lines:', sectionLines.length);
		return result;
	}

	// 如果没有找到块引用，尝试查找包含页码信息的标题
	const pageMatch = blockRef.match(/page-(\d+)/);
	if (pageMatch) {
		const pageNumber = parseInt(pageMatch[1]);
		const pagePattern = new RegExp(`^#+\\s*第\\s*${pageNumber}\\s*页`, 'm');

		for (let i = 0; i < lines.length; i++) {
			if (pagePattern.test(lines[i])) {
				const sectionLines: string[] = [lines[i]];

				for (let j = i + 1; j < lines.length; j++) {
					const line = lines[j];
					if (/^#+\s/.test(line)) {
						break;
					}
					sectionLines.push(line);
				}

				return sectionLines.join('\n').trim();
			}
		}
	}

	return '';
}
