export class CookieJar {
	private cookies: Map<string, string> = new Map();

	setFromLogin(userId: number, userKey: string): void {
		this.cookies.set('remix_userid', String(userId));
		this.cookies.set('remix_userkey', userKey);
		this.cookies.set('siteLanguageV2', 'en');
	}

	toHeader(): string {
		return Array.from(this.cookies.entries())
			.map(([k, v]) => `${k}=${v}`)
			.join('; ');
	}

	extractFromResponse(headers: { getSetCookie?: () => string[] }): void {
		const setCookie = headers.getSetCookie?.() ?? [];
		for (const raw of setCookie) {
			const [cookiePart] = raw.split(';');
			const eqIdx = cookiePart.indexOf('=');
			if (eqIdx > 0) {
				const key = cookiePart.slice(0, eqIdx).trim();
				const value = cookiePart.slice(eqIdx + 1);
				this.cookies.set(key, value);
			}
		}
	}

	isLoggedIn(): boolean {
		return this.cookies.has('remix_userid') && this.cookies.has('remix_userkey');
	}

	getUserId(): string {
		return this.cookies.get('remix_userid') ?? '';
	}

	getUserKey(): string {
		return this.cookies.get('remix_userkey') ?? '';
	}

	clear(): void {
		this.cookies.clear();
	}
}
