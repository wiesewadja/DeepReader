import { describe, it, expect } from 'vitest';
import { formatReadingTime } from '@/weread/utils/time';

describe('formatReadingTime', () => {
	it('0 秒返回 "0分钟"', () => {
		expect(formatReadingTime(0)).toBe('0分钟');
	});

	it('小于 60 秒返回分钟数', () => {
		expect(formatReadingTime(30)).toBe('0分钟');
		expect(formatReadingTime(59)).toBe('0分钟');
	});

	it('恰好 60 秒返回 "1分钟"', () => {
		expect(formatReadingTime(60)).toBe('1分钟');
	});

	it('分钟数取整', () => {
		expect(formatReadingTime(90)).toBe('1分钟');
		expect(formatReadingTime(120)).toBe('2分钟');
	});

	it('小时+分钟', () => {
		expect(formatReadingTime(3661)).toBe('1小时1分钟');
		expect(formatReadingTime(3720)).toBe('1小时2分钟');
	});

	it('恰好整小时', () => {
		expect(formatReadingTime(3600)).toBe('1小时0分钟');
		expect(formatReadingTime(7200)).toBe('2小时0分钟');
	});

	it('大数值', () => {
		// 18小时30分钟 = 66600秒
		expect(formatReadingTime(66600)).toBe('18小时30分钟');
	});
});
