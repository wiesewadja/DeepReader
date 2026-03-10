/**
 * DeepPDF 日志工具
 * 支持按模块分类控制日志输出
 */

// 日志级别
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 日志模块配置
interface LogConfig {
    /** 全局开关 */
    enabled: boolean;
    /** 模块开关 - true 表示输出该模块日志 */
    modules: {
        agent: boolean;      // Agent 核心流程（循环、工具调用）
        tools: boolean;      // 工具执行详情
        context: boolean;    // 上下文加载
        ui: boolean;         // UI 组件
        service: boolean;    // 服务层
        api: boolean;        // API 调用
        other: boolean;      // 其他
    };
}

// 默认配置：只开启 agent 模块
const defaultConfig: LogConfig = {
    enabled: true,
    modules: {
        agent: true,       // Agent 循环、消息处理
        tools: false,      // 工具执行详情
        context: false,    // 上下文加载
        ui: false,         // UI 组件
        service: false,    // 服务层
        api: false,        // API 调用
        other: false,      // 其他
    },
};

// 当前配置
let _config: LogConfig = { ...defaultConfig, modules: { ...defaultConfig.modules } };

// 日志模块类型
export type LogModule = keyof typeof _config.modules;

/**
 * 设置日志开关
 */
export function setLogEnabled(enabled: boolean): void {
    _config.enabled = enabled;
}

/**
 * 获取日志开关状态
 */
export function isLogEnabled(): boolean {
    return _config.enabled;
}

/**
 * 设置模块日志开关
 * @param module 模块名称
 * @param enabled 是否开启
 */
export function setModuleEnabled(module: LogModule, enabled: boolean): void {
    _config.modules[module] = enabled;
}

/**
 * 批量设置模块日志开关
 */
export function setModulesEnabled(modules: Partial<Record<LogModule, boolean>>): void {
    Object.assign(_config.modules, modules);
}

/**
 * 获取当前模块配置
 */
export function getModuleConfig(): Record<LogModule, boolean> {
    return { ..._config.modules };
}

/**
 * 检查模块是否应该输出日志
 */
function shouldLog(module: LogModule): boolean {
    return _config.enabled && _config.modules[module];
}

/**
 * 格式化日志前缀
 */
function formatPrefix(level: LogLevel, module: string): string {
    const timestamp = new Date().toISOString().substr(11, 12);
    return `[DeepPDF ${timestamp}] [${level.toUpperCase()}] [${module}]`;
}

/**
 * 创建模块日志函数（返回可直接调用的函数）
 */
function createLogFunctions(module: LogModule) {
    return {
        debug: (...args: any[]) => {
            if (shouldLog(module)) {
                console.debug(formatPrefix('debug', module), ...args);
            }
        },
        info: (...args: any[]) => {
            if (shouldLog(module)) {
                console.info(formatPrefix('info', module), ...args);
            }
        },
        log: (...args: any[]) => {
            if (shouldLog(module)) {
                console.log(formatPrefix('info', module), ...args);
            }
        },
        warn: (...args: any[]) => {
            if (shouldLog(module)) {
                console.warn(formatPrefix('warn', module), ...args);
            }
        },
        error: (...args: any[]) => {
            // 错误始终输出
            console.error(formatPrefix('error', module), ...args);
        },
    };
}

// 预创建各模块日志函数
const _agentLog = createLogFunctions('agent');
const _toolsLog = createLogFunctions('tools');
const _contextLog = createLogFunctions('context');
const _uiLog = createLogFunctions('ui');
const _serviceLog = createLogFunctions('service');
const _apiLog = createLogFunctions('api');
const _otherLog = createLogFunctions('other');

// 导出可直接调用的 log 函数（每个模块一个）
export const agentLog = Object.assign((...args: any[]) => _agentLog.log(...args), _agentLog);
export const toolsLog = Object.assign((...args: any[]) => _toolsLog.log(...args), _toolsLog);
export const contextLog = Object.assign((...args: any[]) => _contextLog.log(...args), _contextLog);
export const uiLog = Object.assign((...args: any[]) => _uiLog.log(...args), _uiLog);
export const serviceLog = Object.assign((...args: any[]) => _serviceLog.log(...args), _serviceLog);
export const apiLog = Object.assign((...args: any[]) => _apiLog.log(...args), _apiLog);

// ============ 向后兼容的全局函数 ============
// 这些函数使用 'other' 模块，默认关闭

function formatGlobalPrefix(level: LogLevel): string {
    const timestamp = new Date().toISOString().substr(11, 12);
    return `[DeepPDF ${timestamp}] [${level.toUpperCase()}]`;
}

export function debug(...args: any[]): void {
    if (shouldLog('other')) {
        console.debug(formatGlobalPrefix('debug'), ...args);
    }
}

export function info(...args: any[]): void {
    if (shouldLog('other')) {
        console.info(formatGlobalPrefix('info'), ...args);
    }
}

export function log(...args: any[]): void {
    if (shouldLog('other')) {
        console.log(formatGlobalPrefix('info'), ...args);
    }
}

export function warn(...args: any[]): void {
    if (shouldLog('other')) {
        console.warn(formatGlobalPrefix('warn'), ...args);
    }
}

export function error(...args: any[]): void {
    // 错误始终输出
    console.error(formatGlobalPrefix('error'), ...args);
}

// 默认导出
export default {
    setLogEnabled,
    isLogEnabled,
    setModuleEnabled,
    setModulesEnabled,
    getModuleConfig,
    // 模块日志函数
    agentLog,
    toolsLog,
    contextLog,
    uiLog,
    serviceLog,
    apiLog,
    // 向后兼容
    debug,
    info,
    log,
    warn,
    error,
};
