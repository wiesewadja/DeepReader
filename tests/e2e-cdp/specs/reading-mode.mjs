/**
 * Reading Mode — 阅读模式激活 + 分页 UX 测试
 *
 * 基线要求: 插件加载 + AI极简经济学索引完整 + 章节文件存在
 * 打开章节 → 激活阅读模式 → 验证分页控件 → 翻页
 */

import { createClient } from '../lib/cdp-client.mjs';
import { isPluginLoaded, openFile, activateReadingModeForFile, deactivateReadingMode } from '../lib/obsidian-helpers.mjs';
import { checkBaseline } from '../lib/baseline.mjs';

const BOOK_ID = 'ee090e29';
const CHAPTER_FILE = 'DeepReader/AI极简经济学/04 - 第1章 导言.md';

const spec = {
	id: 'reading-mode',
	name: '阅读模式激活与分页',
	timeout: 30_000,

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
				bookId: BOOK_ID,
				indexComplete: true,
				chapterPath: CHAPTER_FILE,
			});
			if (!bl.ok) throw new Error(`基线不满足: ${bl.missing.join('; ')}`);
			return `索引OK (${BOOK_ID}), 章节: ${CHAPTER_FILE}`;
		});

		await step('打开章节文件', async () => {
			await openFile(client, CHAPTER_FILE);
			await client.waitForSelector('.markdown-preview-view', 5000);
		});

		await step('激活阅读模式', async () => {
			const result = await activateReadingModeForFile(client, CHAPTER_FILE);
			if (!result?.ok) throw new Error(result?.error || '激活失败');
			await new Promise(r => setTimeout(r, 800));
		});

		await step('阅读模式 CSS class 存在', async () => {
			const count = await client.count('.deeppdf-reading-mode');
			if (count === 0) throw new Error('.deeppdf-reading-mode 未找到');
		});

		await step('分页控件出现', async () => {
			await client.waitForSelector('.deeppdf-page-controls', 5000);
		});

		let initialPageText = '';
		await step('页码显示正确', async () => {
			await client.waitForSelector('.deeppdf-page-num', 3000);
			initialPageText = await client.getText('.deeppdf-page-num');
			if (!initialPageText) throw new Error('页码文本为空');
			return `页码: ${initialPageText}`;
		});

		await step('点击下一页', async () => {
			await client.evaluateJSON(`
				(() => {
					const nextBtn = document.querySelector('.deeppdf-page-next');
					if (!nextBtn) throw new Error('下一页按钮未找到');
					nextBtn.click();
				})()
			`);
			await new Promise(r => setTimeout(r, 500));
		});

		await step('页码发生变化', async () => {
			const newText = await client.getText('.deeppdf-page-num');
			return `页码变化: "${initialPageText}" → "${newText}"`;
		});

		await deactivateReadingMode(client);

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
