/**
 * formatter.ts post-processing 函数现状行为回归测试
 *
 * 目标：固化 S4 formatter 中 3 个 wiki 链接后处理函数的行为（不改实现）。
 * 为后续 T1.3/T1.4/T2.1 的修复提供 baseline 对比。
 *
 * 覆盖场景：
 * - 跨书：fixupWikiLinks 当前会误加书名前缀（T1.3 修复）
 * - 变形文件名：stripFabricatedLinks 用 endsWith 模糊匹配可能误删（T1.4 修复）
 * - 空 block_id：fixupEmptyBlockIds 处理 `[[path#^|alias]]` 形式
 */

import { describe, it, expect } from 'vitest';
import {
  fixupWikiLinks,
  fixupEmptyBlockIds,
  stripFabricatedLinks,
} from '@/agent/graph/nodes/formatter';

describe('fixupWikiLinks', () => {
  it('加书名前缀到「裸文件名」链接', () => {
    const result = fixupWikiLinks('[[01-序|序]]', '西方史纲');
    expect(result).toBe('[[西方史纲/01-序|序]]');
  });

  it('保留已有 bookName 前缀的链接不变', () => {
    const result = fixupWikiLinks('[[另一本书/01-序|序]]', '西方史纲');
    // 现状行为：只要含 `/` 就跳过，所以跨书链接不会被改动
    expect(result).toBe('[[另一本书/01-序|序]]');
  });

  it('空 bookName 时不做任何处理', () => {
    const result = fixupWikiLinks('[[01-序|序]]', '');
    expect(result).toBe('[[01-序|序]]');
  });

  it('处理多个链接', () => {
    const result = fixupWikiLinks('[[01-序|序]] and [[02-论|论]]', '西方史纲');
    expect(result).toBe('[[西方史纲/01-序|序]] and [[西方史纲/02-论|论]]');
  });

  // T1.3: 跨书守卫
  it('crossBookMode=true 时不加书名前缀（保留跨书裸名）', () => {
    const result = fixupWikiLinks('[[01-序|序]]', '西方史纲', true);
    expect(result).toBe('[[01-序|序]]');
  });

  it('crossBookMode=true 时跨书链接不被加错前缀', () => {
    const result = fixupWikiLinks('[[另一本书/01-序|序]]', '西方史纲', true);
    expect(result).toBe('[[另一本书/01-序|序]]');
  });

  it('crossBookMode=false (默认) 行为与旧版一致', () => {
    // 显式 false 也要工作
    const result = fixupWikiLinks('[[01-序|序]]', '西方史纲', false);
    expect(result).toBe('[[西方史纲/01-序|序]]');
  });
});

describe('fixupEmptyBlockIds', () => {
  it('降级 [[path#^|alias]] 为 [[path|alias]]', () => {
    const result = fixupEmptyBlockIds('see [[西方史纲/01-序#^|序]] here');
    expect(result).toBe('see [[西方史纲/01-序|序]] here');
  });

  it('降级 [[path#^]] 为 [[path]]', () => {
    const result = fixupEmptyBlockIds('see [[西方史纲/01-序#^]] here');
    expect(result).toBe('see [[西方史纲/01-序]] here');
  });

  it('保留合法的 block_id 链接', () => {
    const content = 'see [[西方史纲/01-序#^b1|序]] here';
    const result = fixupEmptyBlockIds(content);
    expect(result).toBe(content);
  });

  it('对无链接的文本无影响', () => {
    expect(fixupEmptyBlockIds('plain text')).toBe('plain text');
  });
});

describe('stripFabricatedLinks', () => {
  it('移除不在 inputTexts 中的「编造」链接（需 validFileNames 非空）', () => {
    // 关键：validFileNames 必须从 inputTexts 中的 wiki link 收集
    // 否则走空分支（宽松），不会检测编造
    const content = 'real [[a/01-序|序]] and fake [[a/99-不存在的章节|不存在]]';
    const inputs = [
      'scope has [[a/01-序|序]] reference', // wiki link → validFileNames 添加 '01-序'
    ];
    const result = stripFabricatedLinks(content, inputs);
    // 01-序 保留（合法）；99-不存在的章节 应被识别为编造并降级为别名
    expect(result).toContain('[[a/01-序|序]]');
    expect(result).not.toContain('99-不存在的章节');
  });

  it('对合法 block_id 链接保持原样（需 validFileNames 非空）', () => {
    const content = '[[a/01-序#^b1|序]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set(['b1']));
    // b1 在 vaultBlockIds 中，应保留 #^b1
    expect(result).toBe('[[a/01-序#^b1|序]]');
  });

  it('降级 vault 中不存在的 block_id 链接为文件级链接（需 validFileNames 非空）', () => {
    const content = '[[a/01-序#^ghost|序]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set(['b1', 'b2']));
    // ghost 不在 vaultBlockIds 中，应降级
    expect(result).toBe('[[a/01-序|序]]');
  });

  it('scope 为空时降级 block_id 链接到文件级（宽松分支）', () => {
    // 现状行为：当 validFileNames.size === 0 时，只降级 block_id 链接
    // 不做 file_name 编造检测
    const content = '[[a/01-序#^b1|序]]';
    const inputs: string[] = []; // 完全无输入
    const result = stripFabricatedLinks(content, inputs, new Set());
    // block_id 链接降级为文件级
    expect(result).toBe('[[a/01-序|序]]');
  });

  it('scope 为空时保留无 block_id 的链接', () => {
    const content = '[[a/01-序|序]]';
    const inputs: string[] = [];
    const result = stripFabricatedLinks(content, inputs, new Set());
    // 无 block_id，宽松分支保留
    expect(result).toBe('[[a/01-序|序]]');
  });

  it('降级 Calibre pagebreak 标记 (#calibre-pb-N) 为文件级链接', () => {
    // 关键：calibre-pb-* 不是合法 block_id，应降级为标题链接
    const content = '[[a/01-序#calibre-pb-5|序]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set());
    // calibre-pb-N 应降级
    expect(result).toBe('[[a/01-序|序]]');
  });
});
