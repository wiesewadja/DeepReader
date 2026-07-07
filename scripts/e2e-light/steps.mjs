/**
 * 共享步骤记录器 —— 取代各 spec 内重复的本地 pass/fail 定义。
 *
 * 双重职责：
 *   1. 收集 steps[] 供 run.mjs 汇总（spec 级别 + step 级别计数、诚实判 FAIL）。
 *   2. 实时打印每一步结果，提供运行期进度反馈（默认即打印，不依赖 --verbose）。
 *
 * 用法（spec.run 内）:
 *   import { createStepRecorder } from '../steps.mjs';
 *   const { steps, pass, fail, skip } = createStepRecorder();
 *   ...
 *   pass('plugin loaded', Date.now() - t0);
 *   return { steps, live: true };  // live:true 让 run.mjs 跳过末尾重复汇总
 */

const COLOR = {
	reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
	yellow: '\x1b[33m', gray: '\x1b[90m',
};

function paint(text, code) {
	if (process.env.NO_COLOR) return text;
	return `${COLOR[code]}${text}${COLOR.reset}`;
}

export function createStepRecorder() {
	const steps = [];

	const pass = (name, duration, detail) => {
		steps.push({ name, status: 'pass', duration, detail });
		const dur = paint(`(${Math.round(duration)}ms)`, 'gray');
		const detailStr = detail ? `  ${detail}` : '';
		console.log(`  ${paint('✓', 'green')} ${name} ${dur}${detailStr}`);
	};

	const fail = (name, duration, error) => {
		const message = error?.message ?? String(error);
		steps.push({ name, status: 'fail', duration, error: message });
		const dur = paint(`(${Math.round(duration)}ms)`, 'gray');
		console.log(`  ${paint('✗', 'red')} ${name} ${dur}  ${paint(message, 'red')}`);
	};

	const skip = (name, duration, reason) => {
		steps.push({ name, status: 'skip', duration, reason });
		const dur = paint(`(${Math.round(duration)}ms)`, 'gray');
		console.log(`  ${paint('⏭', 'yellow')} ${name} ${dur}`);
	};

	return { steps, pass, fail, skip };
}
