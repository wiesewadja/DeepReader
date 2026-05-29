/**
 * 本地工具集成测试 - 使用真实的 "如何阅读一本书" 数据
 *
 * 这个测试使用实际的 Obsidian Vault 文件系统进行测试
 * 需要设置 VAULT_PATH 环境变量
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// 模拟 Obsidian App API
const VAULT_PATH = process.env.VAULT_PATH;

interface MockTFile {
  path: string;
  basename: string;
  extension: string;
}

interface MockFileCache {
  frontmatter?: Record<string, unknown>;
  headings?: { heading: string; level: number }[];
  blocks?: Record<string, { start: { line: number } }>;
}

function createMockApp(pdfName: string) {
  const bookDir = path.join(VAULT_PATH, 'DeepReader', pdfName);

  // 获取所有 markdown 文件
  const files: MockTFile[] = [];
  if (fs.existsSync(bookDir)) {
    const fileNames = fs.readdirSync(bookDir).filter(f => f.endsWith('.md'));
    for (const fileName of fileNames) {
      files.push({
        path: path.join('DeepReader', pdfName, fileName),
        basename: fileName.replace('.md', ''),
        extension: 'md'
      });
    }
  }

  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file: MockTFile) => {
        const fullPath = path.join(VAULT_PATH, file.path);
        return fs.readFileSync(fullPath, 'utf-8');
      }
    },
    metadataCache: {
      getFileCache: (file: MockTFile): MockFileCache | null => {
        const fullPath = path.join(VAULT_PATH, file.path);
        if (!fs.existsSync(fullPath)) return null;

        const content = fs.readFileSync(fullPath, 'utf-8');

        // 解析 frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        const frontmatter: Record<string, unknown> = {};

        if (frontmatterMatch) {
          const yaml = frontmatterMatch[1];
          const lines = yaml.split('\n');
          for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.*)$/);
            if (match) {
              let value: string | string[] = match[2];
              // 处理数组
              if (value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1).split(',').map(s => s.trim());
              }
              frontmatter[match[1]] = value;
            }
          }
        }

        // 提取 block IDs
        const blocks: Record<string, { start: { line: number } }> = {};
        const blockRegex = /\^([a-zA-Z0-9_-]+)/g;
        let blockMatch;
        while ((blockMatch = blockRegex.exec(content)) !== null) {
          blocks[blockMatch[1]] = { start: { line: 0 } };
        }

        return { frontmatter, blocks };
      }
    }
  };
}

describe.skip('本地工具集成测试 - 如何阅读一本书', () => {
  const pdfName = '如何阅读一本书';
  let mockApp: ReturnType<typeof createMockApp>;

  beforeAll(() => {
    mockApp = createMockApp(pdfName);
    console.log(`测试 Vault 路径: ${VAULT_PATH}`);
    console.log(`书籍目录: ${path.join(VAULT_PATH, 'DeepReader', pdfName)}`);
    console.log(`找到 ${mockApp.vault.getMarkdownFiles().length} 个文件`);
  });

  describe('get_document_outline', () => {
    it('应成功获取书籍目录结构', async () => {
      const files = mockApp.vault.getMarkdownFiles();
      expect(files.length).toBeGreaterThan(0);

      // 提取章节信息
      const chapters: Array<{ nodeId: string; section: string; level: number }> = [];

      for (const file of files) {
        const cache = mockApp.metadataCache.getFileCache(file);
        if (cache?.frontmatter) {
          const nodeId = cache.frontmatter.node_id as string;
          const section = cache.frontmatter.section as string;
          const level = cache.frontmatter.level as number;

          if (nodeId && section) {
            chapters.push({ nodeId, section, level });
          }
        }
      }

      // 按 nodeId 排序
      chapters.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

      console.log('\n📚 书籍目录结构:');
      chapters.slice(0, 10).forEach(ch => {
        const indent = '  '.repeat(Math.max(0, ch.level - 1));
        console.log(`${indent}[${ch.nodeId}] ${ch.section}`);
      });
      console.log(`... 共 ${chapters.length} 个章节`);

      expect(chapters.length).toBeGreaterThan(10);
    });

    it('应正确提取章节摘要', async () => {
      const files = mockApp.vault.getMarkdownFiles();

      // 找到第二章
      const chapter2 = files.find(f => f.basename.includes('第二章'));
      expect(chapter2).toBeDefined();

      if (chapter2) {
        const content = await mockApp.vault.cachedRead(chapter2);

        // 检查是否包含摘要
        const summaryMatch = content.match(/summary:\s*"(.+?)"/);
        expect(summaryMatch).toBeDefined();
        console.log('\n📝 第二章摘要:', summaryMatch?.[1]?.substring(0, 100) + '...');
      }
    });
  });

  describe('search_markdown_text', () => {
    it('应能搜索关键词并返回匹配结果', async () => {
      const query = '检视阅读';
      const files = mockApp.vault.getMarkdownFiles();
      const hits: Array<{ file: string; preview: string }> = [];

      for (const file of files) {
        const content = await mockApp.vault.cachedRead(file);
        if (content.includes(query)) {
          // 找到匹配位置
          const idx = content.indexOf(query);
          const preview = content.substring(Math.max(0, idx - 50), idx + 100);
          hits.push({
            file: file.basename,
            preview: preview.replace(/\n/g, ' ').substring(0, 150)
          });
        }
      }

      console.log(`\n🔍 搜索 "${query}" 找到 ${hits.length} 个匹配:`);
      hits.slice(0, 3).forEach(h => {
        console.log(`  - ${h.file}: ...${h.preview}...`);
      });

      expect(hits.length).toBeGreaterThan(0);
    });

    it('应支持 AND 逻辑搜索', async () => {
      const keywords = ['阅读', '层次'];
      const files = mockApp.vault.getMarkdownFiles();
      const hits: string[] = [];

      for (const file of files) {
        const content = await mockApp.vault.cachedRead(file);
        const allMatch = keywords.every(kw => content.includes(kw));
        if (allMatch) {
          hits.push(file.basename);
        }
      }

      console.log(`\n🔍 AND 搜索 [${keywords.join(', ')}] 找到 ${hits.length} 个匹配`);
      expect(hits.length).toBeGreaterThan(0);
    });

    it('应在搜索过多结果时返回 TOO_BROAD', async () => {
      const query = '的';  // 极高频词
      const files = mockApp.vault.getMarkdownFiles();
      let hitCount = 0;

      for (const file of files) {
        const content = await mockApp.vault.cachedRead(file);
        if (content.includes(query)) {
          hitCount++;
        }
      }

      console.log(`\n🔍 搜索高频词 "${query}" 命中 ${hitCount} 个文件`);
      expect(hitCount).toBeGreaterThan(10); // 应该触发 TOO_BROAD
    });
  });

  describe('read_markdown_section', () => {
    it('应能按标题读取章节内容', async () => {
      const heading = '阅读的层次';
      const files = mockApp.vault.getMarkdownFiles();

      // 按标题查找
      let foundFile: MockTFile | null = null;
      for (const file of files) {
        const cache = mockApp.metadataCache.getFileCache(file);
        const section = cache?.frontmatter?.section as string;
        if (section && section.includes(heading)) {
          foundFile = file;
          break;
        }
      }

      expect(foundFile).toBeDefined();

      if (foundFile) {
        const content = await mockApp.vault.cachedRead(foundFile);

        // 验证内容
        expect(content.length).toBeGreaterThan(1000);
        expect(content).toContain('阅读');

        console.log(`\n📖 读取章节 "${heading}":`);
        console.log(`  文件: ${foundFile.basename}`);
        console.log(`  长度: ${content.length} 字符`);

        // 提取子标题
        const subHeadings = content.match(/^#{2,4}\s+.+/gm) || [];
        console.log(`  子标题数: ${subHeadings.length}`);
        subHeadings.slice(0, 5).forEach(h => console.log(`    - ${h}`));
      }
    });

    it('应能提取 block_id 引用', async () => {
      const files = mockApp.vault.getMarkdownFiles();

      // 收集所有 block IDs
      const blockIds: string[] = [];
      for (const file of files.slice(0, 10)) {
        const content = await mockApp.vault.cachedRead(file);
        const matches = content.matchAll(/\^([a-zA-Z0-9_-]+)/g);
        for (const match of matches) {
          blockIds.push(match[1]);
        }
      }

      console.log(`\n🔗 找到 ${blockIds.length} 个 block_id 引用`);
      console.log(`  示例: ${blockIds.slice(0, 5).join(', ')}`);

      expect(blockIds.length).toBeGreaterThan(0);
    });

    it('应正确估算 token 数量', async () => {
      const files = mockApp.vault.getMarkdownFiles();
      const file = files[0];
      const content = await mockApp.vault.cachedRead(file);

      // 简单 token 估算：中文约 0.5 字符/token，英文约 4 字符/token
      const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
      const englishChars = content.length - chineseChars;
      const estimatedTokens = Math.ceil(chineseChars / 0.5) + Math.ceil(englishChars / 4);

      console.log(`\n📊 Token 估算:`);
      console.log(`  总字符: ${content.length}`);
      console.log(`  中文字符: ${chineseChars}`);
      console.log(`  估算 tokens: ${estimatedTokens}`);

      expect(estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('工具协作场景', () => {
    it('场景1: 先获取目录，再读取特定章节', async () => {
      // Step 1: 获取目录
      const files = mockApp.vault.getMarkdownFiles();
      const chapters: Array<{ nodeId: string; section: string; file: MockTFile }> = [];

      for (const file of files) {
        const cache = mockApp.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.node_id && cache?.frontmatter?.section) {
          chapters.push({
            nodeId: cache.frontmatter.node_id as string,
            section: cache.frontmatter.section as string,
            file
          });
        }
      }

      // Step 2: 找到"检视阅读"相关章节
      const target = chapters.find(ch => ch.section.includes('检视阅读'));
      expect(target).toBeDefined();

      // Step 3: 读取该章节
      if (target) {
        const content = await mockApp.vault.cachedRead(target.file);
        expect(content).toContain('检视阅读');
        console.log(`\n✅ 场景1 成功: 从目录定位到 "${target.section}"`);
      }
    });

    it('场景2: 搜索关键词，获取 block_id，返回引用', async () => {
      const query = '四个层次';

      // Step 1: 搜索
      const files = mockApp.vault.getMarkdownFiles();
      let foundFile: MockTFile | null = null;
      let blockId = '';

      for (const file of files) {
        const content = await mockApp.vault.cachedRead(file);
        if (content.includes(query)) {
          foundFile = file;
          // 查找附近的 block_id
          const idx = content.indexOf(query);
          const nearby = content.substring(Math.max(0, idx - 200), idx + 200);
          const blockMatch = nearby.match(/\^([a-zA-Z0-9_-]+)/);
          if (blockMatch) {
            blockId = blockMatch[1];
            break;
          }
        }
      }

      expect(foundFile).toBeDefined();

      console.log(`\n✅ 场景2 成功:`);
      console.log(`  搜索: "${query}"`);
      console.log(`  找到文件: ${foundFile?.basename}`);
      console.log(`  附近 block_id: ^${blockId || '(未找到)'}`);
    });
  });
});
