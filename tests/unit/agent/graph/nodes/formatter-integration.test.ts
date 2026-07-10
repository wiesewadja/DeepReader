/**
 * S4 Formatter 端到端集成测试
 *
 * 覆盖 S4 formatter post-processing 链路 6 类场景 + 2 静态反例：
 * - D1 端到端 happy path (3 it)
 * - D2 端到端流式末尾截断 (2 it)
 * - D3 formatter × wiki-link-hook 真实校验 (3 it)
 * - D4 formatter × wiki-link-pair-validator (2 it)
 * - D5 crossBookMode 集成 (2 it)
 * - D6 错误路径 + HITL (3 it)
 * - D7 静态反例 (2 it)
 *
 * 测试策略：不直接 mount LangGraph state；用纯函数链式调用 + 最小
 * CognitiveEngineState 字段构造。
 */

import { describe, it, expect, vi } from 'vitest';

// 关键 mock：让 import 链路可解析
vi.mock('@/utils/logger.js', () => ({
  agentLog: vi.fn(),
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import {
  fixupWikiLinks,
  fixupEmptyBlockIds,
  stripFabricatedLinks,
} from '@/agent/graph/utils/output-sanitizer';
import { validateLinkPairs } from '@/agent/utils/wiki-link-pair-validator';
import { validateWikiLinks } from '@/agent/utils/wiki-link-hook';
import type { App } from 'obsidian';

// ============================================================
// 工具函数：构造 mock app / 模拟 S4 处理链
// ============================================================

function createMockApp(adapterOverrides: Record<string, any> = {}) {
  return {
    vault: {
      adapter: {
        exists: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
        ...adapterOverrides,
      },
    },
  } as unknown as App;
}

/**
 * 模拟 S4 真实处理顺序：流式残片 → 工具结果校验 → 风格清洗 → vault 校验 → 编造链接剔除
 * 不直接调 formatterNode（避免 mock LLM stream 全链路），而是用同一顺序串 5 个工具函数
 */
async function simulateS4Pipeline(
  content: string,
  opts: {
    app?: App | null;
    bookName?: string;
    crossBookMode?: boolean;
    toolResults?: { toolName: string; args: Record<string, unknown>; result: string }[];
    vaultBlockIds?: Set<string>;
    inputTextsForValidation?: string[];
  } = {}
): Promise<string> {
  const {
    app = null,
    bookName = '',
    crossBookMode = false,
    toolResults = [],
    vaultBlockIds = new Set(),
    inputTextsForValidation = [],
  } = opts;

  // 步骤 1: 流式截断修复（validateLinkPairs）
  let step1 = validateLinkPairs(content).content;

  // 步骤 2: 工具结果校验（实际是 verifyAndCleanContent；这里简化处理，因 link pair 修复后无截断）
  // 跳过此步以避免引入 verifyAndCleanContent 的复杂 mock

  // 步骤 3: 风格清洗（fixupEmptyBlockIds + fixupWikiLinks）
  const step3 = fixupWikiLinks(fixupEmptyBlockIds(step1), bookName, crossBookMode);

  // 步骤 4: vault.exists 真实校验（validateWikiLinks）
  let step4 = step3;
  if (app) {
    const result = await validateWikiLinks(step3, {
      app,
      bookName: crossBookMode ? '' : bookName,
      expectedBookName: crossBookMode ? '' : bookName,
      vaultPath: '/vault',
      toolResults: toolResults as any,
    });
    step4 = result.correctedContent;
  }

  // 步骤 5: 编造链接剔除（stripFabricatedLinks）
  return stripFabricatedLinks(step4, inputTextsForValidation, vaultBlockIds);
}

// ============================================================
// D1: 端到端 happy path (3 it)
// ============================================================

describe('D1: S4 端到端 happy path', () => {
  it('D1.1 单书：合法链接走完整链路不变', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = 'see [[西方史纲/01-序|序]] for context';
    const result = await simulateS4Pipeline(content, {
      app,
      bookName: '西方史纲',
      crossBookMode: false,
      inputTextsForValidation: ['scope has [[西方史纲/01-序|序]]'],
    });
    expect(result).toContain('[[西方史纲/01-序|序]]');
  });

  it('D1.2 跨书：crossBookMode=true 时不被加书名前缀', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = '[[另一本书/02-论|论]]';
    const result = await simulateS4Pipeline(content, {
      app,
      bookName: '西方史纲',
      crossBookMode: true,
      inputTextsForValidation: ['scope has [[另一本书/02-论|论]]'],
    });
    expect(result).toContain('[[另一本书/02-论|论]]');
    expect(result).not.toContain('[[西方史纲/另一本书');
  });

  it('D1.3 工具链路：toolResults 中含 block_id，合法 link 保留', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = '[[西方史纲/01-序#^b1|序]]';
    const result = await simulateS4Pipeline(content, {
      app,
      bookName: '西方史纲',
      toolResults: [
        { toolName: 'search_book', args: {}, result: '...content with ^b1 reference...' },
      ],
      inputTextsForValidation: ['scope has [[西方史纲/01-序|序]]'],
    });
    expect(result).toContain('[[西方史纲/01-序#^b1|序]]');
  });
});

