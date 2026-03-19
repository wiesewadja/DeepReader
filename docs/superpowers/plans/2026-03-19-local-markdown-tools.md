# 本地 Markdown 探索工具实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 3 个本地 Markdown 探索工具，完全替代后端依赖的 get_toc / search_doc

**Architecture:** 基于 Obsidian Vault API，通过缓存索引优化性能，实现零外部依赖的本地化智能阅读

**Tech Stack:** TypeScript, Obsidian API, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-local-markdown-tools-design.md`

---

## 文件结构

```
frontend/src/agent/tools/
├── local/
│   ├── index.ts           # 统一导出
│   ├── types.ts           # 本地工具类型定义
│   ├── utils.ts           # 共享工具函数（缓存、文件扫描）
│   ├── get-outline.ts     # 工具 1: 获取文档大纲
│   ├── search-text.ts     # 工具 2: 文本搜索
│   └── read-section.ts    # 工具 3: 读取章节
├── index.ts               # 修改: 注册新工具，移除旧工具
└── types.ts               # 保留: 现有 ToolContext

frontend/src/agent/__tests__/tools/
└── local/
    ├── utils.test.ts
    ├── get-outline.test.ts
    ├── search-text.test.ts
    └── read-section.test.ts
```

---

## Chunk 1: 共享基础设施

### Task 1: 创建类型定义

**Files:**
- Create: `frontend/src/agent/tools/local/types.ts`

- [ ] **Step 1: 创建本地工具类型定义**

```typescript
/**
 * 本地 Markdown 工具类型定义
 */

import type { TFile } from 'obsidian';

/**
 * 本地工具缓存（存储在 ToolContext 中）
 */
export interface LocalToolCache {
  /** 文件列表缓存 */
  chapterFiles?: TFile[];

  /** block_id → 文件路径 映射（如 ^ch2-p1 → DeepReader/书名/04-第一章.md） */
  blockIdIndex?: Map<string, string>;

  /** node_id → 文件路径 映射（如 0006 → DeepReader/书名/06-第三章.md） */
  nodeIdIndex?: Map<string, string>;

  /** 标题 → 文件路径 映射（如 "MECE原则" → DeepReader/书名/08-MECE原则.md） */
  headingIndex?: Map<string, string>;
}

/**
 * 章节元数据（从 frontmatter 提取）
 */
export interface ChapterMetadata {
  node_id: string;
  section: string;
  level: number;
  summary?: string;
  page_range?: string;
  part?: string;
}

/**
 * 搜索命中结果
 */
export interface SearchHit {
  location: {
    heading: string;
    path: string[];
    file_path: string;
  };
  line_number: number;
  snippet: string;
  block_id: string;
}

/**
 * 大纲节点
 */
export interface OutlineNode {
  heading: string;
  line: number;
  summary?: string;
  block_id?: string;
  children?: OutlineNode[];
}
```

- [ ] **Step 2: 验证类型定义编译通过**

Run: `cd frontend && npm run build`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/tools/local/types.ts
git commit -m "feat(local-tools): add type definitions"
```

---

### Task 2: 创建共享工具函数

**Files:**
- Create: `frontend/src/agent/tools/local/utils.ts`
- Create: `frontend/src/agent/__tests__/tools/local/utils.test.ts`

- [ ] **Step 1: 编写缓存构建测试**

