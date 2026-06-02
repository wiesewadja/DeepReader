#!/usr/bin/env node
/**
 * 轻量 E2E 入口
 *
 * 用法:
 *   node scripts/e2e-light/run.mjs                          # 跑全部
 *   node scripts/e2e-light/run.mjs --only reading-mode-...  # 跑指定 spec
 *   node scripts/e2e-light/run.mjs --verbose                # 详细输出
 *   node scripts/e2e-light/run.mjs --no-color               # 禁用彩色
 *
 * 退出码:
 *   0 = 全部 PASS
 *   1 = 任一 FAIL
 *   2 = 配置错误
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { e2eLightSpecs } from './specs/index.mjs';
import { evalObsidian } from '../smoke/lib/obsidian-cli.mjs';
import { countBySelector, listPrefixedClasses } from '../smoke/lib/dom-query.mjs';
import { checkRequires } from './baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 参数解析 */
function parseArgs(argv) {
	const args = {
		only: null,
		verbose: false,
		noColor: !!process.env.NO_COLOR,
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--only' || a === '-o') {
			args.only = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
		} else if (a === '--verbose' || a === '-v') {
			args.verbose = true;
		} else if (a === '--no-color') {
			args.noColor = true;
		} else if (a === '--help' || a === '-h') {
			printHelp();
			process.exit(0);
		} else {
			console.error(`错误: 未知参数 "${a}"`);
			printHelp();
			process.exit(2);
		}
	}
	return args;
}

function printHelp() {
	console.log(`
DeepReader 轻量 E2E

用法:
  node scripts/e2e-light/run.mjs [选项]

选项:
  -o, --only <id,id,...>    只跑指定 spec
  -v, --verbose             详细输出
  --no-color                禁用彩色
  -h, --help                显示帮助

示例:
  node scripts/e2e-light/run.mjs
  node scripts/e2e-light/run.mjs --only reading-mode-pagination
  node scripts/e2e-light/run.mjs --verbose

退出码:
  0 = 全部 PASS
  1 = 任一 FAIL
  2 = 配置错误
`);
}

/** 加载 spec 列表 */
function loadSpecs(args) {
	let pool = [...e2eLightSpecs];

	if (args.only) {
		pool = pool.filter(s => args.only.includes(s.id));
		if (pool.length === 0) {
			console.error(`错误: --only 过滤后无 spec 可跑 (指定: ${args.only.join(',')})`);
			process.exit(2);
		}
	}
	return pool;
}

/** 执行单个 spec（带超时 + 计时） */
async function runOne(spec, ctx) {
	const start = Date.now();
	try {
		const result = await Promise.race([
			spec.run(ctx),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error(`超时 (${spec.timeout}ms)`)), spec.timeout)
			),
		]);

		// spec 主动 SKIP
		if (result && result.status === 'skip') {
			return {
				id: spec.id,
				name: spec.name,
				status: 'skip',
				duration: Date.now() - start,
				reason: result.reason || '未提供原因',
				steps: [],
			};
		}

		// 提取内部 steps
		const steps = result?.steps || [];

		return {
			id: spec.id,
			name: spec.name,
			status: 'pass',
			duration: Date.now() - start,
			steps,
		};
	} catch (err) {
		if (err && err.skip === true) {
			return {
				id: spec.id,
				name: spec.name,
				status: 'skip',
				duration: Date.now() - start,
				reason: err.message,
				steps: [],
			};
		}
		return {
			id: spec.id,
			name: spec.name,
			status: 'fail',
			duration: Date.now() - start,
			error: err,
			context: err.context,
			steps: [],
		};
	}
}

