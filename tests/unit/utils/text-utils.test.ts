import { describe, it, expect } from 'vitest';
import { CJK_STOPWORDS } from '@/utils/text-utils';

describe('CJK_STOPWORDS', () => {
  it('is a Set', () => {
    expect(CJK_STOPWORDS).toBeInstanceOf(Set);
  });

  it('contains common Chinese stop words', () => {
    expect(CJK_STOPWORDS.has('的')).toBe(true);
    expect(CJK_STOPWORDS.has('了')).toBe(true);
    expect(CJK_STOPWORDS.has('是')).toBe(true);
    expect(CJK_STOPWORDS.has('在')).toBe(true);
    expect(CJK_STOPWORDS.has('什么')).toBe(true);
    expect(CJK_STOPWORDS.has('如何')).toBe(true);
  });

  it('contains exactly 47 words', () => {
    expect(CJK_STOPWORDS.size).toBe(47);
  });

  it('does not contain meaningful content words', () => {
    expect(CJK_STOPWORDS.has('搜索')).toBe(false);
    expect(CJK_STOPWORDS.has('分析')).toBe(false);
    expect(CJK_STOPWORDS.has('管理')).toBe(false);
  });
});