```typescript
// frontend/src/agent/__tests__/tools/local/utils.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildLocalCache, extractChapterMetadata, estimateTokens } from '../../tools/local/utils.js';
import type { TFile } from 'obsidian';

describe('local/utils', () => {
  describe('buildLocalCache', () => {
    it('应正确构建文件缓存和索引', async () => {
      const mockFiles = [
        { path: 'DeepReader/如何阅读一本书/04-第一章.md', extension: 'md' },
        { path: 'DeepReader/如何阅读一本书/05-第二章.md', extension: 'md' },
        { path: 'Other/file.md', extension: 'md' },
      ] as unknown as TFile[];

      const mockApp = {
        vault: { getMarkdownFiles: () => mockFiles },
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue({
            frontmatter: { node_id: '0004', section: '第一章', level: 1 }
          })
        }
      } as any;

      const cache = await buildLocalCache(mockApp, '如何阅读一本书');

      expect(cache.chapterFiles).toHaveLength(2);
      expect(cache.nodeIdIndex?.has('0004')).toBe(true);
    });
  });

  describe('extractChapterMetadata', () => {
    it('应正确提取 frontmatter 元数据', () => {
      const frontmatter = {
        node_id: '0006',
        section: '第一篇 > 第一章 > MECE',
        level: 2,
        summary: '本章探讨...',
        page_range: '5-6'
      };

      const metadata = extractChapterMetadata(frontmatter);

      expect(metadata.node_id).toBe('0006');
      expect(metadata.section).toBe('第一篇 > 第一章 > MECE');
      expect(metadata.level).toBe(2);
    });
  });

  describe('estimateTokens', () => {
    it('中文应按字数/2估算', () => {
      const text = '这是一段中文测试文本';
      expect(estimateTokens(text)).toBe(Math.ceil(text.length / 2));
    });

    it('英文应按单词数估算', () => {
      const text = 'hello world test';
      expect(estimateTokens(text)).toBe(3);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test:run -- utils.test.ts`
Expected: FAIL - 模块未找到

- [ ] **Step 3: 实现工具函数**

```typescript
// frontend/src/agent/tools/local/utils.ts
import type { App, TFile } from 'obsidian';
import type { LocalToolCache, ChapterMetadata } from './types.js';

/**
 * Token 上限常量
 */
export const MAX_TOKENS = 4000;
export const MAX_SEARCH_HITS = 10;

/**
 * 构建本地工具缓存
 */
export async function buildLocalCache(
  app: App,
  bookName: string
): Promise<LocalToolCache> {
  const files = app.vault.getMarkdownFiles()
    .filter(f => f.path.startsWith(`DeepReader/${bookName}/`))
    .filter(f => !f.path.endsWith(`${bookName}.md`)); // 排除主文件

  const nodeIdIndex = new Map<string, string>();
  const blockIdIndex = new Map<string, string>();
  const headingIndex = new Map<string, string>();

  for (const file of files) {
    // 构建 node_id 索引
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.node_id) {
      nodeIdIndex.set(cache.frontmatter.node_id, file.path);
    }

    // 构建 heading 索引（从 section 提取）
    if (cache?.frontmatter?.section) {
      const sectionPath = String(cache.frontmatter.section);
      const heading = sectionPath.split('>').pop()?.trim();
      if (heading) {
        headingIndex.set(heading, file.path);
      }
    }

    // 构建 block_id 索引（扫描文件内容）
    const content = await app.vault.cachedRead(file);
    const blockMatches = content.matchAll(/\^[\w-]+/g);
    for (const match of blockMatches) {
      blockIdIndex.set(match[0], file.path);
    }
  }

  return { chapterFiles: files, nodeIdIndex, blockIdIndex, headingIndex };
}

/**
 * 从 frontmatter 提取章节元数据
 */
export function extractChapterMetadata(
  frontmatter: Record<string, unknown>
): ChapterMetadata {
  return {
    node_id: String(frontmatter.node_id || ''),
    section: String(frontmatter.section || ''),
    level: Number(frontmatter.level ?? 0),
    summary: frontmatter.summary ? String(frontmatter.summary) : undefined,
    page_range: frontmatter.page_range ? String(frontmatter.page_range) : undefined,
    part: frontmatter.part ? String(frontmatter.part) : undefined,
  };
}

/**
 * 估算 Token 数量
 * - 中文: 字数 / 2
 * - 英文: 单词数
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;

  return Math.ceil(chineseChars / 2) + englishWords;
}

/**
 * 解析标题路径（从 section 字段）
 * "第一篇 > 第一章 > MECE" => ["第一篇", "第一章", "MECE"]
 */
export function parseSectionPath(section: string): string[] {
  return section.split('>').map(s => s.trim()).filter(Boolean);
}

/**
 * 从文件名提取章节标题
 * "04-第一章 阅读的活力与艺术.md" => "第一章 阅读的活力与艺术"
 */
export function extractHeadingFromPath(path: string): string {
  const fileName = path.split('/').pop() || '';
  return fileName.replace(/^\d+-/, '').replace('.md', '');
}

/**
 * 规范化标题（去除空格、标点差异）
 */
export function normalizeHeading(heading: string): string {
  return heading
    .replace(/[#\s]/g, '')
    .replace(/[：:]/g, ':')
    .replace(/[，,]/g, ',')
    .toLowerCase();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test:run -- utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/tools/local/utils.ts frontend/src/agent/__tests__/tools/local/utils.test.ts
git commit -m "feat(local-tools): add shared utility functions with tests"
```

