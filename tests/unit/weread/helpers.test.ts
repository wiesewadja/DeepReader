import { describe, it, expect } from 'vitest';
import { formatReadingTime, sanitizeFileName } from '@/weread/utils/helpers';

describe('formatReadingTime', () => {
	it('should return 0分钟 for zero seconds', () => {
		expect(formatReadingTime(0)).toBe('0分钟');
	});

	it('should return 0分钟 for negative seconds', () => {
		expect(formatReadingTime(-100)).toBe('0分钟');
	});

	it('should format minutes only', () => {
		expect(formatReadingTime(300)).toBe('5分钟');
	});

	it('should format hours and minutes', () => {
		expect(formatReadingTime(6600)).toBe('1小时50分钟');
	});

	it('should format exact hours', () => {
		expect(formatReadingTime(7200)).toBe('2小时0分钟');
	});

	it('should handle large values', () => {
		expect(formatReadingTime(36000)).toBe('10小时0分钟');
	});
});

describe('sanitizeFileName', () => {
	it('should remove invalid characters', () => {
		expect(sanitizeFileName('hello/world')).toBe('helloworld');
		expect(sanitizeFileName('file:name')).toBe('filename');
		expect(sanitizeFileName('file*name')).toBe('filename');
	});

	it('should trim whitespace', () => {
		expect(sanitizeFileName('  hello  ')).toBe('hello');
	});

	it('should collapse multiple spaces', () => {
		expect(sanitizeFileName('hello   world')).toBe('hello world');
	});

	it('should return untitled for empty result', () => {
		expect(sanitizeFileName('')).toBe('untitled');
		expect(sanitizeFileName('///')).toBe('untitled');
	});

	it('should truncate long names', () => {
		const longName = 'a'.repeat(500);
		const result = sanitizeFileName(longName);
		expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(240);
	});
});
