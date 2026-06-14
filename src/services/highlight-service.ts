import { Notice, type App } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata } from '../types/excerpt.js';
import type { HighlightColorId } from '../types/highlight.js';
import { log, error as logError } from '../utils/logger.js';
import { findTextInMarkdown } from '../utils/markdown-utils.js';
import { ExcerptService } from './excerpt-service.js';

const HIGHLIGHT_COLORS: Record<HighlightColorId, string> = {
	yellow: 'rgba(255, 235, 59, 0.4)',
	green: 'rgba(76, 175, 80, 0.4)',
	blue: 'rgba(33, 150, 243, 0.4)',
	pink: 'rgba(233, 30, 99, 0.4)',
	orange: 'rgba(255, 152, 0, 0.4)',
};

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitFrontmatter(content: string): { frontmatter: string; body: string; hasFrontmatter: boolean } {
	const match = content.match(/^(---\n[\s\S]*?\n---)(\n*)/);
	if (match) {
		return { frontmatter: match[0], body: content.slice(match[0].length), hasFrontmatter: true };
	}
	return { frontmatter: '', body: content, hasFrontmatter: false };
}

function getHighlightBgColor(color: HighlightColorId): string {
	return HIGHLIGHT_COLORS[color] || HIGHLIGHT_COLORS.yellow;
}

function findBlockIdNearText(content: string, position: number): string | null {
	const forward = content.substring(position, Math.min(position + 500, content.length));
	const fwdMatch = forward.match(/\^([a-zA-Z0-9_-]+)/);
	if (fwdMatch) return fwdMatch[1];

	const backward = content.substring(Math.max(0, position - 500), position);
	const bwdMatch = backward.match(/\^([a-zA-Z0-9_-]+)/);
	if (bwdMatch) return bwdMatch[1];

	return null;
}

function findHighlightColor(body: string, text: string): { bgColor: string; matchedText: string } | null {
	const exactRegex = new RegExp(`<mark style="background: ([^"]*)">${escapeRegex(text)}</mark>`, 's');
	const exactMatch = body.match(exactRegex);
	if (exactMatch) return { bgColor: exactMatch[1], matchedText: text };

	const matchResult = findTextInMarkdown(body, text);
	if (matchResult) {
		const fuzzyRegex = new RegExp(`<mark style="background: ([^"]*)">${escapeRegex(matchResult.matched)}</mark>`, 's');
		const fuzzyMatch = body.match(fuzzyRegex);
		if (fuzzyMatch) return { bgColor: fuzzyMatch[1], matchedText: matchResult.matched };
	}

	return null;
}

function removeAdjacentHighlights(body: string, bgColor: string): string {
	const escapedBgColor = escapeRegex(bgColor);
	const lines = body.split('\n');
	return lines.map(line => {
		const regex = new RegExp(`<mark style="background: ${escapedBgColor}">([^<]+)</mark>`, 'g');
		return regex.test(line) ? line.replace(regex, '$1') : line;
	}).join('\n');
}

export class HighlightService {
	constructor(private app: App, private excerptService: ExcerptService) {}

	async saveHighlight(text: string, color: HighlightColorId): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("无法保存高亮：没有活动文件");
			return;
		}

		try {
			const content = await this.app.vault.read(activeFile);
			const { frontmatter, body, hasFrontmatter } = splitFrontmatter(content);
			const bgColor = getHighlightBgColor(color);

			const lines = text.split('\n').filter(line => line.trim().length > 0);
			let newBody = body;
			let highlightedCount = 0;

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				const matchResult = findTextInMarkdown(newBody, trimmed);
				if (matchResult) {
					const highlighted = `<mark style="background: ${bgColor}">${trimmed}</mark>`;
					newBody = newBody.substring(0, matchResult.index) + highlighted + newBody.substring(matchResult.index + matchResult.matched.length);
					highlightedCount++;
				}
			}

			if (highlightedCount === 0) {
				new Notice("无法保存高亮：未找到文本");
				return;
			}

			const newContent = hasFrontmatter ? frontmatter + newBody : newBody;
			await this.app.vault.modify(activeFile, newContent);
			log('[DeepPDF] Highlight saved:', highlightedCount, 'lines');

			await this.saveHighlightToExcerpt(text, color, activeFile, null);
		} catch (err) {
			logError('[DeepPDF] Failed to save highlight:', err);
			new Notice("保存高亮失败");
		}
	}

	async removeHighlight(text: string): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		try {
			const content = await this.app.vault.read(activeFile);
			const { frontmatter, body, hasFrontmatter } = splitFrontmatter(content);

			const colorInfo = findHighlightColor(body, text);
			if (!colorInfo) {
				log('[DeepPDF] No highlight found for text');
				return;
			}

			const { bgColor, matchedText } = colorInfo;
			const currentMarkRegex = new RegExp(`<mark style="background: ${escapeRegex(bgColor)}">${escapeRegex(matchedText)}</mark>`, 's');
			let newBody = body.replace(currentMarkRegex, matchedText);
			newBody = removeAdjacentHighlights(newBody, bgColor);

			const newContent = hasFrontmatter ? frontmatter + newBody : newBody;
			await this.app.vault.modify(activeFile, newContent);
			log('[DeepPDF] Highlight removed from file');
		} catch (err) {
			logError('[DeepPDF] Failed to remove highlight:', err);
		}
	}

	private async saveHighlightToExcerpt(text: string, color: HighlightColorId, activeFile: any, blockId: string | null): Promise<void> {
		try {
			const cache = this.app.metadataCache.getFileCache(activeFile);
			let bookName = cache?.frontmatter?.pdf_name || '';

			if (!bookName) {
				const pathParts = activeFile.path.split('/');
				if (pathParts.length >= 2) {
					bookName = pathParts[0] === 'DeepReader' ? pathParts[1] : pathParts[0];
				} else {
					bookName = activeFile.basename;
				}
			}

			const excerptContent: ExcerptContent = { text: text.trim() };
			const metadata: ExcerptMetadata = {
				sourcePdf: bookName,
				createdAt: new Date().toISOString(),
				sourceType: 'reading',
				chapterPath: activeFile.path,
				chapterName: activeFile.basename,
				blockId: blockId || undefined,
				excerptType: 'highlight',
				highlightColor: color,
			};

			const savedPath = await this.excerptService.saveExcerpt(excerptContent, metadata);
			if (savedPath) {
				log('[DeepPDF] Highlight saved to excerpt file:', savedPath);
			}
		} catch (err) {
			logError('[DeepPDF] Failed to save highlight to excerpt:', err);
		}
	}
}
