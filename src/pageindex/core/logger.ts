/**
 * PageIndex 专用日志模块
 * 所有 pageindex 下的文件统一使用此模块输出日志
 * 受 utils/logger.ts 的 setLogEnabled 全局开关控制
 */

import { isLogEnabled } from '../../utils/logger';

function formatPrefix(level: string): string {
	const now = new Date();
	const hours = now.getHours().toString().padStart(2, '0');
	const minutes = now.getMinutes().toString().padStart(2, '0');
	const seconds = now.getSeconds().toString().padStart(2, '0');
	const ms = now.getMilliseconds().toString().padStart(3, '0');
	const timestamp = `${hours}:${minutes}:${seconds}.${ms}`;
	return `[PageIndex ${timestamp}] [${level.toUpperCase()}]`;
}

export function log(...args: any[]): void {
	if (isLogEnabled()) {
		console.log(formatPrefix('info'), ...args);
	}
}

export function debug(...args: any[]): void {
	if (isLogEnabled()) {
		console.debug(formatPrefix('debug'), ...args);
	}
}

export function info(...args: any[]): void {
	if (isLogEnabled()) {
		console.info(formatPrefix('info'), ...args);
	}
}
