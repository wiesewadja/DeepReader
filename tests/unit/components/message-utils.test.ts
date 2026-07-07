import { describe, it, expect } from 'vitest';
import {
	sanitizeHumanizedHtml,
	escapeHtml,
	formatTimestamp,
	extractSectionByBlockRef,
} from '@/components/message/utils';

describe('sanitizeHumanizedHtml', () => {
	it('should strip script tags', () => {
		expect(sanitizeHumanizedHtml('<script>alert(1)</script>hello')).toBe('hello');
	});

	it('should strip iframe tags', () => {
		expect(sanitizeHumanizedHtml('<iframe src="evil.com"></iframe>safe')).toBe('safe');
	});

	it('should strip event handlers', () => {
		expect(sanitizeHumanizedHtml('<div onclick="alert(1)">text</div>')).toBe('<div>text</div>');
	});

	it('should strip javascript: URLs', () => {
		expect(sanitizeHumanizedHtml('<a href="javascript:alert(1)">link</a>')).toContain('href=""');
	});

	it('should keep safe HTML', () => {
		const safe = '<p>Hello <strong>World</strong></p>';
		expect(sanitizeHumanizedHtml(safe)).toBe(safe);
	});

	it('should strip object/embed/form tags', () => {
		expect(sanitizeHumanizedHtml('<object>bad</object>')).toBe('');
		expect(sanitizeHumanizedHtml('<embed src="bad">')).toBe('');
		expect(sanitizeHumanizedHtml('<form>bad</form>')).toBe('');
	});

	it('should strip meta/link/base tags', () => {
		expect(sanitizeHumanizedHtml('<meta http-equiv="refresh">text')).toBe('text');
		expect(sanitizeHumanizedHtml('<link rel="stylesheet">text')).toBe('text');
		expect(sanitizeHumanizedHtml('<base href="evil.com">text')).toBe('text');
	});

	it('should strip data: URLs in src', () => {
		expect(sanitizeHumanizedHtml('<img src="data:text/html,<script>alert(1)</script>">')).toContain('src=""');
	});

	it('should strip multiple event handlers', () => {
		expect(sanitizeHumanizedHtml('<div onclick="x" onerror="y" onload="z">text</div>')).toBe('<div>text</div>');
	});

	it('should handle self-closing script tags', () => {
		expect(sanitizeHumanizedHtml('<script src="evil.js" />hello')).toBe('hello');
	});
});

describe('escapeHtml', () => {
	it('should escape special characters', () => {
		expect(escapeHtml('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#039;');
	});

	it('should return empty for empty string', () => {
		expect(escapeHtml('')).toBe('');
	});

	it('should return empty for falsy input', () => {
		expect(escapeHtml(null as any)).toBe('');
		expect(escapeHtml(undefined as any)).toBe('');
	});

	it('should pass through plain text', () => {
		expect(escapeHtml('hello world')).toBe('hello world');
	});
});

describe('formatTimestamp', () => {
	it('should format valid ISO string', () => {
		const result = formatTimestamp('2024-01-15T10:30:00Z');
		expect(result).toMatch(/\d{1,2}:\d{2}/);
	});

	it('should handle invalid input (no exception, returns locale string)', () => {
		// new Date('invalid') doesn't throw — it creates an Invalid Date
		// The try/catch doesn't help; toLocaleTimeString returns 'Invalid Date'
		const result = formatTimestamp('invalid');
		expect(result).toBeTruthy();
	});
});

describe('extractSectionByBlockRef', () => {
	it('should extract content after block ref', () => {
		const content = 'line1\n^block1\nextracted line\n^block2';
		const result = extractSectionByBlockRef(content, 'block1');
		expect(result).toBe('extracted line');
	});

	it('should stop at next heading', () => {
		const content = '^block1\ncontent\n## Next Section';
		const result = extractSectionByBlockRef(content, 'block1');
		expect(result).toBe('content');
	});

	it('should return empty when block ref not found', () => {
		const content = 'line1\nline2';
		expect(extractSectionByBlockRef(content, 'nonexistent')).toBe('');
	});

	it('should find page-based heading when block ref not found', () => {
		const content = '## 第 5 页\npage content here';
		const result = extractSectionByBlockRef(content, 'page-5');
		expect(result).toContain('page content here');
	});

	it('should extract multiple lines between block refs', () => {
		const content = '^ref1\nline A\nline B\nline C\n^ref2';
		const result = extractSectionByBlockRef(content, 'ref1');
		expect(result).toBe('line A\nline B\nline C');
	});

	it('should stop at next block ref', () => {
		const content = '^ref1\ncontent before\n^ref2\ncontent after';
		const result = extractSectionByBlockRef(content, 'ref1');
		expect(result).toBe('content before');
	});

	it('should handle block ref with special regex chars', () => {
		const content = '^block-1.0\nextracted\n## Next\nother';
		const result = extractSectionByBlockRef(content, 'block-1.0');
		expect(result).toBe('extracted');
	});

	it('should include heading line when matching page-based heading', () => {
		const content = '## 第 3 页\npage three content';
		const result = extractSectionByBlockRef(content, 'page-3');
		expect(result).toContain('## 第 3 页');
		expect(result).toContain('page three content');
	});
});
