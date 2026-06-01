/**
 * 轻量 E2E: EPUB 解析质量
 *
 * 对比: tests/e2e/specs/epub-parsing-quality.e2e.ts (226 行 WDIO)
 * 验证 parseEpub() 页面切分质量、标题污染检测
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const EPUB_FILE = 'DeepReader/assets/疯传：让你的产品、思想、行为像病毒一样入侵 (乔纳·伯杰 (Jonah Berger)) (z-library.sk, 1lib.sk, z-lib.sk).epub';

export default {
	id: 'epub-parsing-quality',
	name: 'EPUB 解析质量',
	feature: 'F-02',
	timeout: 60_000,
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

		// ===== parseEpub 基本结构 =====
		let chapters;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					return plugin.api.parseEpub(${JSON.stringify(fullPath)});
				})()`, { timeout: 30_000 });

				if (!result || !result.chapters || result.chapters.length === 0) {
					throw new Error(`parseEpub 返回异常: chapters=${result?.chapters?.length}`);
				}

				chapters = result.chapters;
				pass('parseEpub 基本结构', Date.now() - t0,
					`chapters=${chapters.length}, title=${result.title?.slice(0, 20)}`);
			} catch (e) {
				fail('parseEpub 基本结构', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== 章节标题污染检测 =====
		{
			const t0 = Date.now();
			try {
				const polluted = [];
				for (let i = 0; i < chapters.length; i++) {
					const ch = chapters[i];
					const text = ch.content || ch.text || '';
					const lines = text.split('\n').filter(l => l.trim());
					let headingLines = 0;
					let totalLines = 0;
					for (const line of lines) {
						totalLines++;
						if (/^###\s/.test(line.trim())) headingLines++;
					}
					const ratio = headingLines / Math.max(totalLines, 1);
					if (ratio >= 0.5) {
						polluted.push(`ch${i}("${ch.title?.slice(0, 15)}"): ratio=${ratio.toFixed(2)}`);
					}
				}
				if (polluted.length > 0) {
					throw new Error(`标题污染章节: ${polluted.join('; ')}`);
				}
				pass('标题污染检测', Date.now() - t0, `checked=${chapters.length} chapters`);
			} catch (e) {
				fail('标题污染检测', Date.now() - t0, e);
			}
		}

		// ===== 章节内容质量 =====
		{
			const t0 = Date.now();
			try {
				let emptyChapters = 0;
				let totalChars = 0;
				for (const ch of chapters) {
					const text = ch.content || ch.text || '';
					if (text.trim().length < 50) emptyChapters++;
					totalChars += text.length;
				}
				if (emptyChapters > chapters.length * 0.5) {
					throw new Error(`空章节过多: ${emptyChapters}/${chapters.length}`);
				}
				pass('章节内容质量', Date.now() - t0,
					`total=${totalChars} chars, empty=${emptyChapters}/${chapters.length}`);
			} catch (e) {
				fail('章节内容质量', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
