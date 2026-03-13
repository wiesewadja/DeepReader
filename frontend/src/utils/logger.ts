/**
 * DeepPDF 日志工具
 * 支持按模块分类控制日志输出
 * 支持性能计时和请求追踪
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

// 性能计时器记录
interface TimerRecord {
    label: string;
    startTime: number;
    module: LogModule;
    metadata?: Record<string, unknown>;
}

export type { TimerRecord };

// 默认配置：全部开启（便于调试和问题排查）
const defaultConfig: LogConfig = {
    enabled: true,
    modules: {
        agent: true,       // Agent 循环、消息处理
        tools: true,       // 工具执行详情
        context: true,     // 上下文加载
        ui: false,         // UI 组件（默认关闭，噪音较多）
        service: true,     // 服务层
        api: false,         // API 调用
        other: true,       // 其他
    },
};

// 当前配置
let _config: LogConfig = { ...defaultConfig, modules: { ...defaultConfig.modules } };

// 日志模块类型
export type LogModule = keyof typeof _config.modules;

// 活动计时器
const activeTimers: Map<string, TimerRecord> = new Map();

// 请求追踪 ID 计数器
let _requestCounter = 0;

/**
 * 生成请求追踪 ID
 */
export function generateRequestId(): string {
    return `req_${Date.now()}_${++_requestCounter}`;
}

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
 * 格式化日志前缀（使用本地时间）
 */
function formatPrefix(level: LogLevel, module: string): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    const timestamp = `${hours}:${minutes}:${seconds}.${ms}`;
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

// ============ 性能计时功能 ============

/**
 * 开始计时
 * @param label 计时器标签
 * @param module 所属模块（可选，默认 'other'）
 * @param metadata 附加元数据（可选）
 * @returns 计时器 ID（用于结束计时）
 */
export function startTimer(
    label: string,
    module: LogModule = 'other',
    metadata?: Record<string, unknown>
): string {
    const timerId = `${module}:${label}:${Date.now()}`;
    activeTimers.set(timerId, {
        label,
        startTime: performance.now(),
        module,
        metadata,
    });

    if (shouldLog(module)) {
        const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
        console.log(formatPrefix('debug', module), `⏱️ 开始计时: ${label}${metaStr}`);
    }

    return timerId;
}

/**
 * 结束计时并返回耗时
 * @param timerId 计时器 ID（由 startTimer 返回）
 * @param additionalMetadata 额外元数据（可选，会合并到输出）
 * @returns 耗时（毫秒），如果计时器不存在返回 -1
 */
export function endTimer(
    timerId: string,
    additionalMetadata?: Record<string, unknown>
): number {
    const timer = activeTimers.get(timerId);
    if (!timer) {
        return -1;
    }

    activeTimers.delete(timerId);
    const duration = performance.now() - timer.startTime;

    if (shouldLog(timer.module)) {
        const durationStr = duration < 1000
            ? `${duration.toFixed(1)}ms`
            : `${(duration / 1000).toFixed(2)}s`;

        const metaParts: string[] = [];
        if (timer.metadata) {
            metaParts.push(JSON.stringify(timer.metadata));
        }
        if (additionalMetadata) {
            metaParts.push(JSON.stringify(additionalMetadata));
        }
        const metaStr = metaParts.length > 0 ? ` ${metaParts.join(' -> ')}` : '';

        console.log(
            formatPrefix('info', timer.module),
            `✅ 计时结束: ${timer.label} [${durationStr}]${metaStr}`
        );
    }

    return duration;
}

/**
 * 获取计时器当前耗时（不结束计时）
 * @param timerId 计时器 ID
 * @returns 耗时（毫秒），如果计时器不存在返回 -1
 */
export function peekTimer(timerId: string): number {
    const timer = activeTimers.get(timerId);
    if (!timer) {
        return -1;
    }
    return performance.now() - timer.startTime;
}

/**
 * 格式化耗时为可读字符串
 */
export function formatDuration(ms: number): string {
    if (ms < 0) return 'N/A';
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * 获取所有活动计时器
 */
export function getActiveTimers(): Map<string, TimerRecord> {
    return new Map(activeTimers);
}

/**
 * 清除所有活动计时器
 */
export function clearAllTimers(): void {
    activeTimers.clear();
}

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
