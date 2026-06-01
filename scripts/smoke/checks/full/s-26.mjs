/**
 * S-26: 微信读书命令
 *
 * 锚定: F-26 微信读书账号绑定
 * SKIP: 4 个 weread-* 命令已在 S-CMD 覆盖
 */

export default {
	id: 'S-26',
	name: '微信读书命令',
	level: 'full',
	feature: 'F-26',
	timeout: 1_000,

	async run() {
		return {
			status: 'skip',
			reason: '4 个 weread-* 命令已在 S-CMD 覆盖（weread-login/sync/sync-force/logout）',
		};
	},
};
