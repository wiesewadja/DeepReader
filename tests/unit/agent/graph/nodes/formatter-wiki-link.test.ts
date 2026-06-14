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
} from '@/agent/graph/utils/output-sanitizer';

describe('fixupWikiLinks', () => {
  it('加书名前缀到「裸文件名」链接', () => {
    const result = fixupWikiLinks('[[01-序|序]]', '西方史纲');
    expect(result).toBe('[[西方史纲/01-序|序]]');
  });

  it('保留已有 bookName 前缀的链接不变', () => {
    const result = fixupWikiLinks('[[另一本书/01-序|序]]', '西方史纲');
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

describe('stripFabricatedLinks - T0.2 snapshot (current behavior)', () => {
  it('移除不在 inputTexts 中的「编造」链接（需 validFileNames 非空）', () => {
    const content = 'real [[a/01-序|序]] and fake [[a/99-不存在的章节|不存在]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs);
    expect(result).toContain('[[a/01-序|序]]');
    expect(result).not.toContain('99-不存在的章节');
  });

  it('对合法 block_id 链接保持原样（需 validFileNames 非空）', () => {
    const content = '[[a/01-序#^b1|序]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set(['b1']));
    expect(result).toBe('[[a/01-序#^b1|序]]');
  });

  it('降级 vault 中不存在的 block_id 链接为文件级链接（需 validFileNames 非空）', () => {
    const content = '[[a/01-序#^ghost|序]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set(['b1', 'b2']));
    expect(result).toBe('[[a/01-序|序]]');
  });

  it('scope 为空时保留无 block_id 的链接', () => {
    const content = '[[a/01-序|序]]';
    const inputs: string[] = [];
    const result = stripFabricatedLinks(content, inputs, new Set());
    expect(result).toBe('[[a/01-序|序]]');
  });

  it('降级 Calibre pagebreak 标记 (#calibre-pb-N) 为文件级链接', () => {
    const content = '[[a/01-序#calibre-pb-5|序]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set());
    expect(result).toBe('[[a/01-序|序]]');
  });
});

describe('stripFabricatedLinks - T1.4 input whitelist (new behavior)', () => {
  it('scope 空 + 无 vaultBlockIds: 链接完全保留', () => {
    // T1.4 修复：移除宽松分支，但 validFileNames.size === 0 时 file_name 检查跳过 → 所有链接保留
    const content = '[[a/01-序|序]]';
    const result = stripFabricatedLinks(content, [], new Set());
    expect(result).toBe('[[a/01-序|序]]');
  });

  it('scope 空 + vaultBlockIds 有内容: 只校验 block_id，file_name 跳过', () => {
    // T1.4：严格分支里 file_name 检查因 validFileNames 为空而跳过
    const content = '[[a/01-序#^ghost|序]] and [[a/02-论#^b1|论]]';
    const result = stripFabricatedLinks(content, [], new Set(['b1']));
    expect(result).toContain('[[a/01-序|序]]');  // ghost 降级
    expect(result).toContain('[[a/02-论#^b1|论]]');  // b1 保留
  });

  it('scope 非空 + 无 vaultBlockIds: 只校验 file_name，block_id 跳过', () => {
    // inputTexts 包含 wiki link → validFileNames 非空
    const content = '[[a/01-序|序]] and [[a/99-不存在的章节|不存在]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set());
    expect(result).toContain('[[a/01-序|序]]');
    expect(result).not.toContain('99-不存在的章节');
  });

  it('scope 非空 + vaultBlockIds 有内容: 两个校验都执行', () => {
    const content = '[[a/01-序#^b1|序]] and [[a/99-不存#^ghost|不存在]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set(['b1']));
    expect(result).toContain('[[a/01-序#^b1|序]]');  // 合法
    expect(result).not.toContain('99-不存');  // 99-不存 被识别为编造
  });

  it('严格分支: fabricated file_name 被 strip 到别名', () => {
    const content = '[[a/01-序|序]] and [[b/完全编造的章节|虚构]]';
    const inputs = ['scope has [[a/01-序|序]] reference'];
    const result = stripFabricatedLinks(content, inputs, new Set());
    expect(result).toContain('[[a/01-序|序]]');
    expect(result).toContain('虚构');
    expect(result).not.toContain('完全编造的章节');
  });
});

/**
 * T3.2 集成测试：验证 S4 formatter 处理顺序中 link-pair-validator 在最前面被调用
 *
 * 简化策略：不直接测 formatterNode（需要 mock LLM stream），
 * 而是验证「如果先调用 validateLinkPairs，残片修复后能进入下游 fixup」。
 */
import { validateLinkPairs } from '@/agent/utils/wiki-link-pair-validator';

describe('S4 formatter 集成：流式截断残片修复 (T3.2)', () => {
  it('链式调用 validateLinkPairs → fixupWikiLinks 修复截断链接', () => {
    // 模拟 streamToContent 末尾被截断（流式中断），输出残留 [[book/01
    const truncated = 'see [[book/01';

    // 步骤 1: 流式截断修复（formatter.ts 中 streamToContent 之后立即调用）
    const pairResult = validateLinkPairs(truncated);
    expect(pairResult.fixedUnpaired).toBe(1);
    expect(pairResult.content).toBe('see [book/01');

    // 步骤 2: 修复后的 content 交给下游 fixup
    const fixed = fixupWikiLinks(pairResult.content, 'book');
    // fixupWikiLinks 不识别 `[book/01`（不是 [[ 开头），所以原样保留
    expect(fixed).toBe('see [book/01');
  });

  it('流式截断 + 完整链接混合：截断残片被剥，完整链接被保留', () => {
    const mixed = '[[book/01-序|序]] and [[book/02-论';

    const pairResult = validateLinkPairs(mixed);
    expect(pairResult.pairedCount).toBe(1);
    expect(pairResult.unpairedCount).toBe(1);
    expect(pairResult.fixedUnpaired).toBe(1);
    expect(pairResult.content).toBe('[[book/01-序|序]] and [book/02-论');

    // 修复后进入 fixup: 完整 [[book/01-序|序]] 已有 bookName 前缀，fixup 不动
    const fixed = fixupWikiLinks(pairResult.content, 'book');
    expect(fixed).toContain('[[book/01-序|序]]');  // 完整保留
    expect(fixed).toContain('[book/02-论');  // 残片不带 [[ 不被改
  });

  it('流式截断：裸文件名残片经 pair 修复后能进入 fixup 加前缀', () => {
    // LLM 偶尔输出 [[裸名（流中断），残片经 pair 修复后形态是 [裸名
    // 这种 case 实际上进入不了 wiki link 流程（不是 [[ 开头），但确认链路不崩
    const truncated = '[[01-序';

    const pairResult = validateLinkPairs(truncated);
    expect(pairResult.fixedUnpaired).toBe(1);
    expect(pairResult.content).toBe('[01-序');

    // 残片形态，fixup 不识别 - 不会做错的事
    const fixed = fixupWikiLinks(pairResult.content, 'book');
    expect(fixed).toBe('[01-序');
  });

  it('空输入时 linkPair validator 返回原值，下游不报错', () => {
    const pairResult = validateLinkPairs('');
    expect(pairResult.content).toBe('');
    expect(pairResult.fixedUnpaired).toBe(0);

    const fixed = fixupWikiLinks(pairResult.content, 'book');
    expect(fixed).toBe('');
  });
});
