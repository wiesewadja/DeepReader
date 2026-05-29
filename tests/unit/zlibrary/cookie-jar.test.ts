import { describe, it, expect } from 'vitest';
import { CookieJar } from '@/zlibrary/cookie-jar';

describe('CookieJar', () => {
	it('setFromLogin 设置正确的 Cookie', () => {
		const jar = new CookieJar();
		jar.setFromLogin(23688146, 'd07560abc');
		expect(jar.toHeader()).toContain('remix_userid=23688146');
		expect(jar.toHeader()).toContain('remix_userkey=d07560abc');
	});

	it('toHeader 包含 siteLanguageV2', () => {
		const jar = new CookieJar();
		jar.setFromLogin(1, 'key');
		expect(jar.toHeader()).toContain('siteLanguageV2=en');
	});

	it('toHeader 返回分号分隔的字符串', () => {
		const jar = new CookieJar();
		jar.setFromLogin(1, 'k');
		const header = jar.toHeader();
		const parts = header.split('; ');
		expect(parts.length).toBeGreaterThanOrEqual(3);
	});

	it('extractFromResponse 从 Set-Cookie 解析', () => {
		const jar = new CookieJar();
		jar.extractFromResponse({
			getSetCookie: () => ['session=abc123; Path=/; HttpOnly', 'theme=dark; Max-Age=3600'],
		} as any);
		expect(jar.toHeader()).toContain('session=abc123');
		expect(jar.toHeader()).toContain('theme=dark');
	});

	it('extractFromResponse 处理空 headers', () => {
		const jar = new CookieJar();
		jar.extractFromResponse({ getSetCookie: () => [] } as any);
		expect(jar.toHeader()).toBe('');
	});

	it('isLoggedIn 判断是否已登录', () => {
		const jar = new CookieJar();
		expect(jar.isLoggedIn()).toBe(false);
		jar.setFromLogin(1, 'key');
		expect(jar.isLoggedIn()).toBe(true);
	});

	it('clear 清除所有 Cookie', () => {
		const jar = new CookieJar();
		jar.setFromLogin(1, 'key');
		jar.clear();
		expect(jar.toHeader()).toBe('');
		expect(jar.isLoggedIn()).toBe(false);
	});
});
