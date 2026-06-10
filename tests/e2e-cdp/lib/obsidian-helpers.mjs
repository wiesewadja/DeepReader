import { PLUGIN_ID } from '../../lib/constants.mjs';
/**
 * Obsidian 高层操作助手
 *
 * 基于 CDP client 的 evaluateJSON / command 方法，
 * 封装 DeepReader 特定的测试操作。
 */

/**
 * 检查插件是否已加载
 */
export async function isPluginLoaded(client) {
	return client.evaluateJSON(`!!app.plugins?.plugins?.[${JSON.stringify(PLUGIN_ID)}]`);
}

/**
 * 打开 DeepReader 侧边栏
 */
export async function openSidebar(client) {
	await client.command(`${PLUGIN_ID}:open-deepreader-sidebar`);
	await client.waitForSelector('.deeppdf-chat-container', 5000);
}

/**
 * 在 Obsidian 中打开文件
 */
export async function openFile(client, filePath) {
	await client.evaluateJSON(`
		(async () => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(filePath)});
			if (!file) throw new Error('文件不存在: ' + ${JSON.stringify(filePath)});
			const leaf = app.workspace.getUnpinnedLeaf();
			await leaf.openFile(file);
		})()
	`);
}

/**
 * 激活阅读模式
 */
export async function activateReadingModeForFile(client, filePath) {
	return client.evaluateJSON(`
		(() => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(filePath)});
			const svc = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.readingModeService;
			if (!file) return { ok: false, error: 'file not found' };
			if (!svc) return { ok: false, error: 'readingModeService not found' };
			svc.activate(file);
			return { ok: true, active: svc.isActive };
		})()
	`);
}

/**
 * 关闭阅读模式
 */
export async function deactivateReadingMode(client) {
	await client.evaluateJSON(`
		const svc = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.readingModeService;
		if (svc) svc.deactivate();
	`);
}

/**
 * 等待 AI 流式响应完成
 */
export async function waitForStreamingDone(client, timeout = 60_000) {
	await client.waitForSelectorGone('.deeppdf-message-streaming', timeout);
}
