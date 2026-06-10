#!/usr/bin/env node
/**
 * CLI E2E 测试运行器
 *
 * 用法:
 *   node tests/e2e-cli/run.mjs                       # 运行全部
 *   node tests/e2e-cli/run.mjs --only plugin-health   # 指定 spec
 *   node tests/e2e-cli/run.mjs --verbose
 */

import { readdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = resolve(__dirname, 'specs');

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const onlyIds = onlyIdx !== -1 ? args[onlyIdx + 1]?.split(',') : null;
const noColor = args.includes('--no-color');

const c = noColor ? { green: s => s, red: s => s, yellow: s => s, gray: s => s, bold: s => s } : {
	green: s => `\x1b[32m${s}\x1b[0m`,
	red: s => `\x1b[31m${s}\x1b[0m`,
	yellow: s => `\x1b[33m${s}\x1b[0m`,
	gray: s => `\x1b[90m${s}\x1b[0m`,
	bold: s => `\x1b[1m${s}\x1b[0m`,
};

async function loadSpecs() {
	const files = await readdir(SPECS_DIR);
	const specs = [];
	for (const file of files.sort()) {
		if (!file.endsWith('.mjs')) continue;
		const mod = await import(resolve(SPECS_DIR, file));
		const spec = mod.default;
		if (!spec?.id || !spec?.run) continue;
		if (onlyIds && !onlyIds.includes(spec.id)) continue;
		specs.push(spec);
	}
	return specs;
}

async function main() {
	const specs = await loadSpecs();
	if (specs.length === 0) {
		console.log(onlyIds ? c.yellow('没有匹配的 spec') : c.yellow('没有发现 spec 文件'));
		process.exit(2);
	}

	console.log(`\n${c.bold('🧪 CLI E2E 业务测试')}${c.gray(` (${specs.length} 个 spec)`)}\n`);

	let passed = 0, failed = 0;

	for (const spec of specs) {
		const timeout = spec.timeout || 30_000;
		console.log(`  ${c.bold(spec.name)} ${c.gray(`[${spec.id}]`)}`);

		try {
			const result = await Promise.race([
				spec.run(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error(`spec 超时 (${timeout}ms)`)), timeout)
				),
			]);

			for (const step of result.steps || []) {
				const icon = step.status === 'pass' ? '✅' : '❌';
				const dur = c.gray(`(${step.duration}ms)`);
				const detail = step.detail ? c.gray(` — ${step.detail}`) : '';
				const error = step.error ? c.red(` — ${step.error}`) : '';
				console.log(`    ${icon} ${step.name} ${dur}${detail}${error}`);
			}

			const hasFailure = (result.steps || []).some(s => s.status === 'fail');
			if (hasFailure) { failed++; } else { passed++; }
		} catch (e) {
			failed++;
			console.log(`    ${c.red('❌ ' + e.message)}`);
		}
		console.log();
	}

	const total = passed + failed;
	console.log(c.bold('─'.repeat(40)));
	if (failed === 0) {
		console.log(c.green(`  ✅ 全部通过 (${total}/${total})`));
	} else {
		console.log(c.red(`  ❌ ${failed} 失败, ${passed} 通过 (${total}/${total})`));
	}
	console.log();

	process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
	console.error(c.red(`\n❌ 运行器错误: ${e.message}\n`));
	process.exit(2);
});
