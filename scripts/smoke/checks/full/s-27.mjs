/**
 * S-27: 微信同步进度元素
 *
 * 锚定: F-27 微信读书标注同步
 * SKIP: 需触发同步操作才能看到进度 UI
 */

export default {
	id: 'S-27',
	name: '微信同步进度元素',
	level: 'full',
	feature: 'F-27',
	timeout: 1_000,

	async run() {
		return {
			status: 'skip',
			reason: '同步进度 UI 需触发微信同步操作，超出冒烟可达性范围',
		};
	},
};
