/**
 * Smoke 报告器 — 彩色输出
 *
 * 输出格式：
 *   [HH:MM:SS] ✓ PASS  S-22    Sidebar 聊天界面      (0.8s)
 *   [HH:MM:SS] ✗ FAIL  S-23    Library 书库          (0.5s)
 *              错误: ...
 *              上下文: ...
 *   [HH:MM:SS] ⏭ SKIP  S-29    Z-Lib 设置开关        (0.0s)
 *              原因: ...
 *
 * ──────────
 * 总计: 26   通过: 24   失败: 1   跳过: 1
 * 耗时: 28.4s
 * ──────────
 */

const COLOR = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	gray: '\x1b[90m',
	bold: '\x1b[1m',
	cyan: '\x1b[36m',
};

function timestamp() {
	const d = new Date();
	return d.toTimeString().slice(0, 8);
}

function colorize(text, color) {
	if (process.env.NO_COLOR) return text;
	const code = COLOR[color];
	if (!code) return text;  // 防御：未知颜色名直接返回原文本
	return `${code}${text}${COLOR.reset}`;
}

function pad(s, n) {
	s = String(s);
	return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function formatDuration(ms) {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export class Reporter {
	constructor({ verbose = false } = {}) {
		this.verbose = verbose;
		this.results = [];
	}

	/**
	 * 报告单个场景结果
	 * @param {Object} result
	 * @param {string} result.id         - 场景 ID 如 S-22
	 * @param {string} result.name       - 场景名
	 * @param {'pass'|'fail'|'skip'} result.status
	 * @param {number} result.duration   - 毫秒
	 * @param {string} [result.reason]   - SKIP 原因
	 * @param {Error}  [result.error]    - FAIL 错误对象
	 * @param {Object} [result.context]  - 失败时上下文（DOM 类名列表、命令列表等）
	 */
	report(result) {
		this.results.push(result);
		const time = colorize(`[${timestamp()}]`, 'gray');
		const dur = colorize(`(${formatDuration(result.duration)})`, 'gray');

		if (result.status === 'pass') {
			const icon = colorize('✓ PASS', 'green');
			console.log(`${time} ${icon}  ${pad(result.id, 7)} ${pad(result.name, 32)} ${dur}`);
		} else if (result.status === 'fail') {
			const icon = colorize('✗ FAIL', 'red');
			console.log(`${time} ${icon}  ${pad(result.id, 7)} ${pad(result.name, 32)} ${dur}`);
			if (result.error) {
				console.log(`           ${colorize('错误:', 'red')} ${result.error.message}`);
			}
			if (result.context) {
				console.log(`           ${colorize('上下文:', 'yellow')} ${result.context}`);
			}
			if (this.verbose && result.error?.stack) {
				console.log(colorize(result.error.stack.split('\n').slice(0, 5).join('\n'), 'gray'));
			}
		} else if (result.status === 'skip') {
			const icon = colorize('⏭ SKIP', 'yellow');
			console.log(`${time} ${icon}  ${pad(result.id, 7)} ${pad(result.name, 32)} ${dur}`);
			if (result.reason) {
				console.log(`           ${colorize('原因:', 'yellow')} ${result.reason}`);
			}
		}
	}

	/**
	 * 输出汇总
	 */
	summary() {
		const passed = this.results.filter(r => r.status === 'pass').length;
		const failed = this.results.filter(r => r.status === 'fail').length;
		const skipped = this.results.filter(r => r.status === 'skip').length;
		const total = this.results.length;
		const totalMs = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log('');
		console.log(colorize('──────────────────────────────────────', 'gray'));
		const summaryText = `总计: ${total}   通过: ${colorize(passed, 'green')}   失败: ${colorize(failed, 'red')}   跳过: ${colorize(skipped, 'yellow')}`;
		console.log(summaryText);
		console.log(`耗时: ${formatDuration(totalMs)}`);
		console.log(colorize('──────────────────────────────────────', 'gray'));

		return { total, passed, failed, skipped, durationMs: totalMs };
	}
}
