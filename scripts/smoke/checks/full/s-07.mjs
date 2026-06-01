/**
 * S-07: 闲聊路由元素
 *
 * 锚定: F-07 闲聊问答
 * SKIP: Sidebar 输入/消息区已在 S-22 完整覆盖
 */

export default {
	id: 'S-07',
	name: '闲聊路由元素',
	level: 'full',
	feature: 'F-07',
	timeout: 1_000,

	async run() {
		return {
			status: 'skip',
			reason: 'Sidebar 输入/消息区已在 S-22 完整覆盖（.deeppdf-chat-input-textarea + .deeppdf-message-list）',
		};
	},
};
