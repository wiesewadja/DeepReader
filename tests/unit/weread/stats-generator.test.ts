import { describe, it, expect, vi } from 'vitest';
import { generateReadingStats } from '../../../src/weread/stats/stats-generator';
import type { WereadApiClient } from '../../../src/weread/api/client';
import type { WereadReadDataResponse } from '../../../src/weread/types';

function makeReadData(totalReadTime = 3600): WereadReadDataResponse {
	return {
		totalReadTime,
		readDays: 10,
		dayAverageReadTime: 360,
		registTime: 1609459200,
		readStat: [{ stat: '读完', counts: 5 }],
		readTimes: {
			'1704067200': 1800,
		},
	};
}

describe('stats-generator', () => {
	it('generates reading stats markdown', async () => {
		const client = {
			getReadingData: vi.fn().mockResolvedValue(makeReadData()),
		} as unknown as WereadApiClient;

		const { path, content } = await generateReadingStats(client, '阅读统计');

		expect(path).toBe('阅读统计/微信读书阅读统计.md');
		expect(content).toContain('微信读书 · 阅读数据分析');
		expect(content).toContain('历年总览');
		expect(content).toContain('1小时');
		expect(content).toContain('10 天');
	});

	it('formats duration correctly', async () => {
		const client = {
			getReadingData: vi.fn().mockResolvedValue(makeReadData(3665)),
		} as unknown as WereadApiClient;

		const { content } = await generateReadingStats(client, '');
		expect(content).toContain('1小时1分钟');
	});

	it('renders monthly bar chart when readTimes present', async () => {
		const client = {
			getReadingData: vi.fn().mockResolvedValue(makeReadData()),
		} as unknown as WereadApiClient;

		const { content } = await generateReadingStats(client, '');
		expect(content).toContain('每日阅读时长');
		expect(content).toContain('█');
	});
});