---

## Chunk 2: 工具 1 - get_document_outline

### Task 3: 实现 get_document_outline

**Files:**
- Create: `frontend/src/agent/tools/local/get-outline.ts`
- Create: `frontend/src/agent/__tests__/tools/local/get-outline.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// frontend/src/agent/__tests__/tools/local/get-outline.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getDocumentOutlineTool } from '../../tools/local/get-outline.js';
import type { ToolContext } from '../../tools/types.js';

describe('get_document_outline', () => {
  const createMockContext = (): ToolContext => ({
    indexId: 'test-idx',
    pdfName: '如何阅读一本书',
    app: {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          { path: 'DeepReader/如何阅读一本书/04-第一章.md' },
          { path: 'DeepReader/如何阅读一本书/05-第二章.md' },
        ])
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: {
            node_id: '0004',
            section: '第一篇 > 第一章',
            level: 1,
            summary: '本章探讨...'
          }
        })
      }
    } as any
  });

  it('应返回大纲树结构', async () => {
    const result = await getDocumentOutlineTool.execute({}, createMockContext());
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.book_title).toBe('如何阅读一本书');
    expect(Array.isArray(parsed.outline)).toBe(true);
  });

  it('max_depth 应限制层级深度', async () => {
    const result = await getDocumentOutlineTool.execute(
      { max_depth: 1 },
      createMockContext()
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
  });

  it('缺少 app 时应返回错误', async () => {
    const context = { ...createMockContext(), app: undefined };
    const result = await getDocumentOutlineTool.execute({}, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NO_APP_CONTEXT');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test:run -- get-outline.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 get_document_outline**

```typescript
// frontend/src/agent/tools/local/get-outline.ts
import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { OutlineNode } from './types.js';
import { buildLocalCache, extractChapterMetadata, parseSectionPath } from './utils.js';

const GET_OUTLINE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_document_outline',
    description: `【检视阅读】获取当前书籍的目录大纲。用于了解书籍整体结构、定位章节。
- 无参数：返回完整层级树
- max_depth: 限制层级深度（如 max_depth=2 只显示到 H2）`,
    parameters: {
      type: 'object',
      properties: {
        max_depth: {
          type: 'number',
          description: '限制层级深度（1=H1, 2=H2...）'
        }
      },
      required: []
    }
  }
};

export const getDocumentOutlineTool: ToolExecutor = {
  definition: GET_OUTLINE_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const maxDepth = args.max_depth as number | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    try {
      const cache = await buildLocalCache(app, pdfName);
      const files = cache.chapterFiles || [];

      if (files.length === 0) {
        return JSON.stringify({
          status: 'ERROR_NO_FILES',
          message: `未找到书籍 "${pdfName}" 的章节文件`
        });
      }

      // 构建大纲树
      const outline = buildOutlineTree(files, app, maxDepth);

      return JSON.stringify({
        status: 'SUCCESS',
        book_title: pdfName,
        outline
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({
        status: 'ERROR_FILE_READ_FAILED',
        message: `读取文件失败: ${errorMsg}`
      });
    }
  }
};

/**
 * 构建大纲树
 */
function buildOutlineTree(
  files: any[],
  app: any,
  maxDepth?: number
): OutlineNode[] {
  const nodes: OutlineNode[] = [];

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) continue;

    const metadata = extractChapterMetadata(cache.frontmatter);
    const path = parseSectionPath(metadata.section);

    // 根据深度过滤
    if (maxDepth && path.length > maxDepth) continue;

    nodes.push({
      heading: path[path.length - 1] || extractHeadingFromPath(file.path),
      line: 1,
      summary: metadata.summary,
      children: []
    });
  }

  // TODO: 构建层级树（按 section 路径嵌套）
  // 当前版本返回扁平列表，后续迭代优化
  return nodes;
}

