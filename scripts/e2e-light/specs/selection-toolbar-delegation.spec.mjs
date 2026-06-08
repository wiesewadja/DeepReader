/**
 * 阅读模式 — SelectionToolbar 事件委托验证
 *
 * 验证 selection-toolbar 使用事件委托模式，避免 show() 时重复绑定事件
 * 覆盖: I3 (selection-toolbar innerHTML 事件泄漏, 9b4d19d5)
 */

export default {
	id: 'selection-toolbar-delegation',
	name: 'SelectionToolbar 事件委托验证',
	feature: 'F-17',
	timeout: 30_000,

	async run({ log, evalObsidian }) {
		const steps = [];
		const pass = (name, duration, detail) =>
			steps.push({ name, status: 'pass', duration, detail });
		const fail = (name, duration, error) =>
			steps.push({ name, status: 'fail', duration, error: error.message || error });
		const skip = (name, duration, reason) =>
			steps.push({ name, status: 'skip', duration, error: reason });

		// Step 1: 验证 bundle 中包含事件委托代码
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						// 检查事件委托模式：toolbarEl 上统一的 click 监听
						const hasDelegation = mainJs.includes('closest') &&
							mainJs.includes('.deeppdf-toolbar-btn');
						// 检查是否移除了 forEach 逐按钮绑定
						// 不应存在 "绑定工具栏按钮事件" 的 forEach 模式在 show() 中
						return { hasDelegation };
					})()
				`);

				if (result.hasDelegation) {
					pass('事件委托模式存在', Date.now() - t0, 'toolbarEl 使用 closest() 进行事件委托');
				} else {
					fail('事件委托模式存在', Date.now() - t0, '未找到事件委托代码');
				}
			} catch (e) {
				fail('事件委托模式存在', Date.now() - t0, e);
			}
		}

		// Step 2: 验证 HIGHLIGHT_COLORS 来源统一
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						// yellow 颜色应统一为 0.4 opacity（来自 types/highlight.ts）
						const yellow04 = mainJs.includes('rgba(255, 235, 59, 0.4)');
						const yellow05 = mainJs.includes('rgba(255, 235, 59, 0.5)');
						return { yellow04, yellow05 };
					})()
				`);

				if (result.yellow04 && !result.yellow05) {
					pass('HIGHLIGHT_COLORS yellow 统一为 0.4', Date.now() - t0, 'selection-menu 使用共享定义');
				} else if (result.yellow04 && result.yellow05) {
					fail('HIGHLIGHT_COLORS yellow 统一为 0.4', Date.now() - t0,
						'存在 0.5 opacity 的 yellow 定义，说明 selection-menu 未完全统一');
				} else {
					fail('HIGHLIGHT_COLORS yellow 统一为 0.4', Date.now() - t0,
						`yellow04=${result.yellow04}, yellow05=${result.yellow05}`);
				}
			} catch (e) {
				fail('HIGHLIGHT_COLORS yellow 统一为 0.4', Date.now() - t0, e);
			}
		}

		// Step 3: 验证 setupScrollHandler 为空壳
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						// 不应包含 "Scroll handler setup failed" 文本
						// sidebar-view setupScrollHandler 不应包含 scroll-to-hide 输入框逻辑
						// 检查 sidebar-view 编译产物中不再有 Scroll handler setup failed
						const hasActiveScrollHandler = mainJs.includes("Scroll handler setup failed");
						return { hasActiveScrollHandler };
					})()
				`);

				if (!result.hasActiveScrollHandler) {
					pass('setupScrollHandler 为空壳', Date.now() - t0, '滚动隐藏输入框功能已禁用');
				} else {
					fail('setupScrollHandler 为空壳', Date.now() - t0, '滚动隐藏逻辑仍然存在');
				}
			} catch (e) {
				fail('setupScrollHandler 为空壳', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
