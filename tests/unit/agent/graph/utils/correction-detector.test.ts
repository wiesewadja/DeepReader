import { describe, it, expect } from 'vitest';
import { detectCorrection, correctionReason, CORRECTION_RULES } from '@/agent/graph/utils/correction-detector';

describe('detectCorrection', () => {
  describe('true positives — actual pushback signals', () => {
    it('detects "不，..." at start of message (T2 case)', () => {
      expect(detectCorrection('不，[[24 - ]] 这里就有这个概念')).toBe(true);
    });

    it('detects "不对" anywhere in message', () => {
      expect(detectCorrection('你的回答不对，应该是')).toBe(true);
    });

    it('detects "错了"', () => {
      expect(detectCorrection('章节引用错了，再看看')).toBe(true);
    });

    it('detects "再搜索" (T1 case)', () => {
      expect(detectCorrection('再搜索下 回报函数工程')).toBe(true);
    });

    it('detects "重新搜"', () => {
      expect(detectCorrection('请重新搜一下')).toBe(true);
    });

    it('detects "再找"', () => {
      expect(detectCorrection('再找找看这个术语')).toBe(true);
    });

    it('detects "这里就有" (T0/T2 case)', () => {
      expect(detectCorrection('这里就有这个概念')).toBe(true);
    });

    it('detects "明明有"', () => {
      expect(detectCorrection('明明有这个概念的啊')).toBe(true);
    });

    it('detects "确定有"', () => {
      expect(detectCorrection('我确定有这个概念')).toBe(true);
    });

    it('detects "是有的"', () => {
      expect(detectCorrection('是有的，你没找到')).toBe(true);
    });

    it('detects "搞错"', () => {
      expect(detectCorrection('你搞错章节了')).toBe(true);
    });
  });

  describe('false positives we should AVOID', () => {
    it('short affirmative "好的" is NOT a correction', () => {
      expect(detectCorrection('好的')).toBe(false);
    });

    it('empty message is NOT a correction', () => {
      expect(detectCorrection('')).toBe(false);
    });

    it('normal follow-up "继续" is NOT a correction', () => {
      expect(detectCorrection('继续')).toBe(false);
    });

    it('non-correction question "什么是回报函数工程" (T3 first ask) is NOT a correction', () => {
      // T3 was the user's first time asking — no prior "未出现" to refute
      expect(detectCorrection('什么是回报函数工程')).toBe(false);
    });

    it('non-correction follow-up "还有其他例子吗" is NOT a correction', () => {
      expect(detectCorrection('还有其他例子吗')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined gracefully', () => {
      expect(detectCorrection(null as any)).toBe(false);
      expect(detectCorrection(undefined as any)).toBe(false);
    });

    it('returns the matched reason for logging', () => {
      expect(correctionReason('不，这里就有')).toBe('开头否定');
      expect(correctionReason('再搜索一下')).toBe('重新检索');
      expect(correctionReason('明明有的')).toBe('坚持存在');
    });
  });

  describe('pattern coverage', () => {
    it('CORRECTION_RULES is non-empty', () => {
      expect(CORRECTION_RULES.length).toBeGreaterThan(5);
    });

    it('every rule has a reason for debugging', () => {
      for (const r of CORRECTION_RULES) {
        expect(r.reason).toBeTruthy();
        expect(r.reason.length).toBeGreaterThan(0);
      }
    });

    it('has both Chinese substring and English regex coverage', () => {
      const substrRules = CORRECTION_RULES.filter(r => r.substring);
      const regexRules = CORRECTION_RULES.filter(r => r.regex);
      expect(substrRules.length).toBeGreaterThan(10);
      expect(regexRules.length).toBeGreaterThan(0);
    });
  });
});
