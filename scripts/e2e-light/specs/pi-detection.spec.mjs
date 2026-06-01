/**
 * 轻量 E2E: PI CLI 检测
 *
 * 对比: tests/e2e/specs/pi-detection.e2e.ts (145 行 WDIO)
 * 验证 PI CLI 在 Obsidian Electron 环境中可检测 + npm 可用
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

export default {
	id: 'pi-detection',
	name: 'PI CLI 检测',
	feature: 'F-30',
	timeout: 60_000,

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// ===== PI CLI 检测 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const { spawn } = require('child_process');
					const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
					const existingPath = (process.env.PATH ?? '').split(':');
					const env = { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') };
					const candidates = ['/opt/homebrew/bin/pi', '/usr/local/bin/pi', 'pi'];

					return (async () => {
						for (const cliPath of candidates) {
							try {
								const output = await new Promise((resolve, reject) => {
									const child = spawn(cliPath, ['--version'], {
										timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env,
									});
									let out = '';
									child.stdout.on('data', d => { out += d.toString(); });
									child.stderr.on('data', d => { out += d.toString(); });
									child.on('error', reject);
									child.on('close', code => {
										code === 0 ? resolve(out.trim()) : reject(new Error('Exit ' + code));
									});
								});
								if (/^\\d+\\.\\d+\\.\\d+/.test(output)) {
									return { detected: true, version: output, path: cliPath };
								}
							} catch { continue; }
						}
						return { detected: false };
					})();
				})()`);

				if (!result?.detected) throw new Error('PI CLI 未检测到');
				pass('PI CLI 检测', Date.now() - t0, `version=${result.version}, path=${result.path}`);
			} catch (e) {
				fail('PI CLI 检测', Date.now() - t0, e);
			}
		}

		// ===== PI CLI help 输出 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const { spawn } = require('child_process');
					const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
					const existingPath = (process.env.PATH ?? '').split(':');
					const env = { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') };
					const candidates = ['/opt/homebrew/bin/pi', '/usr/local/bin/pi', 'pi'];

					return (async () => {
						for (const cliPath of candidates) {
							try {
								const output = await new Promise((resolve, reject) => {
									const child = spawn(cliPath, ['--help'], {
										timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], env,
									});
									let out = '';
									child.stdout.on('data', d => { out += d.toString(); });
									child.stderr.on('data', d => { out += d.toString(); });
									child.on('error', reject);
									child.on('close', code => {
										code === 0 ? resolve(out.trim()) : reject(new Error('Exit ' + code));
									});
								});
								if (output.length > 0) {
									return { success: true, output: output.slice(0, 200), path: cliPath };
								}
							} catch { continue; }
						}
						return { success: false };
					})();
				})()`, { timeout: 15_000 });

				if (!result?.success) throw new Error('pi --help 无输出');
				pass('PI CLI help', Date.now() - t0, result.output?.slice(0, 80));
			} catch (e) {
				fail('PI CLI help', Date.now() - t0, e);
			}
		}

		// ===== npm 可用性 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const { spawn } = require('child_process');
					const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
					const existingPath = (process.env.PATH ?? '').split(':');
					const env = { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') };

					return new Promise((resolve) => {
						const child = spawn('npm', ['--version'], {
							timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], env,
						});
						let out = '';
						child.stdout.on('data', d => { out += d.toString(); });
						child.stderr.on('data', d => { out += d.toString(); });
						child.on('error', e => resolve({ success: false, error: e.message }));
						child.on('close', code => {
							if (code === 0) resolve({ success: true, version: out.trim() });
							else resolve({ success: false, error: 'Exit ' + code + ': ' + out.trim() });
						});
					});
				})()`);

				if (!result?.success) throw new Error(`npm 不可用: ${result?.error}`);
				pass('npm 可用性', Date.now() - t0, `version=${result.version}`);
			} catch (e) {
				fail('npm 可用性', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