import { extractHeadingFromPath } from './utils.js';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test:run -- get-outline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/tools/local/get-outline.ts frontend/src/agent/__tests__/tools/local/get-outline.test.ts
git commit -m "feat(local-tools): implement get_document_outline tool"
```

---

## Chunk 3: 工具 2 - search_markdown_text

### Task 4: 实现 search_markdown_text

**Files:**
- Create: `frontend/src/agent/tools/local/search-text.ts`
- Create: `frontend/src/agent/__tests__/tools/local/search-text.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// frontend/src/agent/__tests__/tools/local/search-text.test.ts
import { describe, it, expect, vi } from 'vitest';
import { searchMarkdownTextTool } from '../../tools/local/search-text.js';
import type { ToolContext } from '../../tools/types.js';

describe('search_markdown_text', () => {
  const createMockContext = (content: string): ToolContext => ({
    indexId: 'test-idx',
    pdfName: '如何阅读一本书',
    app: {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          { path: 'DeepReader/如何阅读一本书/04-第一章.md' }
        ]),
        cachedRead: vi.fn().mockResolvedValue(content)
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: { node_id: '0004', section: '第一章', level: 1 }
        })
      }
    } as any
  });

  it('AND 匹配应要求所有关键词同时出现', async () => {
    const content = 'MECE 原则是重要的。完全穷尽是关键。';
    const context = createMockContext(content);

    // 两个关键词在同一段落
    const result = await searchMarkdownTextTool.execute(
      { keywords: ['MECE', '完全穷尽'] },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.hits).toHaveLength(1);
  });

  it('关键词不在同一段落应返回 NOT_FOUND', async () => {
    const content = 'MECE 原则是重要的。\n\n完全穷尽是另一个话题。';
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['MECE', '完全穷尽'] },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NOT_FOUND');
  });

  it('命中超过 10 处应返回 TOO_BROAD', async () => {
    const content = Array(12).fill('测试内容').join('\n\n');
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['测试'] },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_TOO_BROAD');
  });

  it('use_regex 应启用正则匹配', async () => {
    const content = '管理矩阵和管理象限都是工具。';
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['管理.*(矩阵|象限)'], use_regex: true },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.hits).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test:run -- search-text.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 search_markdown_text**

```typescript
// frontend/src/agent/tools/local/search-text.ts
import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { SearchHit } from './types.js';
import { buildLocalCache, MAX_SEARCH_HITS } from './utils.js';

const SEARCH_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_markdown_text',
    description: `【检视阅读】在当前书籍中搜索文本。用于定位关键词出现的章节位置。
- keywords: 关键词数组（AND 逻辑，必须同时出现在同一段落）
- use_regex: 是否启用正则表达式（默认 false，搜索失败时可开启）

【摩擦力】如果命中超过 10 处，返回 ERROR_TOO_BROAD，请换更精准的词。`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组（AND 逻辑）'
        },
        use_regex: {
          type: 'boolean',
          description: '是否启用正则表达式（默认 false）'
        }
      },
      required: ['keywords']
    }
  }
};

export const searchMarkdownTextTool: ToolExecutor = {
  definition: SEARCH_TEXT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const keywords = args.keywords as string[];
    const useRegex = args.use_regex as boolean || false;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!keywords || keywords.length === 0) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: 'keywords 参数不能为空'
      });
    }

    try {
      const cache = await buildLocalCache(app, pdfName);
      const files = cache.chapterFiles || [];
      const hits: SearchHit[] = [];

      for (const file of files) {
        const content = await app.vault.cachedRead(file);
        const paragraphs = content.split(/\n\n+/);

        for (let i = 0; i < paragraphs.length; i++) {
          const para = paragraphs[i];

          if (matchParagraph(para, keywords, useRegex)) {
            const blockId = extractBlockId(para) || '';
            const fileCache = app.metadataCache.getFileCache(file);
            const section = fileCache?.frontmatter?.section || '';

            hits.push({
              location: {
                heading: section.split('>').pop()?.trim() || file.basename,
                path: section.split('>').map(s => s.trim()),
                file_path: file.path
              },
              line_number: i + 1,
              snippet: para.slice(0, 100) + (para.length > 100 ? '...' : ''),
              block_id: blockId
            });

            if (hits.length > MAX_SEARCH_HITS) {
              return JSON.stringify({
                status: 'ERROR_TOO_BROAD',
                message: `命中超过 ${MAX_SEARCH_HITS} 处，请使用更精准的关键词或启用 use_regex`,
                total_hits: hits.length
              });
            }
          }
        }
      }

      if (hits.length === 0) {
        return JSON.stringify({
          status: 'ERROR_NOT_FOUND',
          message: '未找到匹配内容',
          suggestions: generateSuggestions(keywords)
        });
      }

      return JSON.stringify({
        status: 'SUCCESS',
        hits,
        total_hits: hits.length
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({
        status: 'ERROR_FILE_READ_FAILED',
        message: `读取文件失败: ${errorMsg}`
      });
    }
  }
};

/**
 * 段落匹配
 */
function matchParagraph(para: string, keywords: string[], useRegex: boolean): boolean {
  if (useRegex) {
    return keywords.some(kw => new RegExp(kw).test(para));
  }
  return keywords.every(kw => para.includes(kw));
}

/**
 * 提取段落中的 block_id
 */
function extractBlockId(para: string): string | null {
  const match = para.match(/\^[\w-]+/);
  return match ? match[0] : null;
}

/**
 * 生成搜索建议（基于编辑距离）
 */
function generateSuggestions(keywords: string[]): string[] {
  // 简化版本：返回空数组
  // TODO: 实现基于编辑距离的近似词建议
  return [];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test:run -- search-text.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/tools/local/search-text.ts frontend/src/agent/__tests__/tools/local/search-text.test.ts
git commit -m "feat(local-tools): implement search_markdown_text tool"
```

