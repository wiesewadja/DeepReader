/**
 * Chat Flow — 侧边栏聊天消息流 UX 测试
 *
 * 基线要求: 插件加载 + 书籍已索引 + 书籍已选中
 * 打开侧边栏 → 输入消息 → 发送 → 等待 AI 回复 → 验证回复非空
 */

import { createClient } from '../lib/cdp-client.mjs';
import { isPluginLoaded, openSidebar, waitForStreamingDone } from '../lib/obsidian-helpers.mjs';
import { checkBaseline } from '../lib/baseline.mjs';

const spec = {
	id: 'chat-flow',
	name: '聊天侧边栏消息流',
	timeout: 120_000,

	async run() {
		const client = createClient();
		const steps = [];
		const step = async (name, fn) => {
			const start = Date.now();
			try {
				const detail = await fn();
				steps.push({ name, status: 'pass', duration: Date.now() - start, detail: detail || '' });
			} catch (e) {
				steps.push({ name, status: 'fail', duration: Date.now() - start, error: e.message });
				throw e;
			}
		};

		// ── 基线检查 ──
		await step('基线: 环境检测', async () => {
			const bl = await checkBaseline(client, {
				indexComplete: true,
				bookSelected: true,
			});
			if (!bl.ok) throw new Error(`基线不满足: ${bl.missing.join('; ')}`);
			const sel = bl.details.selectedBook;
			return `索引OK, 当前选中: ${sel?.indexId}`;
		});

		await step('打开侧边栏', async () => {
			await openSidebar(client);
			const count = await client.count('.deeppdf-chat-container');
			if (count === 0) throw new Error('侧边栏未出现');
			return 'deeppdf-chat-container found';
		});

		// 记录发送前的消息数量
		const userBefore = await client.count('.deeppdf-message-user');
		const assistantBefore = await client.count('.deeppdf-message-assistant');

		await step('输入消息并发送', async () => {
			await client.waitForSelector('.deeppdf-chat-input-textarea', 3000);
			await client.type('.deeppdf-chat-input-textarea', '你好');
			await client.click('.deeppdf-chat-input-send-btn');
		});

		await step('用户消息出现', async () => {
			await client.waitForSelector('.deeppdf-message-user', 5000);
			const count = await client.count('.deeppdf-message-user');
			if (count <= userBefore) throw new Error(`新用户消息未出现 (之前 ${userBefore}, 现在 ${count})`);
			return `${count} 条用户消息 (+${count - userBefore})`;
		});

		await step('AI 回复出现', async () => {
			// 等待 assistant 消息数量增加
			const start = Date.now();
			while (Date.now() - start < 60_000) {
				const count = await client.count('.deeppdf-message-assistant');
				if (count > assistantBefore) return `${count} 条 AI 消息 (+${count - assistantBefore})`;
				await new Promise(r => setTimeout(r, 500));
			}
			throw new Error('AI 回复超时 (60s)');
		});

		await step('流式传输完成', async () => {
			await waitForStreamingDone(client, 60_000);
		});

		await step('AI 回复内容非空', async () => {
			// 取最后一条 assistant 消息的 content
			const text = await client.evaluateJSON(`
				(() => {
					const msgs = document.querySelectorAll('.deeppdf-message-assistant');
					const last = msgs[msgs.length - 1];
					return last?.querySelector('.deeppdf-message-content')?.textContent?.trim() || '';
				})()
			`);
			if (!text || text.length === 0) throw new Error('AI 回复内容为空');
			return `回复长度: ${text.length} 字符`;
		});

		return { steps };
	},
};

// 独立运行
const url = import.meta.url;
if (process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	console.log(`\n🧪 ${spec.name}`);
	try {
		const result = await spec.run();
		for (const s of result.steps) {
			const icon = s.status === 'pass' ? '✅' : '❌';
			console.log(`  ${icon} ${s.name} (${s.duration}ms)${s.detail ? ' — ' + s.detail : ''}`);
		}
		console.log();
	} catch (e) {
		console.error(`\n❌ 测试失败: ${e.message}\n`);
		process.exit(1);
	}
}

export default spec;
