/**
 * PI Skill 上下文构造
 *
 * 从当前阅读状态构造 PiSkillContext，扫描 vault skills 目录。
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { PiSkillContext } from './types.js';
import { resolvePiPaths } from './pi-config.js';

/**
 * 扫描 vault skills 目录，提取每个 skill 的名称和描述
 */
export async function scanSkillDescriptions(app: App): Promise<string[]> {
	const paths = resolvePiPaths(app);
	const descriptions: string[] = [];

	try {
		const files = await app.vault.adapter.list(paths.skillsDir);
		for (const filePath of files.files) {
			if (!filePath.endsWith('.md')) continue;
			const content = await app.vault.adapter.read(filePath);
			const name = filePath.split('/').pop()?.replace('.md', '') ?? '';
			const desc = extractDescription(content);
			descriptions.push(`${name}: ${desc}`);
		}
	} catch {
		// skills 目录可能不存在
	}

	return descriptions;
}

/**
 * 生成输出文件路径
 */
export function generateOutputPath(app: App, skillName: string, bookTitle: string): string {
	const paths = resolvePiPaths(app);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
	const safeName = bookTitle.replace(/[<>:"/\\|?*]/g, '_').substring(0, 30);
	return normalizePath(`${paths.exportsDir}/${safeName}-${skillName}-${timestamp}.md`);
}

/**
 * 构造完整的 PiSkillContext
 */
export function buildSkillContext(options: {
	book: { title: string; author: string };
	currentSection: string;
	analysisSummary: string;
	userRequest: string;
	skillDescriptions: string[];
	outputPath: string;
}): PiSkillContext {
	return {
		book: options.book,
		context: {
			currentSection: options.currentSection,
			analysisSummary: options.analysisSummary,
		},
		skillDescriptions: options.skillDescriptions,
		outputPath: options.outputPath,
		userRequest: options.userRequest,
	};
}

/**
 * 从 markdown 文件内容提取 description
 * 优先读取 YAML frontmatter 中的 description，否则取第一个非空段落
 */
function extractDescription(content: string): string {
	// 尝试解析 YAML frontmatter
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (fmMatch) {
		const descMatch = fmMatch[1].match(/description:\s*(.+)/);
		if (descMatch) return descMatch[1].trim();
	}

	// 取第一个非标题非空行
	const lines = content.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.startsWith('-')) {
			return trimmed.substring(0, 100);
		}
	}

	return '';
}
