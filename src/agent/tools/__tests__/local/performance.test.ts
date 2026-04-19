/**
 * 本地工具性能和效果评估
 *
 * 评估维度：
 * 1. 响应时间（冷启动 vs 热启动）
 * 2. 内存使用
 * 3. Token 效率
 * 4. 搜索准确性
 * 5. 与旧工具对比
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const VAULT_PATH = process.env.VAULT_PATH || '/Users/lizhao/workspace/deepreadertest';
const BOOK_NAME = '如何阅读一本书';

// 性能计时器
class PerformanceTimer {
  private start: number;
  constructor() {
    this.start = performance.now();
  }
  elapsed(): number {
    return performance.now() - this.start;
  }
}

// 模拟工具执行环境
function createTestEnvironment() {
  const bookDir = path.join(VAULT_PATH, 'DeepReader', BOOK_NAME);
  const files: Array<{ path: string; basename: string }> = [];

  if (fs.existsSync(bookDir)) {
    const fileNames = fs.readdirSync(bookDir).filter(f => f.endsWith('.md'));
    for (const fileName of fileNames) {
      files.push({
        path: path.join('DeepReader', BOOK_NAME, fileName),
        basename: fileName.replace('.md', '')
      });
    }
  }

  return {
    files,
    readFile: (file: { path: string }) => {
      const fullPath = path.join(VAULT_PATH, file.path);
      return fs.readFileSync(fullPath, 'utf-8');
    },
    getCache: (file: { path: string }) => {
      const fullPath = path.join(VAULT_PATH, file.path);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter: Record<string, unknown> = {};

      if (frontmatterMatch) {
        const yaml = frontmatterMatch[1];
        for (const line of yaml.split('\n')) {
          const match = line.match(/^(\w+):\s*(.*)$/);
          if (match) {
            frontmatter[match[1]] = match[2];
          }
        }
      }
      return { frontmatter };
    }
  };
}

describe.skip('本地工具性能评估', () => {
  let env: ReturnType<typeof createTestEnvironment>;

  beforeAll(() => {
    env = createTestEnvironment();
    console.log(`\n📊 测试环境:`);
    console.log(`   书籍: ${BOOK_NAME}`);
    console.log(`   文件数: ${env.files.length}`);
  });

  describe('1. 响应时间测试', () => {
    it('get_document_outline 冷启动时间', async () => {
      const timer = new PerformanceTimer();

      // 模拟冷启动：首次扫描所有文件
      const chapters: Array<{ nodeId: string; section: string }> = [];
      for (const file of env.files) {
        const cache = env.getCache(file);
        if (cache.frontmatter?.node_id && cache.frontmatter?.section) {
          chapters.push({
            nodeId: cache.frontmatter.node_id as string,
            section: cache.frontmatter.section as string
          });
        }
      }

      const elapsed = timer.elapsed();
      console.log(`\n⏱️ get_document_outline 冷启动: ${elapsed.toFixed(2)}ms`);
      console.log(`   平均每文件: ${(elapsed / env.files.length).toFixed(2)}ms`);

      expect(elapsed).toBeLessThan(1000); // 应在 1 秒内完成
      expect(chapters.length).toBeGreaterThan(50);
    });

    it('get_document_outline 热启动时间（模拟缓存）', async () => {
      // 预热：先执行一次
      for (const file of env.files) {
        env.getCache(file);
      }

      // 热启动测试
      const timer = new PerformanceTimer();
      const chapters: Array<{ nodeId: string; section: string }> = [];
      for (const file of env.files) {
        const cache = env.getCache(file);
        if (cache.frontmatter?.node_id && cache.frontmatter?.section) {
          chapters.push({
            nodeId: cache.frontmatter.node_id as string,
            section: cache.frontmatter.section as string
          });
        }
      }
      const elapsed = timer.elapsed();

      console.log(`⏱️ get_document_outline 热启动: ${elapsed.toFixed(2)}ms`);

      expect(elapsed).toBeLessThan(500); // 热启动应更快
    });

    it('search_markdown_text 搜索时间', async () => {
      const queries = ['检视阅读', '阅读的层次', '分析阅读', '主题阅读', '基础阅读'];
      const results: Array<{ query: string; time: number; hits: number }> = [];

      for (const query of queries) {
        const timer = new PerformanceTimer();
        let hits = 0;

        for (const file of env.files) {
          const content = env.readFile(file);
          if (content.includes(query)) {
            hits++;
          }
        }

        results.push({
          query,
          time: timer.elapsed(),
          hits
        });
      }

      console.log('\n⏱️ search_markdown_text 搜索时间:');
      results.forEach(r => {
        console.log(`   "${r.query}": ${r.time.toFixed(2)}ms (${r.hits} 命中)`);
      });

      const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;
      console.log(`   平均: ${avgTime.toFixed(2)}ms`);

      expect(avgTime).toBeLessThan(200); // 平均应在 200ms 内
    });

    it('read_markdown_section 读取时间', async () => {
      // 读取 10 个随机章节
      const samples = env.files.slice(0, 10);
      const times: number[] = [];

      for (const file of samples) {
        const timer = new PerformanceTimer();
        const content = env.readFile(file);
        times.push(timer.elapsed());
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const max = Math.max(...times);
      const min = Math.min(...times);

      console.log(`\n⏱️ read_markdown_section 读取时间:`);
      console.log(`   平均: ${avg.toFixed(2)}ms`);
      console.log(`   最小: ${min.toFixed(2)}ms`);
      console.log(`   最大: ${max.toFixed(2)}ms`);

      expect(avg).toBeLessThan(5); // 平均应在 5ms 内
    });
  });

  describe('2. 内存使用评估', () => {
    it('评估全量缓存内存占用', () => {
      const memBefore = process.memoryUsage().heapUsed;

      // 模拟全量缓存
      const cache = {
        chapterFiles: env.files,
        contentIndex: new Map<string, string>(),
        nodeIdIndex: new Map<string, string>(),
        blockIdIndex: new Map<string, string>()
      };

      // 读取所有文件内容到缓存
      for (const file of env.files) {
        const content = env.readFile(file);
        cache.contentIndex.set(file.basename, content);

        // 提取 node_id
        const nodeMatch = content.match(/node_id:\s*(\w+)/);
        if (nodeMatch) {
          cache.nodeIdIndex.set(nodeMatch[1], file.path);
        }

        // 提取 block_ids
        const blockMatches = content.matchAll(/\^([a-zA-Z0-9_-]+)/g);
        for (const match of blockMatches) {
          cache.blockIdIndex.set(match[1], file.path);
        }
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memUsed = (memAfter - memBefore) / 1024 / 1024;

      console.log(`\n💾 内存使用评估:`);
      console.log(`   文件数: ${cache.contentIndex.size}`);
      console.log(`   node_id 索引: ${cache.nodeIdIndex.size}`);
      console.log(`   block_id 索引: ${cache.blockIdIndex.size}`);
      console.log(`   内存占用: ${memUsed.toFixed(2)} MB`);

      // 计算平均每个文件占用
      const avgMemPerFile = (memUsed * 1024) / env.files.length;
      console.log(`   平均每文件: ${avgMemPerFile.toFixed(2)} KB`);

      expect(memUsed).toBeLessThan(100); // 应在 100MB 内
    });
  });

  describe('3. Token 效率评估', () => {
    it('计算输出 token 效率', async () => {
      const samples = env.files.slice(0, 20);
      const results: Array<{ file: string; chars: number; estTokens: number }> = [];

      for (const file of samples) {
        const content = env.readFile(file);

        // Token 估算
        const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
        const englishChars = content.length - chineseChars;
        const estTokens = Math.ceil(chineseChars / 0.5) + Math.ceil(englishChars / 4);

        results.push({
          file: file.basename.substring(0, 20),
          chars: content.length,
          estTokens
        });
      }

      const totalChars = results.reduce((sum, r) => sum + r.chars, 0);
      const totalTokens = results.reduce((sum, r) => sum + r.estTokens, 0);
      const efficiency = totalChars / totalTokens;

      console.log(`\n📊 Token 效率评估 (20 个样本):`);
      console.log(`   总字符: ${totalChars.toLocaleString()}`);
      console.log(`   估算 tokens: ${totalTokens.toLocaleString()}`);
      console.log(`   效率比: ${efficiency.toFixed(2)} 字符/token`);

      // 检查是否超过限制
      const overLimit = results.filter(r => r.estTokens > 4000);
      if (overLimit.length > 0) {
        console.log(`   ⚠️ 超过 4000 token 的文件: ${overLimit.length} 个`);
      }

      expect(efficiency).toBeGreaterThan(0.5); // 中文字符/token 约 0.5-0.7
    });

    it('评估摘要压缩效果', async () => {
      const samples = env.files.slice(0, 10);

      for (const file of samples) {
        const content = env.readFile(file);
        const summaryMatch = content.match(/summary:\s*"(.+?)"/);

        if (summaryMatch) {
          const summary = summaryMatch[1];
          const compressionRatio = content.length / summary.length;

          console.log(`   ${file.basename.substring(0, 25)}: ${(compressionRatio).toFixed(1)}x 压缩`);
        }
      }
    });
  });

  describe('4. 搜索准确性评估', () => {
    it('精确匹配 vs 模糊匹配效果', async () => {
      const testCases = [
        { query: '检视阅读', expectedTopic: '阅读层次' },
        { query: '金字塔原理', expectedTopic: '结构化思维' },
        { query: 'MECE', expectedTopic: '相互独立完全穷尽' },
        { query: '基础阅读', expectedTopic: '阅读第一层次' }
      ];

      console.log(`\n🎯 搜索准确性评估:`);

      for (const tc of testCases) {
        const timer = new PerformanceTimer();
        const hits: string[] = [];

        for (const file of env.files) {
          const content = env.readFile(file);
          if (content.includes(tc.query)) {
            hits.push(file.basename);
          }
        }

        console.log(`   "${tc.query}": ${hits.length} 命中 (${timer.elapsed().toFixed(2)}ms)`);
        if (hits.length > 0 && hits.length <= 3) {
          console.log(`     → ${hits.map(h => h.substring(0, 30)).join(', ')}`);
        }
      }
    });

    it('AND 组合搜索效果', async () => {
      const testCases = [
        ['阅读', '层次'],
        ['检视', '方法'],
        ['分析', '规则']
      ];

      console.log(`\n🔗 AND 组合搜索效果:`);

      for (const keywords of testCases) {
        const timer = new PerformanceTimer();
        let hits = 0;

        for (const file of env.files) {
          const content = env.readFile(file);
          if (keywords.every(kw => content.includes(kw))) {
            hits++;
          }
        }

        console.log(`   [${keywords.join(' + ')}]: ${hits} 命中 (${timer.elapsed().toFixed(2)}ms)`);
      }
    });
  });

  describe('5. 与旧工具对比', () => {
    it('响应时间对比（模拟）', async () => {
      console.log(`\n📈 与旧工具对比 (估算):`);

      // 本地工具
      const localTimer = new PerformanceTimer();
      for (const file of env.files.slice(0, 20)) {
        env.readFile(file);
      }
      const localTime = localTimer.elapsed();

      // 模拟后端 API 延迟（假设每个请求 50-100ms）
      const estimatedApiTime = 20 * 75; // 20 个请求，平均 75ms

      console.log(`   本地工具 (20 次读取): ${localTime.toFixed(2)}ms`);
      console.log(`   后端 API (估算): ${estimatedApiTime}ms`);
      console.log(`   性能提升: ${(estimatedApiTime / localTime).toFixed(1)}x`);

      expect(localTime).toBeLessThan(estimatedApiTime);
    });

    it('功能对比', async () => {
      console.log(`\n📋 功能对比:`);

      const comparison = [
        { feature: '离线可用', local: '✅', backend: '❌' },
        { feature: '零延迟', local: '✅', backend: '❌' },
        { feature: '语义搜索', local: '❌', backend: '✅' },
        { feature: 'PDF 支持', local: '❌', backend: '✅' },
        { feature: 'Block ID 引用', local: '✅', backend: '✅' },
        { feature: 'Token 估算', local: '✅', backend: '✅' },
        { feature: '实时更新', local: '✅', backend: '❌' }
      ];

      console.log(`   | 功能 | 本地工具 | 后端 API |`);
      console.log(`   |------|----------|----------|`);
      comparison.forEach(c => {
        console.log(`   | ${c.feature} | ${c.local} | ${c.backend} |`);
      });
    });
  });

  describe('6. 极限测试', () => {
    it('大文件处理能力', async () => {
      // 找最大的文件
      let largestFile = { path: '', size: 0 };
      for (const file of env.files) {
        const content = env.readFile(file);
        if (content.length > largestFile.size) {
          largestFile = { path: file.path, size: content.length };
        }
      }

      const timer = new PerformanceTimer();
      const content = env.readFile({ path: largestFile.path });
      const elapsed = timer.elapsed();

      // Token 估算
      const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
      const estTokens = Math.ceil(chineseChars / 0.5) + Math.ceil((content.length - chineseChars) / 4);

      console.log(`\n🏔️ 极限测试 - 最大文件:`);
      console.log(`   文件: ${largestFile.path.split('/').pop()}`);
      console.log(`   大小: ${(largestFile.size / 1024).toFixed(2)} KB`);
      console.log(`   估算 tokens: ${estTokens.toLocaleString()}`);
      console.log(`   读取时间: ${elapsed.toFixed(2)}ms`);
      console.log(`   是否超限: ${estTokens > 4000 ? '⚠️ 需要截断' : '✅ 正常'}`);
    });

    it('高并发读取能力', async () => {
      const concurrentReads = 10;
      const timer = new PerformanceTimer();

      // 模拟并发读取
      const promises = env.files.slice(0, concurrentReads).map(file =>
        Promise.resolve(env.readFile(file))
      );

      await Promise.all(promises);
      const elapsed = timer.elapsed();

      console.log(`\n🚀 并发测试:`);
      console.log(`   并发数: ${concurrentReads}`);
      console.log(`   总时间: ${elapsed.toFixed(2)}ms`);
      console.log(`   平均每请求: ${(elapsed / concurrentReads).toFixed(2)}ms`);
    });
  });
});
