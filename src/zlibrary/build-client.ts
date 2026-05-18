/**
 * 从 settings 构建 ZLibraryClient 并恢复登录态的公共工具函数
 */

import { ZLibraryClient } from './client';
import { DEFAULT_DOMAINS } from './constants';

export function buildZlibClient(settings: {
	zlibraryUserId?: string;
	zlibraryUserKey?: string;
	zlibraryDomain?: string;
}): ZLibraryClient {
	const domain = settings.zlibraryDomain || DEFAULT_DOMAINS[0];
	const client = new ZLibraryClient({ domain });
	if (settings.zlibraryUserId && settings.zlibraryUserKey) {
		client.restoreSession(Number(settings.zlibraryUserId), settings.zlibraryUserKey);
	}
	return client;
}
