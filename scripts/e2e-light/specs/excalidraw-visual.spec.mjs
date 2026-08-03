/**
 * 轻量 E2E: Excalidraw 可视化生成
 *
 * 验证 VISUALIZER 路径下的图表生成：
 * 1. 发送绘图意图消息
 * 2. 轮询 .excalidraw 文件生成（VISUALIZER 输出不经过 messageList）
 * 3. JSON 验证：元素数、fontSize 合规、箭头连接
 * 4. 在 Obsidian 中打开文件并截图
 *
 * 前提：test-vault 有已索引书籍 + LLM API Key
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const BOOKS = {
	inferiority: { bookId: '9f77964d', name: '自卑与超越' },
	contagious: { bookId: 'd2b30962', name: '疯传' },
};

const TIMEOUT_RESPONSE = 240_000;
const POLL_INTERVAL = 5_000;
const SCREENSHOT_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'../../../tests/e2e/screenshots',
);

function progress(msg) {
	const ts = new Date().toTimeString().slice(0, 8);
	process.stdout.write(`  [${ts}] ${msg}\n`);
}

async function getExcalidrawFileCount() {
	return await evalObsidian(`(async () => {
		const adapter = app.vault.adapter;
		if (!await adapter.exists('Excalidraw')) return 0;
		const { files } = await adapter.list('Excalidraw');
		return files.filter(f => f.endsWith('.excalidraw')).length;
	})()`) || 0;
}

async function getLatestExcalidrawFile() {
	return await evalObsidian(`(async () => {
		const adapter = app.vault.adapter;
		if (!await adapter.exists('Excalidraw')) return null;
		const { files } = await adapter.list('Excalidraw');
		const exc = files.filter(f => f.endsWith('.excalidraw'));
		if (exc.length === 0) return null;
		const withTime = [];
		for (const f of exc) {
			const stat = await adapter.stat(f);
			withTime.push({ path: f, mtime: stat?.mtime ?? 0 });
		}
		withTime.sort((a, b) => a.mtime - b.mtime);
		return withTime[withTime.length - 1].path;
	})()`);
}

export default {
	id: 'excalidraw-visual',
	name: 'Excalidraw 可视化生成',
	feature: 'F-21',
	timeout: 600_000,
	requires: {},

	async run() {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			progress(`✓ ${name} (${(duration / 1000).toFixed(1)}s)${detail ? ' — ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
			progress(`✗ ${name} (${(duration / 1000).toFixed(1)}s) — ${error.message}`);
		}

		// 检查 API Key
		progress('检查前置条件...');
		const precheck = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader-dev"]?.settings;
			const providers = s?.providers || {};
			return { hasApiKey: !!(s?.deepseekApiKey || providers?.deepseek?.apiKey || s?.customApiKey) };
		})()`);
		if (!precheck?.hasApiKey) return { status: 'skip', reason: '未配置 LLM API Key' };
		progress('API Key ✓');

		// ===== Test 1: S1 思维导图 =====
		{
			progress('━━━ S1 思维导图 ━━━');
			const t0 = Date.now();
			try {
				const countBefore = await getExcalidrawFileCount();
				progress(`已有 ${countBefore} 个 .excalidraw 文件`);

				progress(`选择《${BOOKS.inferiority.name}》并发送绘图消息...`);
				await sendMessage('帮我画一张思维导图，展示这本书的核心概念体系', BOOKS.inferiority.bookId);

				// TTCF：异步 VISUALIZER 改造后应 < 5s（改造前 ~10s+）
				const ttfc1 = await measureTTCF(30_000);
				if (ttfc1 < 0) {
					progress('⚠ TTCF 测量超时（30s 内未检测到文本气泡内容）');
				} else {
					pass('S1 TTCF（首字符响应）', ttfc1, `${(ttfc1/1000).toFixed(1)}s (异步改造后应 < 5s)`);
				}

				// 双气泡检测：图表占位气泡应该已经在 messageList 里
				const msgCount1 = await countAssistantMessages();
				if (msgCount1 >= 2) {
					pass('S1 双气泡检测', Date.now() - t0, `${msgCount1} 条 assistant 消息（含占位气泡）`);
				} else {
					progress(`⚠ 双气泡未达标：${msgCount1} 条 assistant 消息（期望 ≥2）`);
				}

				progress('等待 .excalidraw 文件生成...');
				const latestFile = await waitForNewFile(countBefore, TIMEOUT_RESPONSE);

				if (!latestFile) throw new Error('超时：未检测到新的 .excalidraw 文件');
				pass('S1 思维导图生成', Date.now() - t0, latestFile);

				const t1 = Date.now();
				const analysis = await analyzeExcalidrawJSON(latestFile);
				if (analysis.total < 5) throw new Error(`元素数不足: ${analysis.total} < 5`);
				if (!analysis.fontSizeOk) progress(`⚠ fontSize: ${analysis.fontSizeWarnings.join('; ')}`);
				pass('S1 JSON 验证', Date.now() - t1,
					`${analysis.total} 元素, ${analysis.shapes} 形状, fontSizeOk=${analysis.fontSizeOk}`);

				const t2 = Date.now();
				const screenshotPath = await openAndScreenshot(latestFile, 's1-mindmap');
				pass('S1 截图', Date.now() - t2, screenshotPath);

			} catch (e) {
				fail('S1 思维导图', Date.now() - t0, e);
			}
		}

		// ===== Test 2: S2 流程图 =====
		{
			progress('━━━ S2 流程图 ━━━');
			const t0 = Date.now();
			try {
				const countBefore = await getExcalidrawFileCount();

				progress(`选择《${BOOKS.contagious.name}》并发送分析+绘图消息...`);
				await sendMessage('请分析疯传的 STEPPS 模型，并用流程图展示核心逻辑', BOOKS.contagious.bookId);

				// TTCF：S2 分析路径更长，但 formatter 应仍能 < 8s 启动
				const ttfc2 = await measureTTCF(60_000);
				if (ttfc2 < 0) {
					progress('⚠ TTCF 测量超时（60s 内未检测到文本气泡内容）');
				} else {
					pass('S2 TTCF（首字符响应）', ttfc2, `${(ttfc2/1000).toFixed(1)}s`);
				}

				// 双气泡检测
				const msgCount2 = await countAssistantMessages();
				if (msgCount2 >= 2) {
					pass('S2 双气泡检测', Date.now() - t0, `${msgCount2} 条 assistant 消息`);
				} else {
					progress(`⚠ 双气泡未达标：${msgCount2} 条 assistant 消息`);
				}

				progress('等待 .excalidraw 文件生成...');
				const latestFile = await waitForNewFile(countBefore, TIMEOUT_RESPONSE);

				if (!latestFile) throw new Error('超时：未检测到新的 .excalidraw 文件');
				pass('S2 流程图生成', Date.now() - t0, latestFile);

				const t1 = Date.now();
				const analysis = await analyzeExcalidrawJSON(latestFile);
				if (analysis.total < 5) throw new Error(`元素数不足: ${analysis.total} < 5`);
				if (analysis.arrows < 1) throw new Error(`流程图缺少箭头: ${analysis.arrows}`);
				if (!analysis.fontSizeOk) progress(`⚠ fontSize: ${analysis.fontSizeWarnings.join('; ')}`);
				pass('S2 JSON 验证', Date.now() - t1,
					`${analysis.total} 元素, ${analysis.arrows} 箭头, fontSizeOk=${analysis.fontSizeOk}`);

				const t2 = Date.now();
				const screenshotPath = await openAndScreenshot(latestFile, 's2-flowchart');
				pass('S2 截图', Date.now() - t2, screenshotPath);

			} catch (e) {
				fail('S2 流程图', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};

// ========== 辅助函数 ==========

/**
 * 测量 TTCF（首字符响应时间）。
 * 从当前时刻起轮询，直到 sidebar 内出现"非 loading dots"的 AI 消息内容。
 * 返回 elapsed ms；超时返回 -1。
 *
 * 改造前（visualizer 阻塞 formatter）：TTCF 通常 > 8s
 * 改造后（fire-and-forget）：TTCF 应 < 5s（formatter 立即开始流式）
 */
