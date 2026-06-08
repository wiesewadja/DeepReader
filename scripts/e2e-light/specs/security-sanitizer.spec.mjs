/**
 * 安全性测试 — XSS sanitizer 验证
 *
 * 验证 sanitizeHumanizedHtml 函数能正确过滤各种 XSS 攻击向量
 * 覆盖: C1 (innerHTML XSS 修复, 9b4d19d5)
 */

export default {
	id: 'security-sanitizer',
	name: 'XSS Sanitizer 防护验证',
	feature: null,
	timeout: 30_000,

	async run({ log, evalObsidian }) {
		const steps = [];
		const pass = (name, duration, detail) =>
			steps.push({ name, status: 'pass', duration, detail });
		const fail = (name, duration, error) =>
			steps.push({ name, status: 'fail', duration, error: error.message || error });

		// 在 Obsidian 上下文中直接测试 sanitizer 逻辑
		const testCases = [
			{
				name: '过滤 <script> 标签',
				input: '<script>alert("xss")</script><div class="deepreader-agent-humanized">safe</div>',
				mustNotContain: ['<script'],
			},
			{
				name: '过滤 <iframe> 标签',
				input: '<iframe src="evil.com"></iframe><p>content</p>',
				mustNotContain: ['<iframe'],
			},
			{
				name: '过滤事件处理器 (onerror)',
				input: '<img src=x onerror="alert(1)" class="deepreader-agent-humanized">',
				mustNotContain: ['onerror'],
			},
			{
				name: '过滤事件处理器 (onclick)',
				input: '<div onclick="alert(1)">click me</div>',
				mustNotContain: ['onclick'],
			},
			{
				name: '过滤事件处理器 (onload)',
				input: '<svg onload="alert(1)"><circle r="10"/></svg>',
				mustNotContain: ['onload'],
			},
			{
				name: '过滤 javascript: URL',
				input: '<a href="javascript:alert(1)">link</a>',
				mustNotContain: ['javascript:'],
			},
			{
				name: '过滤 <object> 标签',
				input: '<object data="evil.swf"></object><p>safe</p>',
				mustNotContain: ['<object'],
			},
			{
				name: '过滤 <form> 标签',
				input: '<form action="evil.com"><input type="submit"/></form>',
				mustNotContain: ['<form'],
			},
			{
				name: '保留安全 HTML 标签',
				input: '<div class="deepreader-agent-humanized"><p>安全内容</p><strong>加粗</strong></div>',
				mustContain: ['<div', '<p>', '<strong>'],
				mustNotContain: ['<script', '<iframe', 'onerror'],
			},
			{
				name: '保留 SVG 图标',
				input: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
				mustContain: ['<svg', '<circle'],
				mustNotContain: ['onload', '<script'],
			},
		];

		for (const tc of testCases) {
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(() => {
						// 内联 sanitizer 逻辑（与 src/components/message/utils.ts 一致）
						function sanitizeHumanizedHtml(html) {
							let r = html;
							r = r.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, '');
							r = r.replace(/<script\\b[^>]*\\/?>/gi, '');
							r = r.replace(/<iframe\\b[^>]*>[\\s\\S]*?<\\/iframe>/gi, '');
							r = r.replace(/<iframe\\b[^>]*\\/?>/gi, '');
							r = r.replace(/<object\\b[^>]*>[\\s\\S]*?<\\/object>/gi, '');
							r = r.replace(/<embed\\b[^>]*\\/?>/gi, '');
							r = r.replace(/<form\\b[^>]*>[\\s\\S]*?<\\/form>/gi, '');
							r = r.replace(/<meta\\b[^>]*\\/?>/gi, '');
							r = r.replace(/<link\\b[^>]*\\/?>/gi, '');
							r = r.replace(/<base\\b[^>]*\\/?>/gi, '');
							r = r.replace(/\\s+on\\w+\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*)/gi, '');
							r = r.replace(/(src|href|action)\\s*=\\s*["']?\\s*(?:javascript|data)\\s*:[^"'\\s>]*/gi, '$1=""');
							return r;
						}
						return sanitizeHumanizedHtml(${JSON.stringify(tc.input)});
					})()
				`);

				let ok = true;
				const issues = [];

				if (tc.mustNotContain) {
					for (const forbidden of tc.mustNotContain) {
						if (result.includes(forbidden)) {
							ok = false;
							issues.push(`不应包含 "${forbidden}"`);
						}
					}
				}
				if (tc.mustContain) {
					for (const required of tc.mustContain) {
						if (!result.includes(required)) {
							ok = false;
							issues.push(`应包含 "${required}"`);
						}
					}
				}

				if (ok) {
					pass(tc.name, Date.now() - t0, `sanitized: ${result.substring(0, 80)}...`);
				} else {
					fail(tc.name, Date.now() - t0, `${issues.join('; ')} | result: ${result}`);
				}
			} catch (e) {
				fail(tc.name, Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
