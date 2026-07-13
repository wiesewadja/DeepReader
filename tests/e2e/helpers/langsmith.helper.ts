/**
 * LangSmith Trace 分析辅助函数
 * 可选模块，用于 Agent 测试的 trace 验证
 */

import * as fs from 'fs';
import * as path from 'path';

interface LangSmithRun {
  id: string;
  name: string;
  run_type: string;
  parent_run_id: string | null;
  start_time: string;
  end_time: string | null;
  inputs: Record<string, any>;
  outputs: Record<string, any> | null;
  status: string;
}

interface TraceAnalysis {
  totalRuns: number;
  runTypes: Record<string, number>;
  nodeNames: string[];
  toolCalls: string[];
  executionTimeMs: number;
  hasRouter: boolean;
  hasInspectional: boolean;
  hasAnalytical: boolean;
  hasFormatter: boolean;
  rootRun: LangSmithRun | null;
  errors: string[];
}

const REAL_VAULT_PATH = '/Users/lizhao/workspace/DeepReader/test-vault';

export class LangSmithHelper {
  private apiKey: string;
  private project: string;

  constructor() {
    this.apiKey = this.getApiKey();
    this.project = this.getProject();
  }

  private getApiKey(): string {
    const envKey = process.env.LANGSMITH_API_KEY || '';
    if (envKey) return envKey;

    try {
      const realData = JSON.parse(fs.readFileSync(
        path.join(REAL_VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json'), 'utf-8'
      ));
      return realData.langsmithApiKey || '';
    } catch {
      return '';
    }
  }

  private getProject(): string {
    const envProject = process.env.LANGSMITH_PROJECT || '';
    if (envProject) return envProject;

    try {
      const realData = JSON.parse(fs.readFileSync(
        path.join(REAL_VAULT_PATH, '.obsidian/plugins/deepreader-dev/data.json'), 'utf-8'
      ));
      return realData.langsmithProject || 'DeepReader';
    } catch {
      return 'DeepReader-E2E';
    }
  }

  /**
   * 检查 LangSmith 是否可用
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * 获取最近的 trace 数据
   */
  async fetchTraces(sinceMs: number = 300_000): Promise<LangSmithRun[]> {
    if (!this.apiKey) {
      console.warn('[E2E] LangSmith API Key 不可用，跳过 trace 获取');
      return [];
    }

    const since = new Date(Date.now() - sinceMs).toISOString();
    const url = `https://api.smith.langchain.com/api/v1/runs?session_name=${encodeURIComponent(this.project)}&start_time_gte=${encodeURIComponent(since)}&order_by=-start_time&limit=50`;

    try {
      const response = await fetch(url, {
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`[E2E] LangSmith API 返回 ${response.status}: ${response.statusText}`);
        return [];
      }

      const runs: LangSmithRun[] = await response.json();
      console.log(`[E2E] LangSmith: 获取到 ${runs.length} 条 runs`);
      return runs;
    } catch (err) {
      console.warn('[E2E] LangSmith API 请求失败:', (err as Error).message);
      return [];
    }
  }

  /**
   * 分析 trace 数据
   */
  analyzeTraces(runs: LangSmithRun[]): TraceAnalysis {
    const analysis: TraceAnalysis = {
      totalRuns: runs.length,
      runTypes: {},
      nodeNames: [],
      toolCalls: [],
      executionTimeMs: 0,
      hasRouter: false,
      hasInspectional: false,
      hasAnalytical: false,
      hasFormatter: false,
      rootRun: null,
      errors: [],
    };

    for (const run of runs) {
      analysis.runTypes[run.run_type] = (analysis.runTypes[run.run_type] || 0) + 1;

      if (run.name && !analysis.nodeNames.includes(run.name)) {
        analysis.nodeNames.push(run.name);
      }

      const nameLower = run.name.toLowerCase();
      if (nameLower.includes('router') || nameLower.includes('s0')) analysis.hasRouter = true;
      if (nameLower.includes('inspectional') || nameLower.includes('s1')) analysis.hasInspectional = true;
      if (nameLower.includes('analytical') || nameLower.includes('s2')) analysis.hasAnalytical = true;
      if (nameLower.includes('formatter') || nameLower.includes('s4')) analysis.hasFormatter = true;

      if (run.run_type === 'tool') {
        analysis.toolCalls.push(run.name);
      }

      if (run.status === 'error') {
        analysis.errors.push(`${run.name}: ${run.outputs?.error || 'unknown error'}`);
      }

      if (!run.parent_run_id && run.run_type === 'chain') {
        analysis.rootRun = run;
      }
    }

    if (analysis.rootRun?.start_time && analysis.rootRun?.end_time) {
      analysis.executionTimeMs =
        new Date(analysis.rootRun.end_time).getTime() -
        new Date(analysis.rootRun.start_time).getTime();
    }

    return analysis;
  }

  /**
   * 打印 trace 分析报告
   */
  printReport(analysis: TraceAnalysis): void {
    console.log('\n========== LangSmith Trace 报告 ==========');
    console.log(`总 Runs: ${analysis.totalRuns}`);
    console.log(`Run 类型: ${JSON.stringify(analysis.runTypes)}`);
    console.log(`节点: ${analysis.nodeNames.join(', ')}`);
    console.log(`工具调用: ${analysis.toolCalls.join(', ') || '无'}`);
    console.log(`执行路径: Router=${analysis.hasRouter} S1=${analysis.hasInspectional} S2=${analysis.hasAnalytical} S4=${analysis.hasFormatter}`);
    console.log(`执行时间: ${analysis.executionTimeMs}ms (${(analysis.executionTimeMs / 1000).toFixed(1)}s)`);
    if (analysis.errors.length > 0) {
      console.log(`错误: ${analysis.errors.join('; ')}`);
    }
    console.log('==========================================\n');
  }

  /**
   * 获取并分析最近的 trace
   */
  async getAnalysis(sinceMs: number = 180_000): Promise<TraceAnalysis> {
    const runs = await this.fetchTraces(sinceMs);
    const analysis = this.analyzeTraces(runs);
    this.printReport(analysis);
    return analysis;
  }
}