async function measureTTCF(timeoutMs = 30_000) {
	const start = Date.now();
	const deadline = start + timeoutMs;

	while (Date.now() < deadline) {
		await sleep(500);
		const ok = await evalObsidian(`(() => {
			const view = app.workspace.getLeavesOfType('deeppdf-sidebar-view')[0]?.view;
			if (!view) return false;
			const messages = view.messageList?.getMessages?.() || [];
			// 找一条 AI 消息且 content 非空
			for (const m of messages) {
				const d = m.getData?.() || m;
				if (d.role === 'assistant' && !d.isDiagramPlaceholder && d.content && d.content.trim().length > 5) {
					return true;
				}
			}
			return false;
		})()`);
		if (ok) return Date.now() - start;
	}
	return -1;
}

/**
 * 数当前 sidebar 中的 assistant 消息数（含图表占位气泡）。
 * 用于双气泡 UX 验证：图表生成期间应同时存在 ≥2 条（文本 + 占位）。
 */
async function countAssistantMessages() {
	return await evalObsidian(`(() => {
		const view = app.workspace.getLeavesOfType('deeppdf-sidebar-view')[0]?.view;
		if (!view) return 0;
		const messages = view.messageList?.getMessages?.() || [];
		return messages.filter(m => (m.getData?.() || m).role === 'assistant').length;
	})()`) || 0;
}