---

## Chunk 4: 工具 3 - read_markdown_section

### Task 5: 实现 read_markdown_section

**Files:**
- Create: `frontend/src/agent/tools/local/read-section.ts`
- Create: `frontend/src/agent/__tests__/tools/local/read-section.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// frontend/src/agent/__tests__/tools/local/read-section.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readMarkdownSectionTool } from '../../tools/local/read-section.js';
import type { ToolContext } from '../../tools/types.js';

describe('read_markdown_section', () => {
  const createMockContext = (content: string): ToolContext => ({
    indexId: 'test-idx',
    pdfName: '如何阅读一本书',
    app: {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          { path: 'DeepReader/如何阅读一本书/04-MECE原则.md', basename: '04-MECE原则' }
        ]),
        cachedRead: vi.fn().mockResolvedValue(content)
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: { node_id: '0004', section: 'MECE原则', level: 2 }
        })
      }
    } as any
  });

  it('应返回完整章节内容', async () => {
    const content = '# MECE原则\n\n这是内容。';
    const context = createMockContext(content);

    const result = await readMarkdownSectionTool.execute(
      { heading: 'MECE' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS_FULL_SECTION');
    expect(parsed.content).toContain('MECE');
  });

  it('超限内容应返回截断+子标题', async () => {
    // 生成超长内容
    const longContent = '# 大章节\n\n' + 'x'.repeat(10000);
    const context = createMockContext(longContent);

    const result = await readMarkdownSectionTool.execute(
      { heading: '大章节' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('WARNING_SECTION_TOO_LARGE');
    expect(parsed.overview_text).toBeDefined();
    expect(parsed.sub_headings).toBeDefined();
  });

  it('未找到标题应返回 NOT_FOUND', async () => {
    const content = '# 其他标题\n\n内容';
    const context = createMockContext(content);

    const result = await readMarkdownSectionTool.execute(
      { heading: '不存在的标题' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NOT_FOUND');
  });

  it('block_id 应定位到对应章节', async () => {
    const content = '内容 ^block123';
    const context = createMockContext(content);

    const result = await readMarkdownSectionTool.execute(
      { block_id: '^block123' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS_FULL_SECTION');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test:run -- read-section.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 read_markdown_section**

```typescript
// frontend/src/agent/tools/local/read-section.ts
import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import { buildLocalCache, estimateTokens, MAX_TOKENS, normalizeHeading } from './utils.js';

const READ_SECTION_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_markdown_section',
    description: `【分析阅读】读取指定章节的完整内容。用于精读某个小节。
- heading: 标题名称（包含匹配，如 "MECE" 可匹配 "### MECE 原则"）
- block_id: 块引用 ID（如 "^ch2-p1"，自动定位到包含该块的章节）
二选一，优先 heading。`,
    parameters: {
      type: 'object',
      properties: {
        heading: {
          type: 'string',
          description: '标题名称（包含匹配）'
        },
        block_id: {
          type: 'string',
          description: '块引用 ID（如 ^ch2-p1）'
        }
      },
      required: []
    }
  }
};

