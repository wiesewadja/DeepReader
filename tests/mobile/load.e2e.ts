import * as fs from 'fs';
import * as path from 'path';
import { browser } from '@wdio/globals';

const PLUGIN_ID = 'deepreader-dev';
const PLUGIN_DIR = `.obsidian/plugins/${PLUGIN_ID}`;

/**
 * 真实插件部署 + 加载测试
 *
 * 策略：pushFile 直接推送到 vault 目录（不是 /data/local/tmp/）。
 * adapter 只能访问 vault 内的路径，所以必须推送到 vault 内部。
 */
describe('真实插件部署 + 加载', function () {
	const projectRoot = path.resolve(__dirname, '../..');

	before(async () => {
		// ── 获取 vault 绝对路径 ──
		const vaultBase = await browser.execute(() => {
			const adapter = (window as any).app?.vault?.adapter;
			return adapter?.basePath || '';
		});
		console.log(`[deploy] vault basePath: ${vaultBase}`);

		// vault 路径是相对路径（如 test-vault-xxx-wdio-copy），
		// 需要通过 ls 找到绝对路径
		const vaultFiles = await browser.execute('mobile: shell', {
			command: 'ls',
			args: ['-NA1', '/storage/emulated/0/Android/data/md.obsidian/files'],
		});
		console.log(`[deploy] vault files: ${vaultFiles}`);

		// 找到匹配 vaultBase 的目录
		const vaultDir = (vaultFiles as string).split('\n').find((f: string) => f.includes(vaultBase));
		if (!vaultDir) {
			throw new Error(`Vault directory not found for basePath: ${vaultBase}`);
		}
		const vaultAbs = `/storage/emulated/0/Android/data/md.obsidian/files/${vaultDir}`;
		const pluginAbs = `${vaultAbs}/${PLUGIN_DIR}`;
		console.log(`[deploy] vault absolute: ${vaultAbs}`);
		console.log(`[deploy] plugin absolute: ${pluginAbs}`);

		// ── 创建插件目录 ──
		await browser.execute('mobile: shell', {
			command: 'mkdir',
			args: ['-p', pluginAbs],
		});

		// ── 推送 manifest.json（小文件）──
		const manifest = fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf-8');
		await browser.pushFile(`${pluginAbs}/manifest.json`, Buffer.from(manifest).toString('base64'));
		console.log(`[deploy] manifest.json pushed (${manifest.length} bytes)`);

		// ── 推送 styles.css（228KB）──
		const styles = fs.readFileSync(path.join(projectRoot, 'bin/styles.css'), 'utf-8');
		await browser.pushFile(`${pluginAbs}/styles.css`, Buffer.from(styles).toString('base64'));
		console.log(`[deploy] styles.css pushed (${styles.length} bytes)`);

		// ── 推送 main.js（3.3MB）──
		const mainJs = fs.readFileSync(path.join(projectRoot, 'bin/main.js'), 'utf-8');
		console.log(`[deploy] pushing main.js (${mainJs.length} bytes)...`);
		await browser.pushFile(`${pluginAbs}/main.js`, Buffer.from(mainJs).toString('base64'));
		console.log(`[deploy] main.js pushed`);

		// ── 验证推送的文件 ──
		const ls = await browser.execute('mobile: shell', {
			command: 'ls',
			args: ['-la', pluginAbs],
		});
		console.log(`[deploy] ls: ${ls}`);

		// ── 更新 community-plugins.json ──
		await browser.execute('mobile: shell', {
			command: 'cat',
			args: [`${vaultAbs}/.obsidian/community-plugins.json`],
		}).then(async (raw: string) => {
			try {
				const arr = JSON.parse(raw);
				if (!arr.includes(PLUGIN_ID)) {
					arr.push(PLUGIN_ID);
					const json = JSON.stringify(arr);
					// 用 printf 写入避免单引号问题
					await browser.execute('mobile: shell', {
						command: 'sh',
						args: ['-c', `printf '%s' '${json.replace(/'/g, "'\\''")}' > ${vaultAbs}/.obsidian/community-plugins.json`],
					});
					console.log(`[deploy] community-plugins.json updated`);
				} else {
					console.log(`[deploy] community-plugins.json already has plugin`);
				}
			} catch (e: any) {
				console.log(`[deploy] community-plugins.json parse error: ${e.message}, creating new`);
				await browser.execute('mobile: shell', {
					command: 'sh',
					args: ['-c', `printf '%s' '["${PLUGIN_ID}"]' > ${vaultAbs}/.obsidian/community-plugins.json`],
				});
			}
		});
	});

	it('验证插件文件存在且大小正确', async () => {
		const verify = await browser.execute(async (pluginDir: string) => {
			const adapter = (window as any).app?.vault?.adapter;
			const manifest = await adapter.read(`${pluginDir}/manifest.json`).catch(() => '');
			const mainJs = await adapter.read(`${pluginDir}/main.js`).catch(() => '');
			const styles = await adapter.read(`${pluginDir}/styles.css`).catch(() => '');

			return {
				manifestSize: manifest.length,
				mainSize: mainJs.length,
				stylesSize: styles.length,
				mainHasDeepReader: mainJs.includes('DeepReader') || mainJs.includes('deepreader'),
				mainHasPluginClass: mainJs.includes('class') && mainJs.includes('extends'),
			};
		}, PLUGIN_DIR);
		console.log('[verify]', JSON.stringify(verify, null, 2));

		expect(verify.manifestSize).toBeGreaterThan(50);
		expect(verify.mainSize).toBeGreaterThan(100000);
		expect(verify.mainHasDeepReader).toBe(true);
	});

	it('通过 Obsidian 插件系统加载', async () => {
		await browser.pause(2000);

		// 先检查插件系统基本状态
		const preState = await browser.execute(() => {
			const app = (window as any).app;
			return {
				hasPlugins: !!app?.plugins,
				manifestKeys: Object.keys(app?.plugins?.manifests || {}),
				pluginKeys: Object.keys(app?.plugins?.plugins || {}),
				enabledPlugins: [...(app?.plugins?.enabledPlugins || [])],
			};
		});
		console.log('[pre-load state]', JSON.stringify(preState, null, 2));

		const loadResult = await browser.execute(async (pluginId: string) => {
			const app = (window as any).app;
			const results: any = {};

			// loadManifest
			try {
				const manifest = await app.plugins.loadManifest(pluginId);
				results.manifest = manifest ? { id: manifest.id, name: manifest.name } : null;
				results.manifestKeys = Object.keys(app.plugins.manifests || {});
			} catch (e: any) {
				results.loadManifestError = e.message;
			}

			// loadPlugin
			try {
				const plugin = await app.plugins.loadPlugin(pluginId);
				results.pluginLoaded = !!plugin;
				results.loaded = plugin?._loaded;
				results.pluginKeys = Object.keys(app.plugins.plugins || {});
				if (plugin) {
					results.manifestId = plugin.manifest?.id;
					results.hasOnload = typeof plugin.onload === 'function';
					results.hasApp = !!plugin.app;
				}
			} catch (e: any) {
				results.loadPluginError = e.message;
				results.loadPluginStack = e.stack?.substring(0, 800);
			}

			// enablePluginAndSave
			try {
				await app.plugins.enablePluginAndSave(pluginId);
				results.afterEnable = {
					enabledPlugins: [...(app.plugins.enabledPlugins || [])],
					pluginKeys: Object.keys(app.plugins.plugins || {}),
				};
			} catch (e: any) {
				results.enableError = e.message;
			}

			return results;
		}, PLUGIN_ID);
		console.log('[load]', JSON.stringify(loadResult, null, 2));

		// 不硬断言，先看结果
	});

	it('插件状态验证', async () => {
		const state = await browser.execute((pluginId: string) => {
			const app = (window as any).app;
			const plugin = app?.plugins?.plugins?.[pluginId];
			if (!plugin) return { error: 'plugin not found' };
			return {
				loaded: plugin._loaded,
				hasApp: !!plugin.app,
				manifestId: plugin.manifest?.id,
				manifestVersion: plugin.manifest?.version,
				pluginKeys: Object.keys(app?.plugins?.plugins || {}),
			};
		}, PLUGIN_ID);
		console.log('[state]', JSON.stringify(state, null, 2));

		expect(state.loaded).toBe(true);
		expect(state.manifestId).toBe(PLUGIN_ID);
	});
});