/** 发送消息：打开 sidebar → 选书 → 等 textarea 就绪 → 发送 */
async function sendMessage(question, bookId) {
	// 打开 sidebar
	await evalObsidian(`(() => {
		app.commands.executeCommandById("deepreader-dev:open-deepreader-sidebar");
		return true;
	})()`);
	await sleep(2000);

	// 选书
	if (bookId) {
		await evalObsidian(`(() => {
			const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
			if (leaves.length === 0) throw new Error('sidebar 未打开');
			if (typeof leaves[0].view.selectIndex === 'function')
				leaves[0].view.selectIndex(${JSON.stringify(bookId)});
			return true;
		})()`);
		await sleep(2000);
	}

	// 强制停止残留 streaming + 解锁 textarea
	await evalObsidian(`(() => {
		const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
		if (!leaves.length) return;
		const view = leaves[0].view;
		if (view.isAiStreaming) {
			if (typeof view.frontendAgent?.chat?.abort === 'function') view.frontendAgent.chat.abort();
			view.isAiStreaming = false;
		}
		if (view.chatInput?.textarea?.disabled) view.chatInput.setDisabled(false);
		// 不要清空消息列表，保留历史消息
	})()`);
	await sleep(1000);

	// 等 textarea 就绪（最多 30s）
	for (let i = 0; i < 30; i++) {
		const ok = await evalObsidian(`(() => {
			const ta = app.workspace.getLeavesOfType('deeppdf-sidebar-view')[0]?.view?.chatInput?.textarea;
			return ta && !ta.disabled;
		})()`);
		if (ok) break;
		await sleep(1000);
	}

	// setValue + send
	const result = await evalObsidian(`(() => {
		const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
		if (!leaves.length) throw new Error('sidebar 未打开');
		const view = leaves[0].view;
		if (view.chatInput?.textarea?.disabled) view.chatInput.setDisabled(false);
		view.chatInput.setValue(${JSON.stringify(question)});
		const btn = document.querySelector('.deeppdf-chat-input-send-btn');
		if (!btn || btn.disabled) throw new Error('发送按钮不可用');
		btn.click();
		return { sent: true };
	})()`);
	progress(`发送结果: ${JSON.stringify(result)}`);
}

/** 轮询等待新的 .excalidraw 文件生成 */
async function waitForNewFile(countBefore, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let pollCount = 0;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL);
		pollCount++;

		const countNow = await getExcalidrawFileCount();
		if (countNow > countBefore) {
			progress(`检测到新文件 (从 ${countBefore} → ${countNow})`);
			return await getLatestExcalidrawFile();
		}

		// 每 15s 打印进度
		if (pollCount % 3 === 0) {
			const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
			const remaining = Math.round((deadline - Date.now()) / 1000);
			process.stdout.write(`  [${new Date().toTimeString().slice(0, 8)}] 等待文件生成... ${elapsed}s elapsed, ~${remaining}s remaining\n`);
		}
	}

	progress('⚠ 超时：未检测到新文件');
	return null;
}

async function analyzeExcalidrawJSON(filepath) {
	return await evalObsidian(`(async () => {
		const content = JSON.parse(await app.vault.adapter.read(${JSON.stringify(filepath)}));
		const texts = content.elements.filter(e => e.type === 'text');
		const shapes = content.elements.filter(e =>
			['rectangle', 'ellipse', 'diamond'].includes(e.type));
		const arrows = content.elements.filter(e => e.type === 'arrow');

		const fontSizeWarnings = [];
		for (const t of texts) {
			if (!t.containerId && t.fontSize > 22)
				fontSizeWarnings.push('自由文本 "' + t.id + '" fontSize=' + t.fontSize + ' > 22');
			if (t.containerId) {
				const c = content.elements.find(e => e.id === t.containerId);
				if (c) {
					const max = c.width >= 300 ? 24 : c.width >= 220 ? 20 : c.width >= 160 ? 16 : 14;
					if (t.fontSize > max)
						fontSizeWarnings.push('容器文本 "' + t.id + '" fontSize=' + t.fontSize + ' > ' + max);
				}
			}
		}

		return {
			total: content.elements.length,
			texts: texts.length,
			shapes: shapes.length,
			arrows: arrows.length,
			fontSizeOk: fontSizeWarnings.length === 0,
			fontSizeWarnings,
		};
	})()`);
}

async function openAndScreenshot(filepath, testName) {
	await evalObsidian(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(filepath)});
		if (file) await app.workspace.getLeaf(false).openFile(file);
		return true;
	})()`);
	await sleep(3000);

	if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

	try {
		const { stdout } = await execFileAsync('obsidian', [
			'dev:cdp',
			'method=Page.captureScreenshot',
			'params={"format":"jpeg","quality":50}',
		], { timeout: 15_000, maxBuffer: 20 * 1024 * 1024 });

		const payload = JSON.parse(stdout);
		const data = payload.result?.data;
		if (!data) throw new Error('CDP 截图返回空数据');

		const filePath = path.join(SCREENSHOT_DIR, `${testName}-${Date.now()}.jpg`);
		fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
		return filePath;
	} catch (e) {
		progress(`⚠ 截图失败: ${e.message}`);
		return '(截图失败)';
	}
}

function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}