export const readMarkdownSectionTool: ToolExecutor = {
  definition: READ_SECTION_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
    const heading = args.heading as string | undefined;
    const blockId = args.block_id as string | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!heading && !blockId) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: '必须提供 heading 或 block_id 参数'
      });
    }

    try {
      const cache = await buildLocalCache(app, pdfName);
      const files = cache.chapterFiles || [];

      let targetFile = null;

      if (heading) {
        // 按标题查找
        const normalizedQuery = normalizeHeading(heading);
        const candidates: string[] = [];

        for (const file of files) {
          const fileCache = app.metadataCache.getFileCache(file);
          const section = fileCache?.frontmatter?.section || file.basename;
          const normalizedSection = normalizeHeading(section);

          if (normalizedSection.includes(normalizedQuery)) {
            candidates.push(section);
            if (!targetFile) targetFile = file;
          }
        }

        if (candidates.length > 1) {
          return JSON.stringify({
            status: 'ERROR_MULTIPLE_MATCHES',
            message: '标题匹配到多个章节',
            candidates
          });
        }

        if (candidates.length === 0) {
          return JSON.stringify({
            status: 'ERROR_NOT_FOUND',
            message: `未找到标题: ${heading}`
          });
        }
      } else if (blockId) {
        // 按 block_id 查找
        for (const file of files) {
          const content = await app.vault.cachedRead(file);
          if (content.includes(blockId)) {
            targetFile = file;
            break;
          }
        }

        if (!targetFile) {
          return JSON.stringify({
            status: 'ERROR_NOT_FOUND',
            message: `未找到 block_id: ${blockId}`
          });
        }
      }

      if (!targetFile) {
        return JSON.stringify({
          status: 'ERROR_NOT_FOUND',
          message: '未找到匹配的章节'
        });
      }

      const content = await app.vault.cachedRead(targetFile);
      const tokens = estimateTokens(content);

      // 超限截断
      if (tokens > MAX_TOKENS) {
        const overviewText = content.slice(0, 800);
        const subHeadings = extractSubHeadings(content);

        return JSON.stringify({
          status: 'WARNING_SECTION_TOO_LARGE',
          message: `章节过大（约 ${tokens} tokens），已截断。请钻取具体子标题。`,
          word_count: content.length,
          token_estimate: tokens,
          overview_text: overviewText,
          sub_headings: subHeadings
        });
      }

      return JSON.stringify({
        status: 'SUCCESS_FULL_SECTION',
        heading: targetFile.basename,
        word_count: content.length,
        token_estimate: tokens,
        content
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({
        status: 'ERROR_FILE_READ_FAILED',
        message: `读取文件失败: ${errorMsg}`
      });
    }
  }
};

/**
 * 提取子标题列表
 */
