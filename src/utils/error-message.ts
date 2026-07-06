/**
 * 错误消息提取工具
 *
 * 用于 catch(e: unknown) 块中安全地获取错误消息，
 * 避免 70+ 处重复的 instanceof Error 三元表达式。
 */

/**
 * 从未知错误对象中提取消息字符串
 *
 * @param e - catch 块中捕获的未知值
 * @returns 错误消息字符串
 */
export function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === 'string') return e;
	return String(e);
}

/**
 * 从未知错误对象中获取错误名称
 *
 * @param e - catch 块中捕获的未知值
 * @returns 错误名称字符串
 */
export function getErrorName(e: unknown): string {
	if (e instanceof Error) return e.name;
	return 'Error';
}