/** 输出 spec 级别报告 */
function reportSpec(result) {
	const COLOR = {
		reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
		yellow: '\x1b[33m', gray: '\x1b[90m',
	};
	const c = (t, code) => process.env.NO_COLOR ? t : `${COLOR[code]}${t}${COLOR.reset}`;
	const time = c(`[${new Date().toTimeString().slice(0, 8)}]`, 'gray');
	const dur = c(`(${formatDur(result.duration)})`, 'gray');

	if (result.status === 'pass') {
		console.log(`${time} ${c('✓ PASS', 'green')}  ${result.id}  ${result.name}  ${dur}`);
	} else if (result.status === 'fail') {
		console.log(`${time} ${c('✗ FAIL', 'red')}  ${result.id}  ${result.name}  ${dur}`);
		if (result.error) console.log(`           ${c('错误:', 'red')} ${result.error.message}`);
		if (result.context) console.log(`           ${c('上下文:', 'yellow')} ${result.context}`);
	} else if (result.status === 'skip') {
		console.log(`${time} ${c('⏭ SKIP', 'yellow')}  ${result.id}  ${result.name}  ${dur}`);
		if (result.reason) console.log(`           ${c('原因:', 'yellow')} ${result.reason}`);
	}
}

function formatDur(ms) {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** 输出 spec 的内部步骤 */
function reportSteps(steps) {
	for (const step of steps) {
		// 步骤用较短的显示格式，不走 reporter 的 id/name 列布局
		const icon = step.status === 'pass' ? '  ✓' : step.status === 'skip' ? '  ⏭' : '  ✗';
		const dur = `(${step.duration}ms)`;
		const detail = step.detail ? `  ${step.detail}` : '';
		const errMsg = step.error ? `\n           错误: ${step.error}` : '';
		console.log(`           ${icon} ${step.name.padEnd(40)} ${dur}${detail}${errMsg}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.noColor) process.env.NO_COLOR = '1';

	const specs = loadSpecs(args);

	console.log(`\n🧪 DeepReader 轻量 E2E (${specs.length} spec)\n`);

	const ctx = {
		projectRoot: PROJECT_ROOT,
		evalObsidian,
		countBySelector,
		listPrefixedClasses,
		log: {
			info: (m) => args.verbose && console.log(`  [info] ${m}`),
			warn: (m) => console.log(`  [warn] ${m}`),
			error: (m) => console.log(`  [error] ${m}`),
		},
	};

	// baseline 前置检查 + 串行执行
	const allResults = [];
	for (const spec of specs) {
		if (spec.requires && Object.keys(spec.requires).length > 0) {
			const baseline = await checkRequires(spec.requires);
			if (!baseline.ok) {
				const skipResult = {
					id: spec.id,
					name: spec.name,
					status: 'skip',
					duration: 0,
					reason: 'baseline 不满足:\n           ' + baseline.missing.join('\n           '),
					steps: [],
				};
				allResults.push(skipResult);
				reportSpec(skipResult);
				continue;
			}
		}

		const result = await runOne(spec, ctx);
		allResults.push(result);

		// spec 级别报告（自行格式化，适应长 ID）
		reportSpec(result);

		// 内部步骤报告
		if (result.steps?.length > 0) {
			reportSteps(result.steps);
		}
	}

	// 汇总（含 spec 级别 + step 级别计数）
	const specPassed = allResults.filter(r => r.status === 'pass').length;
	const specFailed = allResults.filter(r => r.status === 'fail').length;
	const specSkipped = allResults.filter(r => r.status === 'skip').length;
	const stepResults = allResults.flatMap(r => r.steps || []);
	const stepPassed = stepResults.filter(s => s.status === 'pass').length;
	const stepFailed = stepResults.filter(s => s.status === 'fail').length;
	const totalMs = allResults.reduce((sum, r) => sum + r.duration, 0);

		console.log('');
	console.log('\x1b[90m──────────────────────────────────────\x1b[0m');
	console.log(`Spec: ${allResults.length}   步骤通过: \x1b[32m${stepPassed}\x1b[0m   步骤失败: \x1b[31m${stepFailed}\x1b[0m   跳过: \x1b[33m${specSkipped}\x1b[0m`);
	console.log(`耗时: ${(totalMs / 1000).toFixed(1)}s`);
	console.log('\x1b[90m──────────────────────────────────────\x1b[0m');

	if (specFailed > 0 || stepFailed > 0) {
		process.exit(1);
	}
	process.exit(0);
}

main().catch(e => {
	console.error('E2E 崩溃:', e);
	process.exit(2);
});
