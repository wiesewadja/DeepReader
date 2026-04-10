#!/usr/bin/env npx ts-node
/**
 * Trace Analyzer — Harness Hill-climbing Tool
 *
 * 从 Langfuse 拉取失败 session，识别常见失败模式，输出 harness 改进建议。
 *
 * 用法：
 *   npx ts-node scripts/trace-analyzer.ts [--limit N]
 *
 * 环境变量：
 *   LANGFUSE_PUBLIC_KEY
 *   LANGFUSE_SECRET_KEY
 *   LANGFUSE_HOST
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── CLI 参数解析 ────────────────────────────────────────────────────────────

function parseArgs(): { limit: number } {
  const args = process.argv.slice(2);
  let limit = 20;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n > 0) limit = n;
    }
  }
  return { limit };
}

// ─── 环境变量读取 ────────────────────────────────────────────────────────────

function getConfig(): { publicKey: string; secretKey: string; host: string } {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const host = process.env.LANGFUSE_HOST;

  if (!publicKey || !secretKey || !host) {
    const missing = [
      !publicKey && 'LANGFUSE_PUBLIC_KEY',
      !secretKey && 'LANGFUSE_SECRET_KEY',
      !host && 'LANGFUSE_HOST',
    ].filter(Boolean).join(', ');
    process.stderr.write(`Error: Missing required environment variables: ${missing}\n`);
    process.exit(1);
  }

  return { publicKey, secretKey, host };
}

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface TraceObservation {
  name: string;
  type: string;
  metadata?: Record<string, unknown>;
  output?: unknown;
  level?: string;
}

interface TraceSession {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  observations?: TraceObservation[];
  level?: string;
  tags?: string[];
}

interface FailurePattern {
  name: string;
  count: number;
  percentage: number;
  exampleIds: string[];
  priority: 'HIGH' | 'NORMAL';
  suggestion: string;
}

// ─── Langfuse API 调用 ───────────────────────────────────────────────────────

async function fetchFailedTraces(
  publicKey: string,
  secretKey: string,
  host: string,
  limit: number
): Promise<TraceSession[]> {
  // 使用 @langfuse/client SDK
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Langfuse } = require('@langfuse/client');

  const client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: host,
  });

  try {
    // 拉取最近 N 条 traces，过滤 ERROR 级别或包含 max_tool_calls 的
    const response = await client.fetchTraces({
      limit,
      orderBy: 'timestamp',
      orderDirection: 'DESC',
    });

    const traces: TraceSession[] = response.data ?? [];

    // 对每条 trace 拉取 observations（spans）
    const tracesWithObs: TraceSession[] = [];
    for (const trace of traces) {
      try {
        const obsResponse = await client.fetchObservations({
          traceId: trace.id,
          limit: 100,
        });
        tracesWithObs.push({
          ...trace,
          observations: obsResponse.data ?? [],
        });
      } catch {
        tracesWithObs.push({ ...trace, observations: [] });
      }
    }

    return tracesWithObs;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: Failed to fetch traces from Langfuse: ${msg}\n`);
    process.exit(1);
  }
}

// ─── 失败模式分析 ────────────────────────────────────────────────────────────

function analyzePatterns(traces: TraceSession[]): FailurePattern[] {
  const total = traces.length;
  if (total === 0) return [];

  // 各模式计数
  const ghostRefIds: string[] = [];
  const doomLoopIds: string[] = [];
  const emptyScopeIds: string[] = [];
  const maxToolCallsIds: string[] = [];
  const llmErrorIds: string[] = [];

  for (const trace of traces) {
    const obs = trace.observations ?? [];

    // Ghost_Reference：存在 self-verification span 且 ghostRefs > 0
    const svSpan = obs.find(o => o.name === 'self-verification');
    if (svSpan) {
      const meta = svSpan.metadata as Record<string, unknown> | undefined;
      const ghostRefs = meta?.ghostRefs as number | undefined;
      if (ghostRefs && ghostRefs > 0) {
        ghostRefIds.push(trace.id);
      }
    }

    // Doom_Loop：存在 loop-detection-intercept span
    const loopSpan = obs.find(o => o.name === 'loop-detection-intercept');
    if (loopSpan) {
      doomLoopIds.push(trace.id);
    }

    // Empty_Scope：state-loop-Inspectional span 的 output.scopeNodeIds 为空
    const inspSpan = obs.find(o => o.name === 'Inspectional' || o.name === 'state-loop-Inspectional');
    if (inspSpan) {
      const output = inspSpan.output as Record<string, unknown> | undefined;
      const scopeNodeIds = output?.scopeNodeIds as unknown[] | undefined;
      if (Array.isArray(scopeNodeIds) && scopeNodeIds.length === 0) {
        emptyScopeIds.push(trace.id);
      }
    }

    // Max_Tool_Calls_Hit：存在 forced-conclusion span（由 max_tool_calls 触发）
    const forcedSpan = obs.find(o => o.name === 'forced-conclusion');
    if (forcedSpan) {
      maxToolCallsIds.push(trace.id);
    }

    // LLM_Error：trace level 为 ERROR 或存在 ERROR 级别的 span
    const hasError =
      trace.level === 'ERROR' ||
      obs.some(o => o.level === 'ERROR');
    if (hasError) {
      llmErrorIds.push(trace.id);
    }
  }

  const makePattern = (
    name: string,
    ids: string[],
    suggestion: string
  ): FailurePattern => {
    const count = ids.length;
    const percentage = Math.round((count / total) * 100);
    return {
      name,
      count,
      percentage,
      exampleIds: ids.slice(0, 3),
      priority: percentage >= 20 ? 'HIGH' : 'NORMAL',
      suggestion,
    };
  };

  return [
    makePattern(
      'Ghost_Reference',
      ghostRefIds,
      '幽灵引用频繁出现，建议检查 S2 prompt 中的 block_id 引用规则，或降低 maxToolCalls 以减少 LLM 在信息不足时的幻觉引用。'
    ),
    makePattern(
      'Doom_Loop',
      doomLoopIds,
      'Agent 反复搜索相同关键词，建议在 S2 prompt 中强化"搜索失败时直接读取章节"的指引，或减少 maxToolCalls。'
    ),
    makePattern(
      'Empty_Scope',
      emptyScopeIds,
      'S1 无法圈定章节范围，建议检查 tree.json 是否正确加载，或优化 inspectional prompt 的 scope 判断逻辑。'
    ),
    makePattern(
      'Max_Tool_Calls_Hit',
      maxToolCallsIds,
      '工具调用次数频繁触顶，建议适当提高 maxToolCalls（当前 5），或优化 S2 prompt 减少不必要的探索步骤。'
    ),
    makePattern(
      'LLM_Error',
      llmErrorIds,
      'LLM 调用出错，建议检查 API key 配置、网络连接，以及是否存在 context 过长导致的截断错误。'
    ),
  ];
}

// ─── 报告生成 ────────────────────────────────────────────────────────────────

function generateReport(
  patterns: FailurePattern[],
  totalSessions: number,
  host: string,
  limit: number
): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [];

  lines.push('# Trace Analysis Report — Harness Hill-climbing');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| 分析时间 | ${timestamp} |`);
  lines.push(`| Langfuse Host | ${host} |`);
  lines.push(`| 拉取 Session 数 | ${totalSessions} (limit: ${limit}) |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 失败模式统计');
  lines.push('');

  const highPriority = patterns.filter(p => p.priority === 'HIGH');
  if (highPriority.length > 0) {
    lines.push(`> ⚠️ **${highPriority.length} 个高优先级问题**（频率 ≥ 20%）需要关注`);
    lines.push('');
  }

  lines.push('| 模式 | 出现次数 | 占比 | 优先级 |');
  lines.push('|------|----------|------|--------|');
  for (const p of patterns) {
    const priority = p.priority === 'HIGH' ? '🔴 HIGH' : '⚪ NORMAL';
    lines.push(`| ${p.name} | ${p.count} | ${p.percentage}% | ${priority} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 详细分析');
  lines.push('');

  for (const p of patterns) {
    const priorityTag = p.priority === 'HIGH' ? ' `[HIGH PRIORITY]`' : '';
    lines.push(`### ${p.name}${priorityTag}`);
    lines.push('');
    lines.push(`- **出现次数**: ${p.count} / ${totalSessions} (${p.percentage}%)`);

    if (p.exampleIds.length > 0) {
      lines.push(`- **示例 Session ID**:`);
      for (const id of p.exampleIds) {
        lines.push(`  - \`${id}\``);
      }
    } else {
      lines.push('- **示例 Session ID**: 无');
    }

    if (p.priority === 'HIGH') {
      lines.push('');
      lines.push(`**改进建议**: ${p.suggestion}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function writeReport(content: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = path.join(process.cwd(), '.gstack', 'qa-reports');
  const reportPath = path.join(reportDir, `trace-analysis-${timestamp}.md`);

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, content, 'utf-8');

  return reportPath;
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

async function main() {
  const { limit } = parseArgs();
  const { publicKey, secretKey, host } = getConfig();

  console.log(`[TraceAnalyzer] 正在从 ${host} 拉取最近 ${limit} 条 traces...`);

  const traces = await fetchFailedTraces(publicKey, secretKey, host, limit);

  if (traces.length === 0) {
    process.stderr.write('Error: No traces returned from Langfuse API\n');
    process.exit(1);
  }

  console.log(`[TraceAnalyzer] 获取到 ${traces.length} 条 traces，开始分析...`);

  const patterns = analyzePatterns(traces);
  const report = generateReport(patterns, traces.length, host, limit);
  const reportPath = writeReport(report);

  console.log(`[TraceAnalyzer] 报告已写入: ${reportPath}`);

  // 打印高优先级问题摘要
  const highPriority = patterns.filter(p => p.priority === 'HIGH');
  if (highPriority.length > 0) {
    console.log('\n⚠️  高优先级问题:');
    for (const p of highPriority) {
      console.log(`  - ${p.name}: ${p.count}/${traces.length} (${p.percentage}%)`);
    }
  } else {
    console.log('\n✅ 无高优先级问题（所有模式频率 < 20%）');
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
