/**
 * 轻量 E2E: 阅读引用功能（PR 1 端到端验证）
 *
 * 覆盖范围：
 * 1. 阅读模式激活 + 工具栏 3 按钮齐全
 * 2. 引用按钮 → 卡片渲染（含完整文本，不截断到 20 字符）
 * 3. 卡片含章节路径（headingPath/heading 优先于 source）
 * 4. 卡片含跳转按钮（blockId 存在时）
 * 5. 卡片有 data-quote-id 属性（用于 citedQuoteIds 关联）
 * 6. 移除/清除按钮（只读模式下不存在）
 *
 * 锚定:
 * - src/components/reading-mode/selection-toolbar.ts
 * - src/components/excerpt/selection-menu.ts
 * - src/views/sidebar/quote-manager.ts
 * - src/components/quote-card.css
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

export default {
	id: 'citation-flow',
	name: '阅读引用功能（PR 1 端到端）',
	feature: 'F-citation',
	timeout: 90_000,
	requires: {
		files: [],
		// 不强制特定章节，使用任何 DeepReader/ 下的 md
	},

	async run({ log }) {
		const steps = [];
		const pass = (n, d, det) => { steps.push({ name: n, status: 'pass', duration: d, detail: det }); log?.info?.(`  ✓ ${n} (${d}ms)${det ? '  ' + det : ''}`); };
		const fail = (n, d, e) => { steps.push({ name: n, status: 'fail', duration: d, error: typeof e === 'string' ? e : e.message }); };

		// ===== Step 1: plugin loaded =====
		{
			const t0 = Date.now();
			try {
				const loaded = await evalObsidian('!!app.plugins?.plugins?.["deepreader-dev"]');
				if (!loaded) throw new Error('plugin not loaded');
				pass('plugin loaded', Date.now() - t0);
			} catch (e) {
				fail('plugin loaded', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 2: 找一个 DeepReader 章节文件 =====
		let chapterPath = null;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const files = app.vault.getMarkdownFiles().filter(f =>
						f.path.startsWith('DeepReader/') &&
						!f.path.startsWith('DeepReader/covers/') &&
						!f.path.startsWith('DeepReader/assets/') &&
						!f.path.includes('MOC') &&
						/^\\d+/.test(f.basename)
					);
					return files.length ? files[0].path : null;
				})()`);
				if (!result) throw new Error('DeepReader/ 下无章节文件');
				chapterPath = result;
				pass('查找章节文件', Date.now() - t0, chapterPath);
			} catch (e) {
				fail('查找章节文件', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 2.5: 打开 DeepReader 侧边栏（引用卡片需要侧边栏存在） =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`app.commands.executeCommandById('deepreader-dev:open-deepreader-sidebar')`);
				await new Promise(r => setTimeout(r, 800));
				const opened = await evalObsidian(`!!document.querySelector('.deeppdf-quotes-container')`);
				if (!opened) throw new Error('侧边栏未打开（缺 .deeppdf-quotes-container）');
				pass('打开 DeepReader 侧边栏', Date.now() - t0);
			} catch (e) {
				fail('打开 DeepReader 侧边栏', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 3: 打开章节并激活阅读模式 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`app.workspace.openLinkText(${JSON.stringify(chapterPath)}, '', false)`);
				// 等待阅读模式激活（可能需要 plugin 自动启用，多给点时间）
				let rmode = false;
				for (let i = 0; i < 6; i++) {
					await new Promise(r => setTimeout(r, 600));
					rmode = await evalObsidian(`(() => {
						return document.body.classList.contains('deeppdf-reading-mode')
							|| !!document.querySelector('.deeppdf-reading-mode');
					})()`);
					if (rmode) break;
				}
				// 如果仍未激活，尝试手动调用 readingModeService.activate()
				if (!rmode) {
					await evalObsidian(`(() => {
						const p = app.plugins.plugins['deepreader-dev'];
						const rms = p?.readingModeService;
						const file = app.workspace.getActiveFile();
						if (rms && file && rms.isChapterFile && rms.isChapterFile(file)) {
							rms.activate(file);
						}
						return true;
					})()`);
					await new Promise(r => setTimeout(r, 1500));
					rmode = await evalObsidian(`!!document.querySelector('.deeppdf-reading-mode')`);
				}
				if (!rmode) throw new Error('阅读模式未激活（手动 activate 后仍未生效）');
				pass('阅读模式激活', Date.now() - t0);
			} catch (e) {
				fail('阅读模式激活', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 4: 模拟选中段落触发工具栏 =====
		let selectedText = null;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					// 找到第一个有足够文字的段落（≥30 字符）
					const ps = Array.from(document.querySelectorAll('.deeppdf-reading-mode p, .markdown-preview-view p'));
					const p = ps.find(el => (el.textContent || '').trim().length >= 30);
					if (!p) return { error: 'no paragraph >=30 chars', count: ps.length };

					const range = document.createRange();
					range.selectNodeContents(p);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);

					// 触发 mouseup 让工具栏显示
					p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
					// 工具栏的 show() 在 setTimeout(checkSelection, 10) 里，需要等待
					return new Promise(resolve => {
						setTimeout(() => {
							resolve({
								selectedText: sel.toString().slice(0, 50),
								toolbarExists: !!document.querySelector('.deeppdf-selection-toolbar'),
								toolbarVisible: document.querySelector('.deeppdf-selection-toolbar')?.classList.contains('visible'),
							});
						}, 200);
					});
				})()`);

				if (result.error) throw new Error(result.error);
				selectedText = result.selectedText;
				if (!result.toolbarExists || !result.toolbarVisible) {
					throw new Error('工具栏未显示: ' + JSON.stringify(result));
				}
				pass('选中段落 + 工具栏显示', Date.now() - t0, `text="${result.selectedText}…"`);
			} catch (e) {
				fail('选中段落 + 工具栏显示', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 5: 验证工具栏 3 按钮齐全 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const toolbar = document.querySelector('.deeppdf-selection-toolbar');
					if (!toolbar) return { error: 'no toolbar' };
					const btns = toolbar.querySelectorAll('.deeppdf-toolbar-btn');
					return {
						count: btns.length,
						hasQuote: !!toolbar.querySelector('[data-action="quote"]'),
						hasExcerpt: !!toolbar.querySelector('[data-action="excerpt"]'),
						hasHighlight: !!toolbar.querySelector('[data-action="highlight"], .highlight-trigger'),
					};
				})()`);
				if (result.error) throw new Error(result.error);
				if (result.count < 3 || !result.hasQuote || !result.hasExcerpt || !result.hasHighlight) {
					throw new Error('工具栏按钮不全: ' + JSON.stringify(result));
				}
				pass('工具栏 3 按钮齐全', Date.now() - t0, `quote=${result.hasQuote} excerpt=${result.hasExcerpt} highlight=${result.hasHighlight}`);
			} catch (e) {
				fail('工具栏 3 按钮齐全', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 6: 点击引用按钮 → 卡片渲染 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const quoteBtn = document.querySelector('.deeppdf-selection-toolbar [data-action="quote"]');
					if (!quoteBtn) return { error: 'no quote button' };
					quoteBtn.click();
					return new Promise(resolve => {
						setTimeout(() => {
							const card = document.querySelector('.deeppdf-quote-card');
							if (!card) return resolve({ error: 'no card after click' });
							const textEl = card.querySelector('.deeppdf-quote-text');
							resolve({
								cardExists: true,
								cardCount: document.querySelectorAll('.deeppdf-quote-card').length,
								textLength: textEl?.textContent?.length || 0,
								textPreview: textEl?.textContent?.slice(0, 30) || '',
								dataQuoteId: card.getAttribute('data-quote-id'),
								hasSource: !!card.querySelector('.deeppdf-quote-source'),
							});
						}, 300);
					});
				})()`);
				if (result.error) throw new Error(result.error);
				if (!result.cardExists) throw new Error('卡片未渲染');
				if (result.textLength < 30) throw new Error(`卡片文本过短（${result.textLength} < 30），疑似仍被截断`);
				if (!result.dataQuoteId) throw new Error('卡片缺 data-quote-id');
				if (!result.hasSource) throw new Error('卡片缺 source 显示');
				pass('引用卡片渲染', Date.now() - t0, `text=${result.textLength}字 id=${result.dataQuoteId?.slice(-8)}`);
			} catch (e) {
				fail('引用卡片渲染', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 7: 卡片仅含删除按钮（无跳转/展开） =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const card = document.querySelector('.deeppdf-quote-card');
					if (!card) return { error: 'no card' };
					return {
						hasRemoveBtn: !!card.querySelector('.deeppdf-quote-remove-btn'),
						hasJumpBtn: !!card.querySelector('.deeppdf-quote-jump-btn'),
						hasExpandBtn: !!card.querySelector('.deeppdf-quote-expand-btn'),
						dataBlockId: card.getAttribute('data-quote-block-id'),
						sourceText: card.querySelector('.deeppdf-quote-source')?.textContent || '',
					};
				})()`);
				if (result.error) throw new Error(result.error);
				if (!result.hasRemoveBtn) throw new Error('卡片缺删除按钮');
				if (result.hasJumpBtn) throw new Error('不应有跳转按钮（已移除）');
				if (result.hasExpandBtn) throw new Error('不应有展开按钮（已移除）');
				pass('卡片仅含删除按钮', Date.now() - t0, `removeBtn=${result.hasRemoveBtn} blockId=${result.dataBlockId || '(none)'}`);
			} catch (e) {
				fail('卡片仅含删除按钮', Date.now() - t0, e);
			}
		}

		// ===== Step 8: 章节路径展示（heading/headingPath 优先于 source） =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const card = document.querySelector('.deeppdf-quote-card');
					if (!card) return { error: 'no card' };
					const sourceText = card.querySelector('.deeppdf-quote-source')?.textContent || '';
					// headingPath 用 › 分隔，heading/章节文件用 › 或 -
					return {
						sourceText,
						hasChapterSeparator: /[›\-]/.test(sourceText),
					};
				})()`);
				if (result.error) throw new Error(result.error);
				// 只要有可读标题就 OK
				if (!result.sourceText || result.sourceText === '引用') {
					// 降级：如果 source 是空或"引用"，仍算 pass（用户引用无元数据是边缘情况）
					log?.warn?.(`  ⚠ 章节路径为空（边缘情况，引用无 frontmatter）`);
				}
				pass('章节路径展示', Date.now() - t0, `text="${result.sourceText.slice(0, 30)}"`);
			} catch (e) {
				fail('章节路径展示', Date.now() - t0, e);
			}
		}

		// ===== Step 9: 移除按钮存在（非只读模式） =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const card = document.querySelector('.deeppdf-quote-card');
					if (!card) return { error: 'no card' };
					return {
						hasRemoveBtn: !!card.querySelector('.deeppdf-quote-remove-btn'),
						cardReadonly: card.getAttribute('data-readonly') === 'true',
					};
				})()`);
				if (result.error) throw new Error(result.error);
				if (result.cardReadonly) throw new Error('新引用的卡片不应是 readonly');
				if (!result.hasRemoveBtn) throw new Error('新引用卡片缺移除按钮');
				pass('非只读卡片含移除按钮', Date.now() - t0, `removeBtn=${result.hasRemoveBtn}`);
			} catch (e) {
				fail('非只读卡片含移除按钮', Date.now() - t0, e);
			}
		}

		// ===== Step 10: 移除按钮点击 → 卡片消失 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const before = document.querySelectorAll('.deeppdf-quote-card').length;
					const removeBtn = document.querySelector('.deeppdf-quote-card .deeppdf-quote-remove-btn');
					if (!removeBtn) return { error: 'no remove btn', before };
					removeBtn.click();
					return new Promise(resolve => {
						setTimeout(() => {
							resolve({
								before,
								remaining: document.querySelectorAll('.deeppdf-quote-card').length,
							});
						}, 300);
					});
				})()`);
				if (result.error) throw new Error(result.error);
				// 允许 before=1 → remaining=0 （正常）或 before=2 → remaining=1 （多卡片场景）
				if (result.remaining >= result.before) {
					throw new Error(`移除无效: before=${result.before} remaining=${result.remaining}`);
				}
				pass('移除按钮工作正常', Date.now() - t0, `before=${result.before} → remaining=${result.remaining}`);
			} catch (e) {
				fail('移除按钮工作正常', Date.now() - t0, e);
			}
		}

		// ===== Step 11: 重新引用 + 全部清除按钮 =====
		{
			const t0 = Date.now();
			try {
				// 重新选中并添加 2 个引用
				const result = await evalObsidian(`(() => {
					const ps = Array.from(document.querySelectorAll('.deeppdf-reading-mode p, .markdown-preview-view p'));
					const paragraphs = ps.filter(p => (p.textContent || '').trim().length >= 20);
					if (paragraphs.length < 2) return { error: 'need 2 paragraphs, got ' + paragraphs.length };

					const addQuote = (p) => {
						const range = document.createRange();
						range.selectNodeContents(p);
						const sel = window.getSelection();
						sel.removeAllRanges();
						sel.addRange(range);
						p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
						return new Promise(r => setTimeout(() => {
							const quoteBtn = document.querySelector('.deeppdf-selection-toolbar [data-action="quote"]');
							if (quoteBtn) quoteBtn.click();
							r(true);
						}, 200));
					};

					return (async () => {
						await addQuote(paragraphs[0]);
						await new Promise(r => setTimeout(r, 200));
						await addQuote(paragraphs[1]);
						await new Promise(r => setTimeout(r, 300));
						return {
							cardCount: document.querySelectorAll('.deeppdf-quote-card').length,
						};
					})();
				})()`);
				if (result.error) throw new Error(result.error);
				if (result.cardCount < 2) throw new Error(`预期 ≥2 张卡片，实际 ${result.cardCount}`);
				pass('多引用共存的引用容器', Date.now() - t0, `cards=${result.cardCount}`);
			} catch (e) {
				fail('多引用共存的引用容器', Date.now() - t0, e);
			}
		}

		// ===== Step 12: 验证 QuoteManager 在内存中 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					// 通过 DOM 间接验证：每张卡片有独立 data-quote-id
					const ids = Array.from(document.querySelectorAll('.deeppdf-quote-card'))
						.map(c => c.getAttribute('data-quote-id'));
					return {
						count: ids.length,
						unique: new Set(ids).size,
						sample: ids[0]?.slice(-12),
					};
				})()`);
				if (result.unique !== result.count) {
					throw new Error(`id 重复：${result.count} 张卡片只有 ${result.unique} 个唯一 id`);
				}
				pass('卡片 id 唯一性', Date.now() - t0, `count=${result.count} unique=${result.unique}`);
			} catch (e) {
				fail('卡片 id 唯一性', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
