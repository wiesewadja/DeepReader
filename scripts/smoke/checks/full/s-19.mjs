/**
 * S-19: 阅读进度元素
 *
 * 锚定: F-19 阅读进度追踪
 * SKIP: 需进入阅读模式且有阅读历史才能看到进度元素
 */

export default {
	id: 'S-19',
	name: '阅读进度元素',
	level: 'full',
	feature: 'F-19',
	timeout: 1_000,

	async run() {
		return {
			status: 'skip',
			reason: '阅读进度元素需进入阅读模式且有阅读历史，超出冒烟可达性范围',
		};
	},
};
