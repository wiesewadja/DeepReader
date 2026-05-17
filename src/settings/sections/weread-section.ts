/**
 * 微信读书设置 Tab 渲染
 */

import { Setting, Notice } from 'obsidian';
import type { SectionContext } from '../types';
import { WereadService } from '../../weread/index';
import { WereadApiClient } from '../../weread/api/client';
import { loginWithBrowser } from '../../weread/auth/browser-login';

export function renderWereadSection(
	container: HTMLElement,
	ctx: SectionContext,
	refresh: () => void,
): void {
	const { plugin } = ctx;
	const settings = plugin.settings;

	// ═══ 账号/登录区域 ═══
	const accountCard = container.createDiv({ cls: 'deeppdf-settings-card' });
	accountCard.createEl('h4', { text: '账号' });

	if (settings.wereadCookie?.wr_vid) {
		// 已登录状态
		const infoDiv = accountCard.createDiv({ cls: 'setting-item' });

		// 头像 + 用户信息
		if (settings.wereadCookie.wr_avatar) {
			const img = infoDiv.createEl('img', {
				cls: 'weread-avatar',
				attr: { src: settings.wereadCookie.wr_avatar, width: '36', height: '36' },
			});
			img.style.borderRadius = '50%';
			img.style.marginRight = '10px';
			img.style.verticalAlign = 'middle';
		}
		const nameText = settings.wereadCookie.wr_name || '已登录用户';
		infoDiv.createEl('span', { text: `用户：${nameText}` });

		new Setting(accountCard)
			.setName('登出')
			.addButton(btn => {
				btn.setButtonText('登出')
					.setWarning()
					.onClick(async () => {
						settings.wereadCookie = null;
						await plugin.saveSettings();
						new Notice('已登出微信读书');
						refresh();
					});
			});
	} else {
		// 未登录状态
		new Setting(accountCard)
			.setName('扫码登录')
			.setDesc('打开微信读书扫码登录页面')
			.addButton(btn => {
				btn.setButtonText('扫码登录')
					.onClick(async () => {
						const result = await loginWithBrowser();
						if (result.success && result.cookie) {
							settings.wereadCookie = result.cookie;
							await plugin.saveSettings();
							new Notice('微信读书登录成功');
							refresh();
						} else {
							new Notice(result.error || '登录失败');
						}
					});
			});

		new Setting(accountCard)
			.setName('手动输入 Cookie')
			.setDesc('输入 wr_vid 和 wr_skey')
			.addText(text => {
				text.setPlaceholder('wr_vid');
				text.inputEl.dataset.field = 'wr_vid';
			})
			.addText(text => {
				text.setPlaceholder('wr_skey');
				text.inputEl.dataset.field = 'wr_skey';
			})
			.addButton(btn => {
				btn.setButtonText('保存')
					.onClick(async () => {
						const inputs = accountCard.querySelectorAll('input[data-field]');
						const vid = (inputs[0] as HTMLInputElement)?.value?.trim();
						const skey = (inputs[1] as HTMLInputElement)?.value?.trim();
						if (!vid || !skey) {
							new Notice('请填写 wr_vid 和 wr_skey');
							return;
						}
						// 先验证 Cookie 有效性
						new Notice('正在验证 Cookie...');
						try {
							const client = new WereadApiClient({ wr_vid: vid, wr_skey: skey });
							const valid = await client.validateCookie();
							if (!valid) {
								new Notice('Cookie 无效或已过期，请重新获取');
								return;
							}
						} catch {
							new Notice('Cookie 验证失败，请检查网络');
							return;
						}
						settings.wereadCookie = { wr_vid: vid, wr_skey: skey };
						await plugin.saveSettings();
						new Notice('Cookie 已保存并验证通过');
						refresh();
					});
			});
	}

	// ═══ 同步区域 ═══
	const syncCard = container.createDiv({ cls: 'deeppdf-settings-card' });
	syncCard.createEl('h4', { text: '同步' });

	const isLoggedIn = !!settings.wereadCookie?.wr_vid;

	// 同步统计（异步加载）
	const statsDiv = syncCard.createDiv({ cls: 'setting-item' });
	if (isLoggedIn) {
		statsDiv.createEl('span', { text: '加载同步状态...' });
		loadAndRenderStats(statsDiv, plugin);
	} else {
		statsDiv.createEl('span', { text: '请先登录' });
	}

	new Setting(syncCard)
		.setName('同步笔记')
		.setDesc(isLoggedIn ? '从微信读书同步高亮和笔记' : '请先登录')
		.addButton(btn => {
			btn.setButtonText('同步笔记')
				.setDisabled(!isLoggedIn)
				.onClick(async () => {
					if (!isLoggedIn) return;
					new Notice('开始同步微信读书...');
					try {
						const host = {
							settings: plugin.settings,
							app: plugin.app,
							saveSettings: async () => { await plugin.saveSettings(); },
						};
						const svc = new WereadService(host);
						const result = await svc.sync();
						new Notice(`同步完成：新增 ${result.added} 本，更新 ${result.updated} 本`);
						refresh();
					} catch (e: any) {
						new Notice(`同步失败：${e.message}`);
					}
				});
		})
		.addButton(btn => {
			btn.setButtonText('强制全量同步')
				.setDisabled(!isLoggedIn)
				.setWarning()
				.onClick(async () => {
					if (!isLoggedIn) return;
					new Notice('开始强制全量同步...');
					try {
						const host = {
							settings: plugin.settings,
							app: plugin.app,
							saveSettings: async () => { await plugin.saveSettings(); },
						};
						const svc = new WereadService(host);
						const result = await svc.sync(true);
						new Notice(`同步完成：新增 ${result.added} 本，更新 ${result.updated} 本`);
						refresh();
					} catch (e: any) {
						new Notice(`同步失败：${e.message}`);
					}
				});
		});

	// ═══ 配置区域 ═══
	const configCard = container.createDiv({ cls: 'deeppdf-settings-card' });
	configCard.createEl('h4', { text: '配置' });

	new Setting(configCard)
		.setName('笔记存放路径')
		.addText(text => {
			text.setValue(settings.wereadNoteLocation || 'DeepReader/微信读书')
				.onChange(async (v) => {
					settings.wereadNoteLocation = v;
					await plugin.saveSettings();
				});
		});

	new Setting(configCard)
		.setName('子文件夹规则')
		.addDropdown(dropdown => {
			dropdown
				.addOptions({
					'none': '无子文件夹',
					'category': '按分类',
					'title': '按书名',
				})
				.setValue(settings.wereadSubFolder || 'category')
				.onChange(async (v) => {
					settings.wereadSubFolder = v as 'none' | 'category' | 'title';
					await plugin.saveSettings();
				});
		});

	new Setting(configCard)
		.setName('文件名格式')
		.addDropdown(dropdown => {
			dropdown
				.addOptions({
					'title': '书名',
					'title-author': '书名 - 作者',
					'title-bookId': '书名 - bookId',
				})
				.setValue(settings.wereadFileName || 'title')
				.onChange(async (v) => {
					settings.wereadFileName = v as 'title' | 'title-author' | 'title-bookId';
					await plugin.saveSettings();
				});
		});

	new Setting(configCard)
		.setName('排除公众号文章')
		.addToggle(toggle => {
			toggle
				.setValue(settings.wereadExcludeArticles ?? true)
				.onChange(async (v) => {
					settings.wereadExcludeArticles = v;
					await plugin.saveSettings();
				});
		});

	new Setting(configCard)
		.setName('最低笔记数量阈值')
		.setDesc('低于此数量的书籍不同步')
		.addSlider(slider => {
			slider
				.setLimits(0, 10, 1)
				.setValue(settings.wereadNoteCountThreshold ?? 1)
				.setDynamicTooltip()
				.onChange(async (v) => {
					settings.wereadNoteCountThreshold = v;
					await plugin.saveSettings();
				});
		});
}

/** 异步加载同步统计并渲染到 statsDiv */
async function loadAndRenderStats(container: HTMLElement, plugin: any): Promise<void> {
	try {
		const host = {
			settings: plugin.settings,
			app: plugin.app,
			saveSettings: async () => { await plugin.saveSettings(); },
		};
		const svc = new WereadService(host);
		const stats = await svc.getSyncStats();

		container.empty();

		if (stats.lastSyncTime > 0) {
			const date = new Date(stats.lastSyncTime);
			container.createEl('div', {
				text: `上次同步：${date.toLocaleString('zh-CN')}`,
				cls: 'setting-item-description',
			});
		} else {
			container.createEl('div', {
				text: '尚未同步',
				cls: 'setting-item-description',
			});
		}

		if (stats.syncedCount > 0) {
			container.createEl('div', {
				text: `已同步 ${stats.syncedCount} 本，已关联 ${stats.matchedCount} 本`,
				cls: 'setting-item-description',
			});
		}
	} catch {
		container.empty();
		container.createEl('span', { text: '无法读取同步状态' });
	}
}