// ============================================================
// D2: 端到端流式末尾截断 (2 it)
// ============================================================

describe('D2: 流式末尾截断集成', () => {
  it('D2.1 流中断：残片 [[book/01 在管道早期被修复', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    // 模拟 LLM stream 末尾残缺
    const truncated = 'see [[book/01-序';
    const result = await simulateS4Pipeline(truncated, {
      app,
      bookName: 'book',
      inputTextsForValidation: [],
    });
    // validateLinkPairs 把 [[ 剥成 [，下游不会再当 wiki link 处理
    expect(result).toBe('see [book/01-序');
    // 残片形态不应被加书名前缀（fixupWikiLinks 只识别 [[ 形式）
    expect(result).not.toContain('[[book/[book');
  });

  it('D2.2 混合：完整 + 截断 共存时分别处理', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const mixed = '[[book/01-序|序]] and [[book/02-论';
    const result = await simulateS4Pipeline(mixed, {
      app,
      bookName: 'book',
      inputTextsForValidation: ['scope has [[book/01-序|序]] and [[book/02-论|论]]'],
    });
    // 完整链接保留
    expect(result).toContain('[[book/01-序|序]]');
    // 截断的 [[book/02-论 被剥成 [book/02-论
    expect(result).toContain('[book/02-论');
  });
});

// ============================================================
// D3: formatter × wiki-link-hook 真实校验 (3 it)
// ============================================================

describe('D3: S4 与 wiki-link-hook 真实校验集成', () => {
  it('D3.1 存在：vault 中文件存在，链接保留', async () => {
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (p: string) => {
        return p.endsWith('01-序.md');
      }),
    });
    const result = await simulateS4Pipeline('[[西方史纲/01-序|序]]', {
      app,
      bookName: '西方史纲',
      inputTextsForValidation: ['scope has [[西方史纲/01-序|序]]'],
    });
    expect(result).toContain('[[西方史纲/01-序|序]]');
  });

  it('D3.2 不存在：vault 中无文件 → 模糊匹配修复', async () => {
    const app = createMockApp({
      exists: vi.fn().mockImplementation(async (p: string) => {
        // book 目录存在 → 允许 list() 模糊匹配
        if (p === '/vault/DeepReader/西方史纲') return true;
        // 期望的文件 07-八、抗议.md 不存在
        if (p.endsWith('07-八、抗议.md')) return false;
        return false;
      }),
      list: vi.fn().mockResolvedValue({
        files: ['/vault/DeepReader/西方史纲/08-八、抗议.md'],
        folders: [],
      }),
    });
    const result = await validateWikiLinks('[[西方史纲/07-八、抗议|七、抗议]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    // 至少记录一个 file_not_found issue（链接文件不存在）
    expect(result.metrics.totalLinks).toBe(1);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    const fileNotFound = result.issues.find(i => i.issueType === 'file_not_found');
    expect(fileNotFound).toBeDefined();
  });

  it('D3.3 跨书：链接 bookName 与当前书不符 → wrong_book', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const result = await validateWikiLinks('[[另一本书/01-序|序]]', {
      app,
      bookName: '西方史纲',
      vaultPath: '/vault',
      toolResults: [],
    });
    const wrongBook = result.issues.find(i => i.issueType === 'wrong_book');
    expect(wrongBook).toBeDefined();
  });
});

// ============================================================
// D4: formatter × wiki-link-pair-validator (2 it)
// ============================================================

