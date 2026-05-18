/**
 * 微信读书设置 Tab 渲染
 */

import { Setting, Notice } from 'obsidian';
import type { SectionContext } from '../types';
import { WereadService } from '../../weread/index';
import { ZLibraryClient } from '../../zlibrary/client';
import { buildZlibClient } from '../../zlibrary/build-client';

export function renderWereadSection(
	container: HTMLElement,
	ctx: SectionContext,
	refresh: () => void,
): void {
	const { plugin } = ctx;
	const settings = plugin.settings;

	// ═══ API Key 区域 ═══
	const accountCard = container.createDiv({ cls: 'deeppdf-settings-card' });
	accountCard.createEl('h4', { text: 'API Key' });

	if (settings.wereadApiKey) {
		// 已配置状态
		const infoDiv = accountCard.createDiv({ cls: 'setting-item' });
		const masked = settings.wereadApiKey.length > 12
			? settings.wereadApiKey.slice(0, 4) + '****' + settings.wereadApiKey.slice(-4)
			: '****';
		infoDiv.createEl('span', { text: `当前 Key：${masked}` });

		new Setting(accountCard)
			.addButton(btn => {
				btn.setButtonText('验证连接')
					.onClick(async () => {
						btn.setButtonText('验证中...').setDisabled(true);
						try {
							const host = {
								settings: plugin.settings,
								app: plugin.app,
								saveSettings: async () => { await plugin.saveSettings(); },
							};
							const svc = new WereadService(host);
							const valid = await svc.validateApiKey();
							new Notice(valid ? 'API Key 有效，连接正常' : 'API Key 无效或已过期');
						} catch {
							new Notice('验证失败，请检查网络');
						} finally {
							btn.setButtonText('验证连接').setDisabled(false);
						}
					});
			})
			.addButton(btn => {
				btn.setButtonText('清除')
					.setWarning()
					.onClick(async () => {
						settings.wereadApiKey = '';
						await plugin.saveSettings();
						new Notice('已清除微信读书 API Key');
						refresh();
					});
			});
	} else {
		// 未配置状态
		new Setting(accountCard)
			.setName('输入 API Key')
			.setDesc('从微信读书开放平台获取的 API Key')
			.addText(text => {
				text.setPlaceholder('wrk-...')
					.inputEl.type = 'password';
				text.inputEl.dataset.field = 'weread-apikey';
			})
			.addButton(btn => {
				btn.setButtonText('保存并验证')
					.onClick(async () => {
						const input = accountCard.querySelector('input[data-field="weread-apikey"]') as HTMLInputElement;
						const key = input?.value?.trim();
						if (!key) {
							new Notice('请输入 API Key');
							return;
						}

						btn.setButtonText('验证中...').setDisabled(true);
						try {
							const host = {
								settings: plugin.settings,
								app: plugin.app,
								saveSettings: async () => { await plugin.saveSettings(); },
							};
							const svc = new WereadService(host);
							const result = await svc.setApiKey(key);
							if (result.success) {
								new Notice('API Key 验证成功');
								refresh();
							} else {
								new Notice(result.error || 'API Key 无效');
							}
						} catch {
							new Notice('验证失败，请检查网络');
						} finally {
							btn.setButtonText('保存并验证').setDisabled(false);
						}
					});
			});
	}

	// ═══ 同步区域 ═══
	const syncCard = container.createDiv({ cls: 'deeppdf-settings-card' });
	syncCard.createEl('h4', { text: '同步' });

	const isLoggedIn = !!settings.wereadApiKey;

	// 同步统计（异步加载）
	const statsDiv = syncCard.createDiv({ cls: 'setting-item' });
	if (isLoggedIn) {
		statsDiv.createEl('span', { text: '加载同步状态...' });
		loadAndRenderStats(statsDiv, plugin);
	} else {
		statsDiv.createEl('span', { text: '请先配置 API Key' });
	}

	// 同步进度条区域（同步过程中动态更新）
	const progressDiv = syncCard.createDiv({ cls: 'deeppdf-weread-progress' });
	progressDiv.style.display = 'none';

	const progressBar = progressDiv.createEl('div', { cls: 'deeppdf-weread-progress-bar' });
	const progressFill = progressBar.createEl('div', { cls: 'deeppdf-weread-progress-fill' });
	const progressText = progressDiv.createEl('div', { cls: 'deeppdf-weread-progress-text', text: '准备同步...' });

	const doSync = async (force: boolean) => {
		if (!isLoggedIn) return;
		progressDiv.style.display = 'block';
		progressFill.style.width = '0%';
		progressText.textContent = '正在拉取书架...';
		syncBtn.setDisabled(true);
		forceBtn.setDisabled(true);

		try {
			const host = {
				settings: plugin.settings,
				app: plugin.app,
				saveSettings: async () => { await plugin.saveSettings(); },
			};
			const svc = new WereadService(host);
			const result = await svc.sync(force, {
				onProgress: (p: any) => {
					try {
						if (p.phase === 'fetching-shelf') {
							progressText.textContent = '正在拉取书架...';
						} else if (p.phase === 'fetching-books') {
							const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
							progressFill.style.width = `${pct}%`;
							progressText.textContent = `同步中 (${p.current}/${p.total}) ${p.currentBook}`;
						} else if (p.phase === 'matching') {
							progressFill.style.width = '100%';
							progressText.textContent = '正在匹配关联...';
						} else if (p.phase === 'completed') {
							progressFill.style.width = '100%';
							progressText.textContent = '同步完成';
						}
					} catch { /* 设置页可能已关闭 */ }
				},
			});

			progressText.textContent = `同步完成：新增 ${result.added} 本，更新 ${result.updated} 本` +
				(result.errors.length > 0 ? `，${result.errors.length} 本失败` : '');
			new Notice(`同步完成：新增 ${result.added} 本，更新 ${result.updated} 本`);
			refresh();
		} catch (e: any) {
			progressText.textContent = `同步失败：${e.message}`;
			new Notice(`同步失败：${e.message}`);
		} finally {
			syncBtn.setDisabled(!isLoggedIn);
			forceBtn.setDisabled(!isLoggedIn);
		}
	};

	let syncBtn: any;
	let forceBtn: any;

	new Setting(syncCard)
		.setName('同步笔记')
		.setDesc(isLoggedIn ? '从微信读书同步高亮和笔记' : '请先配置 API Key')
		.addButton(btn => {
			btn.setButtonText('同步笔记')
				.setDisabled(!isLoggedIn);
			syncBtn = btn;
			btn.onClick(() => doSync(false));
		})
		.addButton(btn => {
			btn.setButtonText('强制全量同步')
				.setDisabled(!isLoggedIn)
				.setWarning();
			forceBtn = btn;
			btn.onClick(() => doSync(true));
		});

	// ═══ 配置区域 ═══
	const configCard = container.createDiv({ cls: 'deeppdf-settings-card' });
	configCard.createEl('h4', { text: '配置' });

	new Setting(configCard)
		.setName('笔记存放位置')
		.setDesc('同步到 书籍摘录/{书名}/{书名}.md')
		.addText(text => {
			text.setValue('书籍摘录').setDisabled(true);
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


		// ═══ Z-Library 下载 ═══
		const zlibCard = container.createDiv({ cls: 'deeppdf-settings-card' });
		zlibCard.createEl('h4', { text: 'Z-Library 书籍下载' });

		const hasZlib = !!settings.zlibraryUserId && !!settings.zlibraryUserKey;

		if (hasZlib) {
			// 已登录状态：显示用户信息 + 操作按钮
			const infoDiv = zlibCard.createDiv({ cls: 'setting-item' });
			infoDiv.createEl('span', { text: `用户 ID：${settings.zlibraryUserId}` });

			// 异步加载下载配额
			const quotaDiv = zlibCard.createDiv({ cls: 'setting-item' });
			quotaDiv.createEl('span', { text: '加载配额信息...' });
			loadZlibProfile(quotaDiv, settings);

			new Setting(zlibCard)
				.addButton(btn => {
					btn.setButtonText('刷新配额')
						.onClick(async () => {
							btn.setButtonText('刷新中...').setDisabled(true);
							try {
								const client = buildZlibClient(settings);
								const profile = await client.getProfile();
								quotaDiv.empty();
								quotaDiv.createEl('span', {
									text: `今日剩余下载：${profile.downloadsTodayLeft} / ${profile.downloadsTodayLimit}`,
								});
							} catch {
								new Notice('获取配额失败');
							} finally {
								btn.setButtonText('刷新配额').setDisabled(false);
							}
						});
				})
				.addButton(btn => {
					btn.setButtonText('退出登录')
						.setWarning()
						.onClick(async () => {
							settings.zlibraryUserId = '';
							settings.zlibraryUserKey = '';
							settings.zlibraryDomain = '';
							await plugin.saveSettings();
							new Notice('已清除 Z-Library 登录信息');
							refresh();
						});
				});
		} else {
			// 未登录状态：输入邮箱密码登录
			new Setting(zlibCard)
				.setName('邮箱')
				.addText(text => {
					text.setPlaceholder('your@email.com');
					text.inputEl.dataset.field = 'zlib-email';
				});
			new Setting(zlibCard)
				.setName('密码')
				.addText(text => {
					text.inputEl.type = 'password';
					text.setPlaceholder('Z-Library 密码');
					text.inputEl.dataset.field = 'zlib-password';
				});
			new Setting(zlibCard)
				.addButton(btn => {
					btn.setButtonText('登录')
						.setCta()
						.onClick(async () => {
							const emailEl = zlibCard.querySelector('input[data-field="zlib-email"]') as HTMLInputElement;
							const passEl = zlibCard.querySelector('input[data-field="zlib-password"]') as HTMLInputElement;
							const email = emailEl?.value?.trim();
							const password = passEl?.value;
							if (!email || !password) {
								new Notice('请输入邮箱和密码');
								return;
							}

							btn.setButtonText('登录中...').setDisabled(true);
							try {
								const client = new ZLibraryClient();
								const profile = await client.login(email, password);
								const creds = client.getPersistableCredentials();
								if (creds) {
									settings.zlibraryUserId = creds.userId;
									settings.zlibraryUserKey = creds.userKey;
									settings.zlibraryDomain = creds.domain;
								}
								await plugin.saveSettings();
								new Notice(`登录成功！剩余下载 ${profile.downloadsTodayLeft} 次`);
								refresh();
							} catch (e: any) {
								new Notice(e.message || '登录失败');
							} finally {
								btn.setButtonText('登录').setDisabled(false);
							}
						});
				});
			zlibCard.createEl('div', {
				text: '仅存储登录后的 Cookie，不保存明文密码',
				cls: 'setting-item-description',
			});
		}
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



/** 异步加载 Z-Library 用户配额 */
async function loadZlibProfile(container: HTMLElement, settings: any): Promise<void> {
	try {
		const client = buildZlibClient(settings);
		const profile = await client.getProfile();
		container.empty();
		container.createEl('span', {
			text: `今日剩余下载：${profile.downloadsTodayLeft} / ${profile.downloadsTodayLimit}`,
		});
	} catch {
		container.empty();
		container.createEl('span', { text: '无法获取配额信息' });
	}
}
