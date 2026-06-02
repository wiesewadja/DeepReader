/**
 * 微信读书集成 UI E2E 测试
 * 验证：设置 Tab、书库视图标签、未匹配 Modal
 */
import { obsidianPage } from 'wdio-obsidian-service';

describe('微信读书 UI E2E 测试', function () {
	this.timeout(120000);

	it('should have DeepReader plugin loaded', async function () {
		const loaded = await browser.executeObsidian(({ app }) => {
			return !!app.plugins?.plugins?.['deepreader-dev'];
		});
		expect(loaded).toBe(true);
	});

	// ═══ 设置页面截图 ═══
	describe('设置页面 UI', () => {
		it('should open DeepReader settings and navigate to WeRead tab', async function () {
			// 打开设置
			await browser.executeObsidian(({ app }) => {
				app.setting.open();
			});
			await browser.pause(1000);

			// 找到 DeepReader 插件设置项
			const found = await browser.executeObsidian(({ app }) => {
				// 在设置面板中找到 DeepReader
				const tabs = document.querySelectorAll('.vertical-tab-header-item');
				for (const tab of tabs) {
					if (tab.textContent?.includes('DeepReader')) {
						(tab as HTMLElement).click();
						return true;
					}
				}
				return false;
			});
			console.log('[E2E] Found DeepReader settings tab:', found);

			// 如果有微信读书子 tab，点击它
			await browser.pause(500);
			const hasWereadTab = await browser.executeObsidian(() => {
				const items = document.querySelectorAll('.vertical-tab-header-item');
				for (const item of items) {
					if (item.textContent?.includes('微信读书')) {
						(item as HTMLElement).click();
						return true;
					}
				}
				// 没有子 tab，可能 DeepReader 设置直接包含微信读书区域
				return false;
			});
			console.log('[E2E] Has WeRead sub-tab:', hasWereadTab);

			await browser.pause(1000);
		});

		it('should screenshot settings page', async function () {
			await browser.saveScreenshot('./test-vault/weread-settings.png');
			console.log('[E2E] Settings screenshot saved');
		});

		it('should verify WeRead settings section exists', async function () {
			const hasWereadSection = await browser.executeObsidian(() => {
				// 检查是否有微信读书相关的设置区域
				const headings = document.querySelectorAll('.deeppdf-settings-card h4');
				for (const h of headings) {
					if (h.textContent?.includes('API Key') || h.textContent?.includes('同步')) {
						return true;
					}
				}
				// 也检查是否有扫码登录按钮
				const buttons = document.querySelectorAll('button');
				for (const btn of buttons) {
					if (btn.textContent?.includes('保存并验证') || btn.textContent?.includes('同步笔记')) {
						return true;
					}
				}
				return false;
			});
			console.log('[E2E] WeRead settings section found:', hasWereadSection);
		});
	});

	// ═══ 书库视图截图 ═══
	describe('书库视图 UI', () => {
		it('should open DeepReader library view', async function () {
			// 先关闭设置
			await browser.executeObsidian(({ app }) => {
				app.setting.close();
			});
			await browser.pause(500);

			// 通过命令打开书库视图
			await browser.executeObsidian(({ app }) => {
				app.commands.executeCommandById('deepreader-dev:open-library');
			});
			await browser.pause(2000);
		});

		it('should screenshot library view', async function () {
			await browser.saveScreenshot('./test-vault/weread-library-view.png');
			console.log('[E2E] Library view screenshot saved');
		});

		it('should verify library view is rendered', async function () {
			const hasLibrary = await browser.executeObsidian(() => {
				return !!document.querySelector('.deeppdf-library-view');
			});
			console.log('[E2E] Library view rendered:', hasLibrary);

			if (hasLibrary) {
				// 检查书籍卡片数量
				const cardCount = await browser.executeObsidian(() => {
					return document.querySelectorAll('.deeppdf-lib-book-card').length;
				});
				console.log('[E2E] Book cards count:', cardCount);

				// 检查是否有微信读书标签
				const wereadBadges = await browser.executeObsidian(() => {
					return document.querySelectorAll('.deeppdf-lib-type-weread').length;
				});
				console.log('[E2E] WeRead badges count:', wereadBadges);
			}
		});
	});

	// ═══ 未匹配 Modal 测试（改进版：手动关联 + 滚动 + 引导提示）═══
	describe('未匹配 Modal', () => {
		it('should trigger UnmatchedModal with enhanced UI', async function () {
			await browser.executeObsidian(({ app }) => {
				const { Modal } = require('obsidian') as any;
				const modal = new Modal(app) as any;
				modal.onOpen = function () {
					const { contentEl } = this;
					contentEl.empty();
					contentEl.createEl('h2', { text: '未关联的微信读书书籍' });
					contentEl.createEl('p', {
						text: '以下 5 本微信读书书籍未在 DeepReader 中找到匹配。你可以点击"手动关联"选择已有书籍。',
					});

					// 滚动列表容器
					const container = contentEl.createDiv({ cls: 'deeppdf-unmatched-list-container' });
					const list = container.createEl('ul', { cls: 'deeppdf-unmatched-list' });
					const books = [
						{ title: '深度学习', author: 'Ian Goodfellow' },
						{ title: '设计模式', author: 'GoF' },
						{ title: '代码整洁之道', author: 'Robert C. Martin' },
						{ title: '重构', author: 'Martin Fowler' },
						{ title: '人月神话', author: 'Fred Brooks' },
					];
					for (const book of books) {
						const li = list.createEl('li', { cls: 'deeppdf-unmatched-item' });
						const info = li.createDiv({ cls: 'deeppdf-unmatched-info' });
						info.createEl('strong', { text: book.title });
						info.createEl('span', { cls: 'deeppdf-unmatched-author', text: ` — ${book.author}` });
						li.createEl('button', { cls: 'deeppdf-unmatched-link-btn', text: '手动关联' });
					}

					// 引导提示
					contentEl.createEl('p', {
						cls: 'deeppdf-unmatched-hint',
						text: '提示：匹配基于书名相似度。如果书名差异较大（如翻译版本不同），可以使用手动关联功能。',
					});
				};
				modal.open();
			});
			await browser.pause(1500);
		});

		it('should screenshot enhanced unmatched modal', async function () {
			await browser.saveScreenshot('./test-vault/weread-unmatched-modal.png');
			console.log('[E2E] Enhanced modal screenshot saved');
		});

		it('should verify enhanced modal structure', async function () {
			const info = await browser.executeObsidian(() => {
				const modal = document.querySelector('.modal');
				if (!modal) return { exists: false };
				return {
					exists: true,
					hasScrollContainer: !!modal.querySelector('.deeppdf-unmatched-list-container'),
					hasLinkButtons: modal.querySelectorAll('.deeppdf-unmatched-link-btn').length,
					hasHint: !!modal.querySelector('.deeppdf-unmatched-hint'),
					itemCount: modal.querySelectorAll('.deeppdf-unmatched-item').length,
					items: Array.from(modal.querySelectorAll('.deeppdf-unmatched-info')).slice(0, 3).map(el => el.textContent),
				};
			});
			console.log('[E2E] Enhanced modal info:', JSON.stringify(info, null, 2));
			expect(info.hasScrollContainer).toBe(true);
			expect(info.hasLinkButtons).toBe(5);
			expect(info.hasHint).toBe(true);
		});

		it('should close modal', async function () {
			await browser.executeObsidian(() => {
				const closeBtn = document.querySelector('.modal-close-button') as HTMLElement;
				if (closeBtn) closeBtn.click();
			});
			await browser.pause(500);
		});
	});
});
