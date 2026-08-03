#!/usr/bin/env node
/**
 * Smoke 入口
 *
 * 用法:
 *   node scripts/smoke/smoke.mjs                  # 默认跑 core
 *   node scripts/smoke/smoke.mjs --level full     # 跑 full
 *   node scripts/smoke/smoke.mjs --only S-22,S-23 # 指定场景
 *   node scripts/smoke/smoke.mjs --verbose        # 详细输出
 *   node scripts/smoke/smoke.mjs --no-color       # 禁用彩色
 *   node scripts/smoke/smoke.mjs --no-env-check   # 跳过环境检查
 *
 * 退出码:
 *   0 = 全部 PASS（或仅 SKIP）
 *   1 = 任一 FAIL
 *   2 = 配置错误（如参数错误）
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { Reporter } from './reporter.mjs';
import { coreChecks } from './checks/core/index.mjs';
import { fullChecks } from './checks/full/index.mjs';
import { checkEnvironment } from '../e2e-light/env-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 参数解析 */
function parseArgs(argv) {
	const args = {
		level: 'core',  // core | full
		only: null,     // 逗号分隔的 ID 列表
		verbose: false,
		noColor: !!process.env.NO_COLOR,
		noEnvCheck: false,  // 跳过环境检查
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--level' || a === '-l') {
			const v = argv[++i];
			if (v !== 'core' && v !== 'full') {
				console.error(`错误: --level 必须是 core 或 full (收到 "${v}")`);
				process.exit(2);
			}
			args.level = v;
		} else if (a === '--only' || a === '-o') {
			args.only = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
		} else if (a === '--verbose' || a === '-v') {
			args.verbose = true;
		} else if (a === '--no-color') {
			args.noColor = true;
		} else if (a === '--no-env-check') {
			args.noEnvCheck = true;
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
DeepReader 冒烟测试

用法:
  node scripts/smoke/smoke.mjs [选项]

选项:
  -l, --level <core|full>   跑哪一层 (默认 core)
  -o, --only <id,id,...>    只跑指定场景
  -v, --verbose             详细输出（含错误堆栈）
  --no-color                禁用彩色
  --no-env-check            跳过环境检查（不推荐）
  -h, --help                显示帮助

示例:
  node scripts/smoke/smoke.mjs
  node scripts/smoke/smoke.mjs --level full
  node scripts/smoke/smoke.mjs --only S-RES,S-22
  node scripts/smoke/smoke.mjs --verbose

退出码:
  0 = 全部 PASS
  1 = 任一 FAIL
  2 = 配置错误
`);
}

/** 加载 check 列表 */
function loadChecks(args) {
	let pool = args.level === 'full' ? [...coreChecks, ...fullChecks] : [...coreChecks];

	if (args.only) {
		pool = pool.filter(c => args.only.includes(c.id));
		if (pool.length === 0) {
			console.error(`错误: --only 过滤后无场景可跑 (指定: ${args.only.join(',')})`);
			process.exit(2);
		}
	}
	return pool;
}

/** 执行单个 check（带超时 + 计时） */
async function runOne(check, ctx) {
	const start = Date.now();
	try {
		const result = await Promise.race([
			check.run(ctx),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error(`超时 (${check.timeout}ms)`)), check.timeout)
			),
		]);
		// 允许 check 主动返回 SKIP（不需 throw）
		if (result && result.status === 'skip') {
			return {
				id: check.id,
				name: check.name,
				status: 'skip',
				duration: Date.now() - start,
				reason: result.reason || '未提供原因',
			};
		}
		return {
			id: check.id,
			name: check.name,
			status: 'pass',
			duration: Date.now() - start,
			detail: result,
		};
	} catch (err) {
		// 允许 check throw with skip=true 表达 SKIP
		if (err && err.skip === true) {
			return {
				id: check.id,
				name: check.name,
				status: 'skip',
				duration: Date.now() - start,
				reason: err.message,
			};
		}
		return {
			id: check.id,
			name: check.name,
			status: 'fail',
			duration: Date.now() - start,
			error: err,
			context: err.context,
		};
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.noColor) process.env.NO_COLOR = '1';

	const reporter = new Reporter({ verbose: args.verbose });
	const checks = loadChecks(args);

	console.log(`\n🧪 DeepReader 冒烟测试 — level: ${args.level} (${checks.length} 场景)\n`);

	// 环境健康检查（除非明确跳过）
	if (!args.noEnvCheck) {
		console.log('🔍 检查环境...');
		const envCheck = await checkEnvironment();
		if (!envCheck.ok) {
			console.log('\x1b[31m✗ 环境检查失败\x1b[0m\n');
			for (const err of envCheck.errors) {
				console.log(`  \x1b[31m• ${err}\x1b[0m`);
			}
			console.log('\n\x1b[90m──────────────────────────────────────\x1b[0m');
			console.log('\x1b[31m测试套件停止: 环境不就绪\x1b[0m');
			console.log('\x1b[90m──────────────────────────────────────\x1b[0m');
			console.log('\n提示: 运行 npm run setup:test-env 配置测试环境');
			process.exit(2);
		}
		console.log('\x1b[32m✓ 环境检查通过\x1b[0m\n');
	}

	const ctx = {
		projectRoot: PROJECT_ROOT,
		log: {
			info: (m) => args.verbose && console.log(`  [info] ${m}`),
			warn: (m) => console.log(`  [warn] ${m}`),
			error: (m) => console.log(`  [error] ${m}`),
		},
	};

	// 串行执行（避免 Obsidian CLI 抢资源）
	for (const check of checks) {
		const result = await runOne(check, ctx);
		reporter.report(result);
	}

	const summary = reporter.summary();

	// 退出码
	if (summary.failed > 0) {
		process.exit(1);
	}
	process.exit(0);
}

main().catch(e => {
	console.error('Smoke 崩溃:', e);
	process.exit(2);
});
