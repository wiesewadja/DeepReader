/**
 * 微信读书浏览器扫码登录
 * 参考 obsidian-weread-plugin 的实现
 */

import type { WereadCookie } from '../types';

export interface LoginResult {
	success: boolean;
	cookie?: WereadCookie;
	error?: string;
}

/** 登录超时时间（5 分钟） */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 打开 Electron BrowserWindow 进行扫码登录
 * 使用 dynamic require 确保 Obsidian 兼容性
 */
export async function loginWithBrowser(): Promise<LoginResult> {
	// @ts-ignore — electron 仅在桌面端可用，Obsidian 插件运行时通过 require 动态加载
	let electron: typeof import('electron');
	try {
		// @ts-ignore
		electron = require('electron') as typeof import('electron');
	} catch {
		return { success: false, error: '无法加载 Electron 模块，请在桌面端使用此功能' };
	}

	const { BrowserWindow } = electron;

	return new Promise<LoginResult>((resolve) => {
		const win = new BrowserWindow({
			width: 800,
			height: 600,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				partition: 'persist:weread-plugin-browser',
			},
		});

		let settled = false;

		const finish = (result: LoginResult) => {
			if (settled) return;
			settled = true;
			try { win.close(); } catch { /* window may already be closed */ }
			resolve(result);
		};

		// 超时处理
		const timer = setTimeout(() => {
			finish({ success: false, error: '登录超时（5 分钟）' });
		}, LOGIN_TIMEOUT_MS);

		// 用户手动关闭窗口
		win.on('closed', () => {
			clearTimeout(timer);
			if (!settled) {
				finish({ success: false, error: '用户取消了登录' });
			}
		});

		// 监听导航事件，检测登录成功
		win.webContents.on('did-navigate', async (_event: any, url: string) => {
			// 登录成功后跳转到用户页面
			const match = url.match(/weread\.qq\.com\/web\/user\?userVid=(\d+)/);
			if (!match) return;

			clearTimeout(timer);

			try {
				const session = win.webContents.session;
				const cookies1 = await session.cookies.get({ domain: '.weread.qq.com' });
				const cookies2 = await session.cookies.get({ domain: 'weread.qq.com' });
				const allCookies = [...cookies1, ...cookies2];

				// 解析 cookie 键值对
				const cookieMap = new Map<string, string>();
				for (const c of allCookies) {
					cookieMap.set(c.name, c.value);
				}

				const wr_vid = cookieMap.get('wr_vid') || '';
				const wr_skey = cookieMap.get('wr_skey') || '';
				const wr_name = cookieMap.get('wr_name') || cookieMap.get('wr_local_name') || '';
				const wr_avatar = cookieMap.get('wr_avatar') || cookieMap.get('wr_local_avatar') || '';

				// 验证：wr_vid 必须存在，且 wr_name 或 wr_skey 至少有一个非空
				if (!wr_vid) {
					finish({ success: false, error: '未能获取 wr_vid，请重试' });
					return;
				}
				if (!wr_name && !wr_skey) {
					finish({ success: false, error: 'Cookie 不完整，请重试' });
					return;
				}

				const cookie: WereadCookie = {
					wr_vid,
					wr_skey,
					...(wr_name ? { wr_name } : {}),
					...(wr_avatar ? { wr_avatar } : {}),
				};

				finish({ success: true, cookie });
			} catch (err) {
				finish({
					success: false,
					error: `提取 Cookie 失败: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		});

		// 导航到登录页
		win.loadURL('https://weread.qq.com/#login');
	});
}
