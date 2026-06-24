import type { Options, Services, Capabilities } from '@wdio/types';

/**
 * 自定义 wdio service：在 obsidian service 之前运行，
 * 手动设置 window.wdioObsidianService，绕过 helper plugin 加载失败的问题。
 *
 * wdio-obsidian-service 的 prepareApp 等待 window.wdioObsidianService 被设置，
 * 这需要 helper plugin (wdio-obsidian-service-plugin) 加载成功。
 * 但由于上传机制丢失插件文件，helper plugin 永远无法加载。
 *
 * 这个 service 在 Obsidian 页面加载后，手动注入 window.wdioObsidianService。
 */
export class MobileCompatService implements Services.Service {
	private browser?: WebdriverIO.Browser;

	async beforeSession(config: any, capabilities: any) {
		// 不需要做任何事
	}

	async before(capabilities: any, specs: any, browser: WebdriverIO.Browser) {
		this.browser = browser;

		// 等 Obsidian 页面加载
		try {
			await browser.waitUntil(
				async () => {
					return await browser.execute(() => {
						return !!(window as any).app;
					});
				},
				{ timeout: 60000, interval: 500 },
			);
		} catch {
			// app 可能还没加载，继续尝试
		}

		// 注入 window.wdioObsidianService
		try {
			await browser.execute(() => {
				if (!(window as any).wdioObsidianService) {
					(window as any).wdioObsidianService = () => ({
						app: (window as any).app,
						obsidian: (window as any).obsidian || (typeof require !== 'undefined' ? require('obsidian') : {}),
						plugins: (window as any).app?.plugins?.plugins || {},
						require: typeof require !== 'undefined' ? require : (mod: string) => { throw new Error('require not available: ' + mod); },
					});
					console.log('[mobile-compat] Injected window.wdioObsidianService');
				}
			});
		} catch (e) {
			console.warn('[mobile-compat] Failed to inject wdioObsidianService:', e);
		}
	}
}
