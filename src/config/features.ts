/**
 * DeepReader 功能开关配置
 *
 * 用于控制可选插件的启用状态。
 * 开源版本默认关闭需要额外配置的模块。
 */

// Z-Library 插件（版权风险模块，默认关闭）
// 设为 true 可在插件中启用 Z-Library 功能
// 开源发布时应设为 true，让用户自行选择是否启用
export const ZLIBRARY_ENABLED = true;

// 其他可选插件开关（预留）
// export const WEREAD_ENABLED = true;
// export const PI_AGENT_ENABLED = true;

/** 索引追踪日志（默认开启。每次索引生成 traces/{exportName}.log + .json） */
export const INDEX_TRACE_ENABLED = true;

/** 搜索追踪日志（默认开启。每次搜索生成 search-traces/{bookId}-{timestamp}.json） */
export const SEARCH_TRACE_ENABLED = true;
