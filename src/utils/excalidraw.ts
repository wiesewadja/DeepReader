/**
 * Excalidraw 插件集成工具函数
 *
 * 集中管理 ExcalidrawAutomate 全局对象的检测和获取，
 * 避免各处重复 (window as any).ExcalidrawAutomate 模式。
 */

import type { ExcalidrawAutomate } from '../types/excalidraw.js';

/** 获取 Excalidraw Automate 实例（如未安装返回 undefined） */
export function getExcalidrawAutomate(): ExcalidrawAutomate | undefined {
	return window.ExcalidrawAutomate;
}

/** 检查 Excalidraw 插件是否可用 */
export function isExcalidrawAvailable(): boolean {
	return typeof window !== 'undefined' && !!window.ExcalidrawAutomate;
}