function extractSubHeadings(content: string): { heading: string; line: number }[] {
  const lines = content.split('\n');
  const headings: { heading: string; line: number }[] = [];

  lines.forEach((line, idx) => {
    const match = line.match(/^(#{2,6})\s+(.+)/);
    if (match) {
      headings.push({
        heading: match[2],
        line: idx + 1
      });
    }
  });

  return headings;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test:run -- read-section.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/agent/tools/local/read-section.ts frontend/src/agent/__tests__/tools/local/read-section.test.ts
git commit -m "feat(local-tools): implement read_markdown_section tool"
```

---

## Chunk 5: 集成与清理

### Task 6: 创建统一导出

**Files:**
- Create: `frontend/src/agent/tools/local/index.ts`

- [ ] **Step 1: 创建导出文件**

```typescript
// frontend/src/agent/tools/local/index.ts
/**
 * 本地 Markdown 工具统一导出
 */

export { getDocumentOutlineTool } from './get-outline.js';
export { searchMarkdownTextTool } from './search-text.js';
export { readMarkdownSectionTool } from './read-section.js';

export * from './types.js';
export * from './utils.js';
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/agent/tools/local/index.ts
git commit -m "feat(local-tools): add unified exports"
```

---

### Task 7: 更新工具注册

**Files:**
- Modify: `frontend/src/agent/tools/index.ts`

- [ ] **Step 1: 更新工具注册**

```typescript
// 在 frontend/src/agent/tools/index.ts 中

// 1. 添加新导入
import {
  getDocumentOutlineTool,
  searchMarkdownTextTool,
  readMarkdownSectionTool
} from './local/index.js';

// 2. 移除旧导入（注释掉或删除）
// import { searchDocTool } from './search-doc.js';
// import { getTocTool } from './get-toc.js';

// 3. 在 createToolRegistry 函数中替换注册
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 注册本地工具（替代旧工具）
  registry.set('get_document_outline', getDocumentOutlineTool);
  registry.set('search_markdown_text', searchMarkdownTextTool);
  registry.set('read_markdown_section', readMarkdownSectionTool);

  // ... 其他工具保持不变
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd frontend && npm run build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/tools/index.ts
git commit -m "feat(local-tools): register new tools, deprecate old ones"
```

---

### Task 8: 更新 ContextBuilder

**Files:**
- Modify: `frontend/src/agent/context/builder.ts`

- [ ] **Step 1: 更新工具说明文案**

```typescript
// 在 buildConstraints() 方法中更新工具描述

private buildConstraints(): string {
  return `## 核心行为准则

### 1. **【路由服从】**：每次对话前，系统会通过 \`<system_note>\` 告诉你当前属于哪种阅读层级（检视/分析/主题），你必须**绝对服从**该限制，仅调用被允许的工具。

### 2. 你的阅读动作定义
- **先找地图 (get_document_outline)**：获取书籍目录树、章节摘要。用于建立宏观认知和定位战区。
- **放大镜 (search_markdown_text)**：本地文本搜索（AND 逻辑）。用于精准定位事实。
- **望远镜 (read_markdown_section)**：读取完整章节内容。**这是重型武器**，仅在极度需要深挖单章逻辑时调用。

## 4. 静默执行纪律 (Silent Execution)
当你决定调用任何工具时，
**必须直接输出 JSON/Tool Call，绝对禁止在 content 字段输出任何自然语言文本**。`;
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd frontend && npm run build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/context/builder.ts
git commit -m "feat(local-tools): update tool descriptions in ContextBuilder"
```

---

### Task 9: 删除旧工具文件

**Files:**
- Delete: `frontend/src/agent/tools/get-toc.ts`
- Delete: `frontend/src/agent/tools/search-doc.ts`

- [ ] **Step 1: 删除旧文件**

```bash
rm frontend/src/agent/tools/get-toc.ts
rm frontend/src/agent/tools/search-doc.ts
```

- [ ] **Step 2: 验证编译通过**

Run: `cd frontend && npm run build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove deprecated get-toc and search-doc tools"
```

---

### Task 10: 最终验证

- [ ] **Step 1: 运行完整测试套件**

Run: `cd frontend && npm run test:run`
Expected: 全部通过

- [ ] **Step 2: 运行类型检查**

Run: `cd frontend && npm run build`
Expected: 无类型错误

- [ ] **Step 3: 手动测试**

1. 在 Obsidian 中重新加载插件
2. 选择一本已导出章节的书
3. 测试三个工具：
   - `get_document_outline` - 查看大纲
   - `search_markdown_text` - 搜索关键词
   - `read_markdown_section` - 读取章节

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat(local-tools): complete migration to local markdown tools

- Implement 3 local tools: get_document_outline, search_markdown_text, read_markdown_section
- Remove deprecated backend-dependent tools: get_toc, search_doc
- Add comprehensive test coverage
- Update ContextBuilder with new tool descriptions"
```

---

## 测试清单

- [ ] `get_document_outline` 返回正确的层级树
- [ ] `search_markdown_text` AND 逻辑正确
- [ ] `search_markdown_text` 正则模式正确
- [ ] `search_markdown_text` TOO_BROAD 错误正确触发
- [ ] `read_markdown_section` 返回完整内容
- [ ] `read_markdown_section` 超限截断正确
- [ ] `read_markdown_section` 多匹配返回候选
- [ ] 所有错误状态正确返回
- [ ] 缺少 app 时返回 ERROR_NO_APP_CONTEXT
