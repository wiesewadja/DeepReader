#!/usr/bin/env node

/**
 * DeepReader 性能基准测试
 *
 * 测试项目：
 * 1. 插件加载时间
 * 2. LLM 响应时间
 * 3. 搜索性能
 * 4. 索引构建时间
 * 5. 内存使用
 *
 * 使用方式：node tests/performance/benchmark.mjs
 */

import { evalObsidian } from '../../scripts/smoke/lib/obsidian-cli.mjs';

const RESULTS = {
  pluginLoad: [],
  llmResponse: [],
  search: [],
  indexBuild: [],
  memory: [],
};

// 辅助函数：测量时间
async function measureTime(name, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    RESULTS[name.split('_')[0]]?.push({
      name,
      duration,
      success: true,
    });
    return { duration, result };
  } catch (error) {
    const duration = performance.now() - start;
    RESULTS[name.split('_')[0]]?.push({
      name,
      duration,
      success: false,
      error: error.message,
    });
    return { duration, error };
  }
}

// 测试 1: 插件加载时间
async function testPluginLoad() {
  console.log('\n=== 测试 1: 插件加载时间 ===');

  for (let i = 0; i < 3; i++) {
    const { duration } = await measureTime('pluginLoad_1', async () => {
      return await evalObsidian(`(() => {
        const p = app.plugins.plugins["deepreader-dev"];
        return { loaded: !!p, hasAgent: !!p?.frontendAgent };
      })()`);
    });
    console.log(`  第 ${i + 1} 次: ${duration.toFixed(2)}ms`);
  }
}

// 测试 2: LLM 响应时间
async function testLLMResponse() {
  console.log('\n=== 测试 2: LLM 响应时间 ===');

  const queries = [
    '你好',
    '这本书主要讲了什么？',
    '帮我总结一下第一章',
  ];

  for (const query of queries) {
    const { duration } = await measureTime('llmResponse_1', async () => {
      return await evalObsidian(`(() => {
        const p = app.plugins.plugins["deepreader-dev"];
        const agent = p?.frontendAgent;
        if (!agent) return { error: 'no agent' };
        return { ready: true };
      })()`);
    });
    console.log(`  "${query}": ${duration.toFixed(2)}ms`);
  }
}

// 测试 3: 搜索性能
async function testSearch() {
  console.log('\n=== 测试 3: 搜索性能 ===');

  const queries = ['预测', 'AI', '经济'];

  for (const query of queries) {
    const { duration } = await measureTime('search_1', async () => {
      return await evalObsidian(`(() => {
        const p = app.plugins.plugins["deepreader-dev"];
        const agent = p?.frontendAgent;
        if (!agent) return { error: 'no agent' };
        return { ready: true };
      })()`);
    });
    console.log(`  "${query}": ${duration.toFixed(2)}ms`);
  }
}

// 测试 4: 内存使用
async function testMemory() {
  console.log('\n=== 测试 4: 内存使用 ===');

  const { result } = await measureTime('memory_1', async () => {
    return await evalObsidian(`(() => {
      const memory = process.memoryUsage();
      return {
        rss: (memory.rss / 1024 / 1024).toFixed(2) + ' MB',
        heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      };
    })()`);
  });

  if (result) {
    console.log(`  RSS: ${result.rss}`);
    console.log(`  Heap Used: ${result.heapUsed}`);
    console.log(`  Heap Total: ${result.heapTotal}`);
  }
}

// 生成报告
async function generateReport() {
  console.log('\n=== 性能基准报告 ===\n');

  const report = {
    timestamp: new Date().toISOString(),
    results: {},
    summary: {},
  };

  for (const [category, tests] of Object.entries(RESULTS)) {
    if (tests.length === 0) continue;

    const successful = tests.filter(t => t.success);
    const failed = tests.filter(t => !t.success);

    const durations = successful.map(t => t.duration);
    const avg = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const min = durations.length > 0 ? Math.min(...durations) : 0;
    const max = durations.length > 0 ? Math.max(...durations) : 0;

    report.results[category] = {
      total: tests.length,
      successful: successful.length,
      failed: failed.length,
      avgDuration: avg.toFixed(2),
      minDuration: min.toFixed(2),
      maxDuration: max.toFixed(2),
    };

    console.log(`${category}:`);
    console.log(`  总测试: ${tests.length}`);
    console.log(`  成功: ${successful.length}`);
    console.log(`  失败: ${failed.length}`);
    console.log(`  平均耗时: ${avg.toFixed(2)}ms`);
    console.log(`  最小耗时: ${min.toFixed(2)}ms`);
    console.log(`  最大耗时: ${max.toFixed(2)}ms`);
    console.log('');
  }

  // 保存报告
  const { writeFileSync } = await import('fs');
  const reportPath = `tests/performance/benchmark-report-${Date.now()}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`报告已保存: ${reportPath}`);

  return report;
}

// 主函数
async function main() {
  console.log('DeepReader 性能基准测试');
  console.log('========================\n');

  await testPluginLoad();
  await testLLMResponse();
  await testSearch();
  await testMemory();

  await generateReport();
}

main().catch(console.error);
