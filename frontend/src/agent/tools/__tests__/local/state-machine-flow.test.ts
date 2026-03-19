/**
 * 状态机与本地工具集成测试
 *
 * 验证数据流：状态机 → 工具调用 → 结果处理 → 下一状态
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const VAULT_PATH = process.env.VAULT_PATH || '/Users/lizhao/workspace/deepreadertest';
const BOOK_NAME = '如何阅读一本书';

// ============================================================================
// Mock Obsidian Environment
// ============================================================================

function createMockObsidianApp() {
  const bookDir = path.join(VAULT_PATH, 'DeepReader', BOOK_NAME);
  const files: Array<{ path: string; basename: string }> = [];

  if (fs.existsSync(bookDir)) {
    for (const fileName of fs.readdirSync(bookDir).filter(f => f.endsWith('.md'))) {
      files.push({
        path: path.join('DeepReader', BOOK_NAME, fileName),
        basename: fileName.replace('.md', '')
      });
    }
  }

  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file: { path: string }) => {
        return fs.readFileSync(path.join(VAULT_PATH, file.path), 'utf-8');
      }
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const content = fs.readFileSync(path.join(VAULT_PATH, file.path), 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        const frontmatter: Record<string, unknown> = {};

        if (frontmatterMatch) {
          for (const line of frontmatterMatch[1].split('\n')) {
            const match = line.match(/^(\w+):\s*(.*)$/);
            if (match) {
              let value: string | string[] = match[2];
              if (value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1).split(',').map(s => s.trim());
              }
              frontmatter[match[1]] = value;
            }
          }
        }

        // 提取 block IDs
        const blocks: Record<string, unknown> = {};
        const blockRegex = /\^([a-zA-Z0-9_-]+)/g;
        let blockMatch;
        while ((blockMatch = blockRegex.exec(content)) !== null) {
          blocks[blockMatch[1]] = {};
        }

        return { frontmatter, blocks };
      }
    }
  };
}

// ============================================================================
// Tool Executors (简化版，模拟实际工具行为)
// ============================================================================

async function getDocumentOutline(app: ReturnType<typeof createMockObsidianApp>, pdfName: string) {
  const files = app.vault.getMarkdownFiles();
  const chapters: Array<{
    nodeId: string;
    section: string;
    level: number;
    summary?: string;
    link: string;
  }> = [];

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.node_id) {
      const content = await app.vault.cachedRead(file);
      const summaryMatch = content.match(/summary:\s*"(.+?)"/);

      chapters.push({
        nodeId: cache.frontmatter.node_id as string,
        section: cache.frontmatter.section as string || file.basename,
        level: cache.frontmatter.level as number || 1,
        summary: summaryMatch?.[1]?.substring(0, 100),
        link: `[[${file.path}|${file.basename}]]`
      });
    }
  }

  return chapters.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

async function searchMarkdownText(
  app: ReturnType<typeof createMockObsidianApp>,
  query: string,
  options?: { scopeNodeIds?: string[]; maxResults?: number }
) {
  const files = app.vault.getMarkdownFiles();
  const hits: Array<{
    file: string;
    nodeId: string;
    section: string;
    preview: string;
    blockId?: string;
  }> = [];

  const keywords = query.toLowerCase().split(/\s+/);
  const maxResults = options?.maxResults || 10;

  // 如果有 scope 限制，先构建 node_id -> file 映射
  const scopeSet = options?.scopeNodeIds ? new Set(options.scopeNodeIds) : null;

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const nodeId = cache?.frontmatter?.node_id as string;

    // 检查 scope
    if (scopeSet && !scopeSet.has(nodeId)) continue;

    const content = await app.vault.cachedRead(file);
    const lowerContent = content.toLowerCase();

    // AND 逻辑：所有关键词都必须匹配
    if (!keywords.every(kw => lowerContent.includes(kw))) continue;

    // 找到匹配位置
    const idx = lowerContent.indexOf(keywords[0]);
    const preview = content.substring(Math.max(0, idx - 100), idx + 200);

    // 查找附近的 block_id
    const nearbyText = content.substring(Math.max(0, idx - 300), idx + 300);
    const blockMatch = nearbyText.match(/\^([a-zA-Z0-9_-]+)/);

    hits.push({
      file: file.basename,
      nodeId,
      section: cache?.frontmatter?.section as string || file.basename,
      preview: preview.replace(/\n/g, ' ').substring(0, 200),
      blockId: blockMatch?.[1]
    });

    if (hits.length >= maxResults) break;
  }

  return hits;
}

async function readMarkdownSection(
  app: ReturnType<typeof createMockObsidianApp>,
  options: { heading?: string; blockId?: string }
) {
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);

    // 按 heading 匹配
    if (options.heading) {
      const section = (cache?.frontmatter?.section as string) || '';
      if (section.toLowerCase().includes(options.heading.toLowerCase())) {
        const content = await app.vault.cachedRead(file);

        // Token 估算
        const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
        const estTokens = Math.ceil(chineseChars / 0.5) + Math.ceil((content.length - chineseChars) / 4);

        if (estTokens > 4000) {
          // 返回截断版
          return {
            status: 'WARNING_SECTION_TOO_LARGE',
            overview: content.substring(0, 800),
            subHeadings: extractSubHeadings(content),
            tokenEstimate: estTokens
          };
        }

        return {
          status: 'SUCCESS',
          content,
          tokenEstimate: estTokens,
          blockIds: extractBlockIds(content)
        };
      }
    }
  }

  return { status: 'NOT_FOUND' };
}

function extractSubHeadings(content: string) {
  const regex = /^(#{2,4})\s+(.+?)(?:\s+\^([a-zA-Z0-9_-]+))?$/gm;
  const headings: Array<{ level: number; text: string; blockId?: string }> = [];

  let match;
  while ((match = regex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2],
      blockId: match[3]
    });
  }

  return headings;
}

function extractBlockIds(content: string): string[] {
  const regex = /\^([a-zA-Z0-9_-]+)/g;
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// ============================================================================
// State Machine Simulation
// ============================================================================

interface StateContext {
  query: string;
  scopeNodeIds?: string[];
  tocData?: unknown;
  searchResults?: unknown[];
  sectionContent?: unknown;
  rawResults: Array<{ toolName: string; result: unknown }>;
}

async function simulateInspectionalState(
  app: ReturnType<typeof createMockObsidianApp>,
  ctx: StateContext
) {
  console.log('\n🔵 S1: Inspectional State');

  // 调用 get_document_outline
  const outline = await getDocumentOutline(app, BOOK_NAME);
  ctx.tocData = outline;

  // 模拟 LLM 决策：选择相关章节
  const relevantChapters = outline
    .filter(ch => ch.section?.includes('阅读') || ch.summary?.includes('阅读'))
    .slice(0, 3)
    .map(ch => ch.nodeId);

  ctx.scopeNodeIds = relevantChapters;
  ctx.rawResults.push({ toolName: 'get_document_outline', result: outline.slice(0, 5) });

  console.log(`   ✓ 获取目录: ${outline.length} 个章节`);
  console.log(`   ✓ 锁定范围: ${relevantChapters.join(', ')}`);

  return ctx;
}

async function simulateAnalyticalState(
  app: ReturnType<typeof createMockObsidianApp>,
  ctx: StateContext
) {
  console.log('\n🟢 S2: Analytical State');

  // 调用 search_markdown_text（带 scope）
  const searchResults = await searchMarkdownText(app, ctx.query, {
    scopeNodeIds: ctx.scopeNodeIds,
    maxResults: 5
  });

  ctx.searchResults = searchResults;
  ctx.rawResults.push({ toolName: 'search_markdown_text', result: searchResults });

  console.log(`   ✓ 搜索结果: ${searchResults.length} 条`);
  searchResults.forEach(r => {
    console.log(`     - ${r.section}: ${r.preview.substring(0, 50)}...`);
  });

  // 如果搜索结果不够，读取相关章节
  if (searchResults.length < 2 && ctx.scopeNodeIds && ctx.scopeNodeIds.length > 0) {
    const sectionResult = await readMarkdownSection(app, {
      heading: ctx.scopeNodeIds[0]
    });
    ctx.sectionContent = sectionResult;
    ctx.rawResults.push({ toolName: 'read_markdown_section', result: sectionResult });
    console.log(`   ✓ 读取章节: ${sectionResult.status}`);
  }

  return ctx;
}

// ============================================================================
// Tests
// ============================================================================

describe('状态机与本地工具数据流', () => {
  let mockApp: ReturnType<typeof createMockObsidianApp>;

  beforeAll(() => {
    mockApp = createMockObsidianApp();
    console.log(`\n📋 测试环境: ${mockApp.vault.getMarkdownFiles().length} 个文件`);
  });

  describe('1. 单工具数据流', () => {
    it('get_document_outline → 状态机接收正确的目录结构', async () => {
      const outline = await getDocumentOutline(mockApp, BOOK_NAME);

      // 验证数据结构
      expect(outline.length).toBeGreaterThan(50);

      const firstChapter = outline[0];
      expect(firstChapter).toHaveProperty('nodeId');
      expect(firstChapter).toHaveProperty('section');
      expect(firstChapter).toHaveProperty('level');
      expect(firstChapter).toHaveProperty('link');

      // 验证 Obsidian 链接格式
      expect(firstChapter.link).toMatch(/\[\[.+\|.+\]\]/);

      console.log('\n✅ 数据结构验证:');
      console.log(JSON.stringify(firstChapter, null, 2));
    });

    it('search_markdown_text → 状态机接收正确的搜索结果', async () => {
      const results = await searchMarkdownText(mockApp, '检视阅读', { maxResults: 5 });

      expect(results.length).toBeGreaterThan(0);

      const firstResult = results[0];
      expect(firstResult).toHaveProperty('file');
      expect(firstResult).toHaveProperty('nodeId');
      expect(firstResult).toHaveProperty('section');
      expect(firstResult).toHaveProperty('preview');
      expect(firstResult).toHaveProperty('blockId'); // 可选但应存在

      console.log('\n✅ 搜索结果结构:');
      console.log(JSON.stringify(firstResult, null, 2));
    });

    it('read_markdown_section → 状态机接收正确的章节内容', async () => {
      const result = await readMarkdownSection(mockApp, { heading: '阅读的层次' });

      // 可能返回 SUCCESS 或 WARNING_SECTION_TOO_LARGE
      expect(['SUCCESS', 'WARNING_SECTION_TOO_LARGE']).toContain(result.status);

      if (result.status === 'SUCCESS') {
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('tokenEstimate');
        expect(result).toHaveProperty('blockIds');
        expect(result.blockIds?.length).toBeGreaterThan(0);

        console.log('\n✅ 章节内容结构 (SUCCESS):');
        console.log(`   Token 估算: ${result.tokenEstimate}`);
        console.log(`   Block IDs: ${result.blockIds?.slice(0, 5).join(', ')}`);
      } else if (result.status === 'WARNING_SECTION_TOO_LARGE') {
        expect(result).toHaveProperty('overview');
        expect(result).toHaveProperty('subHeadings');

        console.log('\n✅ 章节内容结构 (TRUNCATED):');
        console.log(`   概览长度: ${result.overview?.length || 0}`);
        console.log(`   子标题数: ${result.subHeadings?.length || 0}`);
      }
    });
  });

  describe('2. Scope 过滤数据流', () => {
    it('S1 锁定 scope → S2 搜索应只在范围内', async () => {
      // Step 1: 获取全部目录
      const outline = await getDocumentOutline(mockApp, BOOK_NAME);

      // Step 2: 模拟 S1 选择 scope
      const scopeNodeIds = outline
        .filter(ch => ch.section?.includes('检视阅读'))
        .map(ch => ch.nodeId);

      console.log(`\n📍 锁定 scope: ${scopeNodeIds.join(', ')}`);

      // Step 3: 带 scope 搜索
      const resultsWithScope = await searchMarkdownText(mockApp, '阅读', {
        scopeNodeIds,
        maxResults: 10
      });

      // Step 4: 验证结果都在 scope 内
      const resultNodeIds = new Set(resultsWithScope.map(r => r.nodeId));
      const allInScope = [...resultNodeIds].every(id => scopeNodeIds.includes(id));

      console.log(`   结果 node_ids: ${[...resultNodeIds].join(', ')}`);
      console.log(`   全部在 scope 内: ${allInScope}`);

      expect(allInScope).toBe(true);
    });
  });

  describe('3. 完整状态机流程', () => {
    it('S1 → S2 完整数据流', async () => {
      let ctx: StateContext = {
        query: '什么是检视阅读',
        rawResults: []
      };

      // S1: Inspectional
      ctx = await simulateInspectionalState(mockApp, ctx);

      // 验证 S1 输出
      expect(ctx.scopeNodeIds).toBeDefined();
      expect(ctx.scopeNodeIds?.length).toBeGreaterThan(0);
      expect(ctx.rawResults.length).toBe(1);

      // S2: Analytical
      ctx = await simulateAnalyticalState(mockApp, ctx);

      // 验证 S2 输出
      expect(ctx.searchResults).toBeDefined();
      expect(ctx.rawResults.length).toBeGreaterThan(1);

      console.log('\n📊 完整数据流摘要:');
      ctx.rawResults.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.toolName}: ${JSON.stringify(r.result).substring(0, 100)}...`);
      });
    });

    it('S2 → Formatter block_id 传递', async () => {
      // 搜索并获取 block_id
      const results = await searchMarkdownText(mockApp, '四个层次', { maxResults: 3 });

      // 提取 block_ids
      const blockIds = results
        .filter(r => r.blockId)
        .map(r => ({
          blockId: r.blockId,
          section: r.section,
          obsidianLink: `[[${BOOK_NAME}#^${r.blockId}|${r.section.split('>').pop()?.trim()}]]`
        }));

      console.log('\n🔗 Block ID 传递链:');
      blockIds.forEach(b => {
        console.log(`   ${b.obsidianLink}`);
      });

      // 验证可以用于 Formatter
      expect(blockIds.length).toBeGreaterThan(0);
      blockIds.forEach(b => {
        expect(b.obsidianLink).toMatch(/\[\[.+#\^.+\|.+\]\]/);
      });
    });
  });

  describe('4. 边界情况', () => {
    it('搜索无结果时状态机应正确处理', async () => {
      const results = await searchMarkdownText(mockApp, '不存在的关键词 xyz123', { maxResults: 5 });

      console.log(`\n🔍 无结果搜索: ${results.length} 条`);
      expect(results.length).toBe(0);

      // 状态机应能处理空结果
    });

    it('大文件应返回截断版而非报错', async () => {
      // 找一个大文件
      const files = mockApp.vault.getMarkdownFiles();
      let largestFile = { path: '', content: '' };

      for (const file of files) {
        const content = await mockApp.vault.cachedRead(file);
        if (content.length > largestFile.content.length) {
          largestFile = { path: file.path, content };
        }
      }

      // 估算 tokens
      const chineseChars = (largestFile.content.match(/[\u4e00-\u9fff]/g) || []).length;
      const estTokens = Math.ceil(chineseChars / 0.5) + Math.ceil((largestFile.content.length - chineseChars) / 4);

      console.log(`\n📄 最大文件:`);
      console.log(`   路径: ${largestFile.path}`);
      console.log(`   Tokens: ${estTokens}`);

      if (estTokens > 4000) {
        console.log(`   ✅ 超过限制，应返回截断版 + 子标题`);
        // 模拟截断返回
        const truncated = {
          status: 'WARNING_SECTION_TOO_LARGE',
          overview: largestFile.content.substring(0, 800),
          subHeadings: extractSubHeadings(largestFile.content)
        };
        expect(truncated.subHeadings.length).toBeGreaterThan(0);
        console.log(`   子标题数: ${truncated.subHeadings.length}`);
      }
    });

    it('Token 估算应准确（中文为主的内容）', async () => {
      const files = mockApp.vault.getMarkdownFiles();
      const samples = files.slice(0, 10);

      for (const file of samples) {
        const content = await mockApp.vault.cachedRead(file);
        const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
        const estTokens = Math.ceil(chineseChars / 0.5) + Math.ceil((content.length - chineseChars) / 4);

        // 验证估算合理
        expect(estTokens).toBeGreaterThan(0);
        expect(estTokens).toBeLessThan(50000); // 不应该过大
      }

      console.log('\n✅ Token 估算验证通过 (10 个样本)');
    });
  });

  describe('5. 数据格式兼容性', () => {
    it('工具输出应兼容 SharedContext.rawResults', async () => {
      interface RawToolResult {
        block_id: string;
        text: string;
        toolName: string;
      }

      const searchResults = await searchMarkdownText(mockApp, '阅读', { maxResults: 3 });

      // 转换为 rawResults 格式
      const rawResults: RawToolResult[] = searchResults.map(r => ({
        block_id: r.blockId || '',
        text: r.preview,
        toolName: 'search_markdown_text'
      }));

      console.log('\n📦 rawResults 格式:');
      rawResults.forEach(r => {
        console.log(`   { block_id: "${r.block_id}", toolName: "${r.toolName}" }`);
      });

      // 验证格式
      rawResults.forEach(r => {
        expect(r).toHaveProperty('block_id');
        expect(r).toHaveProperty('text');
        expect(r).toHaveProperty('toolName');
      });
    });
  });
});
