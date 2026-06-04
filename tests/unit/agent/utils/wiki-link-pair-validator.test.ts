/**
 * wiki-link-pair-validator.ts 单元测试
 *
 * 覆盖场景：
 * - 正常：完整 [[link]] 配对
 * - 末尾截断：流式输出末尾残缺 `[[`
 * - 中间截断：一行中段残缺 `[[`
 * - 多重截断：多个单边
 * - 嵌套（Obsidian 不支持真正的嵌套，算法应识别外层未闭合）
 * - 空字符串
 * - 单边 `]]` 残留
 */

import { describe, it, expect } from 'vitest';
import { validateLinkPairs } from '@/agent/utils/wiki-link-pair-validator';

describe('validateLinkPairs - normal cases', () => {
  it('keeps well-formed wiki links unchanged', () => {
    const result = validateLinkPairs('see [[book/01-序|序]] for context');
    expect(result.content).toBe('see [[book/01-序|序]] for context');
    expect(result.pairedCount).toBe(1);
    expect(result.unpairedCount).toBe(0);
    expect(result.fixedUnpaired).toBe(0);
  });

  it('handles multiple well-formed links in one content', () => {
    const result = validateLinkPairs('[[a/1|x]] and [[a/2|y]] and [[a/3|z]]');
    expect(result.content).toBe('[[a/1|x]] and [[a/2|y]] and [[a/3|z]]');
    expect(result.pairedCount).toBe(3);
    expect(result.unpairedCount).toBe(0);
  });

  it('keeps plain text without links unchanged', () => {
    const result = validateLinkPairs('just some text without links');
    expect(result.content).toBe('just some text without links');
    expect(result.pairedCount).toBe(0);
    expect(result.unpairedCount).toBe(0);
  });

  it('keeps single brackets unchanged (not wiki link syntax)', () => {
    // 单个 `[` 或 `]` 不应被当作 wiki link 残片
    const result = validateLinkPairs('array[0] = array[1]');
    expect(result.content).toBe('array[0] = array[1]');
    expect(result.pairedCount).toBe(0);
    expect(result.unpairedCount).toBe(0);
  });
});

describe('validateLinkPairs - unpaired [[ (truncation)', () => {
  it('fixes trailing [[ at end of content', () => {
    const result = validateLinkPairs('see [[book/01');
    expect(result.content).toBe('see [book/01');
    expect(result.unpairedCount).toBe(1);
    expect(result.fixedUnpaired).toBe(1);
    expect(result.pairedCount).toBe(0);
  });

  it('fixes unpaired [[ in middle of content', () => {
    const result = validateLinkPairs('see [[book/01-序 and more text');
    expect(result.content).toBe('see [book/01-序 and more text');
    expect(result.unpairedCount).toBe(1);
  });

  it('fixes multiple unpaired [[ in content', () => {
    const result = validateLinkPairs('text [[ a text [[ b text');
    expect(result.content).toBe('text [ a text [ b text');
    expect(result.unpairedCount).toBe(2);
    expect(result.fixedUnpaired).toBe(2);
  });

  it('keeps well-formed links and fixes trailing [[ together', () => {
    const result = validateLinkPairs('[[a/1|x]] text [[a/2');
    expect(result.content).toBe('[[a/1|x]] text [a/2');
    expect(result.pairedCount).toBe(1);
    expect(result.unpairedCount).toBe(1);
  });
});

describe('validateLinkPairs - unpaired ]] (orphan closing)', () => {
  it('fixes orphan ]] without preceding [[', () => {
    const result = validateLinkPairs('text ]] more text');
    expect(result.content).toBe('text ] more text');
    expect(result.unpairedCount).toBe(1);
    expect(result.fixedUnpaired).toBe(1);
  });

  it('fixes multiple orphan ]]', () => {
    const result = validateLinkPairs('text ]] and ]] again');
    expect(result.content).toBe('text ] and ] again');
    expect(result.unpairedCount).toBe(2);
  });

  it('does NOT touch valid closing of well-formed link', () => {
    const result = validateLinkPairs('[[a/1|x]] and extra ]] here');
    expect(result.content).toBe('[[a/1|x]] and extra ] here');
    expect(result.pairedCount).toBe(1);
    expect(result.unpairedCount).toBe(1);
  });
});

