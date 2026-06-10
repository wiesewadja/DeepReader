/**
 * Selection Quote — 文本选择 → 引用卡片 UX 测试
 *
 * 基线要求: 插件加载 + AI极简经济学索引完整 + 章节文件存在
 * 打开章节 → 激活阅读模式 → 选中文本 → 验证选择工具栏 →
 * 点击引用 → 验证侧边栏 quote card
 */

import { createClient } from '../lib/cdp-client.mjs';
import { isPluginLoaded, openFile, activateReadingModeForFile, deactivateReadingMode } from '../lib/obsidian-helpers.mjs';
import { checkBaseline } from '../lib/baseline.mjs';

const BOOK_ID = 'ee090e29';
const CHAPTER_FILE = 'DeepReader/AI极简经济学/04 - 第1章 导言.md';

const spec = {
	id: 'selection-quote',
	name: '文本选择引用卡片流',
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

		await step('打开章节并激活阅读模式', async () => {
			await openFile(client, CHAPTER_FILE);
			await client.waitForSelector('.markdown-preview-view', 5000);
			const result = await activateReadingModeForFile(client, CHAPTER_FILE);
			if (!result?.ok) throw new Error(result?.error || '激活失败');
			await new Promise(r => setTimeout(r, 1000));
		});

		await step('程序化选中文本', async () => {
			const result = await client.evaluateJSON(`
				(() => {
					const view = document.querySelector('.markdown-preview-view');
					if (!view) return { ok: false, reason: 'no .markdown-preview-view' };
					const p = view.querySelector('p');
					if (!p || !p.textContent.trim()) return { ok: false, reason: 'no paragraph with text' };

					const range = document.createRange();
					range.selectNodeContents(p);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);

					const rect = p.getBoundingClientRect();
					const evt = new MouseEvent('mouseup', {
						clientX: rect.left + rect.width / 2,
						clientY: rect.top + rect.height / 2,
						bubbles: true,
					});
					p.dispatchEvent(evt);

					return { ok: true, text: p.textContent.substring(0, 50) };
				})()
			`);
			if (!result?.ok) throw new Error(result?.reason || '选中文本失败');
			return `选中: "${result.text}..."`;
		});

		await step('选择工具栏出现', async () => {
			await client.waitForSelector('.deeppdf-selection-toolbar.visible', 5000);
			return 'toolbar visible';
		});

		await step('引用按钮存在', async () => {
			const count = await client.count('.deeppdf-toolbar-btn[data-action="quote"]');
			if (count === 0) throw new Error('quote 按钮未找到');
			return `${count} 个 quote 按钮`;
		});

		await step('点击引用按钮', async () => {
			await client.evaluateJSON(`
				document.querySelector('.deeppdf-toolbar-btn[data-action="quote"]')?.click()
			`);
		});

		await step('侧边栏出现引用卡片', async () => {
			await client.waitForSelector('.deeppdf-quote-card', 5000);
			const count = await client.count('.deeppdf-quote-card');
			return `${count} 张引用卡片`;
		});

		await step('引用文本非空', async () => {
			const text = await client.getText('.deeppdf-quote-text');
			if (!text || text.length === 0) throw new Error('引用文本为空');
			return `引用长度: ${text.length} 字符`;
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
