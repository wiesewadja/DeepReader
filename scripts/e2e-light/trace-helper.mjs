/**
 * LangSmith Trace 集成模块
 *
 * 在轻量 E2E 测试中集成 LangSmith trace 收集，
 * 实现测试和 trace 的联动。
 */

import { evalObsidian } from '../smoke/lib/obsidian-cli.mjs';

/**
 * 获取 LangSmith 配置
 */
async function getLangSmithConfig() {
  try {
    const config = await evalObsidian(`(() => {
      const s = app.plugins.plugins["deepreader-dev"]?.settings;
      return {
        apiKey: s?.langsmithApiKey || '',
        project: s?.langsmithProject || 'DeepReader',
        enabled: s?.langsmithEnabled || false,
      };
    })()`);
    return config;
  } catch {
    return { apiKey: '', project: 'DeepReader', enabled: false };
  }
}

/**
 * 获取指定时间后的 LangSmith runs
 *
 * 用 GET /api/v1/runs?session_name=<project> 直接按 project 名查，
 * 与 tests/e2e/helpers/langsmith.helper.ts 保持一致的可靠写法。
 * 不依赖 session UUID（GET /sessions 在不同租户行为不一致，易静默失效）。
 */
async function getRunsAfter(apiKey, project, sinceMs = 60_000) {
  if (!apiKey || !project) return [];

  const since = new Date(Date.now() - sinceMs).toISOString();
  const url = `https://api.smith.langchain.com/api/v1/runs?session_name=${encodeURIComponent(project)}&start_time_gte=${encodeURIComponent(since)}&order_by=-start_time&limit=50`;

  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    // GET /runs 直接返回 runs 数组（非 { runs: [...] } 包装）
    return Array.isArray(data) ? data : (data.runs || []);
  } catch {
    return [];
  }
}

/**
 * 分析 trace 数据
 */
function analyzeTrace(run) {
  if (!run) return null;
  
  const startTime = new Date(run.start_time).getTime();
  const endTime = run.end_time ? new Date(run.end_time).getTime() : Date.now();
  const executionTimeMs = endTime - startTime;
  
  // 提取 token 信息
  const totalTokens = run.total_tokens || 0;
  const promptTokens = run.prompt_tokens || 0;
  const completionTokens = run.completion_tokens || 0;
  
  // 提取状态
  const status = run.status || 'unknown';
  const hasError = status === 'error';
  
  return {
    id: run.id,
    name: run.name,
    executionTimeMs,
    totalTokens,
    promptTokens,
    completionTokens,
    status,
    hasError,
    startTime: run.start_time,
    endTime: run.end_time,
    childCount: run.direct_child_run_ids?.length || 0,
  };
}

/**
 * 创建 trace 收集器
 *
 * 用法：
 * ```javascript
 * const collector = await startTraceCollection();
 * // ... 执行测试 ...
 * const trace = await collector.getTrace();
 * ```
 */
export async function startTraceCollection() {
  const startTime = Date.now();
  const config = await getLangSmithConfig();
  const available = !!(config.enabled && config.apiKey);

  return {
    /**
     * 获取测试后的 trace
     */
    async getTrace() {
      if (!available) return null;

      const runs = await getRunsAfter(
        config.apiKey,
        config.project,
        Date.now() - startTime + 10_000, // 多等 10 秒确保写入
      );

      if (runs.length === 0) return null;

      // 获取最新的 root run（runs 已按 start_time 倒序）
      return analyzeTrace(runs[0]);
    },

    /**
     * 获取 trace 摘要文本
     */
    async getTraceSummary() {
      const trace = await this.getTrace();
      if (!trace) return null;

      const parts = [];
      parts.push(`tokens=${trace.totalTokens}`);
      parts.push(`耗时=${(trace.executionTimeMs / 1000).toFixed(1)}s`);
      if (trace.hasError) parts.push('⚠️ 错误');

      return parts.join(', ');
    },

    /**
     * 获取 trace 详情（用于调试）
     */
    async getTraceDetails() {
      if (!available) return null;

      const runs = await getRunsAfter(
        config.apiKey,
        config.project,
        Date.now() - startTime + 10_000,
      );

      return runs.map(analyzeTrace).filter(Boolean);
    },
    
    /**
     * 获取 LangSmith 链接
     */
    getTraceUrl(trace) {
      if (!trace?.id) return null;
      return `https://smith.langchain.com/runs/${trace.id}`;
    },
  };
}

/**
 * 快捷函数：在测试步骤中自动收集 trace
 *
 * 用法：
 * ```javascript
 * {
 *   const t0 = Date.now();
 *   try {
 *     const { trace, traceSummary } = await withTrace(async () => {
 *       // 执行 Agent 对话
 *       await evalObsidian(`...`);
 *     });
 *     
 *     pass('Agent 对话', Date.now() - t0, traceSummary || '成功');
 *   } catch (e) {
 *     fail('Agent 对话', Date.now() - t0, e);
 *   }
 * }
 * ```
 */
export async function withTrace(testFn) {
  const collector = await startTraceCollection();
  
  await testFn();
  
  const trace = await collector.getTrace();
  const traceSummary = await collector.getTraceSummary();
  const traceUrl = trace ? collector.getTraceUrl(trace) : null;
  
  return { trace, traceSummary, traceUrl };
}
