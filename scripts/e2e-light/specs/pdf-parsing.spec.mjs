/**
 * 轻量 E2E: PDF 解析质量
 *
 * 对比: tests/e2e/specs/pdf-parsing.e2e.ts (331 行 WDIO)
 * 验证 parsePdf() 文本提取质量：页面切分、标题检测、段落分段、中文、大纲
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const PDF_FILE = '69fe2a55b93bb0732b1fe33c_The-Founders-Playbook-05062026_v3 (1).pdf';

export default {
	id: 'pdf-parsing',
	name: 'PDF 解析质量',
	feature: 'F-01',
	timeout: 120_000,
	requires: {
		files: [PDF_FILE],
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

		// 获取 vault 路径
		const basePath = await evalObsidian('app.vault.adapter.basePath');

		// ===== parsePdf 基本结构 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					return plugin.api.parsePdf(${JSON.stringify(basePath + '/' + PDF_FILE)});
				})()`, { timeout: 60_000 });

				if (result.error) throw new Error(`parsePdf error: ${result.error}`);
				if (!result.title) throw new Error('title 为空');
				if (!(result.totalPages > 0)) throw new Error(`totalPages=${result.totalPages}`);
				if (!(result.pageCount > 0)) throw new Error(`pageCount=${result.pageCount}`);

				pass('parsePdf 基本结构', Date.now() - t0,
					`title=${result.title?.slice(0, 30)}, pages=${result.totalPages}`);
			} catch (e) {
				fail('parsePdf 基本结构', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== 标题检测 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					const r = plugin.api.parsePdf(${JSON.stringify(basePath + '/' + PDF_FILE)});
					if (r.error) return { error: r.error };
					let headingLines = 0;
					let totalLines = 0;
					for (const page of (r.pages || []).slice(0, 10)) {
						for (const line of (page.text || '').split('\\n')) {
							totalLines++;
							if (/^#{1,3}\\s+/.test(line)) headingLines++;
						}
					}
					return { foundHeading: headingLines > 0, headingLines, totalLines };
				})()`, { timeout: 60_000 });

				if (result.error) throw new Error(result.error);
				if (!result.foundHeading) throw new Error('未检测到 Markdown 标题');

				pass('标题检测', Date.now() - t0, `headings=${result.headingLines}/${result.totalLines}`);
			} catch (e) {
				fail('标题检测', Date.now() - t0, e);
			}
		}

		// ===== 段落分段 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					const r = plugin.api.parsePdf(${JSON.stringify(basePath + '/' + PDF_FILE)});
					if (r.error) return { error: r.error };
					let hasBreak = false;
					let maxLen = 0;
					for (const page of (r.pages || [])) {
						const text = page.text || '';
						if (text.includes('\\n\\n')) hasBreak = true;
						for (const line of text.split('\\n')) {
							if (line.length > maxLen) maxLen = line.length;
						}
					}
					return { hasParagraphBreak: hasBreak, maxLineLength: maxLen };
				})()`, { timeout: 60_000 });

				if (result.error) throw new Error(result.error);
				if (!result.hasParagraphBreak) throw new Error('段落间无空行');
				if (result.maxLineLength >= 300) throw new Error(`行过长: ${result.maxLineLength}`);

				pass('段落分段', Date.now() - t0, `maxLine=${result.maxLineLength}`);
			} catch (e) {
				fail('段落分段', Date.now() - t0, e);
			}
		}

		// ===== 中文提取 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					const r = plugin.api.parsePdf(${JSON.stringify(basePath + '/' + PDF_FILE)});
					if (r.error) return { error: r.error };
					const pages = r.pages || [];
					let nonEmpty = 0;
					let hasChinese = false;
					for (const p of pages.slice(0, 5)) {
						const text = p.text || '';
						if (text.length > 50) nonEmpty++;
						if (/[一-鿿]/.test(text)) hasChinese = true;
					}
					const contentRatio = nonEmpty / Math.max(pages.slice(0, 5).length, 1);
					return { hasChinese, contentRatio };
				})()`, { timeout: 60_000 });

				if (result.error) throw new Error(result.error);
				if (!result.hasChinese) throw new Error('未检测到中文字符');
				if (result.contentRatio <= 0.8) throw new Error(`内容比率=${result.contentRatio.toFixed(2)}`);

				pass('中文提取', Date.now() - t0, `ratio=${result.contentRatio.toFixed(2)}`);
			} catch (e) {
				fail('中文提取', Date.now() - t0, e);
			}
		}

		// ===== 页面数据有效性 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					const r = plugin.api.parsePdf(${JSON.stringify(basePath + '/' + PDF_FILE)});
					if (r.error) return { error: r.error };
					const pages = r.pages || [];
					let validCount = 0;
					let totalTokens = 0;
					for (const p of pages) {
						const hasPage = typeof p.pageNumber === 'number';
						const hasText = typeof p.text === 'string';
						const hasTokens = typeof p.tokenCount === 'number';
						if (hasPage && hasText && hasTokens) validCount++;
						totalTokens += (p.tokenCount || 0);
					}
					return { totalPages: pages.length, validCount, totalTokens };
				})()`, { timeout: 60_000 });

				if (result.error) throw new Error(result.error);
				if (result.totalPages !== result.validCount) {
					throw new Error(`有效页=${result.validCount}/${result.totalPages}`);
				}
				if (!(result.totalTokens > 0)) throw new Error('totalTokens=0');

				pass('页面数据有效性', Date.now() - t0,
					`pages=${result.totalPages}, tokens=${result.totalTokens}`);
			} catch (e) {
				fail('页面数据有效性', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