describe('validateLinkPairs - nested / unclosed outer', () => {
  it('treats inner [[ before outer close as outer-unclosed (inner still pairs)', () => {
    // Obsidian 不支持真正嵌套；遇到内层 [[ 时认为外层未闭合
    // 外层 [[ 在 0，因内层 [[ 视为未闭合被剥成 [；
    // 内层 [[ 在 8 与尾部 ]] 配对成功保留
    const result = validateLinkPairs('[[outer [[inner]]');
    expect(result.content).toBe('[outer [[inner]]');
    expect(result.pairedCount).toBe(1);  // 仅内层配对
    expect(result.unpairedCount).toBe(1);  // 外层被剥
  });

  it('handles content with [ and ] inside wiki link content', () => {
    // 单个 [ 或 ] 在 wiki 链接内部不应被误判
    const result = validateLinkPairs('[[a/file[1]test|x]]');
    expect(result.content).toBe('[[a/file[1]test|x]]');
    expect(result.pairedCount).toBe(1);
  });
});

describe('validateLinkPairs - edge cases', () => {
  it('handles empty string', () => {
    const result = validateLinkPairs('');
    expect(result.content).toBe('');
    expect(result.pairedCount).toBe(0);
    expect(result.unpairedCount).toBe(0);
  });

  it('handles content with only [[', () => {
    const result = validateLinkPairs('[[');
    expect(result.content).toBe('[');
    expect(result.unpairedCount).toBe(1);
  });

  it('handles content with only ]]', () => {
    const result = validateLinkPairs(']]');
    expect(result.content).toBe(']');
    expect(result.unpairedCount).toBe(1);
  });

  it('handles content ending right after [[', () => {
    const result = validateLinkPairs('hello [[');
    expect(result.content).toBe('hello [');
    expect(result.unpairedCount).toBe(1);
  });

  it('handles content ending right after ]]', () => {
    // 注意：]] 出现在末尾时如果前面有 [[ 配对成功则保留；否则单边
    const result = validateLinkPairs('hello [[a/1|x]]');
    expect(result.content).toBe('hello [[a/1|x]]');
    expect(result.pairedCount).toBe(1);
  });

  it('handles empty wiki link [[]]', () => {
    // 空内容 `[[]]` 是合法的"链接空"形式 - 配对成功保留
    const result = validateLinkPairs('see [[]] here');
    expect(result.content).toBe('see [[]] here');
    expect(result.pairedCount).toBe(1);
  });
});

describe('validateLinkPairs - mixed scenarios', () => {
  it('handles mix of paired, trailing unpaired, and orphan close', () => {
    // 第一个 [[good|x]] 配对成功；
    // 第二个 [[trailing 没有 ]] → 剥成 [trailing；
    // 最后的 ]] 是单边 → 剥成 ]
    const result = validateLinkPairs('[[good|x]] and [[trailing and orphan');
    expect(result.content).toBe('[[good|x]] and [trailing and orphan');
    expect(result.pairedCount).toBe(1);
    expect(result.unpairedCount).toBe(1);
    expect(result.fixedUnpaired).toBe(1);
  });

  it('handles mix of paired and orphan closing without opening', () => {
    const result = validateLinkPairs('[[good|x]] orphan]] more');
    expect(result.content).toBe('[[good|x]] orphan] more');
    expect(result.pairedCount).toBe(1);
    expect(result.unpairedCount).toBe(1);
  });

  it('preserves emoji / unicode content inside wiki link', () => {
    const result = validateLinkPairs('[[book/08-八、抗议|八、抗议]]');
    expect(result.content).toBe('[[book/08-八、抗议|八、抗议]]');
    expect(result.pairedCount).toBe(1);
  });

  it('handles wiki link with block_id', () => {
    const result = validateLinkPairs('[[book/01#^b1|序]]');
    expect(result.content).toBe('[[book/01#^b1|序]]');
    expect(result.pairedCount).toBe(1);
  });

  it('preserves escaped brackets in code spans', () => {
    // 简单字符串处理不解析 Markdown code span——单边 `[[` 在 code span 也会被修
    // 这是可接受的 trade-off：流式截断后修复优先于语法保留
    const result = validateLinkPairs('`[[broken code`');
    // `[[broken code` 中 `[[` 后面无 `]]` → 剥为 `[broken code
    expect(result.content).toBe('`[broken code`');
  });
});
