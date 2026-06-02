/**
 * 轻量 E2E: EPUB 索引+导出
 *
 * 对比: tests/e2e/specs/epub-index-export.e2e.ts (236 行 WDIO)
 * 验证 parseEpub + exportToObsidian 全链路
 * 无需 LLM
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const EPUB_FILE = '金钱不能买什么：金钱与公正的正面交锋 = What Money Cant Buy The Moral Limits of Markets ([美] 迈克尔 · 桑德尔 (Michael J. Sandel) 著  邓正来 译) (z-library.sk, 1lib.sk, z-lib.sk).epub';

export default {
	id: 'epub-index-export',
	name: 'EPUB 索引+导出',
	feature: 'F-02/04',
	timeout: 120_000,
	requires: {
		files: [EPUB_FILE],
	},

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		const basePath = await evalObsidian('app.vault.adapter.basePath');
		const fullPath = basePath + '/' + EPUB_FILE;

		// ===== parseEpub 元数据 =====
		let chapters;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];
					return plugin.api.parseEpub(${JSON.stringify(fullPath)});
				})()`, { timeout: 30_000 });

				if (!result?.title) throw new Error('title 为空');
				if (!result?.chapters?.length) throw new Error('无章节');
				if (typeof result.author !== 'string' || !result.author) {
					throw new Error(`author 类型错误: ${typeof result.author} = ${result.author}`);
				}

				chapters = result.chapters;
				pass('parseEpub 元数据', Date.now() - t0,
					`title=${result.title?.slice(0, 20)}, author=${result.author?.slice(0, 10)}, ch=${chapters.length}`);
			} catch (e) {
				fail('parseEpub 元数据', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== exportToObsidian =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];
					return plugin.api.exportToObsidian(${JSON.stringify(fullPath)}, {
						outputDir: ${JSON.stringify(basePath)},
						includeIndex: true,
					});
				})()`, { timeout: 60_000 });

				if (!result || !(result.notesCount > 0)) {
					throw new Error(`notesCount=${result?.notesCount}`);
				}

				pass('exportToObsidian', Date.now() - t0, `notes=${result.notesCount}`);
			} catch (e) {
				fail('exportToObsidian', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== MOC 文件结构 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const files = app.vault.getMarkdownFiles();
					const mocFiles = files.filter(f =>
						f.path.includes('MOC') && !f.path.startsWith('.obsidian')
					);
					if (mocFiles.length === 0) return { exists: false };
					return (async () => {
						const content = await app.vault.read(mocFiles[0]);
						const authorBug = content.includes('author: [object Object]');
						return {
							exists: true,
							hasType: content.includes('type: epub-moc'),
							hasToc: content.includes('## 目录'),
							hasAuthor: /\*\*作者:\*\* .+/.test(content),
							noAuthorBug: !authorBug,
							hasWikiLinks: /\[\[.*\]\]/.test(content),
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('MOC 文件不存在');
				const missing = [];
				if (!result.hasType) missing.push('type: epub-moc');
				if (!result.hasToc) missing.push('## 目录');
				if (!result.hasAuthor) missing.push('**作者:**');
				if (!result.noAuthorBug) missing.push('author:[object Object] bug');
				if (!result.hasWikiLinks) missing.push('wiki links');
				if (missing.length > 0) throw new Error(`MOC 缺少: ${missing.join(', ')}`);

				pass('MOC 结构', Date.now() - t0);
			} catch (e) {
				fail('MOC 结构', Date.now() - t0, e);
			}
		}

		// ===== 章节笔记 frontmatter =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const files = app.vault.getMarkdownFiles();
					const chapterFiles = files.filter(f =>
						f.path.includes('/') &&
						!f.path.startsWith('.obsidian') &&
						!f.path.startsWith('.pageindex') &&
						!f.path.startsWith('DeepReader') &&
						!f.path.includes('MOC') &&
						f.path.endsWith('.md')
					);
					return (async () => {
						let valid = 0;
						let authorBug = false;
						for (const f of chapterFiles.slice(0, 10)) {
							const content = await app.vault.read(f);
							if (!content.startsWith('---')) continue;
							const end = content.indexOf('---', 3);
							if (end < 0) continue;
							const fm = content.slice(0, end);
							if (fm.includes('title:') && fm.includes('type: epub')) valid++;
							if (fm.includes('author: [object Object]')) authorBug = true;
						}
						return { total: chapterFiles.length, valid, authorBug };
					})();
				})()`, { timeout: 15_000 });

				if (!(result?.valid > 0)) throw new Error(`无有效 frontmatter: ${JSON.stringify(result)}`);
				if (result.authorBug) throw new Error('author:[object Object] bug 存在');

				pass('章节 frontmatter', Date.now() - t0, `valid=${result.valid}/${result.total}`);
			} catch (e) {
				fail('章节 frontmatter', Date.now() - t0, e);
			}
		}

		// ===== tree.json 结构 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const files = app.vault.getFiles();
					const treeFile = files.find(f => f.path.endsWith('tree.json') && !f.path.startsWith('.obsidian'));
					if (!treeFile) return { exists: false };
					return (async () => {
						const raw = await app.vault.read(treeFile);
						const tree = JSON.parse(raw);
						return {
							exists: true,
							hasTitle: !!tree.title,
							type: tree.type,
							hasStructure: Array.isArray(tree.structure) && tree.structure.length > 0,
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('tree.json 不存在');
				if (!result.hasTitle) throw new Error('tree.title 为空');
				if (result.type !== 'epub') throw new Error(`tree.type=${result.type}`);
				if (!result.hasStructure) throw new Error('tree.structure 为空');

				pass('tree.json', Date.now() - t0);
			} catch (e) {
				fail('tree.json', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
