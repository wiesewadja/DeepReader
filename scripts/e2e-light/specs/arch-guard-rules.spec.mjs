/**
 * 架构守卫 — 动态 import/re-export 检测验证
 *
 * 验证 arch-guard.mjs 能正确检测动态 import() 和 re-export 语句
 * 覆盖: I6 (arch-guard 补充动态 import/re-export 匹配, 9b4d19d5)
 */

import { execSync } from 'child_process';
import { join } from 'path';

export default {
	id: 'arch-guard-rules',
	name: 'Arch Guard 动态 import 检测',
	feature: null,
	timeout: 30_000,

	async run({ log, projectRoot }) {
		const steps = [];
		const pass = (name, duration, detail) =>
			steps.push({ name, status: 'pass', duration, detail });
		const fail = (name, duration, error) =>
			steps.push({ name, status: 'fail', duration, error: error.message || error });

		// Step 1: 验证 arch-guard 全量扫描通过
		{
			const t0 = Date.now();
			try {
				const output = execSync('node scripts/arch-guard.mjs', {
					cwd: projectRoot,
					encoding: 'utf-8',
					timeout: 15_000,
				});

				if (output.includes('没有发现架构违规')) {
					pass('arch-guard 全量扫描无违规', Date.now() - t0, output.match(/扫描: (\d+)/)?.[1] + ' 个文件');
				} else {
					fail('arch-guard 全量扫描无违规', Date.now() - t0, `发现违规:\n${output}`);
				}
			} catch (e) {
				// arch-guard --strict 模式退出码 1 表示有违规
				fail('arch-guard 全量扫描无违规', Date.now() - t0, e.stdout || e.message);
			}
		}

		// Step 2: 验证 arch-guard 脚本包含动态 import 检测
		{
			const t0 = Date.now();
			try {
				const fs = await import('fs');
				const archGuardPath = join(projectRoot, 'scripts', 'arch-guard.mjs');
				const content = fs.readFileSync(archGuardPath, 'utf-8');

				const hasDynamicImport = content.includes('DYNAMIC_IMPORT_RE');
				const hasReexport = content.includes('REEXPORT_RE');

				if (hasDynamicImport && hasReexport) {
					pass('arch-guard 包含动态 import/re-export 正则', Date.now() - t0,
						`DYNAMIC_IMPORT_RE=${hasDynamicImport}, REEXPORT_RE=${hasReexport}`);
				} else {
					fail('arch-guard 包含动态 import/re-export 正则', Date.now() - t0,
						`DYNAMIC_IMPORT_RE=${hasDynamicImport}, REEXPORT_RE=${hasReexport}`);
				}
			} catch (e) {
				fail('arch-guard 包含动态 import/re-export 正则', Date.now() - t0, e);
			}
		}

		// Step 3: 验证 arch-guard 未使用 statSync/normalize（死导入清理）
		{
			const t0 = Date.now();
			try {
				const fs = await import('fs');
				const archGuardPath = join(projectRoot, 'scripts', 'arch-guard.mjs');
				const content = fs.readFileSync(archGuardPath, 'utf-8');

				const importLine = content.split('\n').find(l => l.includes('from \'fs\''));
				const pathImportLine = content.split('\n').find(l => l.includes('from \'path\''));

				const noStatSync = !importLine?.includes('statSync');
				const noNormalize = !pathImportLine?.includes('normalize');

				if (noStatSync && noNormalize) {
					pass('arch-guard 死导入已清理', Date.now() - t0, 'statSync/normalize 已移除');
				} else {
					fail('arch-guard 死导入已清理', Date.now() - t0,
						`statSync=${!noStatSync}, normalize=${!noNormalize}`);
				}
			} catch (e) {
				fail('arch-guard 死导入已清理', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
