/**
 * 阅读统计文档生成器
 * 参考 weread 插件的 syncReadingStats.ts 实现
 */

import type { WereadApiClient } from '../api/client';
import type { WereadReadDataResponse } from '../types';

function fmtDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0 && m > 0) return `${h}小时${m}分钟`;
	if (h > 0) return `${h}小时`;
	return `${m}分钟`;
}

function fmtTs(ts: number): string {
	if (!ts) return '—';
	const d = new Date(ts * 1000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderBarChart(values: number[], labels: string[], maxWidth = 20): string {
	const maxVal = Math.max(...values, 1);
	return values.map((v, i) => {
		const barLen = Math.round((v / maxVal) * maxWidth);
		const bar = '█'.repeat(barLen) + '░'.repeat(maxWidth - barLen);
		const label = labels[i].padEnd(4, ' ');
		return `${label} ${bar} ${fmtDuration(v)}`;
	}).join('\n');
}

const HOUR_LABELS = ['6时','7时','8时','9时','10时','11时','12时','13时','14时','15时','16时','17时','18时','19时','20时','21时','22时','23时','0时','1时','2时','3时','4时','5时'];

function buildMarkdown(
	overall: WereadReadDataResponse,
	annual: WereadReadDataResponse,
	monthly: WereadReadDataResponse,
	year: number,
	month: number
): string {
	const now = new Date();
	const lines: string[] = [];

	// Frontmatter
	lines.push('---');
	lines.push(`title: 微信读书 · 阅读统计`);
	lines.push(`updated: ${now.toISOString().slice(0, 10)}`);
	lines.push(`tags:`);
	lines.push(`  - 阅读统计`);
	lines.push(`  - 微信读书`);
	lines.push('---');
	lines.push('');

	// 标题
	lines.push('# 📚 微信读书 · 阅读数据分析');
	lines.push('');
	lines.push(`> 最后更新：${now.toLocaleString('zh-CN', { hour12: false })}`);
	lines.push('');

	// 一、总览
	lines.push('## 📊 一、历年总览');
	lines.push('');

	const totalH = fmtDuration(overall.totalReadTime || 0);
	const totalDays = overall.readDays || 0;

	lines.push(`| 指标 | 数值 |`);
	lines.push(`|------|------|`);
	lines.push(`| 注册时间 | ${overall.registTime ? fmtTs(overall.registTime) : '—'} |`);
	lines.push(`| 累计阅读时长 | ${totalH} |`);
	lines.push(`| 累计阅读天数 | ${totalDays} 天 |`);

	if (overall.readStat?.length) {
		for (const s of overall.readStat) {
			lines.push(`| ${s.stat} | ${s.counts} |`);
		}
	}
	lines.push('');

	// 二、今年数据
	lines.push(`## 📅 二、${year} 年阅读概况`);
	lines.push('');
	lines.push(`| 指标 | 数值 |`);
	lines.push(`|------|------|`);
	lines.push(`| 总阅读时长 | ${fmtDuration(annual.totalReadTime || 0)} |`);
	lines.push(`| 阅读天数 | ${annual.readDays || 0} 天 |`);
	lines.push(`| 日均时长 | ${fmtDuration(annual.dayAverageReadTime || 0)} |`);
	if (annual.readStat?.length) {
		for (const s of annual.readStat) {
			lines.push(`| ${s.stat} | ${s.counts} |`);
		}
	}
	lines.push('');

	// 三、本月数据
	lines.push(`## 🗓️ 三、${year} 年 ${month} 月阅读概况`);
	lines.push('');
	lines.push(`| 指标 | 数值 |`);
	lines.push(`|------|------|`);
	lines.push(`| 本月阅读时长 | ${fmtDuration(monthly.totalReadTime || 0)} |`);
	lines.push(`| 阅读天数 | ${monthly.readDays || 0} 天 |`);
	lines.push(`| 日均时长 | ${fmtDuration(monthly.dayAverageReadTime || 0)} |`);
	if (monthly.readStat?.length) {
		for (const s of monthly.readStat) {
			lines.push(`| ${s.stat} | ${s.counts} |`);
		}
	}
	lines.push('');

	// 本月每日分布
	if (monthly.readTimes && Object.keys(monthly.readTimes).length > 0) {
		lines.push(`### ${month} 月每日阅读时长`);
		lines.push('');
		const dayEntries = Object.entries(monthly.readTimes).sort(([a], [b]) => Number(a) - Number(b));
		const dayVals = dayEntries.map(([, v]) => v as number);
		const dayLabels = dayEntries.map(([ts]) => {
			const d = new Date(Number(ts) * 1000);
			return `${d.getDate()}日`;
		});
		lines.push('```');
		lines.push(renderBarChart(dayVals, dayLabels, 20));
		lines.push('```');
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * 生成阅读统计文档
 */
export async function generateReadingStats(
	client: WereadApiClient,
	folder: string
): Promise<{ path: string; content: string }> {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;

	const [overall, annual, monthly] = await Promise.all([
		client.getReadingData('overall'),
		client.getReadingData('annually'),
		client.getReadingData('monthly'),
	]);

	const content = buildMarkdown(overall, annual, monthly, year, month);
	const safeFolder = folder.endsWith('/') ? folder.slice(0, -1) : folder;
	const path = safeFolder ? `${safeFolder}/微信读书阅读统计.md` : '微信读书阅读统计.md';

	return { path, content };
}
