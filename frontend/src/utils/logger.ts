/**
 * DeepPDF 日志工具
 * 提供可控的日志输出，默认关闭
 */

// 日志级别
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 日志配置
let _enabled: boolean = false;

/**
 * 设置日志开关
 */
export function setLogEnabled(enabled: boolean): void {
    _enabled = enabled;
}

/**
 * 获取日志开关状态
 */
export function isLogEnabled(): boolean {
    return _enabled;
}

/**
 * 格式化日志前缀
 */
function formatPrefix(level: LogLevel): string {
    const timestamp = new Date().toISOString().substr(11, 12);
    return `[DeepPDF ${timestamp}] [${level.toUpperCase()}]`;
}

/**
 * 调试日志 - 仅在开启时输出
 */
export function debug(...args: any[]): void {
    if (_enabled) {
        console.debug(formatPrefix('debug'), ...args);
    }
}

/**
 * 信息日志 - 仅在开启时输出
 */
export function info(...args: any[]): void {
    if (_enabled) {
        console.info(formatPrefix('info'), ...args);
    }
}

/**
 * 普通日志 - 仅在开启时输出
 */
export function log(...args: any[]): void {
    if (_enabled) {
        console.log(formatPrefix('info'), ...args);
    }
}

/**
 * 警告日志 - 仅在开启时输出
 */
export function warn(...args: any[]): void {
    if (_enabled) {
        console.warn(formatPrefix('warn'), ...args);
    }
}

/**
 * 错误日志 - 始终输出
 */
export function error(...args: any[]): void {
    console.error(formatPrefix('error'), ...args);
}

// 默认导出
export default {
    setLogEnabled,
    isLogEnabled,
    debug,
    info,
    log,
    warn,
    error
};
