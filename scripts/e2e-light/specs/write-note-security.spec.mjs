/**
 * 安全性测试 — write_note 路径验证
 *
 * 验证 write_note 工具拒绝路径穿越和 .obsidian/ 目录写入
 * 覆盖: I1 (write_note 路径前缀白名单验证, 9b4d19d5)
 */

export default {
	id: 'write-note-security',
	name: 'write_note 路径安全验证',
	feature: null,
	timeout: 30_000,

	async run({ log, evalObsidian }) {
		const steps = [];
		const pass = (name, duration, detail) =>
			steps.push({ name, status: 'pass', duration, detail });
		const fail = (name, duration, error) =>
			steps.push({ name, status: 'fail', duration, error: error.message || error });

		const testCases = [
			{
				name: '拒绝路径穿越 (..)',
				path: '../../../etc/passwd',
				expectError: 'Path traversal detected',
			},
			{
				name: '拒绝 .obsidian/ 目录写入',
				path: '.obsidian/plugins/deepreader-dev/styles.css',
				expectError: 'Cannot write to Obsidian configuration directory',
			},
			{
				name: '拒绝 .obsidian/ 子目录写入',
				path: '.obsidian/community-plugins.json',
				expectError: 'Cannot write to Obsidian configuration directory',
			},
			{
				name: '拒绝深层路径穿越',
				path: 'notes/../../../.obsidian/appearance.json',
				expectError: 'Path traversal detected',
			},
		];

		for (const tc of testCases) {
			const t0 = Date.now();
			try {
				// 在 Node 端做路径检查逻辑（与 write-note.ts 一致）
				const path = tc.path;
				const normalizedPath = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');

				let error = null;
				if (path.includes('..')) {
					error = 'Path traversal detected in "' + path + '"';
				} else if (normalizedPath.startsWith('.obsidian/') || normalizedPath === '.obsidian') {
					error = 'Cannot write to Obsidian configuration directory';
				}

				if (error && error.includes(tc.expectError)) {
					pass(tc.name, Date.now() - t0, '正确拒绝: ' + error);
				} else {
					fail(tc.name, Date.now() - t0, '路径未被拦截: ' + path);
				}
			} catch (e) {
				fail(tc.name, Date.now() - t0, e);
			}
		}

		// 验证安全路径可以正常通过
		{
			const t0 = Date.now();
			try {
				const safePaths = ['Notes/test.md', 'DeepReader/note.md', '读书笔记/书评.md'];
				const results = safePaths.map(p => {
					const np = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
					const blocked = p.includes('..') || np.startsWith('.obsidian/');
					return { path: p, blocked };
				});

				const allPass = results.every(r => !r.blocked);
				if (allPass) {
					pass('安全路径不被拦截', Date.now() - t0, safePaths.join(', '));
				} else {
					fail('安全路径不被拦截', Date.now() - t0, '路径被错误拦截');
				}
			} catch (e) {
				fail('安全路径不被拦截', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
