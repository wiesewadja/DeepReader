/**
 * PiContext 单元测试
 */

import { describe, it, expect } from 'vitest';
import { buildSkillContext, generateOutputPath } from '../pi-context.js';
import { scanSkillDescriptions, resolvePiPaths } from '../pi-config.js';

describe('PiContext', () => {
	describe('buildSkillContext', () => {
		it('应构造完整的 PiSkillContext', () => {
			const ctx = buildSkillContext({
				book: { title: '《深度学习》', author: 'Ian Goodfellow' },
				currentSection: '第1章 引言',
				analysisSummary: '本章介绍了深度学习的定义',
				userRequest: '画个思维导图',
				skillDescriptions: ['topic-mindmap: 主题思维导图'],
				outputPath: 'DeepReader/exports/test.md',
			});

			expect(ctx.book.title).toBe('《深度学习》');
			expect(ctx.context.currentSection).toBe('第1章 引言');
			expect(ctx.userRequest).toBe('画个思维导图');
			expect(ctx.skillDescriptions).toHaveLength(1);
		});
	});

	describe('generateOutputPath', () => {
		it('应生成包含书名和 skill 名的路径', () => {
			const mockApp = {
				vault: {
					adapter: {
						basePath: '/test-vault',
					},
				},
			} as any;

			const path = generateOutputPath(mockApp, 'topic-mindmap', '深度学习');
			expect(path).toContain('DeepReader/exports');
			expect(path).toContain('深度学习');
			expect(path).toContain('topic-mindmap');
			expect(path).toContain('.md');
		});

		it('应清理文件名中的特殊字符', () => {
			const mockApp = {
				vault: {
					adapter: {
						basePath: '/test-vault',
					},
				},
			} as any;

			const path = generateOutputPath(mockApp, 'skill', 'Book: A/B<Test>');
			expect(path).not.toContain(':');
			expect(path).not.toContain('<');
			expect(path).toContain('_');
		});
	});
});
