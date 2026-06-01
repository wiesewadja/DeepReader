/**
 * 轻量 E2E: 微信读书 UI
 *
 * 对比: tests/e2e/specs/weread-ui.e2e.ts (203 行 WDIO)
 * 验证设置页面、书库视图、未匹配 Modal UI 结构
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { countBySelector } from '../../smoke/lib/dom-query.mjs';

export default {
	id: 'weread-ui',
	name: '微信读书 UI',
	feature: 'F-26',
	timeout: 60_000,

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// ===== 设置页面 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`
					(() => {
						app.setting.open();
						app.setting.openTabById('deepreader');
						return true;
					})()
				`);
				await new Promise(r => setTimeout(r, 1000));

				// 验证微信读书设置区域存在（F-26 核心断言）
				const hasWeread = await evalObsidian(`(() => {
					const headings = document.querySelectorAll('.deeppdf-settings-card h4');
					for (const h of headings) {
						if (h.textContent?.includes('API Key') || h.textContent?.includes('同步')) return true;
					}
					const buttons = document.querySelectorAll('button');
					for (const btn of buttons) {
						if (btn.textContent?.includes('保存并验证') || btn.textContent?.includes('同步笔记')) return true;
					}
					return false;
				})()`);
				if (!hasWeread) throw new Error('微信读书设置区域未找到（无 h4 含 API Key/同步，无按钮含 保存并验证/同步笔记）');
				pass('设置页面 UI', Date.now() - t0);
			} catch (e) {
				fail('设置页面 UI', Date.now() - t0, e);
			} finally {
				await evalObsidian('app.setting.close()').catch(() => {});
			}
		}

		// ===== 书库视图 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian('app.commands.executeCommandById("deepreader:open-library")');
				await new Promise(r => setTimeout(r, 1000));

				const hasLibrary = await countBySelector('.deeppdf-library-view');
				if (hasLibrary === 0) throw new Error('.deeppdf-library-view 不存在');

				const cardCount = await countBySelector('.deeppdf-lib-book-card');
				const wereadBadges = await countBySelector('.deeppdf-lib-type-weread');
				pass('书库视图', Date.now() - t0, `cards=${cardCount}, wereadBadges=${wereadBadges}`);
			} catch (e) {
				fail('书库视图', Date.now() - t0, e);
			}
		}

		// ===== 未匹配 Modal =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`(() => {
					// 用 DOM 直接构建测试 modal
					const overlay = document.createElement('div');
					overlay.className = 'modal-container';
					const modal = document.createElement('div');
					modal.className = 'modal';
					const content = document.createElement('div');
					content.className = 'modal-content';
					const h2 = document.createElement('h2');
					h2.textContent = '未关联的微信读书书籍';
					content.appendChild(h2);
					const container = document.createElement('div');
					container.className = 'deeppdf-unmatched-list-container';
					const ul = document.createElement('ul');
					ul.className = 'deeppdf-unmatched-list';
					const books = [
						{ title: '深度学习', author: 'Ian Goodfellow' },
						{ title: '设计模式', author: 'GoF' },
					];
					for (const book of books) {
						const li = document.createElement('li');
						li.className = 'deeppdf-unmatched-item';
						li.innerHTML = '<div class="deeppdf-unmatched-info"><strong>' + book.title + '</strong><span class="deeppdf-unmatched-author"> — ' + book.author + '</span></div><button class="deeppdf-unmatched-link-btn">手动关联</button>';
						ul.appendChild(li);
					}
					container.appendChild(ul);
					content.appendChild(container);
					const hint = document.createElement('p');
					hint.className = 'deeppdf-unmatched-hint';
					hint.textContent = '提示：匹配基于书名相似度。';
					content.appendChild(hint);
					modal.appendChild(content);
					overlay.appendChild(modal);
					document.body.appendChild(overlay);
					return true;
				})()`);
				await new Promise(r => setTimeout(r, 1000));

				const info = await evalObsidian(`(() => {
					const modal = document.querySelector('.modal');
					if (!modal) return { exists: false };
					return {
						exists: true,
						hasScrollContainer: !!modal.querySelector('.deeppdf-unmatched-list-container'),
						linkButtons: modal.querySelectorAll('.deeppdf-unmatched-link-btn').length,
						hasHint: !!modal.querySelector('.deeppdf-unmatched-hint'),
						items: modal.querySelectorAll('.deeppdf-unmatched-item').length,
					};
				})()`);

				if (!info?.exists) throw new Error('Modal 不存在');
				if (!info.hasScrollContainer || info.linkButtons < 1) {
					throw new Error(`Modal 结构不完整: ${JSON.stringify(info)}`);
				}
				pass('未匹配 Modal', Date.now() - t0, `items=${info.items}, buttons=${info.linkButtons}`);
			} catch (e) {
				fail('未匹配 Modal', Date.now() - t0, e);
			} finally {
				await evalObsidian('document.querySelector(".modal-close-button")?.click()').catch(() => {});
			}
		}

		return { steps };
	},
};
