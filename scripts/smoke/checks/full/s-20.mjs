/**
 * S-20: 高亮元素
 *
 * 锚定: F-20 高亮 + 摘录保存
 * SKIP: 需进入阅读模式并选中文字才能产生高亮元素
 */

export default {
	id: 'S-20',
	name: '高亮元素',
	level: 'full',
	feature: 'F-20',
	timeout: 1_000,

	async run() {
		return {
			status: 'skip',
			reason: '高亮元素需在阅读模式中选中文字触发，超出冒烟可达性范围',
		};
	},
};