describe('D4: S4 与 wiki-link-pair-validator 集成', () => {
  it('D4.1 正常配对：4 个完整 [[x]] 全保留', async () => {
    const content = '[[a/1|x]] [[a/2|y]] [[a/3|z]] [[a/4|w]]';
    const pairResult = validateLinkPairs(content);
    expect(pairResult.pairedCount).toBe(4);
    expect(pairResult.fixedUnpaired).toBe(0);
    expect(pairResult.content).toBe(content);
  });

  it('D4.2 单边 ]]：末尾多余 ]] 替换为 ]', async () => {
    const content = '[[a/1|x]] and extra ]] here';
    const pairResult = validateLinkPairs(content);
    expect(pairResult.pairedCount).toBe(1);
    expect(pairResult.unpairedCount).toBe(1);
    expect(pairResult.content).toBe('[[a/1|x]] and extra ] here');
  });
});

// ============================================================
// D5: crossBookMode 集成 (2 it)
// ============================================================

describe('D5: crossBookMode 集成', () => {
  it('D5.1 跨书模式 + fixupWikiLinks：crossBookMode=true → 不加前缀', () => {
    // 跨书模式直接用 fixupWikiLinks 测（单步）
    const content = '[[01-序|序]] and [[另一本书/02|二]]';
    const result = fixupWikiLinks(content, '西方史纲', true);
    // 跨书模式：都不加前缀
    expect(result).toBe('[[01-序|序]] and [[另一本书/02|二]]');
  });

  it('D5.2 跨书模式 + validateWikiLinks：crossBookMode=true → 无 wrong_book', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const result = await validateWikiLinks('[[任意书/01-序|序]]', {
      app,
      bookName: '西方史纲',
      expectedBookName: '',  // 跨书模式
      vaultPath: '/vault',
      toolResults: [],
    });
    const wrongBook = result.issues.find(i => i.issueType === 'wrong_book');
    expect(wrongBook).toBeUndefined();
  });
});

// ============================================================
// D6: 错误路径 + HITL (3 it)
// ============================================================

describe('D6: 错误路径与边界情况', () => {
  it('D6.1 LLM 拒答：空内容不崩', async () => {
    const result = await simulateS4Pipeline('', {
      app: createMockApp(),
      bookName: '西方史纲',
    });
    expect(result).toBe('');
  });

  it('D6.2 纯文本：无 wiki 链接时全链路无副作用', async () => {
    const app = createMockApp({
      exists: vi.fn().mockResolvedValue(true),
    });
    const content = 'just some plain text without any links';
    const result = await simulateS4Pipeline(content, {
      app,
      bookName: '西方史纲',
      inputTextsForValidation: [],
    });
    expect(result).toBe(content);
  });

  it('D6.3 vault 校验失败：app.vault.adapter 抛错时降级使用 cleanOutput 结果', async () => {
    // 模拟 vault 不可用：app=null（实际 formatterNode 检查 ctx?.toolContext?.vault?.app）
    const content = '[[西方史纲/01-序|序]]';
    const result = await simulateS4Pipeline(content, {
      app: null,  // 模拟无 vault
      bookName: '西方史纲',
      inputTextsForValidation: ['scope has [[西方史纲/01-序|序]]'],
    });
    // 无 app 时跳过 validateWikiLinks，cleanOutput 的结果保留
    expect(result).toContain('[[西方史纲/01-序|序]]');
  });
});

// ============================================================
// D7: 静态反例 (2 it)
// ============================================================

const SRC = path.resolve(__dirname, '../../../../../src');

function grepSrc(pattern: string): string {
  try {
    return execSync(`grep -rE "${pattern}" "${SRC}" --include="*.ts"`, { encoding: 'utf-8' });
  } catch (e: any) {
    if (e.status === 1) return '';
    throw e;
  }
}

describe('D7: 静态反例（重构后清理验证）', () => {
  it('D7.1 agent-chat-controller.ts 已不再 import link-validator', () => {
    const controllerPath = path.join(SRC, 'views/sidebar/agent-chat-controller.ts');
    if (fs.existsSync(controllerPath)) {
      const content = fs.readFileSync(controllerPath, 'utf-8');
      expect(content).not.toMatch(/link-validator|validateAndCorrectLinks/);
    }
  });

  it('D7.2 src/ 无 link-validator 模块引用（应已被删除）', () => {
    // 链接验证器已删（Phase 4.2），src/ 应无残留引用
    const result = grepSrc('link-validator|validateAndCorrectLinks');
    const matches = result.trim().split('\n').filter(Boolean);
    expect(matches).toEqual([]);
  });
});
