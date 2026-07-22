/**
 * 轻量 E2E: Summary & DocDescription 导出验证
 *
 * 对比: tests/e2e/specs/summary-description.e2e.ts (286 行 WDIO)
 * 用 mock 摘要验证 exportToObsidian 的摘要/MOC 生成结构
 * 无需 LLM
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const EPUB_FILE = 'AI工程大模型应用开发实战.epub';

export default {
	id: 'summary-description',
	name: 'Summary & DocDescription 导出',
	feature: 'F-04',
	timeout: 180_000,
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

		// ===== parseEpub 获取章节标题 =====
		let chapterTitles;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];
					return plugin.api.parseEpub(${JSON.stringify(fullPath)}).then(r => ({
						chapters: r.chapters.map(c => ({ id: c.id, title: c.title }))
					}));
				})()`, { timeout: 30_000 });

				if (!result?.chapters?.length) {
					throw new Error(`parseEpub 无章节: ${JSON.stringify(result)?.slice(0, 100)}`);
				}

				chapterTitles = result.chapters.map(c => c.title).filter(Boolean);
				pass('parseEpub 章节标题', Date.now() - t0,
					`chapters=${chapterTitles.length}`);
			} catch (e) {
				fail('parseEpub 章节标题', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== exportToObsidian + mock summaries =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];

					// 构建 mock summaries
					const titles = ${JSON.stringify(chapterTitles.slice(0, 5))};
					const summaries = {};
					for (const t of titles) {
						summaries[t] = '这是' + t + '章节的模拟摘要，用于验证导出结构。';
					}
					const docDesc = '这是一本关于金钱与公正的书籍，探讨了市场道德边界的问题。';

					return plugin.api.exportToObsidian(${JSON.stringify(fullPath)}, {
						outputDir: ${JSON.stringify(basePath)},
						includeIndex: true,
						docDescription: docDesc,
						nodeSummaries: JSON.stringify(summaries),
					});
				})()`, { timeout: 120_000 });

				if (!result || !(result.notesCount > 0)) {
					throw new Error(`exportToObsidian: notesCount=${result?.notesCount}`);
				}

				pass('exportToObsidian', Date.now() - t0, `notes=${result.notesCount}`);
			} catch (e) {
				fail('exportToObsidian', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== 验证 summary callout =====
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
					let notesWithCallout = 0;
					for (const f of chapterFiles) {
						const content = f.stat ? null : null;
					}
					// 读文件检查 callout
					return (async () => {
						let withCallout = 0;
						for (const f of chapterFiles.slice(0, 10)) {
							try {
								const content = await app.vault.read(f);
								if (content.includes('[!summary]')) withCallout++;
							} catch {}
						}
						return { total: chapterFiles.length, withCallout };
					})();
				})()`, { timeout: 30_000 });

				if (!(result?.withCallout > 0)) {
					throw new Error(`无 summary callout: ${JSON.stringify(result)}`);
				}

				pass('summary callout', Date.now() - t0,
					`files=${result.total}, withCallout=${result.withCallout}`);
			} catch (e) {
				fail('summary callout', Date.now() - t0, e);
			}
		}

		// ===== 验证 MOC 结构 =====
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
						return {
							exists: true,
							hasType: content.includes('type: epub-moc'),
							hasToc: content.includes('## 目录'),
							hasAuthor: content.includes('**作者:**'),
							hasDocDesc: content.includes('金钱与公正'),
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('MOC 文件不存在');
				const missing = [];
				if (!result.hasType) missing.push('type: epub-moc');
				if (!result.hasToc) missing.push('## 目录');
				if (!result.hasAuthor) missing.push('**作者:**');
				if (!result.hasDocDesc) missing.push('docDescription');
				if (missing.length > 0) throw new Error(`MOC 缺少: ${missing.join(', ')}`);

				pass('MOC 结构', Date.now() - t0);
			} catch (e) {
				fail('MOC 结构', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
