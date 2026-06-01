/**
 * 轻量 E2E: 微信读书网关 API 全链路调试
 *
 * 对比: tests/e2e/specs/weread-api-debug.e2e.ts (148 行 WDIO)
 * 通过网关代理逐步调用每个 API 查看真实返回结构
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';

async function callGateway(apiName, body, apiKey) {
	return evalObsidian(`(() => {
		const { requestUrl } = require('obsidian');
		return requestUrl({
			url: ${JSON.stringify(GATEWAY_URL)},
			method: 'POST',
			headers: {
				'Authorization': 'Bearer ' + ${JSON.stringify(apiKey)},
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(${JSON.stringify({ api_name: apiName, skill_version: '1.0.3', ...body })}),
		}).then(r => r.json);
	})()`, { timeout: 30_000 });
}

export default {
	id: 'weread-api-debug',
	name: '微信读书网关 API',
	feature: 'F-26',
	timeout: 180_000,

	async run({ log }) {
		const steps = [];
		let firstBookId = '';

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// Step 1: 获取 API Key
		let apiKey;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`app.plugins.plugins['deepreader']?.settings?.wereadApiKey`);
				if (!result) {
					return {
						status: 'skip',
						reason: 'wereadApiKey 未配置（需先通过命令 deepreader:weread-login 配置）',
					};
				}
				apiKey = result;
				pass('获取 API Key', Date.now() - t0, `length=${apiKey.length}`);
			} catch (e) {
				fail('获取 API Key', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 2: notebook API
		{
			const t0 = Date.now();
			try {
				const data = await callGateway('/user/notebooks', {}, apiKey);
				if (data.errcode && data.errcode !== 0) throw new Error(`errcode=${data.errcode}`);
				const books = data.books || [];
				firstBookId = books[0]?.bookId || '';
				pass('notebook API', Date.now() - t0, `total=${books.length}, firstBookId=${firstBookId?.slice(0, 12)}`);
			} catch (e) {
				fail('notebook API', Date.now() - t0, e);
			}
		}

		// Step 3-6: 依赖 firstBookId 的 API
		const apis = [
			{ name: 'highlights API', api: '/book/bookmarklist', bodyKey: 'bookId' },
			{ name: 'chapters API', api: '/book/chapterinfo', bodyKey: 'bookId' },
			{ name: 'reviews API', api: '/review/list/mine', bodyKey: 'bookid' },
			{ name: 'progress API', api: '/book/getprogress', bodyKey: 'bookId' },
		];

		for (const api of apis) {
			const t0 = Date.now();
			if (!firstBookId) {
				steps.push({ name: api.name, status: 'skip', duration: 0, error: 'no bookId' });
				continue;
			}
			try {
				const data = await callGateway(api.api, { [api.bodyKey]: firstBookId }, apiKey);
				if (data.errcode && data.errcode !== 0) throw new Error(`errcode=${data.errcode}`);
				pass(api.name, Date.now() - t0, `keys=${Object.keys(data).slice(0, 5).join(',')}`);
			} catch (e) {
				fail(api.name, Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
